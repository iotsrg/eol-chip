#!/usr/bin/env python3
"""Convert chips.yaml to data/eol_chips.json.

Lifecycle status is sourced, in priority order:
  1. data/lifecycle.json  — fetched from Digi-Key (authoritative, marked
     status_verified=True with a source_url).
  2. chips.yaml           — hand-typed fallback, marked status_verified=False
     ("Unverified") so the UI never presents a guess as fact.

EOL / last-order DATES have no automated source yet (Digi-Key exposes a status
label, not a date), so any date carried from chips.yaml is emitted with
date_verified=False. Honest-by-default: unverified values are flagged, not hidden.
"""

import json
import os
import re
import yaml


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def main():
    base = os.path.join(os.path.dirname(__file__), "..")
    yaml_path = os.path.join(base, "chips.yaml")
    out_path = os.path.join(base, "data", "eol_chips.json")
    lifecycle_path = os.path.join(base, "data", "lifecycle.json")

    with open(yaml_path, "r") as f:
        data = yaml.safe_load(f)

    lifecycle = {}
    if os.path.exists(lifecycle_path):
        try:
            with open(lifecycle_path) as f:
                lifecycle = json.load(f) or {}
        except (json.JSONDecodeError, OSError):
            lifecycle = {}

    chips = []
    verified = 0
    for chip in data.get("chips", []):
        pn = str(chip["part_number"])
        lc = lifecycle.get(_norm(pn))

        eol_date = str(chip.get("eol_date", ""))
        last_order = str(chip.get("last_order_date", ""))

        if lc and lc.get("status"):
            status = lc["status"]
            status_verified = True
            source = lc.get("source", "Digi-Key")
            source_url = lc.get("source_url", "")
            verified += 1
        else:
            status = chip.get("status", "")
            status_verified = False
            source = "Unverified"
            source_url = ""

        chips.append({
            "id": f"EOL-{pn}",
            "type": "eol",
            "title": chip["name"],
            "description": chip.get("description", ""),
            "manufacturer": chip.get("manufacturer", ""),
            "part_number": pn,
            "category": chip.get("category", ""),
            "source": source,
            "source_url": source_url,
            "date": eol_date,
            "url": chip.get("url", ""),
            "eol_date": eol_date,
            "last_order_date": last_order,
            "status": status,
            # Provenance flags consumed by the UI to label unverified data.
            "status_verified": status_verified,
            # No automated date source yet -> dates are never verified.
            "date_verified": False,
            "datasheet": chip.get("datasheet", ""),
            "fcc_id": str(chip.get("fcc_id", "")),
        })

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(chips, f, indent=2)

    print(f"Processed {len(chips)} EOL chips -> {out_path} "
          f"({verified} status-verified via Digi-Key, "
          f"{len(chips) - verified} unverified)")


if __name__ == "__main__":
    main()
