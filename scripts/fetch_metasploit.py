#!/usr/bin/env python3
"""Fetch hardware/IoT/ICS Metasploit modules using GitHub git-tree API.

Single recursive call retrieves every module path; we filter by path keywords,
then download only matched files for metadata extraction.
"""

import json
import os
import re
import time

import requests

GITHUB_API = "https://api.github.com"
RAW_BASE = "https://raw.githubusercontent.com/rapid7/metasploit-framework/master"
REPO = "rapid7/metasploit-framework"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "metasploit.json")

# Path-substring filters (case-insensitive). Anything matching any of these
# in its module path is considered hardware/IoT/ICS-relevant.
PATH_KEYWORDS = [
    "scada", "ics", "modbus", "dnp3", "bacnet", "iec104", "profinet",
    "rfid", "nfc", "can_bus", "automotive",
    "vxworks", "qnx", "embedded", "firmware", "bootloader", "uefi", "bios",
    "printer", "mqtt", "coap", "upnp", "snmp", "mdns",
    "router", "modem", "gateway", "cellular", "gprs", "lte",
    "bluetooth", "zigbee", "zwave", "z-wave", "wifi", "wireless",
    "telephony", "voip", "sip", "asterisk",
    # Vendor module folders (network gear / NAS / IoT)
    "ubiquiti", "mikrotik", "cisco", "juniper", "fortinet", "sonicwall",
    "asus", "netgear", "tp-link", "tplink", "dlink", "d-link", "linksys",
    "zyxel", "draytek", "huawei", "tenda", "trendnet",
    "hikvision", "dahua", "axis", "hanwha",
    "qnap", "synology", "western_digital", "wd_my_cloud",
    "honeywell", "siemens", "schneider", "rockwell", "ge_", "abb",
    "moxa", "advantech", "wago", "mitsubishi", "omron",
    "supermicro", "ipmi", "ilo",
]

VENDOR_HINTS = {
    "cisco": "Cisco", "juniper": "Juniper", "fortinet": "Fortinet",
    "sonicwall": "SonicWall", "asus": "ASUS", "netgear": "Netgear",
    "tp-link": "TP-Link", "tplink": "TP-Link", "dlink": "D-Link",
    "d-link": "D-Link", "linksys": "Linksys", "zyxel": "Zyxel",
    "huawei": "Huawei", "hikvision": "Hikvision", "dahua": "Dahua",
    "axis": "Axis", "qnap": "QNAP", "synology": "Synology",
    "ubiquiti": "Ubiquiti", "mikrotik": "MikroTik",
    "siemens": "Siemens", "schneider": "Schneider Electric",
    "rockwell": "Rockwell", "honeywell": "Honeywell", "moxa": "Moxa",
    "advantech": "Advantech",
}


def get_headers():
    token = os.environ.get("GITHUB_TOKEN", "")
    h = {"User-Agent": "eol-chip-fetcher/1.0", "Accept": "application/vnd.github.v3+json"}
    if token:
        h["Authorization"] = f"token {token}"
    return h


def get_master_sha():
    url = f"{GITHUB_API}/repos/{REPO}/branches/master"
    resp = requests.get(url, headers=get_headers(), timeout=20)
    resp.raise_for_status()
    return resp.json()["commit"]["sha"]


def get_full_tree(sha):
    url = f"{GITHUB_API}/repos/{REPO}/git/trees/{sha}?recursive=1"
    resp = requests.get(url, headers=get_headers(), timeout=60)
    resp.raise_for_status()
    data = resp.json()
    return data.get("tree", []), data.get("truncated", False)


def fetch_raw(path):
    try:
        resp = requests.get(f"{RAW_BASE}/{path}", timeout=20)
        if resp.status_code == 200:
            return resp.text
    except Exception:
        pass
    return ""


def vendor_from_path(path):
    p = path.lower()
    for hint, name in VENDOR_HINTS.items():
        if hint in p:
            return name
    return ""


def parse_module(content, path):
    name = ""
    desc = ""
    rank = ""
    disclosure = ""
    cves = []
    refs = []
    platforms = []

    m = re.search(r"['\"]Name['\"]\s*=>\s*['\"]([^'\"]+)['\"]", content)
    if m:
        name = m.group(1).strip()

    m = re.search(r"['\"]Description['\"]\s*=>\s*%q\{([^}]+)\}", content, re.DOTALL)
    if not m:
        m = re.search(r"['\"]Description['\"]\s*=>\s*['\"]([^'\"]{10,})['\"]", content)
    if m:
        desc = re.sub(r"\s+", " ", m.group(1)).strip()[:500]

    m = re.search(r"['\"]DisclosureDate['\"]\s*=>\s*['\"]([^'\"]+)['\"]", content)
    if m:
        disclosure = m.group(1).strip()

    m = re.search(r"Rank\s*=\s*(\w+Ranking)", content)
    if m:
        rank = m.group(1).replace("Ranking", "")

    cves = [f"CVE-{c}" for c in re.findall(r"\[\s*['\"]CVE['\"]\s*,\s*['\"]([^'\"]+)['\"]", content)]
    edbs = [f"EDB-{c}" for c in re.findall(r"\[\s*['\"]EDB['\"]\s*,\s*['\"]([^'\"]+)['\"]", content)]
    urls = re.findall(r"\[\s*['\"]URL['\"]\s*,\s*['\"]([^'\"]+)['\"]", content)
    refs = edbs + urls

    plat_m = re.search(r"['\"]Platform['\"]\s*=>\s*\[([^\]]+)\]", content)
    if plat_m:
        platforms = [p.strip().strip("'\"") for p in plat_m.group(1).split(",") if p.strip()]
    else:
        plat_m = re.search(r"['\"]Platform['\"]\s*=>\s*['\"]([^'\"]+)['\"]", content)
        if plat_m:
            platforms = [plat_m.group(1).strip()]

    if not name:
        name = path.split("/")[-1].replace(".rb", "")
    return {
        "name": name, "description": desc, "rank": rank,
        "disclosure_date": disclosure, "cves": cves,
        "references": refs[:10], "platforms": platforms,
    }


def main():
    print("  Resolving master SHA...")
    sha = get_master_sha()
    print(f"  master={sha[:8]}")
    print("  Fetching git tree (recursive)...")
    tree, truncated = get_full_tree(sha)
    print(f"  Tree entries: {len(tree)} (truncated={truncated})")

    candidates = []
    for entry in tree:
        if entry.get("type") != "blob":
            continue
        path = entry.get("path", "")
        if not path.startswith("modules/") or not path.endswith(".rb"):
            continue
        low = path.lower()
        if any(kw in low for kw in PATH_KEYWORDS):
            candidates.append(path)

    print(f"  Hardware/IoT candidates: {len(candidates)}")

    results = []
    for i, path in enumerate(candidates, 1):
        if i % 25 == 0:
            print(f"  ...processed {i}/{len(candidates)}")
        content = fetch_raw(path)
        if not content:
            continue
        meta = parse_module(content, path)
        module_id = path.split("/")[-1].replace(".rb", "")
        results.append({
            "id": f"MSF-{module_id}",
            "type": "metasploit",
            "title": meta["name"],
            "description": meta["description"],
            "manufacturer": vendor_from_path(path),
            "source": "Metasploit",
            "date": meta["disclosure_date"],
            "url": f"https://github.com/{REPO}/blob/master/{path}",
            "cves": meta["cves"],
            "references": meta["references"],
            "rank": meta["rank"],
            "platforms": meta["platforms"],
            "module_path": path,
            "severity": "",
        })
        time.sleep(0.05)

    if not results and os.path.exists(OUT_PATH):
        print(f"WARNING: 0 Metasploit modules fetched - keeping existing {OUT_PATH}")
        return

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Saved {len(results)} Metasploit modules -> {OUT_PATH}")


if __name__ == "__main__":
    main()
