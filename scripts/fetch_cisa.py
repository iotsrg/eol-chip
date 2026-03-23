#!/usr/bin/env python3
"""Fetch CISA Known Exploited Vulnerabilities catalog (hardware/IoT relevant)."""

import json
import os
import requests

CISA_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "cisa_kev.json")

HARDWARE_KEYWORDS = [
    'firmware', 'router', 'camera', 'iot', 'embedded', 'bluetooth', 'zigbee',
    'modbus', 'scada', 'plc', 'industrial', 'automotive', 'modem', 'gateway',
    'switch', 'firewall', 'vpn', 'nas', 'dvr', 'nvr', 'access point',
    'wifi', 'wi-fi', 'wireless', 'printer', 'ups', 'controller', 'inverter',
    'chipset', 'processor', 'microcontroller', 'bios', 'uefi', 'bootloader',
    'netgear', 'asus', 'dlink', 'd-link', 'tp-link', 'linksys',
    'hikvision', 'dahua', 'axis', 'ubiquiti', 'mikrotik', 'zyxel', 'fortinet',
    'sonicwall', 'cisco', 'juniper', 'f5', 'qnap', 'synology', 'western digital',
]


def is_hardware_relevant(entry):
    text = ' '.join([
        entry.get('vendorProject', ''),
        entry.get('product', ''),
        entry.get('vulnerabilityName', ''),
        entry.get('shortDescription', ''),
    ]).lower()
    return any(kw in text for kw in HARDWARE_KEYWORDS)


def main():
    print("Fetching CISA KEV...")
    try:
        resp = requests.get(CISA_URL, timeout=30, headers={"User-Agent": "eol-chip-fetcher/1.0"})
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  Error: {e}")
        return

    all_vulns = resp.json().get("vulnerabilities", [])
    print(f"  Total CISA KEV entries: {len(all_vulns)}")

    results = []
    for v in all_vulns:
        if not is_hardware_relevant(v):
            continue
        cve_id = v.get("cveID", "")
        results.append({
            "id": cve_id or v.get("vulnerabilityName", "CISA-UNKNOWN"),
            "type": "cisa",
            "title": v.get("vulnerabilityName", ""),
            "description": v.get("shortDescription", ""),
            "manufacturer": v.get("vendorProject", ""),
            "part_number": v.get("product", ""),
            "source": "CISA KEV",
            "date": v.get("dateAdded", ""),
            "url": f"https://nvd.nist.gov/vuln/detail/{cve_id}" if cve_id else "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
            "severity": "HIGH",
            "ransomware": v.get("knownRansomwareCampaignUse", "Unknown"),
        })

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)
    print(f"  Saved {len(results)} hardware-relevant CISA KEV entries -> {OUT_PATH}")


if __name__ == "__main__":
    main()
