#!/usr/bin/env python3
"""Fetch hardware/firmware CVEs from the NVD API 2.0."""

import json
import os
import time
from datetime import datetime, timedelta, timezone

import requests

NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
KEYWORDS = [
    "firmware vulnerability",
    "chipset vulnerability",
    "microcontroller",
    "embedded device",
    "BIOS vulnerability",
    "UEFI vulnerability",
    "IoT vulnerability",
    "hardware vulnerability",
]
API_KEY = os.environ.get("NVD_API_KEY", "")
SLEEP_TIME = 0.6 if API_KEY else 6.0
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "cves.json")


def fetch_cves_for_keyword(keyword, pub_start, pub_end):
    """Fetch CVEs matching a keyword within a date range."""
    results = []
    start_index = 0

    while True:
        params = {
            "keywordSearch": keyword,
            "pubStartDate": pub_start,
            "pubEndDate": pub_end,
            "resultsPerPage": 2000,
            "startIndex": start_index,
        }
        headers = {"User-Agent": "eol-chip-fetcher/1.0"}
        if API_KEY:
            headers["apiKey"] = API_KEY

        try:
            resp = requests.get(NVD_URL, params=params, headers=headers, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as e:
            print(f"  Warning: Failed to fetch '{keyword}' at index {start_index}: {e}")
            break

        data = resp.json()
        vulns = data.get("vulnerabilities", [])
        results.extend(vulns)

        total = data.get("totalResults", 0)
        start_index += len(vulns)
        if start_index >= total or not vulns:
            break

        time.sleep(SLEEP_TIME)

    return results


def extract_cvss(metrics):
    """Extract the best available CVSS score and severity."""
    for version_key in ["cvssMetricV31", "cvssMetricV30", "cvssMetricV2"]:
        metric_list = metrics.get(version_key, [])
        if metric_list:
            cvss_data = metric_list[0].get("cvssData", {})
            score = cvss_data.get("baseScore", 0)
            severity = metric_list[0].get("baseSeverity", "")
            if not severity:
                severity = cvss_data.get("baseSeverity", "")
            return score, severity.upper() if severity else ""
    return 0, ""


def extract_cwe(weaknesses):
    """Extract the primary CWE ID."""
    for w in weaknesses:
        for desc in w.get("description", []):
            val = desc.get("value", "")
            if val.startswith("CWE-"):
                return val
    return ""


def normalize_cve(vuln_wrapper):
    """Normalize a CVE record into our schema."""
    cve = vuln_wrapper["cve"]
    cve_id = cve.get("id", "")

    descriptions = cve.get("descriptions", [])
    desc_en = ""
    for d in descriptions:
        if d.get("lang") == "en":
            desc_en = d.get("value", "")
            break
    if not desc_en and descriptions:
        desc_en = descriptions[0].get("value", "")

    title = desc_en[:120] + "..." if len(desc_en) > 120 else desc_en

    metrics = cve.get("metrics", {})
    cvss_score, severity = extract_cvss(metrics)

    cwe = extract_cwe(cve.get("weaknesses", []))

    published = cve.get("published", "")
    date_str = published[:10] if published else ""

    affected = []
    for config in cve.get("configurations", []):
        for node in config.get("nodes", []):
            for match in node.get("cpeMatch", []):
                criteria = match.get("criteria", "")
                if criteria:
                    affected.append(criteria)

    return {
        "id": cve_id,
        "type": "cve",
        "title": title,
        "description": desc_en,
        "severity": severity,
        "cvss_score": cvss_score,
        "source": "NVD",
        "date": date_str,
        "url": f"https://nvd.nist.gov/vuln/detail/{cve_id}",
        "cwe": cwe,
        "affected_products": affected[:5],
    }


def main():
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=120)
    fmt = "%Y-%m-%dT%H:%M:%S.000"

    all_cves = {}
    total_fetched = 0

    for kw in KEYWORDS:
        print(f"  Fetching CVEs for keyword: {kw}")
        raw = fetch_cves_for_keyword(kw, start.strftime(fmt), end.strftime(fmt))
        for v in raw:
            cve_id = v["cve"]["id"]
            if cve_id not in all_cves:
                all_cves[cve_id] = normalize_cve(v)
        total_fetched += len(raw)
        print(f"    Got {len(raw)} results ({len(all_cves)} unique so far)")
        time.sleep(SLEEP_TIME)

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(list(all_cves.values()), f, indent=2)

    print(f"Fetched {total_fetched} total, {len(all_cves)} unique CVEs -> {OUT_PATH}")


if __name__ == "__main__":
    main()
