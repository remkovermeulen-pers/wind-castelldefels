import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getMessaging, isSupported, type Messaging } from "firebase/messaging";
import { firebaseConfig } from "./firebase-config";

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

/**
 * Messaging is unavailable in a few contexts we still want the graph to work
 * in: plain Safari on iOS (push only works once the PWA is installed to the
 * home screen), private windows, and browsers without the Push API.
 */
let messagingPromise: Promise<Messaging | null> | null = null;

export function getMessagingIfSupported(): Promise<Messaging | null> {
  if (!messagingPromise) {
    messagingPromise = isSupported().then((ok) => (ok ? getMessaging(app) : null));
  }
  return messagingPromise;
}
