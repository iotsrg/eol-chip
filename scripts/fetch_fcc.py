#!/usr/bin/env python3
"""Fetch FCC device data from curated target list.

Uses fccid.io for lookup. Falls back to keeping existing data if scraping fails.
"""

import json
import os
import time

import requests
import yaml
from bs4 import BeautifulSoup

TARGETS_PATH = os.path.join(os.path.dirname(__file__), "fcc_targets.yaml")
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "fcc_devices.json")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; eol-chip-fetcher/1.0)"
}


def fetch_fcc_device(fcc_id, name, grantee):
    """Try to fetch device info from fccid.io, return normalized dict or None."""
    url = f"https://fccid.io/{fcc_id.replace('-', '/')}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            return make_fallback_entry(fcc_id, name, grantee)

        soup = BeautifulSoup(resp.text, "lxml")

        # Try to extract description from the page
        description = name
        desc_el = soup.find("td", string="Equipment Class")
        equipment_class = ""
        if desc_el:
            val = desc_el.find_next_sibling("td")
            if val:
                equipment_class = val.get_text(strip=True)

        freq_el = soup.find("td", string="Lower Frequency")
        frequency = ""
        if freq_el:
            lower = freq_el.find_next_sibling("td")
            upper_el = soup.find("td", string="Upper Frequency")
            if lower:
                frequency = lower.get_text(strip=True)
                if upper_el:
                    upper = upper_el.find_next_sibling("td")
                    if upper:
                        frequency += " - " + upper.get_text(strip=True)

        date_el = soup.find("td", string="Grant Date")
        grant_date = ""
        if date_el:
            val = date_el.find_next_sibling("td")
            if val:
                grant_date = val.get_text(strip=True)

        return {
            "id": f"FCC-{fcc_id}",
            "type": "fcc",
            "title": name,
            "description": description,
            "grantee": grantee,
            "fcc_id": fcc_id,
            "source": "FCC",
            "date": grant_date,
            "url": f"https://fccid.io/{fcc_id.replace('-', '/')}",
            "frequency": frequency,
            "equipment_class": equipment_class,
        }

    except Exception as e:
        print(f"    Warning: Failed to fetch {fcc_id}: {e}")
        return make_fallback_entry(fcc_id, name, grantee)


def make_fallback_entry(fcc_id, name, grantee):
    """Create a basic entry from the target config when scraping fails."""
    return {
        "id": f"FCC-{fcc_id}",
        "type": "fcc",
        "title": name,
        "description": name,
        "grantee": grantee,
        "fcc_id": fcc_id,
        "source": "FCC",
        "date": "",
        "url": f"https://fccid.io/{fcc_id.replace('-', '/')}",
        "frequency": "",
        "equipment_class": "",
    }


def main():
    with open(TARGETS_PATH) as f:
        config = yaml.safe_load(f)

    targets = config.get("targets", [])
    devices = []

    for target in targets:
        fcc_id = target["fcc_id"]
        name = target.get("name", fcc_id)
        grantee = target.get("grantee", "")

        print(f"  Fetching FCC data for: {fcc_id} ({name})")
        device = fetch_fcc_device(fcc_id, name, grantee)
        if device:
            devices.append(device)
        time.sleep(2)  # Be polite

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(devices, f, indent=2)

    print(f"Processed {len(devices)} FCC devices -> {OUT_PATH}")


if __name__ == "__main__":
    main()
