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
//  Why we do the download manually instead of calling
//  Messaging.serviceExtension().populateNotificationContent():
//  Firebase's helper reads userInfo["fcm_options"]["image"] but Lia's
//  build 8 logged `attachments: 0` from the helper despite the server
//  sending apns.fcmOptions.imageUrl. The key path FCM v1 uses to
//  serialize that field has diverged across SDK versions, and the
//  helper silently no-ops when it doesn't find the key. Doing the
//  download manually means we control the contract end-to-end:
//
//    server  → data.icon = "https://..."
//    iOS NSE → userInfo["icon"] → download → attach
//
//  Same contract Android's PadelMessagingService uses, so the server
//  payload is symmetric across both transports.
//
//  We ALSO check fcm_options.image as a fallback in case FCM stripped
//  the data block. Multiple lookups, log everything for diagnosis.
//
//  Bundle identifier: com.padelnachos.app.PadelNotificationService
//  Deployment target: iOS 15.0+
//
//  Runs in a sandboxed process with a 30-second wall-clock budget.
//  We cap the download at 10s to leave headroom for serialization.

import UserNotifications
import os

private let log = OSLog(subsystem: "com.padelnachos.app.PadelNotificationService", category: "nse")

class NotificationService: UNNotificationServiceExtension {

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

    // Dump userInfo keys so the next device-log capture shows exactly
    // what FCM delivered. Helps diagnose where the image URL landed.
    let topLevelKeys = bestAttemptContent.userInfo.keys
      .compactMap { $0 as? String }
      .joined(separator: ",")
    os_log("NSE didReceive — userInfo top-level keys: %{public}@", log: log, type: .info, topLevelKeys)

    guard let urlString = extractImageURL(from: bestAttemptContent.userInfo),
          let url = URL(string: urlString),
          let scheme = url.scheme?.lowercased(),
          scheme == "http" || scheme == "https" else {
      os_log("NSE — no image URL found in payload, delivering text-only", log: log, type: .info)
      contentHandler(bestAttemptContent)
      return
    }

    os_log("NSE — attempting image download from %{public}@", log: log, type: .info, urlString)
    downloadAttachment(from: url) { [weak self] attachment in
      guard let self = self, let bestAttemptContent = self.bestAttemptContent else { return }
      if let attachment = attachment {
        bestAttemptContent.attachments = [attachment]
        os_log("NSE — attached image successfully", log: log, type: .info)
      } else {
        os_log("NSE — image download failed, delivering text-only", log: log, type: .error)
      }
      contentHandler(bestAttemptContent)
    }
  }

  override func serviceExtensionTimeWillExpire() {
    os_log("NSE — time will expire, delivering best-attempt", log: log, type: .info)
    if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
      contentHandler(bestAttemptContent)
    }
  }

  // MARK: - URL extraction
  //
  // Tries multiple possible locations for the image URL. The server
  // populates data.icon (which lands in userInfo["icon"] on iOS), but
  // we also try fcm_options.image (Firebase's standard path) and
  // a couple of other shapes seen in the wild.

  private func extractImageURL(from userInfo: [AnyHashable: Any]) -> String? {
    // Primary: our own data block (matches Android contract)
    if let icon = userInfo["icon"] as? String, !icon.isEmpty {
      return icon
    }
    // Fallback 1: Firebase's standard key (what populateNotificationContent reads)
    if let fcmOptions = userInfo["fcm_options"] as? [String: Any],
       let image = fcmOptions["image"] as? String, !image.isEmpty {
      return image
    }
    // Fallback 2: gcm.notification.image (older FCM payload shape)
    if let gcmImage = userInfo["gcm.notification.image"] as? String, !gcmImage.isEmpty {
      return gcmImage
    }
    return nil
  }

  // MARK: - Image download

  private func downloadAttachment(from url: URL, completion: @escaping (UNNotificationAttachment?) -> Void) {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 10
    config.timeoutIntervalForResource = 10
    let session = URLSession(configuration: config)

    let task = session.downloadTask(with: url) { localURL, response, error in
      if let error = error {
        os_log("NSE — download error: %{public}@", log: log, type: .error, error.localizedDescription)
        completion(nil)
        return
      }
      guard let localURL = localURL else {
        os_log("NSE — download returned nil localURL", log: log, type: .error)
        completion(nil)
        return
      }

      // iOS picks the thumbnail renderer based on file extension. Default
      // to .png since most of our URLs are PNG (avatars + circuit logos).
      let pathExt = url.pathExtension.isEmpty ? "png" : url.pathExtension
      let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
      let destURL = tmpDir
        .appendingPathComponent(UUID().uuidString)
        .appendingPathExtension(pathExt)

      do {
        try FileManager.default.moveItem(at: localURL, to: destURL)
        let attachment = try UNNotificationAttachment(identifier: "icon", url: destURL, options: nil)
        completion(attachment)
      } catch {
        os_log("NSE — attachment creation error: %{public}@", log: log, type: .error, error.localizedDescription)
        completion(nil)
      }
    }
    task.resume()
  }
}
