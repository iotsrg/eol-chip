#!/usr/bin/env python3
"""Fetch hardware/IoT/firmware GitHub Security Advisories via the GraphQL API."""

import json
import os
import time
from datetime import datetime, timedelta, timezone

import requests

API = "https://api.github.com/graphql"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "ghsa.json")

KEYWORDS = [
    "firmware", "iot", "embedded", "router", "scada", "modbus", "plc",
    "industrial", "bluetooth", "zigbee", "z-wave", "matter", "thread",
    "uefi", "bios", "bootloader", "automotive", "can-bus",
    "esp32", "esp8266", "stm32", "smart-home", "smart-camera",
    "tasmota", "openwrt", "freertos", "zephyr", "contiki",
]

QUERY = """
query($cursor: String) {
  securityAdvisories(first: 100, after: $cursor, orderBy: {field: PUBLISHED_AT, direction: DESC}) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ghsaId
      summary
      description
      severity
      publishedAt
      updatedAt
      permalink
      identifiers { type value }
      references { url }
      vulnerabilities(first: 5) {
        nodes {
          package { ecosystem name }
        }
      }
    }
  }
}
"""


def is_relevant(node):
    blob = " ".join([
        node.get("summary", "") or "",
        node.get("description", "") or "",
        " ".join(v["package"]["name"] for v in node.get("vulnerabilities", {}).get("nodes", []) if v.get("package")),
    ]).lower()
    return any(k in blob for k in KEYWORDS)


def normalize(node):
    cves = [i["value"] for i in node.get("identifiers", []) if i.get("type") == "CVE"]
    pkgs = [v["package"]["name"] for v in node.get("vulnerabilities", {}).get("nodes", []) if v.get("package")]
    pub = node.get("publishedAt", "") or ""
    return {
        "id": node["ghsaId"],
        "type": "ghsa",
        "title": node.get("summary", ""),
        "description": (node.get("description", "") or "")[:600],
        "severity": (node.get("severity", "") or "").upper(),
        "source": "GitHub Advisory",
        "date": pub[:10],
        "url": node.get("permalink", ""),
        "cves": cves,
        "packages": pkgs[:5],
        "references": [r["url"] for r in node.get("references", [])[:8]],
    }


def main():
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        print("  GHSA: no GITHUB_TOKEN, skipping (preserving existing data)")
        return

    headers = {"Authorization": f"bearer {token}", "User-Agent": "eol-chip-fetcher/1.0"}
    cursor = None
    cutoff = datetime.now(timezone.utc) - timedelta(days=365)
    results = []
    pages = 0

    while True:
        resp = requests.post(API, json={"query": QUERY, "variables": {"cursor": cursor}}, headers=headers, timeout=30)
        if resp.status_code != 200:
            print(f"  GHSA error {resp.status_code}: {resp.text[:200]}")
            break
        data = resp.json().get("data", {}).get("securityAdvisories", {})
        nodes = data.get("nodes", [])
        if not nodes:
            break

        oldest_in_page = None
        for n in nodes:
            pub = n.get("publishedAt", "")
            try:
                dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
            except Exception:
                continue
            oldest_in_page = dt
            if dt < cutoff:
                continue
            if is_relevant(n):
                results.append(normalize(n))

        pages += 1
        page_info = data.get("pageInfo", {})
        if not page_info.get("hasNextPage") or (oldest_in_page and oldest_in_page < cutoff) or pages >= 30:
            break
        cursor = page_info.get("endCursor")
        time.sleep(0.5)

    if not results and os.path.exists(OUT_PATH):
        print(f"  GHSA: 0 results - keeping existing {OUT_PATH}")
        return

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Saved {len(results)} GHSA advisories -> {OUT_PATH}")


if __name__ == "__main__":
    main()
