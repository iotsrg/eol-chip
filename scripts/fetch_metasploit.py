#!/usr/bin/env python3
"""Fetch hardware-relevant Metasploit modules from GitHub."""

import json
import os
import re
import time
import requests

GITHUB_API = "https://api.github.com"
REPO = "rapid7/metasploit-framework"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "metasploit.json")

# Directories with hardware/IoT/industrial modules
TARGET_DIRS = [
    "modules/auxiliary/scanner/scada",     # ICS / SCADA
    "modules/auxiliary/scanner/vxworks",   # VxWorks embedded OS
    "modules/auxiliary/scanner/printer",   # Embedded printers
    "modules/auxiliary/scanner/mqtt",      # IoT protocol
    "modules/auxiliary/scanner/ubiquiti",  # IoT networking gear
    "modules/auxiliary/scanner/dect",      # DECT wireless
    "modules/auxiliary/scanner/sonicwall", # Network appliances
    "modules/auxiliary/scanner/upnp",      # UPnP (IoT discovery)
    "modules/auxiliary/scanner/snmp",      # SNMP (network devices)
    "modules/auxiliary/scanner/gprs",      # Cellular/GPRS
    "modules/auxiliary/scanner/telephony", # VoIP / telecom
    "modules/auxiliary/sniffer",           # Protocol sniffers
]

# Path keywords to catch additional hardware modules in other dirs
PATH_KEYWORDS = [
    'bluetooth', 'zigbee', 'firmware', 'automotive', 'ics', 'scada',
    'modbus', 'dnp3', 'bacnet', 'can_bus', 'rfid', 'nfc', 'hardware',
    'industrial', 'iot',
]


def get_headers():
    token = os.environ.get("GITHUB_TOKEN", "")
    h = {"User-Agent": "eol-chip-fetcher/1.0", "Accept": "application/vnd.github.v3+json"}
    if token:
        h["Authorization"] = f"token {token}"
    return h


def list_dir(path):
    url = f"{GITHUB_API}/repos/{REPO}/contents/{path}"
    try:
        resp = requests.get(url, headers=get_headers(), timeout=15)
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"    Warning: {e}")
        return []


def fetch_raw(download_url):
    try:
        resp = requests.get(download_url, timeout=15)
        resp.raise_for_status()
        return resp.text
    except Exception:
        return ""


def parse_module(content, path):
    name_m = re.search(r"['\"]Name['\"]\s*=>\s*['\"]([^'\"]+)['\"]", content)
    desc_m = re.search(r"['\"]Description['\"]\s*=>\s*%q\{([^}]+)\}", content, re.DOTALL)
    if not desc_m:
        desc_m = re.search(r"['\"]Description['\"]\s*=>\s*['\"]([^'\"]{10,})['\"]", content)

    cves = re.findall(r"\[['\"]CVE['\"],\s*['\"]([^'\"]+)['\"]", content)

    name = name_m.group(1).strip() if name_m else path.split('/')[-1].replace('.rb', '')
    desc = re.sub(r'\s+', ' ', desc_m.group(1)).strip() if desc_m else ""
    return name, desc[:400], [f"CVE-{c}" for c in cves]


def main():
    results = []
    seen = set()

    for d in TARGET_DIRS:
        print(f"  Scanning {d}...")
        items = list_dir(d)
        time.sleep(0.5)

        for item in items:
            if item.get('type') != 'file' or not item['name'].endswith('.rb'):
                continue
            path = item['path']
            if path in seen:
                continue
            seen.add(path)

            content = fetch_raw(item['download_url'])
            time.sleep(0.3)

            name, desc, cves = parse_module(content, path)
            module_id = path.split('/')[-1].replace('.rb', '')

            results.append({
                "id": f"MSF-{module_id}",
                "type": "metasploit",
                "title": name,
                "description": desc,
                "source": "Metasploit",
                "date": "",
                "url": f"https://github.com/{REPO}/blob/master/{path}",
                "cves": cves,
                "severity": "",
                "module_path": path,
            })

        print(f"    {len(items)} files found")

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Saved {len(results)} Metasploit modules -> {OUT_PATH}")


if __name__ == "__main__":
    main()
