//
//  NotificationService.swift
//  PadelNotificationService
//
//  Notification Service Extension that runs BEFORE iOS displays a push,
//  letting us attach the player avatar / circuit logo image referenced
//  in the push payload. Achieves Android-parity for rich-media
//  notifications (where PadelMessagingService already does this on the
//  Java side).
//
//  How it works:
//    1. APNs delivers a push to the device. The payload includes
//       `mutable-content: 1` (added by firebase-admin automatically when
//       we send `apns.fcmOptions.imageUrl` — see src/lib/push-fcm.ts).
//    2. iOS sees `mutable-content: 1` and routes the push to THIS
//       extension before showing it to the user.
//    3. `didReceive(...)` is called with the raw notification request.
//    4. `Messaging.serviceExtension().populateNotificationContent(...)`
//       downloads the image URL from `fcmOptions.imageUrl`, attaches it
//       to the UNMutableNotificationContent as a UNNotificationAttachment,
//       and hands back the modified content via the contentHandler.
//    5. iOS now displays the notification with the image attached — the
//       player avatar appears next to the lock-screen banner / under the
//       text in the notification tray.
//
//  Bundle identifier: com.padelnachos.app.NotificationService
//  Deployment target: must match the main app target (iOS 13.0+)
//  Required SPM dependency on this target: FirebaseMessaging
//
//  Cost in IPA: ~100 KB compiled. Runs in a separate sandboxed process
//  with a 30-second wall-clock budget enforced by iOS.

import UserNotifications
import FirebaseMessaging

class NotificationService: UNNotificationServiceExtension {

  // We retain these so `serviceExtensionTimeWillExpire` can still
  // deliver the best-attempt content if the image download stalls.
  var contentHandler: ((UNNotificationContent) -> Void)?
  var bestAttemptContent: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

    guard let bestAttemptContent = bestAttemptContent else {
      contentHandler(request.content)
      return
    }

    // Firebase's helper handles everything for us: parses the
    // fcmOptions.imageUrl from the APNs payload, downloads the image
    // (with the standard 30-second cap iOS enforces on extensions),
    // creates a UNNotificationAttachment, and stitches it back into
    // the content. If the URL is missing or fails to download, it
    // returns the original content unchanged — no error path needed
    // on our side.
    Messaging.serviceExtension().populateNotificationContent(
      bestAttemptContent,
      withContentHandler: contentHandler
    )
  }

  override func serviceExtensionTimeWillExpire() {
    // iOS is about to kill us — ship whatever we've got so the user
    // still sees the notification (just without the image attachment
    // if the download didn't finish in time).
    if let contentHandler = contentHandler,
       let bestAttemptContent = bestAttemptContent {
      contentHandler(bestAttemptContent)
    }
  }
}
