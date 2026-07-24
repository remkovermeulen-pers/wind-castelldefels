#!/usr/bin/env python3
"""Backfills wind history by reading it out of the 17nudos graph image.

17nudos publishes "Evolución del viento en las últimas 12 horas" only as a
rendered PNG (grafica_mdx.php) — there is no data file, no CSV and no JSON
archive anywhere on the site (all the usual weather-station paths 404). The
live AJAX endpoint returns the current instant only.

So the single source of past data is the picture itself. It is a clean plot
with a fixed palette, which makes it reliably machine-readable:

    navy  (0,0,128)   "Nominal" -> average wind   (PROMEDIO)
    green (96,192,0)  "Racha"   -> gust           (RACHA)
    red   (255,0,0)   "Dirección" dots on a separate compass scale

Calibration is derived from the image, not hard-coded guesses:
  * the plot frame is the only full-width/height black rule
  * vertical dotted gridlines are hourly, and the rightmost one is the last
    whole hour before the station's clock
  * the right-hand axis runs 0 kn at the frame bottom to 30 kn at the top

LIMITS — worth knowing before trusting the output:
  * only ~12 hours exist; there is no deeper archive to recover
  * the graph has no "ACTUAL" series, so backfilled rows carry average and
    gust only, and `actual` is null
  * values are quantised to the pixel grid, about +/-0.1 kn
  * rows are written with backfilled=true so they can be told apart later

Usage:
    export ACCESS_TOKEN=$(python3 scripts/token_from_firebase_cli.py)
    python3 scripts/backfill-graph.py [--dry-run]
"""
import argparse
import io
import re
import statistics
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from PIL import Image

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import firestore  # noqa: E402

GRAPH_URL = "https://www.17nudos.com/grafica_mdx.php"
LIVE_URL = "https://www.17nudos.com/update_me_mdx.php"
UA = {"User-Agent": "Mozilla/5.0 (compatible; wind-castelldefels/1.0)"}
ZONE = ZoneInfo("Europe/Madrid")

NAVY = (0, 0, 128)
GREEN = (96, 192, 0)
GREY = {(160, 160, 160), (192, 192, 192), (128, 128, 128)}

AXIS_MAX_KN = 30.0
BUCKET_MIN = 5  # match the live poller's cadence


def fetch(url, post=False):
    req = urllib.request.Request(url, headers=UA, method="POST" if post else "GET")
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read()


def station_now():
    """Reads the station's own clock, so we don't depend on the local one."""
    html = fetch(LIVE_URL, post=True).decode("utf-8", "replace")
    m = re.search(r"Last update:\s*(\d{2}):(\d{2}):(\d{2})\s+(\d{1,2})\s+(\w+)\s+(\d{4})", html)
    today = datetime.now(ZONE)
    if not m:
        print("! could not read station clock; falling back to local time")
        return today
    hh, mm, ss = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return today.replace(hour=hh, minute=mm, second=ss, microsecond=0)


def live_reading():
    html = fetch(LIVE_URL, post=True).decode("utf-8", "replace")
    speeds = re.findall(r"class='windSpeed'>([\d.]+)<", html)
    gust = re.search(r"class='windGust'>([\d.]+)<", html)
    if len(speeds) < 2 or not gust:
        return None
    return float(speeds[1]), float(gust.group(1))  # (average, gust)


def find_frame(px, W, H):
    """The plot border: the only near-full-width and near-full-height black rules."""
    rows = [y for y in range(H) if sum(px[x, y] == (0, 0, 0) for x in range(W)) > W * 0.7]
    cols = [x for x in range(W) if sum(px[x, y] == (0, 0, 0) for y in range(H)) > H * 0.7]
    if len(rows) < 2 or len(cols) < 2:
        raise SystemExit("could not locate the plot frame — graph layout changed?")
    return min(cols), max(cols), min(rows), max(rows)


def find_hour_gridlines(px, left, right, top, bottom):
    """Vertical dotted gridlines, one per hour."""
    span = bottom - top
    out = []
    for x in range(left + 1, right):
        n = sum(px[x, y] in GREY for y in range(top + 1, bottom))
        if n > span * 0.3:
            out.append(x)
    # collapse adjacent columns belonging to one line
    merged = []
    for x in out:
        if merged and x - merged[-1][-1] <= 2:
            merged[-1].append(x)
        else:
            merged.append([x])
    return [round(statistics.mean(g)) for g in merged]


def extract(px, colour, left, right, top, bottom, legend_x, legend_y):
    """Median y of `colour` per column -> knots, skipping the legend swatches."""
    kn_per_px = AXIS_MAX_KN / (bottom - top)
    out = {}
    for x in range(left + 1, right):
        ys = [
            y
            for y in range(top + 1, bottom)
            if px[x, y] == colour and not (x >= legend_x and y <= legend_y)
        ]
        if ys:
            out[x] = (bottom - statistics.median(ys)) * kn_per_px
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="print, do not write")
    args = ap.parse_args()

    img = Image.open(io.BytesIO(fetch(GRAPH_URL))).convert("RGB")
    W, H = img.size
    px = img.load()

    left, right, top, bottom = find_frame(px, W, H)
    grid = find_hour_gridlines(px, left, right, top, bottom)
    if len(grid) < 3:
        raise SystemExit(f"expected hourly gridlines, found {len(grid)}")

    px_per_hour = (grid[-1] - grid[0]) / (len(grid) - 1)

    # The rightmost hourly gridline is the last whole hour on the station clock.
    now = station_now()
    last_hour = now.replace(minute=0, second=0, microsecond=0)

    def time_at(x):
        return last_hour + timedelta(hours=(x - grid[-1]) / px_per_hour)

    # Legend swatches sit in the top-right corner, inside the plot.
    legend_x = left + int((right - left) * 0.9)
    legend_y = top + int((bottom - top) * 0.16)

    gust = extract(px, GREEN, left, right, top, bottom, legend_x, legend_y)
    avg = extract(px, NAVY, left, right, top, bottom, legend_x, legend_y)

    print(f"frame x[{left},{right}] y[{top},{bottom}]  {len(grid)} gridlines"
          f"  {px_per_hour:.2f} px/h  station clock {now:%H:%M}")
    print(f"extracted {len(avg)} average / {len(gust)} gust columns")

    # Sanity-check the calibration against the live figures.
    live = live_reading()
    if live and avg and gust:
        x_last = max(avg)
        got = (round(avg[x_last], 1), round(gust[max(gust)], 1))
        print(f"calibration check — graph tail {got}  vs live {live}")
        if abs(got[0] - live[0]) > 1.5 or abs(got[1] - live[1]) > 1.5:
            print("! graph tail disagrees with the live reading; check the layout")

    # Bucket to BUCKET_MIN minutes so backfilled rows match the live cadence.
    buckets = {}
    for x in sorted(set(avg) | set(gust)):
        t = time_at(x)
        key = t.replace(minute=t.minute - t.minute % BUCKET_MIN, second=0, microsecond=0)
        b = buckets.setdefault(key, {"avg": [], "gust": []})
        if x in avg:
            b["avg"].append(avg[x])
        if x in gust:
            b["gust"].append(gust[x])

    writes = []
    for t in sorted(buckets):
        b = buckets[t]
        if not b["avg"] and not b["gust"]:
            continue
        a = round(statistics.median(b["avg"]), 1) if b["avg"] else None
        g = round(statistics.median(b["gust"]), 1) if b["gust"] else None
        iso = t.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        writes.append(
            (
                "readings",
                iso,
                {
                    "ts": firestore.timestamp(iso),
                    "actual": firestore.value(None),  # graph has no ACTUAL series
                    "average": firestore.value(a),
                    "gust": firestore.value(g),
                    "direction": firestore.value("?"),
                    "windName": firestore.value(None),
                    "tempC": firestore.value(None),
                    "pressureHpa": firestore.value(None),
                    "humidityPct": firestore.value(None),
                    "stationTime": firestore.value(None),
                    "backfilled": firestore.value(True),
                    "source": firestore.value("grafica_mdx"),
                },
            )
        )

    print(f"\n{len(writes)} five-minute rows "
          f"{time_at(min(set(avg) | set(gust))):%H:%M} -> {time_at(max(set(avg) | set(gust))):%H:%M}")
    for _, iso, f in writes[:3] + writes[-3:]:
        print(f"  {iso}  avg={f['average']}  gust={f['gust']}")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    firestore.commit_all(writes)
    print(f"\nwrote {len(writes)} rows to Firestore")


if __name__ == "__main__":
    main()
