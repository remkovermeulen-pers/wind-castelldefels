import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

import { fetchWind } from "./sources/nudos";
import { fetchZoneStatus, isKiteable, label } from "./sources/mojokite";
import { gateAlerts, sendPush, WIND_ALERT_KNOTS, type AlertKind } from "./alerts";
import { ZONE, localTime, shouldPollWind, shouldPollTwintip } from "./time";

initializeApp();

const REGION = "europe-west1";

/** Readings older than this are pruned so the free Firestore tier stays ample. */
const RETENTION_DAYS = 30;

/**
 * One tick of the poller. Runs every 5 minutes; decides internally which
 * sources are due, so a single Cloud Scheduler job covers both cadences.
 */
async function tick(now: Date): Promise<Record<string, unknown>> {
  const db = getFirestore();
  const t = localTime(now);
  const conditions: Partial<Record<AlertKind, boolean>> = {};
  const result: Record<string, unknown> = { local: `${t.day} ${t.hour}:${String(t.minute).padStart(2, "0")}` };

  // --- Wind: every 5 min, 09:00–19:00 local ------------------------------
  if (shouldPollWind(t)) {
    try {
      const w = await fetchWind();
      await db.collection("readings").doc(now.toISOString()).set({
        ts: Timestamp.fromDate(now),
        actual: w.actual,
        average: w.average,
        gust: w.gust,
        direction: w.direction,
        windName: w.windName,
        tempC: w.tempC,
        pressureHpa: w.pressureHpa,
        humidityPct: w.humidityPct,
        stationTime: w.stationTime,
      });

      conditions.wind = w.average >= WIND_ALERT_KNOTS;
      result.wind = w;
    } catch (err) {
      logger.error("Wind poll failed", err);
      result.windError = String(err);
    }
  }

  // --- Twintip: every 10 min, 12:00–19:00 local --------------------------
  let twintipLabel = "—";
  if (shouldPollTwintip(t)) {
    try {
      const z = await fetchZoneStatus();
      await db.collection("twintip").doc(now.toISOString()).set({
        ts: Timestamp.fromDate(now),
        status: z.status,
        openingTime: z.time,
        foil: z.foil,
        surf: z.surf,
        twintip: z.twintip,
        siteLastUpdate: z.lastUpdate,
      });

      conditions.twintip = isKiteable(z.twintip);
      twintipLabel = label(z.twintip);
      result.twintip = z;
    } catch (err) {
      logger.error("Twintip poll failed", err);
      result.twintipError = String(err);
    }
  }

  // --- Alerts (rising edge only) -----------------------------------------
  const fire = await gateAlerts(t, conditions);
  result.fired = fire;

  const wind = result.wind as { average: number; gust: number; direction: string } | undefined;

  for (const kind of fire) {
    if (kind === "twintip") {
      await sendPush({
        title: `🪁 Twintip: ${twintipLabel}`,
        body: wind
          ? `Zona kite Castelldefels · ${wind.average} kn avg, ${wind.gust} kn gusts (${wind.direction})`
          : "Zona kite Castelldefels — twintip status just improved.",
        tag: "twintip",
      });
    } else if (kind === "wind" && wind) {
      await sendPush({
        title: `💨 ${wind.average} kn average at Castelldefels`,
        body: `At or above ${WIND_ALERT_KNOTS} kn · gusts ${wind.gust} kn · ${wind.direction}`,
        tag: "wind",
      });
    }
  }

  // --- Retention: prune once a day on the last tick of the window --------
  if (t.hour === 19 && t.minute === 0) {
    const cutoff = Timestamp.fromMillis(now.getTime() - RETENTION_DAYS * 864e5);
    for (const col of ["readings", "twintip"]) {
      const old = await db.collection(col).where("ts", "<", cutoff).limit(500).get();
      if (old.empty) continue;
      const batch = db.batch();
      old.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      logger.info(`Pruned ${old.size} doc(s) from ${col}`);
    }
  }

  return result;
}

/**
 * Ticks every 5 minutes across the widest window either source needs.
 * Cron runs in Europe/Madrid so the 09:00–19:00 window tracks CET/CEST.
 */
export const poll = onSchedule(
  {
    schedule: "*/5 9-19 * * *",
    timeZone: ZONE,
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
    retryCount: 1,
  },
  async () => {
    const out = await tick(new Date());
    logger.info("tick", out);
  }
);

/** Manual trigger for debugging — same code path as the scheduled tick. */
export const pollNow = onRequest(
  { region: REGION, timeoutSeconds: 60, cors: true },
  async (req, res) => {
    const out = await tick(new Date());
    res.json(out);
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
