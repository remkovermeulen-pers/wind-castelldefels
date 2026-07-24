# Castelldefels Wind

An installable mobile app (PWA) that tracks wind and kitesurf-zone conditions at
Castelldefels and pushes an alert when it's worth going out.

**Live:** https://wind-castelldefels.web.app

## What it does

| | Source | Window (Europe/Madrid) | Interval |
|---|---|---|---|
| Actual / average / gust wind, direction | [17nudos.com](https://www.17nudos.com) — *Estación meteorológica on-line* | 08:00 – 20:00 | 5 min |
| Twintip / surf / foil zone status | [mojokite.com](https://www.mojokite.com/zonakite/castelldefels.php) — *Zona kitesurf en Castelldefels* | 12:00 – 21:00 | 10 min |

The homepage shows the current reading, the kite-zone board, and a 12-hour
graph of actual / average / gust. It updates in place: Firestore's `onSnapshot`
pushes each new measurement straight to the page, so an open tab never needs a
refresh (the indicator under the reading flashes when a value lands).

The Direction cell is a compass rose. Castelldefels beach faces roughly
south-east, so the onshore arc — **E clockwise through S to WSW** — is green and
the rest red; the sector the wind is coming from is highlighted. Edit
`GOOD_FROM` / `GOOD_TO` in `web/src/compass.ts` to change the arc.

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

## History

The graph is built purely from what the poller collects every 5 minutes, so it
fills in as the day goes on and covers a rolling 12 hours once a full day has
been recorded.

There is no historical import. An earlier version reconstructed the past 12
hours by reading the pixels of the PNG that 17nudos publishes — neither site
exposes an archive, so the picture was the only history that existed — but it
was removed: it could only recover Nominal and Racha (never ACTUAL), it dropped
direction entirely, and it quantised values to the pixel grid. Data the poller
records first-hand is simply better, and mixing the two made the graph harder
to trust than it was worth.

## Polling by hand

`scripts/poll-once.py` runs the same
poll locally and writes straight to Firestore:

```bash
export ACCESS_TOKEN=$(python3 scripts/token_from_firebase_cli.py)
python3 scripts/poll-once.py            # both sources
python3 scripts/poll-once.py --zone     # mojokite only
python3 scripts/poll-once.py --wind     # 17nudos only
```

It does **not** send push notifications — that is the Cloud Function's job, and
it needs Blaze. Cron examples are in the script's docstring.

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

## Where the poller runs

There are two interchangeable hosts for the same `tick()` function. **Run one,
not both** — otherwise every reading is stored twice. (Alerts would still fire
once, since both share the `state/alerts` document, but the graph would double
up.)

| | GitHub Actions | Cloud Functions |
|---|---|---|
| Firebase plan | **Spark (free)** | Blaze required |
| Punctuality | approximate — GitHub delays scheduled runs under load, sometimes 10+ min, and drops them at peak | to the minute |
| Cost | free on a public repo; see note below for private | ~€0 within free tier, card on file required |
| Config | `.github/workflows/poll.yml` | `functions/src/index.ts` |

The default is **GitHub Actions**, because it needs no payment method. Firestore
writes and FCM sends are both free on Spark — only Cloud *Scheduler* ever
needed Blaze.

### Actions minutes

The schedule fires every 5 min across a 15-hour UTC window ≈ **180 runs/day**,
and GitHub bills each run rounded up to a whole minute ≈ **5,400 min/month**.

**This repo is public, so Actions minutes are unlimited and free.** That is why
it is public — a private repo only gets 2,000 min/month, which this overruns
about threefold. If you ever make it private, change the cron to `*/15`
(~1,800 min/month) or narrow the daily window.

Two other things worth knowing about GitHub's scheduler:

- it delays scheduled runs under load, occasionally by 10+ minutes, and drops
  them entirely at peak times — the cadence is approximate, not guaranteed
- it disables scheduled workflows after 60 days with no repository activity

To switch to Cloud Functions instead, upgrade at
[the console](https://console.firebase.google.com/project/wind-castelldefels/usage/details),
run `firebase deploy --only functions`, and disable the workflow.

## Setup

### Generate the Web Push certificate (VAPID key)

→ Project settings → Cloud Messaging → Web configuration → **Generate key pair**

https://console.firebase.google.com/project/wind-castelldefels/settings/cloudmessaging

Copy the key pair value into `web/src/firebase-config.ts`:

```ts
export const vapidKey = "BEl...";   // replace __VAPID_KEY__
```

Then redeploy the frontend:

```bash
npm --prefix web run build && firebase deploy --only hosting
```

Until that key exists the button reads "Alerts not set up yet" and is disabled —
the graph and live status work regardless.

### Service account (already configured)

The workflow authenticates as `firebase-adminsdk-fbsvc@…`, whose JSON key is
stored in the repo secret `FIREBASE_SERVICE_ACCOUNT`. To rotate it, create a new
key in the console and re-run `gh secret set FIREBASE_SERVICE_ACCOUNT < key.json`.
Never commit the key — `.gitignore` covers `*-service-account*.json`.

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
