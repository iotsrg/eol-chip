#!/usr/bin/env python3
"""Fetch security advisories directly from major hardware vendor PSIRT feeds.

Vendors disclose vulnerabilities in their products via dedicated security
advisory feeds, often days or weeks before NVD picks them up. We aggregate
RSS/Atom feeds from major networking and ICS vendors.
"""

import json
import os
import re
import time
from datetime import datetime

import requests

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
OUT_PATH = os.path.join(DATA_DIR, "vendor_psirts.json")
UA = "eol-chip-bot/1.0 (https://iotsrg.github.io/eol-chip)"
HEADERS = {"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml, */*"}

FEEDS = [
    ("Cisco PSIRT",
     "https://sec.cloudapps.cisco.com/security/center/psirtrss20/CiscoSecurityAdvisory.xml"),
    ("Fortinet PSIRT",
     "https://www.fortiguard.com/rss/ir.xml"),
    ("SonicWall PSIRT",
     "https://psirt.global.sonicwall.com/api/jws/feed/"),
    ("HPE PSRT",
     "https://support.hpe.com/connect/s/securitybulletinlibrary"),
]


def parse_rss(label, body):
    """Tolerant RSS/Atom parse - handles both formats."""
    items = []
    # RSS <item>
    blocks = re.findall(r"<item>(.+?)</item>", body, re.DOTALL | re.IGNORECASE)
    if not blocks:
        # Atom <entry>
        blocks = re.findall(r"<entry>(.+?)</entry>", body, re.DOTALL | re.IGNORECASE)

    for b in blocks[:200]:
        title_m = re.search(r"<title[^>]*>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?</title>", b, re.DOTALL)
        link_m = re.search(r"<link[^>]*>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?</link>", b, re.DOTALL)
        if not link_m:
            link_m = re.search(r'<link[^>]*href="([^"]+)"', b)
        date_m = (re.search(r"<pubDate>(.+?)</pubDate>", b, re.DOTALL)
                  or re.search(r"<updated>(.+?)</updated>", b, re.DOTALL)
                  or re.search(r"<published>(.+?)</published>", b, re.DOTALL))
        desc_m = (re.search(r"<description[^>]*>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?</description>", b, re.DOTALL)
                  or re.search(r"<summary[^>]*>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?</summary>", b, re.DOTALL))
        if not (title_m and link_m):
            continue
        title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", title_m.group(1))).strip()
        link = link_m.group(1).strip()
        desc = ""
        if desc_m:
            desc = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", desc_m.group(1))).strip()[:500]
        date_iso = ""
        if date_m:
            d = date_m.group(1).strip()
            for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z",
                        "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d"):
                try:
                    date_iso = datetime.strptime(d.replace("GMT", "+0000")[:25], fmt).strftime("%Y-%m-%d")
                    break
                except Exception:
                    pass

        # Stable id from URL
        slug = re.sub(r"[^A-Za-z0-9]+", "-", link.rsplit("/", 1)[-1] or title)[:60]
        cves = re.findall(r"CVE-\d{4}-\d{4,7}", title + " " + desc)

        items.append({
            "id": f"PSIRT-{slug}",
            "type": "psirt",
            "title": title,
            "description": desc,
            "manufacturer": label.split(" PSIRT")[0].split(" PSRT")[0].strip(),
            "source": label,
            "date": date_iso,
            "url": link,
            "cves": sorted(set(cves)),
            "severity": "HIGH",  # Vendor-disclosed = always treated as elevated
        })
    return items


def fetch_feed(label, url):
    try:
        r = requests.get(url, headers=HEADERS, timeout=20)
        if r.status_code != 200:
            print(f"  {label}: HTTP {r.status_code}")
            return []
        items = parse_rss(label, r.text)
        print(f"  {label}: {len(items)} advisories")
        return items
    except Exception as e:
        print(f"  {label}: {type(e).__name__}: {e}")
        return []


def main():
    seen = set()
    results = []
    for label, url in FEEDS:
        for it in fetch_feed(label, url):
            if it["id"] in seen:
                continue
            seen.add(it["id"])
            results.append(it)
        time.sleep(0.5)

    if not results and os.path.exists(OUT_PATH):
        print(f"  PSIRTs: 0 results - keeping existing {OUT_PATH}")
        return

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Saved {len(results)} vendor PSIRT advisories -> {OUT_PATH}")


if __name__ == "__main__":
    main()
