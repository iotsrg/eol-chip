#!/usr/bin/env python3
"""Fetch authoritative product lifecycle status from the Digi-Key API v4.

WHY THIS EXISTS
---------------
Lifecycle status (Active / NRND / Last-Time-Buy / Obsolete) and EOL dates in
chips.yaml were hand-typed and unverified — the source of the "misinformation"
on chip pages. Digi-Key mirrors each manufacturer's official product-status
field, so this script replaces guesses with a sourced, machine-checked value.

It reads manufacturer part numbers (MPNs) from chips.yaml, queries Digi-Key,
and writes data/lifecycle.json keyed by a normalized MPN:

    {
      "esp8266ex": {
        "part_number": "ESP8266EX",
        "status": "Active",                 # normalized lifecycle label
        "status_raw": "Active",             # exact Digi-Key string
        "manufacturer": "Espressif Systems",
        "datasheet": "https://...",
        "source": "Digi-Key",
        "source_url": "https://www.digikey.com/en/products/detail/...",
        "fetched_at": "2026-06-01T00:00:00Z"
      },
      ...
    }

process_eol.py merges this over chips.yaml: a fetched status WINS and is marked
verified; anything Digi-Key cannot confirm stays flagged "Unverified" rather
than asserting a fabricated value.

CREDENTIALS (never hard-coded — set as env / CI secrets):
    DIGIKEY_CLIENT_ID, DIGIKEY_CLIENT_SECRET

SAFE NO-OP: if credentials are absent, the script prints a notice and exits 0
WITHOUT touching data/lifecycle.json, so local builds and unconfigured CI runs
neither crash nor wipe previously fetched data.
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests
import yaml

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
YAML_PATH = os.path.join(os.path.dirname(__file__), "..", "chips.yaml")
OUT_PATH = os.path.join(DATA_DIR, "lifecycle.json")

TOKEN_URL = "https://api.digikey.com/v1/oauth2/token"
SEARCH_URL = "https://api.digikey.com/products/v4/search/keyword"

CLIENT_ID = os.environ.get("DIGIKEY_CLIENT_ID", "").strip()
CLIENT_SECRET = os.environ.get("DIGIKEY_CLIENT_SECRET", "").strip()

# Map Digi-Key's product-status strings to a small normalized vocabulary the
# site renders. Unknown strings pass through verbatim so we never silently lose
# information.
STATUS_MAP = {
    "active": "Active",
    "obsolete": "Obsolete",
    "last time buy": "Last Time Buy",
    "not for new designs": "Not For New Designs",
    "discontinued at digi-key": "Discontinued",
    "discontinued": "Discontinued",
    "preliminary": "Preliminary",
    "end of life": "EOL",
}


def norm_mpn(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def get_token():
    """Client-credentials OAuth2 token (valid ~10 min)."""
    resp = requests.post(
        TOKEN_URL,
        data={
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "grant_type": "client_credentials",
        },
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    return body["access_token"], int(body.get("expires_in", 600))


def headers(token):
    return {
        "Authorization": f"Bearer {token}",
        "X-DIGIKEY-Client-Id": CLIENT_ID,
        "X-DIGIKEY-Locale-Site": "US",
        "X-DIGIKEY-Locale-Language": "en",
        "X-DIGIKEY-Locale-Currency": "USD",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def lookup(mpn, token):
    """Return a normalized lifecycle record for one MPN, or None if not found.

    Uses the keyword-search endpoint and keeps a hit only when the returned
    ManufacturerProductNumber matches our MPN exactly (normalized) — so a fuzzy
    keyword hit on a different part is never mistaken for this chip.
    """
    payload = {"Keywords": mpn, "Limit": 5, "Offset": 0}
    resp = requests.post(SEARCH_URL, headers=headers(token), json=payload, timeout=30)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    data = resp.json()
    products = data.get("Products") or []
    target = norm_mpn(mpn)
    for prod in products:
        cand = prod.get("ManufacturerProductNumber") or ""
        if norm_mpn(cand) != target:
            continue
        ps = prod.get("ProductStatus") or {}
        raw = (ps.get("Status") if isinstance(ps, dict) else str(ps)) or ""
        if not raw:
            return None
        return {
            "part_number": mpn,
            "status": STATUS_MAP.get(raw.strip().lower(), raw.strip()),
            "status_raw": raw.strip(),
            "manufacturer": (prod.get("Manufacturer") or {}).get("Name", ""),
            "datasheet": prod.get("DatasheetUrl", "") or "",
            "source": "Digi-Key",
            "source_url": prod.get("ProductUrl", "") or "",
            "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    return None


def main():
    if not (CLIENT_ID and CLIENT_SECRET):
        print("fetch_lifecycle: DIGIKEY_CLIENT_ID/SECRET not set — skipping "
              "(existing data/lifecycle.json left untouched).")
        return 0

    with open(YAML_PATH) as f:
        chips = (yaml.safe_load(f) or {}).get("chips", [])
    mpns = []
    seen = set()
    for c in chips:
        pn = str(c.get("part_number") or "").strip()
        if pn and norm_mpn(pn) not in seen:
            seen.add(norm_mpn(pn))
            mpns.append(pn)

    try:
        token, ttl = get_token()
    except Exception as e:
        print(f"fetch_lifecycle: token request failed ({e}) — skipping.")
        return 1
    token_deadline = time.time() + ttl - 30

    results = {}
    found = 0
    for i, mpn in enumerate(mpns):
        if time.time() >= token_deadline:
            token, ttl = get_token()
            token_deadline = time.time() + ttl - 30
        try:
            rec = lookup(mpn, token)
        except requests.HTTPError as e:
            code = e.response.status_code if e.response is not None else "?"
            if code == 429:           # rate-limited: back off and retry once
                time.sleep(5)
                try:
                    rec = lookup(mpn, token)
                except Exception:
                    rec = None
            else:
                print(f"  {mpn}: HTTP {code}")
                rec = None
        except Exception as e:
            print(f"  {mpn}: {e}")
            rec = None

        if rec:
            results[norm_mpn(mpn)] = rec
            found += 1
        time.sleep(0.2)               # be polite to the API
        if (i + 1) % 50 == 0:
            print(f"  …{i + 1}/{len(mpns)} processed, {found} confirmed")

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)
    print(f"fetch_lifecycle: {found}/{len(mpns)} MPNs confirmed via Digi-Key "
          f"-> {OUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
