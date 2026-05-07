#!/usr/bin/env python3
"""Fetch firmware/IoT/embedded vulnerabilities from OSV.dev.

OSV.dev is an open vulnerability database run by Google with broad coverage
across packages, ecosystems, firmware, and IoT projects. Many entries reference
CVE IDs but are surfaced earlier than NVD; some are firmware-only and not in NVD.

We query a curated list of ecosystems + packages relevant to firmware/IoT/
embedded systems.
"""

import json
import os
import time

import requests

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
OUT_PATH = os.path.join(DATA_DIR, "osv.json")
API = "https://api.osv.dev/v1/query"
UA = "eol-chip-bot/1.0 (https://iotsrg.github.io/eol-chip)"
HEADERS = {"User-Agent": UA, "Content-Type": "application/json"}

# Ecosystems with hardware/embedded/firmware relevance.
# OSV supports many ecosystems; this list focuses on hardware-adjacent ones.
ECOSYSTEMS_AND_PACKAGES = [
    # Embedded / IoT projects
    ("OSS-Fuzz", "openthread"),
    ("OSS-Fuzz", "openssl"),
    ("OSS-Fuzz", "mbedtls"),
    ("OSS-Fuzz", "wolfssl"),
    ("OSS-Fuzz", "openocd"),
    ("Linux", "linux"),
    ("UVI", None),  # Universal Vulnerability Identifier - bare ecosystem query
]

# Targeted package names common in firmware / IoT
PACKAGES = [
    ("Go",   "github.com/openwrt/openwrt"),
    ("npm",  "node-red"),
    ("npm",  "homebridge"),
    ("PyPI", "esptool"),
    ("PyPI", "pymodbus"),
    ("PyPI", "scapy"),
    ("PyPI", "ampy"),
    ("PyPI", "micropython"),
    ("PyPI", "circuitpython"),
]


def query_package(ecosystem, name):
    """Query OSV for vulns affecting a specific package."""
    payload = {"package": {"name": name, "ecosystem": ecosystem}}
    try:
        r = requests.post(API, json=payload, headers=HEADERS, timeout=20)
        if r.status_code == 200:
            return r.json().get("vulns", []) or []
    except Exception as e:
        print(f"  query failed for {ecosystem}/{name}: {e}")
    return []


def normalize(v):
    """Normalize an OSV vuln record into our common schema."""
    aliases = v.get("aliases", []) or []
    cves = [a for a in aliases if a.startswith("CVE-")]
    osv_id = v.get("id", "")
    summary = v.get("summary", "") or ""
    details = v.get("details", "") or ""
    pubd = v.get("published", "") or ""
    refs = [r.get("url", "") for r in (v.get("references", []) or []) if r.get("url")]
    severity = ""
    sev_list = v.get("severity", []) or []
    if sev_list:
        s = sev_list[0]
        score = s.get("score", "")
        if score:
            try:
                # CVSS vector or numeric - try to extract score
                if "/" in str(score):
                    severity = "HIGH"  # CVSS vector - leave for cross-link to refine
                else:
                    n = float(score)
                    if n >= 9: severity = "CRITICAL"
                    elif n >= 7: severity = "HIGH"
                    elif n >= 4: severity = "MEDIUM"
                    else: severity = "LOW"
            except Exception:
                severity = ""
    affected_pkgs = []
    for a in v.get("affected", []) or []:
        pkg = a.get("package", {}) or {}
        nm = pkg.get("name", "")
        if nm: affected_pkgs.append(nm)

    return {
        "id": osv_id,
        "type": "osv",
        "title": (summary or details[:120]).strip(),
        "description": details[:500].strip(),
        "severity": severity,
        "source": "OSV.dev",
        "date": pubd[:10] if pubd else "",
        "url": f"https://osv.dev/vulnerability/{osv_id}",
        "cves": sorted(set(cves)),
        "packages": list(set(affected_pkgs))[:6],
        "references": refs[:6],
    }


def main():
    seen = set()
    results = []

    for ecosystem, pkg in PACKAGES + [(e, n) for e, n in ECOSYSTEMS_AND_PACKAGES if n]:
        print(f"  Querying {ecosystem}/{pkg}…")
        vulns = query_package(ecosystem, pkg)
        for v in vulns:
            vid = v.get("id")
            if not vid or vid in seen:
                continue
            seen.add(vid)
            results.append(normalize(v))
        print(f"    -> {len(vulns)} vulns ({len(results)} unique total)")
        time.sleep(0.4)

    if not results and os.path.exists(OUT_PATH):
        print(f"  OSV: 0 results - keeping existing {OUT_PATH}")
        return

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Saved {len(results)} OSV entries -> {OUT_PATH}")


if __name__ == "__main__":
    main()
