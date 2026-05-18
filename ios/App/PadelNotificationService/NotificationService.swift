//
//  NotificationService.swift
//  PadelNotificationService
//
//  iOS Notification Service Extension for Padel Nachos.
//
//  Apple only renders image attachments on push notifications via an NSE —
//  there's no server-only way to do it. This extension runs in its own
//  sandboxed process whenever an incoming push has `aps.mutable-content: 1`,
//  BEFORE iOS displays the notification. We read the `icon` URL from
//  userInfo (FCM merges the `data` block into userInfo), download the
//  image, and attach it as a UNNotificationAttachment.
//
//  The result is the round avatar/circuit-logo image that appears on the
//  right side of the lock-screen / Notification Center row — matching
//  Android's largeIcon behavior in PadelMessagingService.java.
//
//  Mirrors the data-payload contract used on Android (key: `icon`,
//  absolute URL). See src/lib/push-fcm.ts for the server side.
//
//  iOS gives the NSE ~30 seconds. If the download takes longer or fails,
//  serviceExtensionTimeWillExpire() fires and we deliver the notification
//  without the attachment — title/body still render.
//

import UserNotifications

class NotificationService: UNNotificationServiceExtension {

    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        self.bestAttemptContent = request.content.mutableCopy() as? UNMutableNotificationContent

        guard let bestAttemptContent = bestAttemptContent else {
            contentHandler(request.content)
            return
        }

        // Pull the image URL out of userInfo. FCM v1 merges `data` fields
        // into userInfo on iOS, so a server-side `data.icon = "https://..."`
        // surfaces here as userInfo["icon"].
        guard let urlString = bestAttemptContent.userInfo["icon"] as? String,
              let url = URL(string: urlString),
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            // No icon (or malformed) — deliver text-only notification.
            contentHandler(bestAttemptContent)
            return
        }

        downloadAttachment(from: url) { [weak self] attachment in
            guard let self = self, let bestAttemptContent = self.bestAttemptContent else { return }
            if let attachment = attachment {
                bestAttemptContent.attachments = [attachment]
            }
            contentHandler(bestAttemptContent)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        // Fired ~30s in. Deliver whatever we have so the user still sees
        // the notification — losing the image is better than losing the
        // whole alert.
        if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
            contentHandler(bestAttemptContent)
        }
    }

    // MARK: - Image download

    private func downloadAttachment(from url: URL, completion: @escaping (UNNotificationAttachment?) -> Void) {
        // 10s ceiling so we leave headroom under the 30s NSE budget.
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 10
        let session = URLSession(configuration: config)

        let task = session.downloadTask(with: url) { localURL, response, error in
            guard error == nil, let localURL = localURL else {
                completion(nil)
                return
            }

            // iOS picks the thumbnail renderer based on file extension.
            // Default to .png when the URL has no extension (Supabase
            // Storage avatar URLs sometimes drop it).
            let pathExt = url.pathExtension.isEmpty ? "png" : url.pathExtension
            let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            let destURL = tmpDir
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension(pathExt)

            do {
                try FileManager.default.moveItem(at: localURL, to: destURL)
                let attachment = try UNNotificationAttachment(
                    identifier: "icon",
                    url: destURL,
                    options: [
                        // Force the renderer to treat it as a thumbnail rather
                        // than the giant in-line preview. Without this, iOS
                        // will sometimes show the image full-width in the
                        // expanded notification view.
                        UNNotificationAttachmentOptionsThumbnailHiddenKey: false,
                    ]
                )
                completion(attachment)
            } catch {
                completion(nil)
            }
        }
        task.resume()
    }
}
