/* Firebase Cloud Messaging service worker.
 *
 * Handles pushes that arrive while the PWA is closed or backgrounded.
 * Uses the compat SDK because service workers cannot use ES module imports
 * reliably across browsers.
 *
 * The config comes from /__/firebase/init.js, a reserved path that Firebase
 * Hosting populates with this project's settings automatically — so there is
 * no config to keep in sync here. (This path only exists on Firebase Hosting,
 * not under `vite dev`.)
 */
importScripts("https://www.gstatic.com/firebasejs/11.2.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.2.0/firebase-messaging-compat.js");
importScripts("/__/firebase/init.js");

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || "Castelldefels Wind", {
    body: n.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    tag: (payload.data && payload.data.tag) || "wind",
    renotify: true,
  });
});

// Focus an existing tab if the app is already open, otherwise open one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    })
  );
});
