#!/usr/bin/env python3
"""Fetch vehicle recalls from NHTSA's public API.

Focuses on software/firmware/cyber-relevant recalls across major automakers
and recent model years (last 5 years, configurable).
"""

import json
import os
import time

import requests

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
OUT_PATH = os.path.join(DATA_DIR, "auto_recalls.json")
API = "https://api.nhtsa.gov/recalls/recallsByVehicle"
UA = "eol-chip-bot/1.0"
HEADERS = {"User-Agent": UA}

# Trimmed list (1-2 high-volume models per make) keeps wall time reasonable.
TARGETS = {
    "tesla":      ["model 3", "model y"],
    "ford":       ["mustang mach-e", "f-150 lightning"],
    "chevrolet":  ["bolt ev"],
    "toyota":     ["bz4x", "prius"],
    "honda":      ["accord"],
    "hyundai":    ["ioniq 5"],
    "kia":        ["ev6"],
    "volkswagen": ["id.4"],
    "bmw":        ["i4"],
    "mercedes-benz": ["eqs"],
    "porsche":    ["taycan"],
    "rivian":     ["r1t"],
    "lucid":      ["air"],
    "polestar":   ["polestar 2"],
    "volvo":      ["xc40 recharge"],
    "nissan":     ["leaf"],
}

YEARS = list(range(2020, 2026))

# Cyber-relevant keywords - we surface every recall but flag these
CYBER_KEYWORDS = ("software", "firmware", "ota", "infotainment", "telematics",
                  "ecu", "controller", "module", "battery management", "tcu",
                  "cyber", "cellular", "wireless", "radio", "encryption", "key fob")


def is_cyber(text):
    t = (text or "").lower()
    return any(kw in t for kw in CYBER_KEYWORDS)


def query(make, model, year):
    params = {"make": make, "model": model, "modelYear": str(year)}
    try:
        r = requests.get(API, params=params, headers=HEADERS, timeout=15)
        if r.status_code == 200:
            return r.json().get("results", []) or []
    except Exception:
        pass
    return []


def normalize(rec, make, model, year):
    nhtsa_id = rec.get("NHTSACampaignNumber", "")
    summary = rec.get("Summary", "") or ""
    consequence = rec.get("Consequence", "") or ""
    component = rec.get("Component", "") or ""
    full_text = f"{summary} {consequence} {component}"
    return {
        "id": f"NHTSA-{nhtsa_id}",
        "type": "recall",
        "title": f"{year} {make.title()} {model.title()} - {component[:100]}".strip(),
        "description": (summary[:500]).strip(),
        "consequence": consequence[:300],
        "manufacturer": rec.get("Manufacturer", make.title()),
        "model": model,
        "year": year,
        "component": component,
        "severity": "HIGH" if is_cyber(full_text) else "MEDIUM",
        "source": "NHTSA",
        "date": rec.get("ReportReceivedDate", "")[:10] if rec.get("ReportReceivedDate") else "",
        "url": f"https://www.nhtsa.gov/recalls?nhtsaId={nhtsa_id}",
        "cyber_relevant": is_cyber(full_text),
    }


def main():
    seen = set()
    results = []
    for make, models in TARGETS.items():
        for model in models:
            for year in YEARS:
                recs = query(make, model, year)
                for rec in recs:
                    nid = rec.get("NHTSACampaignNumber", "")
                    if not nid or nid in seen:
                        continue
                    seen.add(nid)
                    results.append(normalize(rec, make, model, year))
                time.sleep(0.15)

    if not results and os.path.exists(OUT_PATH):
        print(f"  Recalls: 0 results - keeping existing {OUT_PATH}")
        return

    cyber = sum(1 for r in results if r.get("cyber_relevant"))
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Saved {len(results)} NHTSA recalls ({cyber} cyber-relevant) -> {OUT_PATH}")


if __name__ == "__main__":
    main()
