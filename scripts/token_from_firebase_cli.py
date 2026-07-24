#!/usr/bin/env python3
"""Prints a Google OAuth access token derived from the local Firebase CLI login.

Convenience for the one-off scripts, so you don't need a separate gcloud login:

    export ACCESS_TOKEN=$(python3 scripts/token_from_firebase_cli.py)

Reads the refresh token that `firebase login` already stored on this machine.
Nothing is written or transmitted anywhere except Google's token endpoint.
"""
import json
import os
import urllib.parse
import urllib.request

CONFIG = os.path.expanduser("~/.config/configstore/firebase-tools.json")

# The public OAuth client that ships inside firebase-tools.
CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"
CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi"


def main() -> None:
    try:
        with open(CONFIG) as fh:
            tokens = json.load(fh)["tokens"]
    except (OSError, KeyError):
        raise SystemExit("No Firebase CLI login found — run `firebase login` first.")

    data = urllib.parse.urlencode(
        {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "refresh_token": tokens["refresh_token"],
            "grant_type": "refresh_token",
        }
    ).encode()

    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data)
    with urllib.request.urlopen(req) as res:
        print(json.load(res)["access_token"])


if __name__ == "__main__":
    main()
