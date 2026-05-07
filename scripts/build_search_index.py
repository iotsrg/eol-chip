#!/usr/bin/env python3
"""Combine all data JSON files into a single search index + meta file.

Writes:
  data/search_index.json - flat array, one entry per item, used by fuse.js
  data/meta.json         - last_updated timestamp + per-source counts + recent activity
"""

import json
import os
from collections import Counter
from datetime import datetime, timedelta, timezone


DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
FILES = [
    "cves.json", "exploits.json", "cisa_kev.json", "metasploit.json",
    "ghsa.json", "ics_advisories.json", "packetstorm.json",
    "osv.json", "vendor_psirts.json", "auto_recalls.json",
    "eol_chips.json",
]


def load(name):
    p = os.path.join(DATA_DIR, name)
    if not os.path.exists(p):
        return []
    with open(p) as f:
        return json.load(f)


def main():
    combined = []
    counts = Counter()
    for fname in FILES:
        items = load(fname)
        combined.extend(items)
        if items:
            counts[items[0].get("type", fname)] = len(items)
            print(f"  Loaded {len(items)} items from {fname}")
        else:
            print(f"  Skipped {fname} (empty/missing)")

    out_path = os.path.join(DATA_DIR, "search_index.json")
    with open(out_path, "w") as f:
        json.dump(combined, f)
    print(f"Built search index with {len(combined)} total items -> {out_path}")

    # Build meta with last_updated + last-7-days activity per source
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    cutoff_30 = (now - timedelta(days=30)).strftime("%Y-%m-%d")

    recent_7 = Counter()
    recent_30 = Counter()
    severity_30 = Counter()
    by_day = Counter()
    for item in combined:
        d = item.get("date", "")
        t = item.get("type", "")
        if d and d >= cutoff:
            recent_7[t] += 1
        if d and d >= cutoff_30:
            recent_30[t] += 1
            sev = (item.get("severity") or "").upper()
            if sev:
                severity_30[sev] += 1
            by_day[d] += 1

    # Trending CVEs - hardware-related (cves.json is pre-filtered) and from
    # the current year only. Ranked by severity + threat-evidence score, then
    # by date (newest first).
    SEV_RANK = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1, "": 0}
    current_year = str(now.year)
    trending = []
    for c in load("cves.json"):
        cid = c.get("id", "")
        date = c.get("date", "")
        # Strictly current-year CVE IDs (CVE-2026-*) - avoids backfills of older IDs
        if not cid.startswith(f"CVE-{current_year}-"):
            continue
        score = (
            SEV_RANK.get((c.get("severity") or "").upper(), 0) * 5
            + (10 if c.get("kev") else 0)
            + 2 * c.get("exploit_count", 0)
            + 3 * c.get("msf_count", 0)
        )
        trending.append({
            "id": c["id"], "title": c.get("title", ""),
            "severity": c.get("severity", ""), "score": score,
            "kev": c.get("kev", False),
            "exploit_count": c.get("exploit_count", 0),
            "msf_count": c.get("msf_count", 0),
            "url": c.get("url", ""), "date": c.get("date", ""),
        })
    trending.sort(key=lambda x: (-x["score"], x["date"]), reverse=False)
    trending.sort(key=lambda x: (-x["score"], x.get("date", "") < "0000"))  # primary: score
    # Re-sort properly: score desc, then date desc
    trending.sort(key=lambda x: (-x["score"], -int(x["date"].replace("-", "") or 0)))
    trending = trending[:15]

    # Top vendors in last 30 days
    vendor_count = Counter()
    for item in combined:
        if item.get("date", "") < cutoff_30:
            continue
        for v in item.get("vendors", []) or []:
            if v:
                vendor_count[v] += 1
        m = item.get("manufacturer", "")
        if m:
            vendor_count[m.lower()] += 1
    top_vendors = vendor_count.most_common(15)

    high_risk_chips = load("high_risk_chips.json")[:25]
    eol_chips = load("eol_chips.json")
    eol_status_breakdown = Counter(c.get("status", "Unknown") for c in eol_chips)
    eol_category_breakdown = Counter(c.get("category", "Unknown") for c in eol_chips)
    eol_manufacturers = {c.get("manufacturer", "") for c in eol_chips if c.get("manufacturer")}

    meta = {
        "last_updated": now.isoformat(timespec="seconds"),
        "last_updated_human": now.strftime("%Y-%m-%d %H:%M UTC"),
        "total_items": len(combined),
        "counts": dict(counts),
        "recent_7d": dict(recent_7),
        "recent_30d": dict(recent_30),
        "severity_30d": dict(severity_30),
        "activity_by_day": dict(sorted(by_day.items())[-30:]),
        "trending_cves": trending,
        "top_vendors": [{"name": v, "count": c} for v, c in top_vendors],
        "high_risk_chips": high_risk_chips,
        "eol_total": len(eol_chips),
        "eol_at_risk": len(load("high_risk_chips.json")),
        "eol_status": dict(eol_status_breakdown),
        "eol_categories": dict(eol_category_breakdown),
        "eol_manufacturer_count": len(eol_manufacturers),
    }

    meta_path = os.path.join(DATA_DIR, "meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"Built meta -> {meta_path}")
    print(f"  Last 7d: {sum(recent_7.values())} new items")
    print(f"  Trending CVEs: {len(trending)}")


if __name__ == "__main__":
    main()
