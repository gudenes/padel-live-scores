// src/lib/push-plugin.ts
//
// Unified loader for Capacitor push plugins with a fallback chain.
//
// History — why this exists:
//   - Pre-2026-05-17 the Android app used @capacitor/push-notifications.
//     That plugin is built into every AAB shipped before May 17.
//   - On 2026-05-17 (commit ca074016) `cap sync` swapped in
//     @capacitor-firebase/messaging to share one plugin between iOS and
//     Android. The JS code switched to call the new plugin.
//   - Users on AABs older than May 17 don't have the new plugin's native
//     side. Calls hit "FirebaseMessaging plugin is not implemented on
//     android" and silently strand the user with no push registration.
//
// This loader tries the modern plugin first (the long-term winner). If it
// reports as not-implemented, it falls back to the legacy plugin — which
// is still wired into the same AABs and still produces a valid FCM token
// (both plugins ultimately register with the same Firebase project). The
// fallback lets us un-strand old-AAB users without forcing a Play Store
// release, and stays correct for fresh installs that have only the new
// plugin once the legacy one is eventually removed.
//
// Shape returned by loadPushPlugin():
//   { requestPermissions, getToken, kind }
//
// Both transports normalize permission to NotificationPermission and
// token to a plain string. `kind` is exposed for observability (we want
// to know how many users hit the fallback) but callers should not branch
// on it — the contract is "give me a token I can POST to the server".

const FIREBASE_TIMEOUT_MS = 10_000
const LEGACY_TIMEOUT_MS = 10_000

export type PushPluginKind = 'firebase' | 'legacy'

export interface PushPlugin {
  kind: PushPluginKind
  requestPermissions(): Promise<NotificationPermission>
  getToken(): Promise<string>
}

// Capacitor's permission state uses a different vocabulary
// ('granted' | 'denied' | 'prompt' | 'prompt-with-rationale') than the Web
// Notification API ('granted' | 'denied' | 'default'). Map onto the Web
// shape so the rest of the app can treat both transports uniformly.
function mapNativePermission(
  receive: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale',
): NotificationPermission {
  if (receive === 'granted') return 'granted'
  if (receive === 'denied') return 'denied'
  return 'default'
}

// Heuristic for "modern plugin is missing from the AAB" — Capacitor wraps
// the underlying error and the only stable hint is the substring "not
// implemented". We treat any error containing that phrase as a signal to
// fall back rather than propagate. Anything else (auth error inside the
// plugin, network failure during token fetch) is a real error and should
// surface to the caller.
function isNotImplemented(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.toLowerCase().includes('not implemented')
}

async function tryFirebasePlugin(): Promise<PushPlugin | null> {
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging')
    // Probe with checkPermissions — it's the cheapest call that fully
    // exercises the native bridge. requestPermissions would also work but
    // would surface an OS prompt as a side-effect during the probe.
    await FirebaseMessaging.checkPermissions()
    return {
      kind: 'firebase',
      async requestPermissions() {
        const p = await FirebaseMessaging.requestPermissions()
        return mapNativePermission(p.receive)
      },
      async getToken() {
        const promise = FirebaseMessaging.getToken().then((r) => r.token)
        return withTimeout(promise, FIREBASE_TIMEOUT_MS, 'FirebaseMessaging.getToken')
      },
    }
  } catch (err) {
    if (isNotImplemented(err)) return null
    // Non-not-implemented errors (e.g. user denied at OS level partway
    // through, plugin internal crash) shouldn't trigger fallback — we
    // want them to surface. Caller treats this as a hard failure.
    throw err
  }
}

async function loadLegacyPlugin(): Promise<PushPlugin> {
  const { PushNotifications } = await import('@capacitor/push-notifications')
  return {
    kind: 'legacy',
    async requestPermissions() {
      const p = await PushNotifications.requestPermissions()
      return mapNativePermission(p.receive)
    },
    async getToken() {
      // Legacy plugin doesn't expose getToken() — registration is event-
      // driven: you call register() then wait for the 'registration'
      // listener to fire with the token (or 'registrationError').
      //
      // We attach both listeners BEFORE calling register() to avoid a
      // race where the event fires synchronously on cached-token paths.
      // A one-shot promise resolves on the first event and timeouts after
      // 10s so the UI doesn't hang on a wedged plugin.
      const promise = new Promise<string>((resolve, reject) => {
        let settled = false
        const done = (fn: () => void) => {
          if (settled) return
          settled = true
          fn()
        }
        PushNotifications.addListener('registration', (t) => {
          // The Capacitor listener type is { value: string }
          done(() => resolve(t.value))
        }).catch(() => { /* swallow — listener registration is best-effort */ })
        PushNotifications.addListener('registrationError', (err) => {
          done(() => reject(new Error(err.error || 'Push registrationError')))
        }).catch(() => { /* swallow */ })
        PushNotifications.register().catch((e) => done(() => reject(e)))
      })
      return withTimeout(promise, LEGACY_TIMEOUT_MS, 'PushNotifications.register')
    },
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

/**
 * Resolve a push plugin for this device. Modern plugin wins when its
 * native side is in the AAB; otherwise falls back to the legacy plugin.
 * Throws if neither is usable (e.g. running on a platform that has no
 * native bridge, or when the modern plugin throws a real error).
 */
export async function loadPushPlugin(): Promise<PushPlugin> {
  const modern = await tryFirebasePlugin()
  if (modern) return modern
  return loadLegacyPlugin()
}
