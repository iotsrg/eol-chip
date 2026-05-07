#!/usr/bin/env python3
"""Cross-link CVEs, KEV, exploits, MSF, GHSA against each other AND against EOL chips.

After all fetchers have run, this:
  1. Adds kev/exploit_count/msf_count/ghsa_count flags to each CVE.
  2. Adds cve_count/kev_count/exploit_count/msf_count to each EOL chip
     by keyword-matching the chip's part_number / name against threat
     records' titles, descriptions, and affected products.
"""

import json
import os
import re

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")


def load(name):
    p = os.path.join(DATA_DIR, name)
    if not os.path.exists(p):
        return []
    with open(p) as f:
        return json.load(f)


def save(name, items):
    with open(os.path.join(DATA_DIR, name), "w") as f:
        json.dump(items, f, indent=2)


def cve_pass(cves, kev_set, edb_count, msf_count, ghsa_count, ps_count):
    flagged = 0
    for cve in cves:
        cid = cve.get("id", "")
        cve["kev"] = cid in kev_set
        cve["exploit_count"] = edb_count.get(cid, 0)
        cve["msf_count"] = msf_count.get(cid, 0)
        cve["ghsa_count"] = ghsa_count.get(cid, 0)
        cve["packetstorm_count"] = ps_count.get(cid, 0)
        if cve["kev"] or cve["exploit_count"] or cve["msf_count"]:
            flagged += 1
        if cve["kev"] and cve.get("severity") in ("", "LOW", "MEDIUM"):
            cve["severity"] = "HIGH"
    return flagged


def chip_keywords(chip):
    """Build robust keyword variants for matching a chip against threat text.

    Returns (strong_kws, weak_kws, mfr_lc):
      strong_kws  - distinctive enough to match on their own
      weak_kws    - need manufacturer context (avoids false positives on bare
                    numbers like '8080' / '7400' / '4004' which collide with
                    HTTP ports, CVE IDs, model numbers, etc.)
    """
    pn = str(chip.get("part_number") or "").strip()
    name = str(chip.get("title") or chip.get("name") or "").strip()
    mfr = str(chip.get("manufacturer") or "").strip()

    strong, weak = set(), set()

    def classify(tok):
        if not tok or len(tok) < 4:
            return
        # Distinctive: contains a letter
        if re.search(r"[A-Za-z]", tok):
            strong.add(tok)
        else:
            # Pure digits: only useful with manufacturer context
            weak.add(tok)

    if pn:
        classify(pn)
        m = re.match(r"^([A-Za-z0-9]+?\d+)", pn)
        if m and len(m.group(1)) >= 4:
            classify(m.group(1))
        m = re.match(r"^([A-Za-z]+\d{3,5})", pn)
        if m:
            classify(m.group(1))

    for tok in re.findall(r"[A-Za-z]+\d+[A-Za-z0-9]*", name):
        if len(tok) >= 4:
            classify(tok)

    BLACKLIST = {"USB", "ARM", "AVR", "8-bit", "16-bit", "32-bit"}
    strong = {k for k in strong if k not in BLACKLIST}
    return strong, weak, mfr.lower()


def haystack(item):
    parts = [
        item.get("title", ""),
        item.get("description", ""),
        item.get("manufacturer", ""),
        " ".join(item.get("affected_products", []) or []),
        " ".join(item.get("vendors", []) or []),
        " ".join(item.get("packages", []) or []),
        " ".join(item.get("platforms", []) or []),
        item.get("module_path", ""),
    ]
    return " ".join(p for p in parts if p).lower()


def chip_pass(chips, threats_by_type):
    """Tag each EOL chip with counts of matching threat records."""
    high_risk = []

    for chip in chips:
        strong, weak, mfr = chip_keywords(chip)
        all_kws = strong | weak
        if not all_kws:
            chip["cve_count"] = 0
            chip["kev_count"] = 0
            chip["exploit_count"] = 0
            chip["msf_count"] = 0
            chip["ghsa_count"] = 0
            chip["matched_cves"] = []
            chip["risk_score"] = 0
            continue

        lc_strong = {k.lower() for k in strong}
        lc_weak = {k.lower() for k in weak}
        # Manufacturer keyword: take the first word, drop parens/punct
        mfr_main = re.split(r"[\s(]", mfr)[0] if mfr else ""

        def matches(item):
            hay = haystack(item)
            if any(kw in hay for kw in lc_strong):
                return True
            # Weak keywords (bare digits) require manufacturer mention nearby
            if lc_weak and mfr_main and mfr_main in hay:
                if any(kw in hay for kw in lc_weak):
                    return True
            return False

        cve_hits, kev_hits, edb_hits, msf_hits, ghsa_hits = [], [], [], [], []

        for cve in threats_by_type.get("cve", []):
            if matches(cve):
                cve_hits.append(cve["id"])
                if cve.get("kev"):
                    kev_hits.append(cve["id"])

        for kev in threats_by_type.get("cisa", []):
            if matches(kev):
                kev_hits.append(kev["id"])

        for edb in threats_by_type.get("exploit", []):
            if matches(edb):
                edb_hits.append(edb["id"])

        for msf in threats_by_type.get("metasploit", []):
            if matches(msf):
                msf_hits.append(msf["id"])

        for ghsa in threats_by_type.get("ghsa", []):
            if matches(ghsa):
                ghsa_hits.append(ghsa["id"])

        chip["cve_count"] = len(set(cve_hits))
        chip["kev_count"] = len(set(kev_hits))
        chip["exploit_count"] = len(set(edb_hits))
        chip["msf_count"] = len(set(msf_hits))
        chip["ghsa_count"] = len(set(ghsa_hits))
        chip["matched_cves"] = sorted(set(cve_hits))[:30]
        chip["matched_kev"] = sorted(set(kev_hits))[:15]

        # Risk score: KEV is heaviest, then MSF, then exploits, then CVEs.
        chip["risk_score"] = (
            chip["kev_count"] * 10
            + chip["msf_count"] * 5
            + chip["exploit_count"] * 2
            + chip["cve_count"]
        )
        if chip["risk_score"] > 0:
            high_risk.append({
                "id": chip.get("id", ""),
                "part_number": chip.get("part_number", ""),
                "title": chip.get("title") or chip.get("name", ""),
                "manufacturer": chip.get("manufacturer", ""),
                "category": chip.get("category", ""),
                "status": chip.get("status", ""),
                "eol_date": chip.get("eol_date", ""),
                "url": chip.get("url", ""),
                "cve_count": chip["cve_count"],
                "kev_count": chip["kev_count"],
                "exploit_count": chip["exploit_count"],
                "msf_count": chip["msf_count"],
                "risk_score": chip["risk_score"],
            })

    high_risk.sort(key=lambda x: -x["risk_score"])
    return high_risk


def main():
    cves = load("cves.json")
    if not cves:
        print("No CVEs - skipping cross-link")
        return

    kev_set = {c["id"] for c in load("cisa_kev.json") if c.get("id", "").startswith("CVE-")}

    edb_count = {}
    for e in load("exploits.json"):
        for cve in e.get("cves") or e.get("cve_refs") or []:
            edb_count[cve] = edb_count.get(cve, 0) + 1

    msf_count = {}
    for m in load("metasploit.json"):
        for cve in m.get("cves", []):
            msf_count[cve] = msf_count.get(cve, 0) + 1

    ghsa_count = {}
    for g in load("ghsa.json"):
        for cve in g.get("cves", []):
            ghsa_count[cve] = ghsa_count.get(cve, 0) + 1

    ps_count = {}
    for p in load("packetstorm.json"):
        for cve in p.get("cves", []):
            ps_count[cve] = ps_count.get(cve, 0) + 1

    flagged = cve_pass(cves, kev_set, edb_count, msf_count, ghsa_count, ps_count)
    save("cves.json", cves)
    print(f"  CVEs cross-linked: {flagged}/{len(cves)} have KEV/EDB/MSF references")

    # EOL chip cross-link
    chips = load("eol_chips.json")
    if chips:
        threats = {
            "cve": cves,
            "cisa": load("cisa_kev.json"),
            "exploit": load("exploits.json"),
            "metasploit": load("metasploit.json"),
            "ghsa": load("ghsa.json"),
            "osv": load("osv.json"),
            "psirt": load("vendor_psirts.json"),
            "recall": load("auto_recalls.json"),
        }
        high_risk = chip_pass(chips, threats)
        save("eol_chips.json", chips)
        print(f"  EOL chips cross-linked: {len(high_risk)}/{len(chips)} have known threats")

        # Top 10 preview
        for hr in high_risk[:10]:
            print(f"    [{hr['risk_score']:>3}] {hr['part_number']:<20} "
                  f"CVE:{hr['cve_count']:<3} KEV:{hr['kev_count']:<2} "
                  f"EDB:{hr['exploit_count']:<3} MSF:{hr['msf_count']:<2} "
                  f"({hr['manufacturer']})")

        save("high_risk_chips.json", high_risk)


if __name__ == "__main__":
    main()
