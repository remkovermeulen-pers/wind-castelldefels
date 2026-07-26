/**
 * Firebase web configuration.
 *
 * These values are public by design — a web app ships them to every visitor.
 * Access is protected by the Firestore security rules (firestore.rules), which
 * make all client writes impossible; the poller writes via the Admin SDK.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyBgz6AHjI1Qs7TgsGIhhGJ40zs4wrLWqj8",
  authDomain: "wind-castelldefels.firebaseapp.com",
  projectId: "wind-castelldefels",
  storageBucket: "wind-castelldefels.firebasestorage.app",
  messagingSenderId: "307426363109",
  appId: "1:307426363109:web:10ac8be3d7b19d687d760c",
};

/**
 * Web Push certificate (VAPID public key).
 * Firebase console → Project settings → Cloud Messaging → Web Push certificates.
 */
export const vapidKey =
  "BIvhaABfeUAdCtsAEhTiJEVJNZyA4W0BwWt6E7nveoLDxbbR-o2NW6KMCx5mBSpVTzUpZaUmq0uamq95kH-jPMY";

/** Base URL for the Cloud Functions HTTP endpoints (region europe-west1). */
export const functionsBase = "https://europe-west1-wind-castelldefels.cloudfunctions.net";
