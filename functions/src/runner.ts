/**
 * CLI entry point for running one poll tick outside Cloud Functions.
 *
 * Used by .github/workflows/poll.yml so the whole backend can run on the free
 * Spark plan: Firestore writes and FCM sends are both free, and only the
 * *scheduler* needed Blaze. This imports the same `tick()` the Cloud Function
 * uses, so there is exactly one implementation of the polling and alert rules.
 *
 * Credentials come from GOOGLE_APPLICATION_CREDENTIALS, which the workflow
 * points at a service-account key materialised from a GitHub secret.
 *
 * Run locally with:
 *   GOOGLE_APPLICATION_CREDENTIALS=key.json node lib/runner.js
 */
import { initializeApp } from "firebase-admin/app";
import { tick } from "./poller";

initializeApp();

tick(new Date())
  .then((out) => {
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error("tick failed:", err);
    process.exit(1);
  });
