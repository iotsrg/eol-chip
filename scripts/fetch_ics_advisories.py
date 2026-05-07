#!/usr/bin/env python3
"""Fetch CISA ICS / Medical advisories via their RSS / index pages.

Uses the public CISA advisories JSON listing endpoint (cisa.gov/news-events)
which exposes a paginated feed for advisories tagged ICS/ICSMA.
"""

import json
import os
import re
import time
from datetime import datetime

import requests

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "ics_advisories.json")

# CISA's advisory listing JSON endpoint (returns advisories in chronological order).
# Each tag corresponds to a series: ICSA (industrial), ICSMA (medical), ICSC (consultation)
FEEDS = [
    ("ICSA", "https://www.cisa.gov/cybersecurity-advisories/ics-advisories.xml"),
    ("ICSMA", "https://www.cisa.gov/cybersecurity-advisories/ics-medical-advisories.xml"),
]

HEADERS = {"User-Agent": "eol-chip-fetcher/1.0"}


def parse_feed(label, url):
    """Parse a CISA RSS-style feed; tolerant of layout changes."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  {label}: fetch failed ({e})")
        return []

    items = []
    # Loose RSS parse: pull <item>...</item> blocks
    blocks = re.findall(r"<item>(.*?)</item>", resp.text, re.DOTALL)
    for b in blocks:
        title = re.search(r"<title>(.*?)</title>", b, re.DOTALL)
        link = re.search(r"<link>(.*?)</link>", b, re.DOTALL)
        pub = re.search(r"<pubDate>(.*?)</pubDate>", b, re.DOTALL)
        desc = re.search(r"<description>(.*?)</description>", b, re.DOTALL)
        if not (title and link):
            continue
        title_s = re.sub(r"<.*?>", "", title.group(1)).strip()
        link_s = link.group(1).strip()
        # Extract advisory ID from title or link (e.g., ICSA-25-321-01)
        adv_match = re.search(r"(ICSA|ICSMA|ICSC)-\d{2}-\d{3}-\d+", title_s + " " + link_s)
        adv_id = adv_match.group(0) if adv_match else link_s.rsplit("/", 1)[-1]
        date_iso = ""
        if pub:
            try:
                dt = datetime.strptime(pub.group(1).strip()[:25], "%a, %d %b %Y %H:%M:%S")
                date_iso = dt.strftime("%Y-%m-%d")
            except Exception:
                pass
        desc_s = re.sub(r"<.*?>", "", desc.group(1)).strip()[:500] if desc else ""
        items.append({
            "id": adv_id,
            "type": "ics",
            "title": title_s,
            "description": desc_s,
            "severity": "HIGH",
            "source": f"CISA {label}",
            "date": date_iso,
            "url": link_s,
            "cves": re.findall(r"CVE-\d{4}-\d{4,7}", desc_s + " " + title_s),
        })
    print(f"  {label}: parsed {len(items)} advisories")
    return items


def main():
    out = []
    for label, url in FEEDS:
        out.extend(parse_feed(label, url))
        time.sleep(1)

    if not out and os.path.exists(OUT_PATH):
        print(f"  ICS: 0 results - keeping existing {OUT_PATH}")
        return

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, indent=2)
    print(f"Saved {len(out)} ICS advisories -> {OUT_PATH}")


if __name__ == "__main__":
    main()
