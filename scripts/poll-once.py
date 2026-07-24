#!/usr/bin/env python3
"""Polls both live sources once and writes the result to Firestore.

Mirrors what the scheduled Cloud Function does, but runs locally — so data can
be collected before the project is upgraded to Blaze (Cloud Functions and Cloud
Scheduler are not available on the free Spark plan).

Run it on demand:

    export ACCESS_TOKEN=$(python3 scripts/token_from_firebase_cli.py)
    python3 scripts/poll-once.py

Or drive it from cron for the same cadence as the deployed function
(wind every 5 min 09:00-19:00, zone every 10 min 12:00-19:00):

    */5  9-18 * * *  cd /path/to/repo && ACCESS_TOKEN=$(...) python3 scripts/poll-once.py --wind
    */10 12-18 * * * cd /path/to/repo && ACCESS_TOKEN=$(...) python3 scripts/poll-once.py --zone

This script does not send push notifications — that is the Cloud Function's job.
"""
import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import firestore  # noqa: E402

WIND_URL = "https://www.17nudos.com/update_me_mdx.php"
ZONE_URL = "https://www.mojokite.com/zonakite/get_values.php"
UA = {"User-Agent": "Mozilla/5.0 (compatible; wind-castelldefels/1.0)"}


def get(url, post=False, referer=None):
    headers = dict(UA)
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers, method="POST" if post else "GET")
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read().decode("utf-8", "replace")


def cell(html, cls):
    return [
        re.sub(r"\s+", " ", re.sub(r"<[^>]*>", "", m)).strip()
        for m in re.findall(rf"class='{cls}'[^>]*>(.*?)</td>", html, re.S)
    ]


def num(s):
    m = re.search(r"-?\d+(?:\.\d+)?", s or "")
    return float(m.group()) if m else None


def poll_wind(iso):
    html = get(WIND_URL, post=True, referer="https://www.17nudos.com/")
    speeds = cell(html, "windSpeed")
    gust = cell(html, "windGust")
    if len(speeds) < 2 or not gust:
        raise SystemExit("17nudos: unexpected layout")

    ph = cell(html, "LabelPH")
    upd = cell(html, "LabelUpdate")
    fields = {
        "ts": firestore.timestamp(iso),
        "actual": firestore.value(num(speeds[0])),
        "average": firestore.value(num(speeds[1])),
        "gust": firestore.value(num(gust[0])),
        "direction": firestore.value((cell(html, "windDir") or ["?"])[0]),
        "windName": firestore.value((cell(html, "NameWind") or [None])[0]),
        "tempC": firestore.value(num((cell(html, "LabelTemp") or [""])[0])),
        "pressureHpa": firestore.value(num(next((c for c in ph if "hPa" in c), ""))),
        "humidityPct": firestore.value(num(next((c for c in ph if "%" in c), ""))),
        "stationTime": firestore.value(
            re.sub(r"^Last update:\s*", "", upd[0]) if upd else None
        ),
        "source": firestore.value("update_me_mdx"),
    }
    print(f"  wind: actual={num(speeds[0])} avg={num(speeds[1])} gust={num(gust[0])} "
          f"dir={(cell(html,'windDir') or ['?'])[0]}")
    return ("readings", iso, fields)


def poll_zone(iso):
    data = json.loads(get(ZONE_URL, referer="https://www.mojokite.com/zonakite/castelldefels.php"))
    if data.get("error"):
        raise SystemExit(f"mojokite: {data['error']}")

    label = {"Yes": "SI!", "Maybe": "Quizás", "No": "No"}
    fields = {
        "ts": firestore.timestamp(iso),
        "status": firestore.value(data.get("status")),
        "openingTime": firestore.value(data.get("time")),
        "foil": firestore.value(data.get("foil")),
        "surf": firestore.value(data.get("surf")),
        "twintip": firestore.value(data.get("twintip")),
        "siteLastUpdate": firestore.value(data.get("last_update")),
        "source": firestore.value("get_values"),
    }
    print(f"  zone: {data.get('status')} · twintip={label.get(data.get('twintip'),'—')} "
          f"surf={label.get(data.get('surf'),'—')} foil={label.get(data.get('foil'),'—')} "
          f"(site updated {data.get('last_update')})")
    return ("twintip", iso, fields)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wind", action="store_true", help="poll 17nudos only")
    ap.add_argument("--zone", action="store_true", help="poll mojokite only")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    both = not (args.wind or args.zone)
    iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    print(f"polling at {iso}")

    writes = []
    if both or args.wind:
        writes.append(poll_wind(iso))
    if both or args.zone:
        writes.append(poll_zone(iso))

    if args.dry_run:
        print("--dry-run: nothing written")
        return

    firestore.commit_all(writes)
    print(f"wrote {len(writes)} document(s)")


if __name__ == "__main__":
    main()
