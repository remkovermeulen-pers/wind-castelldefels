import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

import { tick } from "./poller";
import { fetchWind } from "./sources/nudos";
import { buildCalendarData } from "./calendar";
import { fetchForecast } from "./sources/windguru";
import { ZONE } from "./time";

initializeApp();

const REGION = "europe-west1";

/**
 * Ticks every minute across the widest window either source needs — wind runs
 * 08:00–20:00 and the kite zone 12:00–21:00, so the schedule spans 08:00–21:00.
 * Cron runs in Europe/Madrid so this tracks CET/CEST.
 *
 * Wind is stored on every tick (once a minute); the kite zone has its own
 * 10-minute gate inside tick(), so a per-minute schedule does not over-poll it.
 * Volume stays well inside the free tiers (~23k invocations, ~24k writes/month).
 */
export const poll = onSchedule(
  {
    schedule: "* 8-21 * * *",
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
 * Proxies the Base Nàutica (Bogatell) webcam snapshot. Serving it from our own
 * origin avoids ad/tracker blockers that drop the SkylineWebcams CDN and any
 * hotlink checks, so the near-live frame loads reliably on all devices.
 */
export const webcam = onRequest(
  { region: REGION, timeoutSeconds: 15, cors: true },
  async (_req, res) => {
    try {
      const r = await fetch("https://cdn.skylinewebcams.com/1469.jpg", {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; wind-castelldefels/1.0)",
          "Referer": "https://www.skylinewebcams.com/",
        },
      });
      if (!r.ok) {
        res.status(502).end();
        return;
      }
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "public, max-age=30");
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      logger.error("webcam proxy failed", err);
      res.status(502).end();
    }
  }
);

/**
 * Windguru WG-blend forecast as JSON, for spots without a live station (e.g.
 * Bogatell, which has no anemometer). Allowlisted spots only. Compact keys:
 * t=epoch ms, w=wind kn, g=gust kn, d=direction deg.
 */
const FORECAST_SPOTS = new Set([644417, 1004]);

export const forecast = onRequest(
  { region: REGION, timeoutSeconds: 60, cors: true },
  async (req, res) => {
    const spot = Number(req.query.spot ?? 644417);
    if (!FORECAST_SPOTS.has(spot)) {
      res.status(400).json({ error: "unknown spot" });
      return;
    }
    try {
      const f = await fetchForecast(spot);
      res.set("Cache-Control", "public, max-age=1800");
      res.json({
        model: f.model,
        points: f.points.map((p) => ({ t: p.tsMs, w: p.wind, g: p.gust, d: p.dir })),
      });
    } catch (err) {
      logger.error("forecast failed", err);
      res.status(502).json({ error: String(err) });
    }
  }
);

/**
 * Live current-wind reader for the PWA.
 *
 * 17nudos refreshes every ~5 seconds but sends no CORS headers, so the browser
 * cannot read it directly. This proxies it — the same parser the poller uses —
 * so the app can show a near-live reading while open. It writes nothing; the
 * scheduled tick still owns history and alerts. A short CDN cache collapses
 * many viewers onto one upstream fetch.
 */
export const live = onRequest(
  { region: REGION, timeoutSeconds: 20, cors: true },
  async (_req, res) => {
    try {
      const w = await fetchWind();
      res.set("Cache-Control", "public, max-age=5");
      res.json({ ...w, at: Date.now() });
    } catch (err) {
      logger.error("live fetch failed", err);
      res.status(502).json({ error: String(err) });
    }
  }
);

/** Star calendars: one stored snapshot per spot. */
const CALENDARS = [
  { spot: 644417, name: "Castelldefels", doc: "state/calendar", file: "castelldefels-kite.ics" },
  { spot: 1004, name: "Bogatell", doc: "state/calendar_1004", file: "bogatell-kite.ics" },
] as const;

type CalendarCfg = (typeof CALENDARS)[number];

/**
 * Rebuilds a spot's calendar and stores the .ics snapshot plus its structured
 * star windows in Firestore. Every device gets byte-identical content between
 * rebuilds, and the poller reuses the windows for that spot's wind alerts.
 */
async function refreshStoredCalendar(cal: CalendarCfg): Promise<string> {
  const data = await buildCalendarData(cal.spot, cal.name);
  await getFirestore().doc(cal.doc).set({
    ics: data.ics,
    windows: data.windows,
    generatedAt: FieldValue.serverTimestamp(),
  });
  return data.ics;
}

/**
 * Rebuild every stored calendar every 3 hours (Windguru's models run ~every 6h),
 * so all subscribers converge on the same snapshot.
 */
export const refreshCalendar = onSchedule(
  {
    schedule: "0 */3 * * *",
    timeZone: ZONE,
    region: REGION,
    timeoutSeconds: 180,
    memory: "256MiB",
    retryCount: 1,
  },
  async () => {
    for (const cal of CALENDARS) await refreshStoredCalendar(cal);
    logger.info("calendars refreshed");
  }
);

/**
 * Subscribable calendar (.ics) of forecast "star" windows. Default spot is
 * Castelldefels; `?spot=1004` serves Bogatell. Serves the stored snapshot so
 * every device sees identical content; builds once on demand if absent.
 */
export const calendar = onRequest(
  { region: REGION, timeoutSeconds: 120, cors: true },
  async (req, res) => {
    const spot = Number(req.query.spot ?? 644417);
    const cal = CALENDARS.find((c) => c.spot === spot);
    if (!cal) {
      res.status(400).send("unknown spot");
      return;
    }
    try {
      const snap = await getFirestore().doc(cal.doc).get();
      const ics = (snap.data()?.ics as string) || (await refreshStoredCalendar(cal));
      const generatedAt = snap.data()?.generatedAt as { toDate(): Date } | undefined;
      res.set("Content-Type", "text/calendar; charset=utf-8");
      res.set("Content-Disposition", `inline; filename="${cal.file}"`);
      res.set("Cache-Control", "public, max-age=900");
      if (generatedAt) res.set("Last-Modified", generatedAt.toDate().toUTCString());
      res.send(ics);
    } catch (err) {
      logger.error("calendar serve failed", err);
      res.status(502).send(`calendar error: ${String(err)}`);
    }
  }
);

/**
 * Latest kite-zone status as clean JSON, for clients that cannot query
 * Firestore directly (e.g. the macOS widget). Reads the newest stored zone
 * reading rather than hitting mojokite, so it stays cheap and matches the app.
 */
export const zone = onRequest(
  { region: REGION, timeoutSeconds: 20, cors: true },
  async (_req, res) => {
    try {
      const snap = await getFirestore()
        .collection("twintip")
        .orderBy("ts", "desc")
        .limit(1)
        .get();

      if (snap.empty) {
        res.status(404).json({ error: "no zone data yet" });
        return;
      }

      const v = snap.docs[0].data();
      res.set("Cache-Control", "public, max-age=30");
      res.json({
        status: v.status ?? null,
        twintip: v.twintip ?? null,
        surf: v.surf ?? null,
        foil: v.foil ?? null,
        siteLastUpdate: v.siteLastUpdate ?? null,
        notice: v.notice ?? null,
        at: Date.now(),
      });
    } catch (err) {
      logger.error("zone fetch failed", err);
      res.status(502).json({ error: String(err) });
    }
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
