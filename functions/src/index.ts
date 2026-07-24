import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

import { tick } from "./poller";
import { ZONE } from "./time";

initializeApp();

const REGION = "europe-west1";

/**
 * Ticks every 5 minutes across the widest window either source needs — wind
 * runs 08:00–20:00 and the kite zone 12:00–21:00, so the schedule spans
 * 08:00–21:00. Cron runs in Europe/Madrid so this tracks CET/CEST.
 *
 * Requires the Blaze plan. The GitHub Actions workflow in
 * .github/workflows/poll.yml runs the same `tick()` on the free plan —
 * run one or the other, not both, or every reading is stored twice.
 */
export const poll = onSchedule(
  {
    schedule: "*/5 8-21 * * *",
    timeZone: ZONE,
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
    retryCount: 1,
  },
  async () => {
    logger.info("tick", await tick(new Date()));
  }
);

/** Manual trigger for debugging — same code path as the scheduled tick. */
export const pollNow = onRequest(
  { region: REGION, timeoutSeconds: 60, cors: true },
  async (_req, res) => {
    res.json(await tick(new Date()));
  }
);

/**
 * Stores a web-push registration token. Called by the PWA after the user
 * grants notification permission. Keyed by token so re-registration is
 * idempotent and Firestore rules can stay read-only for clients.
 */
export const registerToken = onRequest(
  { region: REGION, cors: true },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only" });
      return;
    }

    const token = String(req.body?.token ?? "").trim();
    if (!token || token.length > 4096) {
      res.status(400).json({ error: "Missing or invalid token" });
      return;
    }

    await getFirestore().collection("tokens").doc(token).set(
      {
        userAgent: String(req.get("user-agent") ?? "").slice(0, 300),
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.info("Token registered");
    res.json({ ok: true });
  }
);

/** Removes a token when the user turns notifications off. */
export const unregisterToken = onRequest(
  { region: REGION, cors: true },
  async (req, res) => {
    const token = String(req.body?.token ?? "").trim();
    if (!token) {
      res.status(400).json({ error: "Missing token" });
      return;
    }
    await getFirestore().collection("tokens").doc(token).delete();
    res.json({ ok: true });
  }
);
