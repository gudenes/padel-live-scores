package com.padelnachos.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Custom FCM service for Padel Nachos. Extends the Capacitor plugin's
 * MessagingService so JS still receives push events for foreground apps
 * (via super.onMessageReceived), then builds + posts a system notification
 * for data-only messages with a downloaded largeIcon (player avatar or
 * circuit logo). Without this, the default FCM auto-display can't load
 * URL-based largeIcons — the right-side round avatar would never appear.
 *
 * Wired in AndroidManifest.xml; replaces the default Capacitor service
 * (the plugin's manifest entry is removed via tools:node="remove").
 */
public class PadelMessagingService extends MessagingService {
    private static final String TAG = "PadelPush";
    private static final String CHANNEL_ID = "padel_default";
    private static final String DEEP_LINK_HOST = "https://padelnachos.com";
    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        // Let Capacitor dispatch the message to JS so foreground listeners
        // still fire (e.g. in-app toast handlers).
        super.onMessageReceived(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        if (data == null || data.isEmpty()) return;

        final String title = data.get("title");
        final String body = data.get("body");
        if (title == null || body == null) return;

        final String iconUrl = data.get("icon");
        final String url = data.get("url");
        final String tag = data.get("tag");

        // Download icon off the main thread; post the notification once
        // the bitmap (or null) is ready. Network failure produces a
        // text-only notification — never blocks delivery.
        EXEC.execute(() -> {
            Bitmap largeIcon = (iconUrl != null && !iconUrl.isEmpty())
                ? downloadBitmap(iconUrl)
                : null;
            postNotification(title, body, url, tag, largeIcon);
        });
    }

    private void postNotification(String title, String body, String url, String tag, Bitmap largeIcon) {
        ensureChannel();

        PendingIntent pi = PendingIntent.getActivity(
            this,
            (tag != null ? tag.hashCode() : 0),
            buildClickIntent(url),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        // Small icon = dedicated white paddle silhouette at
        // res/drawable-*/ic_stat_padelnachos.png. The PNG is authored as a
        // transparent-bg outline silhouette (extracted from
        // public/padelNachos - Branding/.../logo notification.png) so the
        // alpha channel correctly defines the paddle shape — including the
        // dot cutouts in the face. Android (and all device skins) tint the
        // silhouette with setColor (brand lime) → renders as a lime paddle
        // outline on the green-tint notification circle. This is the
        // WhatsApp/Spotify approach and it works consistently across
        // Pixel, Samsung, Xiaomi HyperOS, OnePlus, OPPO.
        //
        // Previously tried pointing setSmallIcon at R.mipmap.ic_launcher
        // (the full-color launcher icon). Failed on Xiaomi HyperOS: the
        // legacy raster ic_launcher.png is a fully-opaque green tile, and
        // Xiaomi silhouettes the WHOLE tile to a solid lime square. The
        // adaptive icon (mipmap-anydpi-v26/ic_launcher.xml) does have a
        // proper transparent-bg paddle foreground, but Xiaomi notifications
        // don't follow the adaptive-icon spec — they always use the legacy
        // raster mipmap PNG for notification silhouetting. So we keep a
        // dedicated ic_stat_* drawable for notifications.
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_padelnachos)
            .setColor(getResources().getColor(R.color.brand_lime, getTheme()))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setContentIntent(pi);

        if (largeIcon != null) {
            builder.setLargeIcon(largeIcon);
        }

        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        // Per-match tag → re-fires update the existing notification
        // instead of stacking. Same behavior as the Web Push `tag` field.
        int notifId = (tag != null) ? tag.hashCode() : (int) System.currentTimeMillis();
        nm.notify(notifId, builder.build());
    }

    private Intent buildClickIntent(String urlPath) {
        // Path-style URLs (e.g. "/match/abc-123") get prefixed with the
        // production host so Android matches the deep-link intent filter
        // declared in AndroidManifest.xml. Absolute URLs pass through.
        String full;
        if (urlPath == null || urlPath.isEmpty()) {
            full = DEEP_LINK_HOST + "/";
        } else if (urlPath.startsWith("http")) {
            full = urlPath;
        } else {
            full = DEEP_LINK_HOST + urlPath;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(full));
        intent.setPackage(getPackageName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return intent;
    }

    private Bitmap downloadBitmap(String urlStr) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.connect();
            try (InputStream input = conn.getInputStream()) {
                return BitmapFactory.decodeStream(input);
            }
        } catch (Exception e) {
            Log.w(TAG, "icon download failed: " + urlStr, e);
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
        if (existing != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Match notifications",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Live and finished match alerts");
        nm.createNotificationChannel(channel);
    }
}
