# Castelldefels Wind

An installable mobile app (PWA) that tracks wind and kitesurf-zone conditions at
Castelldefels and pushes an alert when it's worth going out.

**Live:** https://wind-castelldefels.web.app

## What it does

| | Source | Window (Europe/Madrid) | Interval |
|---|---|---|---|
| Actual / average / gust wind, direction | [17nudos.com](https://www.17nudos.com) — *Estación meteorológica on-line* | 09:00 – 19:00 | 5 min |
| Twintip / surf / foil zone status | [mojokite.com](https://www.mojokite.com/zonakite/castelldefels.php) — *Zona kitesurf en Castelldefels* | 12:00 – 19:00 | 10 min |

The homepage shows the current reading, the kite-zone board, and a 12-hour
graph of actual / average / gust.

**Push alerts fire when:**
- twintip status becomes **`Quizás`** or **`SI!`**, or
- **average wind reaches 13 knots or more**.

Alerts are **rising-edge**: each fires once when the condition first becomes
true, stays quiet while it holds, and re-arms when the condition drops away
again (or when a new day starts). A windy afternoon produces one notification,
not fifty.

## How the data is obtained

Neither site offers a documented API, and neither sends CORS headers — so a
server-side poller is required. Both were reverse-engineered from the pages
themselves:

- **17nudos** renders its graph as a PNG (`grafica_mdx.php`), which is not
  machine-readable. But the live panel polls `update_me_mdx.php` over AJAX, and
  that returns a small HTML table containing the same numbers that feed the
  graph. `functions/src/sources/nudos.ts` parses it. Speeds are in **knots**.
- **mojokite** renders its board client-side from
  `/zonakite/get_values.php`, which returns clean JSON:
  `{"status":"OPEN","foil":"Maybe","surf":"No","twintip":"No"}`. Board values
  are `Yes` / `No` / `Maybe`, shown on the site as SI! / No / Quizás.

Because these are undocumented endpoints, they can change without notice. Both
parsers throw loudly on unexpected shapes, and failures are logged per-source
without taking the other source down.

## Architecture

```
Cloud Scheduler ──► poll (Cloud Function, every 5 min, Europe/Madrid)
                      ├─ 17nudos  ──► Firestore /readings
                      ├─ mojokite ──► Firestore /twintip
                      └─ rising-edge gate ──► FCM web push ──► phone

PWA (Firebase Hosting) ──► reads /readings + /twintip live via Firestore
```

- **`functions/`** — TypeScript Cloud Functions (2nd gen, Node 22,
  `europe-west1`). One scheduled function ticks every 5 minutes and decides
  internally which sources are due, so a single Cloud Scheduler job covers both
  cadences.
- **`web/`** — Vite + TypeScript + Chart.js PWA. Reads Firestore directly.
- **Firestore** — `readings`, `twintip` (public read, no client writes),
  `tokens`, `state` (server-only). Readings older than 30 days are pruned
  automatically.

Scheduling uses the IANA zone `Europe/Madrid` rather than a fixed offset, so the
windows stay correct across the CET/CEST switch.

## Setup

Two steps need the Firebase console and cannot be scripted:

### 1. Upgrade to the Blaze plan (required)

Cloud Functions and Cloud Scheduler are not available on the free Spark plan.

→ https://console.firebase.google.com/project/wind-castelldefels/usage/details

Blaze is pay-as-you-go with a free monthly allowance. This workload sits far
inside it — roughly 4,900 function invocations and 5,000 Firestore writes per
month, against free tiers of 2,000,000 and 600,000 respectively. **Expected
cost: €0/month.** A payment method is still required on file. Set a budget alert
if you want a hard guard.

### 2. Generate the Web Push certificate (VAPID key)

→ Project settings → Cloud Messaging → Web configuration → **Generate key pair**

https://console.firebase.google.com/project/wind-castelldefels/settings/cloudmessaging

Copy the key pair value into `web/src/firebase-config.ts`:

```ts
export const vapidKey = "BEl...";   // replace __VAPID_KEY__
```

### 3. Deploy

```bash
npm --prefix web run build && firebase deploy
```

## Local development

```bash
npm --prefix functions install
npm --prefix web install
npm --prefix web run dev          # http://localhost:5173
```

Note that push notifications do not work under `vite dev`: the service worker
loads its config from `/__/firebase/init.js`, a path only Firebase Hosting
serves. Test notifications against a deployed build, or `firebase emulators:start`.

Trigger a poll by hand (same code path as the schedule):

```bash
curl https://europe-west1-wind-castelldefels.cloudfunctions.net/pollNow
```

## Installing on your phone

Web push on iOS only works once the app is on the home screen.

- **iPhone** (iOS 16.4+): open the site in Safari → Share → **Add to Home
  Screen** → open it from the home screen → tap **Enable alerts**.
- **Android**: open in Chrome → **Install app** → tap **Enable alerts**.

## Tuning

| What | Where |
|---|---|
| 13-knot threshold | `WIND_ALERT_KNOTS` in `functions/src/alerts.ts` (and `web/src/chart.ts` for the graph line) |
| Polling windows | `shouldPollWind` / `shouldPollTwintip` in `functions/src/time.ts` |
| Tick frequency | `schedule` in `functions/src/index.ts` |
| Alert behaviour | `gateAlerts` in `functions/src/alerts.ts` |
| Retention | `RETENTION_DAYS` in `functions/src/index.ts` |

For reference, mojokite opens the zone on 14 kn average / 13 kn minimum for
twintip — so the 13-knot alert lines up with the bottom of their twintip range.
