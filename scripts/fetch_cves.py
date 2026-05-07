#!/usr/bin/env python3
"""Fetch hardware/firmware CVEs from the NVD API 2.0."""

import json
import os
import time
from datetime import datetime, timedelta, timezone

import requests

NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"

KEYWORDS = [
    # Wireless / Protocol stacks
    "bluetooth vulnerability", "bluetooth firmware", "BLE vulnerability",
    "Zigbee vulnerability", "Zigbee firmware", "Z-Wave vulnerability",
    "Thread protocol vulnerability", "Matter protocol vulnerability",
    "LoRaWAN vulnerability", "NB-IoT vulnerability",
    "Wi-Fi vulnerability", "WPA3 vulnerability", "WPS vulnerability",
    # IoT / Embedded
    "IoT vulnerability", "IoT firmware", "embedded device vulnerability",
    "microcontroller vulnerability", "smart home vulnerability",
    "smart camera vulnerability", "smart lock vulnerability",
    # Hardware / Firmware
    "hardware vulnerability", "firmware vulnerability",
    "chipset vulnerability", "BIOS vulnerability", "UEFI vulnerability",
    "TPM vulnerability", "secure boot vulnerability",
    "side channel vulnerability", "fault injection vulnerability",
    # Automotive
    "automotive vulnerability", "CAN bus vulnerability",
    "ECU vulnerability", "vehicle firmware", "telematics vulnerability",
    "infotainment vulnerability",
    # Industrial / OT
    "industrial control system vulnerability", "ICS vulnerability",
    "SCADA vulnerability", "PLC vulnerability", "OT vulnerability",
    "Modbus vulnerability", "DNP3 vulnerability", "BACnet vulnerability",
    "Profinet vulnerability", "EtherNet/IP vulnerability",
    "HMI vulnerability", "RTU vulnerability",
    # Vendor / Product (common high-value targets)
    "Cisco firmware", "Juniper firmware", "Fortinet vulnerability",
    "SonicWall vulnerability", "Netgear vulnerability", "ASUS router",
    "TP-Link vulnerability", "D-Link vulnerability", "Linksys vulnerability",
    "Zyxel vulnerability", "MikroTik vulnerability", "Ubiquiti vulnerability",
    "Hikvision vulnerability", "Dahua vulnerability", "Axis camera",
    "QNAP vulnerability", "Synology vulnerability",
    "Western Digital firmware", "Honeywell vulnerability",
    "Siemens vulnerability", "Schneider Electric vulnerability",
    "Rockwell vulnerability", "ABB vulnerability", "Moxa vulnerability",
    "Advantech vulnerability", "Mitsubishi PLC", "Omron PLC",
    # Chip / Vendor SoC
    "ESP32 vulnerability", "ESP8266 vulnerability", "STM32 vulnerability",
    "Broadcom firmware", "Qualcomm firmware", "MediaTek firmware",
    "Realtek firmware", "Marvell firmware", "Texas Instruments firmware",
    "NXP firmware", "Microchip vulnerability", "Renesas vulnerability",
    "Nordic Semiconductor", "Silicon Labs vulnerability",
    # Medical / Other domains
    "medical device vulnerability", "infusion pump vulnerability",
    "pacemaker vulnerability",
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


def extract_cwes(weaknesses):
    out = []
    for w in weaknesses:
        for desc in w.get("description", []):
            val = desc.get("value", "")
            if val.startswith("CWE-") and val not in out:
                out.append(val)
    return out


def extract_attack_vector(metrics):
    for version_key in ["cvssMetricV31", "cvssMetricV30"]:
        ml = metrics.get(version_key, [])
        if ml:
            return ml[0].get("cvssData", {}).get("attackVector", "")
    return ""


def extract_references(refs_list):
    out = []
    for r in refs_list[:8]:
        url = r.get("url", "")
        tags = r.get("tags", []) or []
        if url:
            out.append({"url": url, "tags": tags})
    return out


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
    cwes = extract_cwes(cve.get("weaknesses", []))
    attack_vector = extract_attack_vector(metrics)
    references = extract_references(cve.get("references", []))

    published = cve.get("published", "")
    last_modified = cve.get("lastModified", "")
    date_str = published[:10] if published else ""

    affected = []
    vendors = set()
    for config in cve.get("configurations", []):
        for node in config.get("nodes", []):
            for match in node.get("cpeMatch", []):
                criteria = match.get("criteria", "")
                if criteria:
                    affected.append(criteria)
                    parts = criteria.split(":")
                    if len(parts) > 3:
                        vendors.add(parts[3])

    return {
        "id": cve_id,
        "type": "cve",
        "title": title,
        "description": desc_en,
        "severity": severity,
        "cvss_score": cvss_score,
        "attack_vector": attack_vector,
        "source": "NVD",
        "date": date_str,
        "last_modified": last_modified[:10] if last_modified else "",
        "url": f"https://nvd.nist.gov/vuln/detail/{cve_id}",
        "cwe": cwes[0] if cwes else "",
        "cwes": cwes,
        "affected_products": affected[:8],
        "vendors": sorted(vendors)[:5],
        "references": references,
        "kev": False,
        "exploit_count": 0,
        "msf_count": 0,
    }


def main():
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=180)
    fmt = "%Y-%m-%dT%H:%M:%S.000"

    # Seed with existing data so historical CVEs accumulate across daily runs
    # and stay available for cross-linking with old exploits/MSF modules.
    all_cves = {}
    if os.path.exists(OUT_PATH):
        try:
            with open(OUT_PATH) as f:
                for c in json.load(f):
                    cid = c.get("id")
                    if cid:
                        all_cves[cid] = c
            print(f"  Seeded with {len(all_cves)} existing CVEs")
        except Exception as e:
            print(f"  Could not seed from existing file: {e}")

    new_count = 0
    for kw in KEYWORDS:
        print(f"  Fetching CVEs for keyword: {kw}")
        raw = fetch_cves_for_keyword(kw, start.strftime(fmt), end.strftime(fmt))
        for v in raw:
            cve_id = v["cve"]["id"]
            normalized = normalize_cve(v)
            if cve_id not in all_cves:
                new_count += 1
            # Always overwrite to pick up upgraded severity / new references
            # but preserve cross-link flags written by cross_link.py
            prior = all_cves.get(cve_id, {})
            for k in ("kev", "exploit_count", "msf_count", "ghsa_count", "packetstorm_count"):
                if k in prior:
                    normalized[k] = prior[k]
            all_cves[cve_id] = normalized
        print(f"    Got {len(raw)} results ({new_count} new, {len(all_cves)} total)")
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

    if not sorted_cves and os.path.exists(OUT_PATH):
        # Preserve last-known-good data when NVD calls all fail (e.g. rate-limit, missing API key)
        print(f"WARNING: 0 CVEs fetched - keeping existing {OUT_PATH} unchanged")
        return

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
