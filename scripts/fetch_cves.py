#!/usr/bin/env python3
"""Fetch hardware/firmware CVEs from the NVD API 2.0."""

import json
import os
import time
from datetime import datetime, timedelta, timezone

import requests

NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"

KEYWORDS = [
    # Bluetooth / Zigbee / Wireless
    "bluetooth vulnerability",
    "bluetooth firmware",
    "BLE vulnerability",
    "Zigbee vulnerability",
    "Zigbee firmware",
    "Z-Wave vulnerability",
    # IoT / Embedded
    "IoT vulnerability",
    "IoT firmware",
    "embedded device vulnerability",
    "microcontroller vulnerability",
    # Hardware / Firmware
    "hardware vulnerability",
    "firmware vulnerability",
    "chipset vulnerability",
    "BIOS vulnerability",
    "UEFI vulnerability",
    # Automotive
    "automotive vulnerability",
    "CAN bus vulnerability",
    "ECU vulnerability",
    "vehicle firmware",
    # Industrial
    "industrial control system vulnerability",
    "ICS vulnerability",
    "SCADA vulnerability",
    "PLC vulnerability",
    "OT vulnerability",
]

SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "": 4}

API_KEY = os.environ.get("NVD_API_KEY", "")
SLEEP_TIME = 0.6 if API_KEY else 6.0
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "cves.json")


def fetch_cves_for_keyword(keyword, pub_start, pub_end):
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
    for w in weaknesses:
        for desc in w.get("description", []):
            val = desc.get("value", "")
            if val.startswith("CWE-"):
                return val
    return ""


def normalize_cve(vuln_wrapper):
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
    start = end - timedelta(days=180)
    fmt = "%Y-%m-%dT%H:%M:%S.000"

    all_cves = {}

    for kw in KEYWORDS:
        print(f"  Fetching CVEs for keyword: {kw}")
        raw = fetch_cves_for_keyword(kw, start.strftime(fmt), end.strftime(fmt))
        for v in raw:
            cve_id = v["cve"]["id"]
            if cve_id not in all_cves:
                all_cves[cve_id] = normalize_cve(v)
        print(f"    Got {len(raw)} results ({len(all_cves)} unique so far)")
        time.sleep(SLEEP_TIME)

    # Sort: Critical → High → Medium → Low → unknown, then newest first
    sorted_cves = sorted(
        all_cves.values(),
        key=lambda c: (SEVERITY_ORDER.get(c["severity"], 4), c["date"]),
        reverse=False,
    )
    # Reverse date within same severity group (newest first per severity)
    sorted_cves = sorted(
        sorted_cves,
        key=lambda c: (SEVERITY_ORDER.get(c["severity"], 4), c["date"]),
    )

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(sorted_cves, f, indent=2)

    print(f"Saved {len(sorted_cves)} unique CVEs -> {OUT_PATH}")
    sev_counts = {}
    for c in sorted_cves:
        sev_counts[c["severity"] or "UNKNOWN"] = sev_counts.get(c["severity"] or "UNKNOWN", 0) + 1
    for sev in ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]:
        if sev in sev_counts:
            print(f"  {sev}: {sev_counts[sev]}")


if __name__ == "__main__":
    main()
