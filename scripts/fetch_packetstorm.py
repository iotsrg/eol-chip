#!/usr/bin/env python3
"""Fetch hardware/IoT exploits and advisories from Packet Storm RSS."""

import json
import os
import re
import time
from datetime import datetime

import requests

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "packetstorm.json")

# Packet Storm category RSS feeds
FEEDS = [
    "https://rss.packetstormsecurity.com/files/tags/iot/",
    "https://rss.packetstormsecurity.com/files/tags/hardware/",
    "https://rss.packetstormsecurity.com/files/tags/scada/",
    "https://rss.packetstormsecurity.com/files/tags/firmware/",
    "https://rss.packetstormsecurity.com/files/tags/router/",
]

HEADERS = {"User-Agent": "eol-chip-fetcher/1.0"}


def parse_feed(url):
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  Packet Storm {url}: {e}")
        return []

    items = []
    for b in re.findall(r"<item>(.*?)</item>", resp.text, re.DOTALL):
        title = re.search(r"<title>(.*?)</title>", b, re.DOTALL)
        link = re.search(r"<link>(.*?)</link>", b, re.DOTALL)
        pub = re.search(r"<pubDate>(.*?)</pubDate>", b, re.DOTALL)
        desc = re.search(r"<description>(.*?)</description>", b, re.DOTALL)
        if not (title and link):
            continue
        title_s = re.sub(r"<.*?>", "", title.group(1)).strip()
        link_s = link.group(1).strip()
        ps_id = link_s.rsplit("/", 2)[-2] if "/files/" in link_s else link_s.rsplit("/", 1)[-1]
        date_iso = ""
        if pub:
            try:
                dt = datetime.strptime(pub.group(1).strip()[:25], "%a, %d %b %Y %H:%M:%S")
                date_iso = dt.strftime("%Y-%m-%d")
            except Exception:
                pass
        desc_s = re.sub(r"<.*?>", "", desc.group(1)).strip()[:400] if desc else ""
        items.append({
            "id": f"PS-{ps_id}",
            "type": "packetstorm",
            "title": title_s,
            "description": desc_s,
            "source": "Packet Storm",
            "date": date_iso,
            "url": link_s,
            "cves": re.findall(r"CVE-\d{4}-\d{4,7}", desc_s + " " + title_s),
        })
    return items


def main():
    seen = set()
    results = []
    for url in FEEDS:
        for it in parse_feed(url):
            if it["id"] in seen:
                continue
            seen.add(it["id"])
            results.append(it)
        time.sleep(1)

    if not results and os.path.exists(OUT_PATH):
        print(f"  Packet Storm: 0 results - keeping existing {OUT_PATH}")
        return

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Saved {len(results)} Packet Storm entries -> {OUT_PATH}")


if __name__ == "__main__":
    main()
