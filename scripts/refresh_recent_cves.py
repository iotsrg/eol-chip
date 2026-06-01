#!/usr/bin/env python3
"""One-off targeted refresh: pull RECENT hardware CVEs and merge into cves.json.

The full fetch_cves.py (80 keywords) trips NVD's unauthenticated rate limit and
404-stalls. This grabs just the recent window across a focused, high-yield
hardware keyword set — few enough requests to stay under the limit — and merges
new CVEs into the existing corpus (preserving cross-link flags). Used to update
the Trending list until an NVD_API_KEY lets the weekly run do the full sweep.
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
import fetch_cves as F  # reuse normalize_cve + fetch_cves_for_keyword

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "cves.json")

# Focused, high-yield hardware/firmware keywords (subset of fetch_cves.KEYWORDS).
KEYWORDS = [
    "firmware vulnerability", "hardware vulnerability", "chipset vulnerability",
    "microcontroller vulnerability", "UEFI vulnerability", "BMC vulnerability",
    "TPM vulnerability", "secure boot vulnerability", "Bluetooth vulnerability",
    "Wi-Fi vulnerability", "Intel", "AMD", "Renesas", "Espressif",
    "industrial control system vulnerability", "SCADA vulnerability",
]

FMT = "%Y-%m-%dT%H:%M:%S.000Z"


def main():
    end = datetime.now(timezone.utc)
    # recent window: cover from just before our current newest (2026-03) to now
    start = datetime(2026, 3, 1, tzinfo=timezone.utc)

    all_cves = {}
    if os.path.exists(OUT):
        for c in json.load(open(OUT)):
            if c.get("id"):
                all_cves[c["id"]] = c
    print(f"  seeded {len(all_cves)} existing CVEs")

    new = 0
    for kw in KEYWORDS:
        raw = F.fetch_cves_for_keyword(kw, start.strftime(FMT), end.strftime(FMT))
        for v in raw:
            cid = v["cve"]["id"]
            norm = F.normalize_cve(v)
            prior = all_cves.get(cid, {})
            for k in ("kev", "exploit_count", "msf_count", "ghsa_count", "packetstorm_count"):
                if k in prior:
                    norm[k] = prior[k]
            if cid not in all_cves:
                new += 1
            all_cves[cid] = norm
        print(f"  [{kw}] +{len(raw)} results (total new so far {new})")
        time.sleep(F.SLEEP_TIME)

    if new == 0 and os.path.exists(OUT):
        print("  no new CVEs fetched — leaving cves.json unchanged")
        return

    merged = sorted(
        all_cves.values(),
        key=lambda c: (F.SEVERITY_ORDER.get(c.get("severity", ""), 4), c.get("date", "")),
    )
    json.dump(merged, open(OUT, "w"), indent=2)
    print(f"  merged: {len(merged)} CVEs total, {new} new -> cves.json")


if __name__ == "__main__":
    main()
