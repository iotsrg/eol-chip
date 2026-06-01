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
        # NOTE: severity is left exactly as NVD assigned it. We deliberately do
        # NOT upgrade KEV CVEs to HIGH — "actively exploited" is conveyed by the
        # cve["kev"] flag, not by fabricating a CVSS severity the data lacks.
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


# Kernel oops/panic dumps embed a "Modules linked in: ..." list naming every
# driver loaded at crash time. Those names (e.g. "at24", "ccree") are NOT the
# subject of the CVE and cause keyword collisions (AT24C02 -> "at24" -> match).
# Strip that line, plus register/stack-dump lines, before keyword matching.
# The "Modules linked in:" list wraps across several newline-broken lines in a
# kernel log, ending at the next log field (a [ 60.18] timestamp, "CPU:", etc).
# Scrub the whole block, not just its first line.
_MODULES_BLOCK = re.compile(
    r"(?is)modules linked in:.*?(?=\[\s*\d+\.\d+\]|\bCPU:|\bHardware name:|\n\s*\n|$)"
)
# Other single-line oops headers whose symbol names also collide.
_OOPS_LINE = re.compile(r"(?im)^\s*(call trace:|stack:|code:).*$")


def scrub_oops(text):
    if not text:
        return ""
    text = _MODULES_BLOCK.sub(" ", text)
    return _OOPS_LINE.sub(" ", text)


def haystack(item):
    # NOTE: affected_products (CPE strings) are matched structurally in
    # cpe_targets(), not here, so they're excluded from the free-text haystack
    # used only as a HEURISTIC fallback for CVEs that have no CPE at all.
    parts = [
        item.get("title", ""),
        scrub_oops(item.get("description", "")),
        item.get("manufacturer", ""),
        " ".join(item.get("vendors", []) or []),
        " ".join(item.get("packages", []) or []),
        " ".join(item.get("platforms", []) or []),
        item.get("module_path", ""),
    ]
    return " ".join(p for p in parts if p).lower()


def _norm(s):
    """Lowercase and strip everything but alphanumerics for robust CPE compare."""
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def cpe_targets(item):
    """Extract structured (part, vendor, product) tuples from a record's CPEs.

    CPE 2.3 format: cpe:2.3:<part>:<vendor>:<product>:<version>:...
    Only 'h' (hardware) and 'o' (firmware/OS) parts are relevant to a chip;
    'a' (application software) is skipped to avoid software false matches.
    """
    out = []
    for cpe in item.get("affected_products") or []:
        if not isinstance(cpe, str) or not cpe.startswith("cpe:2.3:"):
            continue
        p = cpe.split(":")
        if len(p) < 6:
            continue
        part, vendor, product = p[2], p[3], p[4]
        if part not in ("h", "o"):
            continue
        if product in ("", "*", "-"):
            continue
        # keep the raw (lowercased) product so we can split on its '_'/'-'
        # delimiters into segments later (e.g. ethernet_..._e810-cqda1 -> e810)
        out.append((part, _norm(vendor), product.lower()))
    return out


def cpe_confirms(pn_norm, mfr_norm, targets):
    """True only when a CPE product is a confident match for this chip.

    Tiers (most→least permissive):
      1. exact: normalized CPE product == part number  -> trust alone
      2. segment / substring: the part number appears as a delimited token
         (or substring) inside the CPE product  -> requires vendor match and
         a letter-bearing part number (>=4 chars), so distinctive parts like
         'e810' match 'ethernet_network_adapter_e810-cqda1' but bare digit
         strings (which collide) do not.
    """
    if not pn_norm:
        return False
    has_alpha = any(c.isalpha() for c in pn_norm)
    for _part, cpe_vendor, product_raw in targets:
        prod_norm = _norm(product_raw)
        if not prod_norm:
            continue
        if prod_norm == pn_norm:
            return True
        if not has_alpha or len(pn_norm) < 4:
            continue  # pure-digit / too-short part numbers: exact match only
        vendor_ok = bool(mfr_norm) and (
            cpe_vendor == mfr_norm
            or cpe_vendor in mfr_norm
            or mfr_norm in cpe_vendor
        )
        if not vendor_ok:
            continue
        segments = {_norm(s) for s in re.split(r"[^A-Za-z0-9]+", product_raw)}
        if pn_norm in segments:
            return True
        if (pn_norm in prod_norm
                or prod_norm.startswith(pn_norm)
                or pn_norm.startswith(prod_norm)):
            return True
    return False


def _cve_to_ids(records, cve_keys=("cves", "cve_refs")):
    """Map each CVE id -> set of record ids that reference it.

    Used to link exploits / Metasploit modules / GHSA advisories to a chip
    ONLY through a CVE we have already CPE-confirmed for that chip — instead of
    fuzzy keyword matching the chip's part number against the record's text
    (which produced false hits like MIPS-R3000 <- "8E6 R3000 Internet Filter").
    """
    out = {}
    for rec in records:
        rid = rec.get("id")
        if not rid:
            continue
        refs = None
        for k in cve_keys:
            if rec.get(k):
                refs = rec[k]
                break
        for cve in refs or []:
            out.setdefault(cve, set()).add(rid)
    return out


def chip_pass(chips, threats_by_type):
    """Tag each EOL chip with counts of matching threat records."""
    high_risk = []

    # Reverse indexes: CVE id -> ids of threat records citing it. Built once.
    edb_by_cve = _cve_to_ids(threats_by_type.get("exploit", []))
    msf_by_cve = _cve_to_ids(threats_by_type.get("metasploit", []))
    ghsa_by_cve = _cve_to_ids(threats_by_type.get("ghsa", []))
    kev_cve_set = {
        k["id"] for k in threats_by_type.get("cisa", [])
        if str(k.get("id", "")).startswith("CVE-")
    }

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
        mfr_main = re.split(r"[\s(]", mfr)[0] if mfr else ""
        pn_norm = _norm(chip.get("part_number"))
        mfr_norm = _norm(mfr_main)

        # Build word-boundary regex per keyword. Plain substring match
        # produces nasty false positives like "Thor" -> "author"/"authorize",
        # "MAX" -> "maximum", "PIC" -> "epic". For digit-bearing tokens we
        # require word START boundary only (so "stm32" still matches
        # "stm32f407"). For pure-alphabetical tokens we require BOTH boundaries.
        def compile_pattern(kw):
            esc = re.escape(kw)
            if any(ch.isdigit() for ch in kw):
                return re.compile(r"\b" + esc, re.IGNORECASE)
            return re.compile(r"\b" + esc + r"\b", re.IGNORECASE)

        strong_re = [compile_pattern(k) for k in lc_strong]
        weak_re = [compile_pattern(k) for k in lc_weak]

        def matches(item):
            hay = haystack(item)
            if any(p.search(hay) for p in strong_re):
                return True
            if weak_re and mfr_main and mfr_main in hay:
                if any(p.search(hay) for p in weak_re):
                    return True
            return False

        cve_hits, kev_hits, edb_hits, msf_hits, ghsa_hits = [], [], [], [], []
        heuristic_hits = []

        for cve in threats_by_type.get("cve", []):
            targets = cpe_targets(cve)
            if targets:
                # CVE carries structured CPEs -> trust ONLY the CPE.
                # This is what kills the "AT24C02 -> at24 module" class of
                # false positives: a non-matching CPE means NOT this chip.
                if cpe_confirms(pn_norm, mfr_norm, targets):
                    cve_hits.append(cve["id"])
            else:
                # No CPE at all -> fall back to scrubbed keyword match, but
                # record it as a lower-confidence HEURISTIC (not a hard count).
                if matches(cve):
                    heuristic_hits.append(cve["id"])

        # Exploits / KEV / Metasploit / GHSA are linked ONLY through a chip's
        # CPE-confirmed CVEs (provenance-backed), never by keyword on their
        # free-text. A record with no CVE reference can't be mis-attributed.
        confirmed_cves = set(cve_hits)
        for cid in confirmed_cves:
            if cid in kev_cve_set:
                kev_hits.append(cid)
            edb_hits.extend(edb_by_cve.get(cid, ()))
            msf_hits.extend(msf_by_cve.get(cid, ()))
            ghsa_hits.extend(ghsa_by_cve.get(cid, ()))

        chip["cve_count"] = len(set(cve_hits))
        chip["kev_count"] = len(set(kev_hits))
        chip["exploit_count"] = len(set(edb_hits))
        chip["msf_count"] = len(set(msf_hits))
        chip["ghsa_count"] = len(set(ghsa_hits))
        chip["matched_cves"] = sorted(set(cve_hits))[:50]
        # Lower-confidence keyword matches (CVEs lacking a CPE). Kept separate
        # so the headline cve_count stays trustworthy; UI may show as "possible".
        chip["heuristic_cves"] = sorted(set(heuristic_hits) - set(cve_hits))[:50]
        chip["matched_kev"] = sorted(set(kev_hits))[:30]
        chip["matched_exploits"] = sorted(set(edb_hits))[:50]
        chip["matched_msf"] = sorted(set(msf_hits))[:30]
        chip["matched_ghsa"] = sorted(set(ghsa_hits))[:30]

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

    # Fill CISA KEV severity from the matching CVE's REAL NVD CVSS severity.
    # The KEV feed carries no severity, so fetch_cisa.py leaves it "". We never
    # fabricate one: if we have no CVSS for that CVE, it stays "Unrated".
    cisa = load("cisa_kev.json")
    if cisa:
        cvss_by_id = {c["id"]: (c.get("severity") or "") for c in cves}
        rated = 0
        for k in cisa:
            sev = cvss_by_id.get(k.get("id", ""), "")
            k["severity"] = sev if sev else "Unrated"
            if sev:
                rated += 1
        save("cisa_kev.json", cisa)
        print(f"  CISA KEV severity: {rated}/{len(cisa)} from real CVSS, "
              f"{len(cisa) - rated} Unrated (no fabrication)")

    # EOL chip cross-link
    chips = load("eol_chips.json")
    if chips:
        threats = {
            "cve": cves,
            "cisa": cisa,
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
