import { getToken, onMessage } from "firebase/messaging";
import { getMessagingIfSupported } from "./firebase";
import { functionsBase, vapidKey } from "./firebase-config";

const TOKEN_KEY = "wind.fcmToken";

export type NotifyState =
  | { kind: "on" }
  | { kind: "off" }
  | { kind: "blocked" }
  | { kind: "unsupported"; reason: string };

/** iOS only exposes the Push API to a PWA that has been added to the home screen. */
function isIosSafariNotInstalled(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export async function currentState(): Promise<NotifyState> {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    return {
      kind: "unsupported",
      reason: isIosSafariNotInstalled()
        ? "Add to Home Screen first"
        : "Not supported here",
    };
  }
  if (isIosSafariNotInstalled()) {
    return { kind: "unsupported", reason: "Add to Home Screen first" };
  }
  if (Notification.permission === "denied") return { kind: "blocked" };
  if (Notification.permission === "granted" && localStorage.getItem(TOKEN_KEY)) {
    return { kind: "on" };
  }
  return { kind: "off" };
}

/**
 * Requests permission, mints an FCM token against our own service worker
 * registration, and hands it to the backend so the poller can reach this
 * device.
 */
export async function enable(): Promise<NotifyState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { kind: "blocked" };

  const messaging = await getMessagingIfSupported();
  if (!messaging) return { kind: "unsupported", reason: "Push unavailable" };

  const registration = await navigator.serviceWorker.register(
    "/firebase-messaging-sw.js",
    { scope: "/" }
  );
  await navigator.serviceWorker.ready;

  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token) return { kind: "off" };

  const res = await fetch(`${functionsBase}/registerToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(`registerToken failed: HTTP ${res.status}`);

  localStorage.setItem(TOKEN_KEY, token);

  // Surface pushes that land while the app is in the foreground; FCM
  // suppresses the automatic notification in that case.
  onMessage(messaging, (payload) => {
    const { title, body } = payload.notification ?? {};
    if (title) new Notification(title, { body, icon: "/icons/icon-192.png" });
  });

  return { kind: "on" };
}

export async function disable(): Promise<NotifyState> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    await fetch(`${functionsBase}/unregisterToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => undefined);
    localStorage.removeItem(TOKEN_KEY);
  }
  return { kind: "off" };
}
