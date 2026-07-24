"""Minimal Firestore REST client.

Used by the one-off scripts so they can write to Firestore without a service
account file — they reuse the OAuth token you already have locally.

Get a token with either of:
    export ACCESS_TOKEN=$(gcloud auth print-access-token)
    export ACCESS_TOKEN=$(python3 scripts/token_from_firebase_cli.py)
"""
import json
import os
import urllib.error
import urllib.request

PROJECT = "wind-castelldefels"
# Resource path used inside request bodies — must NOT carry the https:// host.
DOC_ROOT = f"projects/{PROJECT}/databases/(default)/documents"
BASE = f"https://firestore.googleapis.com/v1/{DOC_ROOT}"


def _token() -> str:
    tok = os.environ.get("ACCESS_TOKEN", "").strip()
    if not tok:
        raise SystemExit("ACCESS_TOKEN is not set — see the docstring in scripts/firestore.py")
    return tok


def value(v):
    """Python value -> Firestore typed value."""
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    raise TypeError(f"unsupported value: {v!r}")


def timestamp(iso: str):
    return {"timestampValue": iso}


def commit(writes):
    """Applies up to 500 writes. Each write is (collection, doc_id, fields)."""
    if not writes:
        return 0

    body = {
        "writes": [
            {
                "update": {
                    "name": f"{DOC_ROOT}/{col}/{doc_id}",
                    "fields": fields,
                }
            }
            for col, doc_id, fields in writes
        ]
    }

    req = urllib.request.Request(
        f"{BASE}:commit",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {_token()}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as res:
            json.load(res)
    except urllib.error.HTTPError as err:
        # Surface the API's message; the bare status code is not actionable.
        raise SystemExit(f"Firestore {err.code}: {err.read().decode('utf-8', 'replace')[:600]}")
    return len(writes)


def commit_all(writes, chunk=450):
    total = 0
    for i in range(0, len(writes), chunk):
        total += commit(writes[i : i + chunk])
        print(f"  committed {total}/{len(writes)}")
    return total
