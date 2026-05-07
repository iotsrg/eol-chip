#!/usr/bin/env python3
"""Multi-source chip enrichment.

Sources (best-effort, all reachable ones contribute):
  1. Wikipedia REST summary + longer intro (intro_full)
  2. Wikidata (deep): manufacturer, dates, clock freq, transistor count,
     fabrication method, predecessor/successor, image, subclass, etc.
     Quantity claims resolve their units; entity refs resolve to labels.
  3. Wikidata search-by-label fallback (when no Wikipedia article exists,
     search for the part number directly in Wikidata)
  4. WikiChip (en.wikichip.org) - rich CPU/SoC database. May be blocked
     by network firewall; gracefully skipped if connection refused.
  5. Family fallback (ESP32-D0WDQ6 -> ESP32, STM32F407VG -> STM32F4)
  6. Wikipedia images converted via Commons Special:FilePath if no thumb

Cache: data/chip_facts.json keyed by part_number.
"""

import json
import os
import re
import socket
import sys
import time
import urllib.parse

import requests

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
CHIPS_PATH = os.path.join(DATA_DIR, "eol_chips.json")
OUT_PATH = os.path.join(DATA_DIR, "chip_facts.json")

UA = "eol-chip-bot/1.0 (https://iotsrg.github.io/eol-chip; chip enrichment)"
HEADERS = {"User-Agent": UA, "Accept": "application/json"}
HTML_HEADERS = {"User-Agent": UA, "Accept": "text/html"}

WIKI_REST_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/{}"
WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_ENTITY = "https://www.wikidata.org/wiki/Special:EntityData/{}.json"
WIKIDATA_SEARCH = "https://www.wikidata.org/w/api.php"
WIKICHIP_URL_FMT = "https://en.wikichip.org/wiki/{}"
WIKICHIP_API = "https://en.wikichip.org/w/api.php"
COMMONS_FILE = "https://commons.wikimedia.org/wiki/Special:FilePath/{}"

# Rich chip-related Wikidata properties.
PROP_LABELS = {
    "P31":   "type",
    "P176":  "manufacturer",
    "P571":  "introduced",
    "P577":  "released",
    "P2669": "discontinued",
    "P155":  "followed_by",
    "P156":  "follows",
    "P361":  "part_of",
    "P5023": "transistor_count",
    "P2079": "fabrication_method",
    "P2149": "clock_frequency",
    "P2046": "die_area",
    "P186":  "material",
    "P527":  "has_parts",
    "P1056": "product",
    "P3938": "named_after",
    "P137":  "operator",
    "P2575": "units_sold",
    "P279":  "subclass_of",
    "P306":  "operating_system",
    "P1535": "used_by",
}

ENTITY_LABEL_CACHE = {}
WIKICHIP_REACHABLE = None  # Lazy probe


def title_from_wp_url(url):
    if not url or "wikipedia.org/wiki/" not in url:
        return None
    return urllib.parse.unquote(url.split("/wiki/")[-1])


def search_wikipedia(query):
    q = (query or "").strip()
    if len(q) < 3:
        return None
    try:
        r = requests.get(
            WIKI_API,
            params={"action": "opensearch", "search": q, "limit": 3,
                    "namespace": 0, "format": "json"},
            headers=HEADERS, timeout=10)
        if r.status_code == 200:
            data = r.json()
            for t in (data[1] if len(data) > 1 else []):
                tl = t.lower()
                if "list of" in tl or "(disambiguation)" in tl:
                    continue
                return t
    except Exception:
        pass
    return None


CHIP_KEYWORDS = (
    "microprocessor", "processor", "processing unit", "cpu", "microcontroller",
    "mcu", "integrated circuit", "system-on-a-chip", "system on a chip",
    "soc ", " soc.", " soc,", " soc;", "fpga", "asic", "transceiver", "modem",
    "memory", "dram", "sram", "rom", "eprom", "eeprom", "flash memory",
    "chipset", "semiconductor", "wi-fi chip", "bluetooth chip",
    "bluetooth controller", "ethernet controller", "wireless chip",
    "video card", "graphics card", "graphics processor", "gpu",
    "voltage regulator", "power management", "amplifier ic", "logic gate",
    "ic family", "embedded controller", "sensor ic", "tpu", "npu",
    "mobile soc", "ble chip", "bridge ic", "pmic", "die ", "lithography",
    "transistor", "wafer", "rfid", "nand flash", "nor flash",
    "smart card", "secure element", "crypto chip", "wireless module",
    "gnss receiver", "gps chip", "gps receiver", "lora", "zigbee",
    "real-time clock", "rtc chip", "audio codec", "display driver",
    "ethernet phy", "wi-fi module", "wifi module", "bluetooth module",
    "rf transceiver", "microcontrollers", "microprocessors", "fpgas",
)

REJECT_TITLE_KEYWORDS = (
    "(film)", "(album)", "(song)", "(band)", "(novel)", "(book)",
    "airlines flight", "highway", "motorway", "f.c.", "club ",
    "(city)", "(town)", "election", "national park",
    "carrier strike group", "regiment", "battalion",
    "neo-nazi", "methylmercury", "tumor marker", "cross-dressing",
    "neoliberalism", "boeing ", "airbus ", "lockheed ", "northrop ",
    "world war", "stallion", "racehorse", "operating system",
    " a.d.", " ad)",
)


def looks_chip_related(summary):
    """Heuristic: does this Wikipedia summary describe a chip/IC/processor?"""
    if not summary:
        return False
    title_lo = (summary.get("title") or "").lower()
    desc_lo = (summary.get("description") or "").lower()
    extract_lo = (summary.get("extract") or "").lower()
    blob = f"{title_lo} {desc_lo} {extract_lo}"

    # Hard reject obvious non-chip pages
    for bad in REJECT_TITLE_KEYWORDS:
        if bad in title_lo or bad in desc_lo:
            return False
    # Wikidata description is the most reliable signal: short and curated
    if any(k in desc_lo for k in CHIP_KEYWORDS):
        return True
    # Else require multiple chip-keyword hits in extract
    hits = sum(1 for k in CHIP_KEYWORDS if k in extract_lo)
    return hits >= 2


def fetch_summary(title, validate=True):
    encoded = urllib.parse.quote(title.replace(" ", "_"), safe="")
    try:
        r = requests.get(WIKI_REST_SUMMARY.format(encoded), headers=HEADERS, timeout=15)
        if r.status_code == 200:
            j = r.json()
            if j.get("type") == "disambiguation":
                return None
            summary = {
                "title": j.get("title", ""),
                "extract": j.get("extract", ""),
                "description": j.get("description", ""),
                "thumbnail": (j.get("thumbnail") or {}).get("source", ""),
                "image": (j.get("originalimage") or {}).get("source", ""),
                "wp_url": (j.get("content_urls") or {}).get("desktop", {}).get("page", ""),
                "wikidata_id": j.get("wikibase_item", ""),
            }
            if validate and not looks_chip_related(summary):
                return None
            return summary
    except Exception:
        pass
    return None


def fetch_full_intro(title):
    try:
        r = requests.get(WIKI_API, params={
            "action": "query", "format": "json",
            "prop": "extracts", "exintro": 1, "explaintext": 1,
            "titles": title, "redirects": 1,
        }, headers=HEADERS, timeout=15)
        if r.status_code == 200:
            for _, page in r.json().get("query", {}).get("pages", {}).items():
                ext = page.get("extract", "")
                if ext and len(ext) > 100:
                    return ext.strip()
    except Exception:
        pass
    return ""


def resolve_label(qid):
    if not qid:
        return ""
    if qid in ENTITY_LABEL_CACHE:
        return ENTITY_LABEL_CACHE[qid]
    try:
        r = requests.get(WIKIDATA_ENTITY.format(qid), headers=HEADERS, timeout=10)
        if r.status_code == 200:
            entity = r.json().get("entities", {}).get(qid, {})
            label = entity.get("labels", {}).get("en", {}).get("value", "")
            ENTITY_LABEL_CACHE[qid] = label
            return label
    except Exception:
        pass
    ENTITY_LABEL_CACHE[qid] = ""
    return ""


def parse_value(snak):
    """Convert a Wikidata snak's mainsnak datavalue into a friendly string."""
    try:
        v = snak["mainsnak"]["datavalue"]["value"]
    except (KeyError, TypeError):
        return None
    if isinstance(v, dict):
        if "time" in v:
            t = v["time"]
            # +1971-11-15T00:00:00Z → "1971-11-15" or "1971" if no day
            try:
                year = t[1:5]
                month = t[6:8]
                day = t[9:11]
                if month != "00" and day != "00":
                    return f"{year}-{month}-{day}"
                if month != "00":
                    return f"{year}-{month}"
                return year
            except Exception:
                return t
        if "id" in v:
            return resolve_label(v["id"]) or v["id"]
        if "amount" in v:
            amount = v["amount"].lstrip("+")
            unit_url = v.get("unit", "")
            unit = ""
            if unit_url and unit_url != "1":
                qid = unit_url.rsplit("/", 1)[-1]
                unit = resolve_label(qid)
            try:
                num = float(amount)
                # Pretty: 740 -> "740", 1500000 -> "1.5M"
                if num >= 1e9:
                    s = f"{num/1e9:g}B"
                elif num >= 1e6:
                    s = f"{num/1e6:g}M"
                elif num >= 1e3 and num != int(num) is False:
                    s = f"{num:,g}"
                else:
                    s = f"{num:g}"
            except ValueError:
                s = amount
            return f"{s} {unit}".strip()
        return str(v)[:120]
    return str(v)


def fetch_wikidata(qid):
    """Return a dict with label-keyed enriched values for chip-relevant properties."""
    if not qid:
        return {}
    try:
        r = requests.get(WIKIDATA_ENTITY.format(qid), headers=HEADERS, timeout=15)
        r.raise_for_status()
        entity = r.json().get("entities", {}).get(qid, {})
    except Exception:
        return {}

    claims = entity.get("claims", {})
    out = {}

    for pid, label in PROP_LABELS.items():
        snaks = claims.get(pid, [])
        if not snaks:
            continue
        # Multiple values: collect a few
        vals = []
        for s in snaks[:4]:
            v = parse_value(s)
            if v:
                vals.append(v)
        if vals:
            if len(vals) == 1:
                out[label] = vals[0]
            else:
                out[label] = vals

    # Image filename in P18 - construct a Commons URL
    img_snaks = claims.get("P18", [])
    if img_snaks:
        try:
            fname = img_snaks[0]["mainsnak"]["datavalue"]["value"]
            if fname:
                out["image_url"] = COMMONS_FILE.format(urllib.parse.quote(fname.replace(" ", "_")))
        except (KeyError, TypeError):
            pass

    # Aliases & description for context
    desc = entity.get("descriptions", {}).get("en", {}).get("value", "")
    if desc:
        out["wd_description"] = desc

    return out


def search_wikidata(query):
    """Search Wikidata directly for a chip name; returns a Q-id or None."""
    q = (query or "").strip()
    if len(q) < 3:
        return None
    try:
        r = requests.get(WIKIDATA_SEARCH, params={
            "action": "wbsearchentities", "search": q,
            "language": "en", "format": "json", "limit": 3,
        }, headers=HEADERS, timeout=10)
        if r.status_code != 200:
            return None
        for hit in r.json().get("search", []):
            desc = (hit.get("description") or "").lower()
            # Heuristic: prefer hits whose description mentions chips/CPUs/microcontrollers
            if any(k in desc for k in ("processor", "microprocessor", "microcontroller",
                                       "cpu", "soc", "chip", "circuit", "controller",
                                       "transceiver", "memory")):
                return hit["id"]
        # Fall back to first hit
        hits = r.json().get("search", [])
        return hits[0]["id"] if hits else None
    except Exception:
        return None


def family_candidates(pn, name):
    out = []
    if pn:
        out.append(pn)
        if "-" in pn:
            out.append(pn.split("-")[0])
        m = re.match(r"^([A-Za-z]+\d+)[A-Za-z0-9]*$", pn)
        if m: out.append(m.group(1))
        m = re.match(r"^([A-Za-z]+\d{1,2})", pn)
        if m and len(m.group(1)) >= 4: out.append(m.group(1))
    seen, uniq = set(), []
    for t in out:
        t = t.strip()
        if t and t not in seen and len(t) >= 3:
            seen.add(t); uniq.append(t)
    return uniq


def probe_wikichip():
    global WIKICHIP_REACHABLE
    if WIKICHIP_REACHABLE is not None:
        return WIKICHIP_REACHABLE
    try:
        s = socket.create_connection(("en.wikichip.org", 443), timeout=5)
        s.close()
        WIKICHIP_REACHABLE = True
    except Exception:
        WIKICHIP_REACHABLE = False
        print("  ⚠ WikiChip is not reachable from this host (firewall/IP block) - skipping for this run", file=sys.stderr)
    return WIKICHIP_REACHABLE


def fetch_wikichip(term):
    """Best-effort WikiChip page fetch + extract. Returns dict or None."""
    if not probe_wikichip():
        return None
    encoded = urllib.parse.quote(term.replace(" ", "_"), safe="")
    url = WIKICHIP_URL_FMT.format(encoded)
    try:
        r = requests.get(url, headers=HTML_HEADERS, timeout=15, allow_redirects=True)
        if r.status_code != 200 or "There is currently no text in this page" in r.text:
            return None
        # Pull first substantive paragraph
        m = re.search(r"<p>(.+?)</p>", r.text, re.DOTALL)
        if not m: return None
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip()
        if len(text) < 80: return None
        return {"wikichip_extract": text[:1200], "wikichip_url": r.url}
    except Exception:
        return None


def main():
    if not os.path.exists(CHIPS_PATH):
        print("No data/eol_chips.json - run process_eol.py first")
        return

    with open(CHIPS_PATH) as f:
        chips = json.load(f)

    cache = {}
    if os.path.exists(OUT_PATH):
        try:
            with open(OUT_PATH) as f:
                cache = json.load(f)
        except Exception:
            cache = {}

    new_count = wd_only = wp_hits = wd_hits = wc_hits = 0
    for i, chip in enumerate(chips, 1):
        pn = chip.get("part_number", "")
        if not pn:
            continue

        existing = cache.get(pn)
        # Re-process previously-tried (but failed) chips with new strategies
        if existing and existing.get("intro_full") and existing.get("wikidata"):
            continue

        title = title_from_wp_url(chip.get("url", ""))
        summary = None
        family_used = ""

        if title:
            summary = fetch_summary(title)

        if not summary:
            mfr = (chip.get("manufacturer", "") or "").split("(")[0].strip()
            name = chip.get("title", "")
            for q in (
                f"{mfr} {pn}".strip(),
                f"{mfr} {name}".strip(),
                pn,
            ):
                if len(q) < 3: continue
                t = search_wikipedia(q)
                if t:
                    summary = fetch_summary(t)
                    if summary:
                        title = t; break
                time.sleep(0.2)

        if not summary:
            for fam in family_candidates(pn, chip.get("title", "")):
                if fam == pn: continue
                t = search_wikipedia(fam)
                if t:
                    summary = fetch_summary(t)
                    if summary:
                        title = t; family_used = fam; break
                time.sleep(0.2)

        # Wikidata: either via summary's Q-id, or by direct search
        qid = summary.get("wikidata_id") if summary else None
        if not qid:
            mfr = (chip.get("manufacturer", "") or "").split("(")[0].strip()
            for q in (f"{mfr} {pn}".strip(), pn):
                if len(q) < 3: continue
                qid = search_wikidata(q)
                if qid: break
                time.sleep(0.2)

        wikidata = fetch_wikidata(qid) if qid else {}

        # WikiChip (best-effort, may be unreachable)
        wikichip = None
        for term in [pn] + family_candidates(pn, chip.get("title", ""))[:1]:
            wikichip = fetch_wikichip(term)
            if wikichip:
                wc_hits += 1
                break

        if not summary and not wikidata and not wikichip:
            cache[pn] = {"part_number": pn, "tried": True}
            print(f"[{i:>3}/{len(chips)}] {pn:<22} (no data found)")
            continue

        entry = {"part_number": pn}
        if summary:
            entry.update(summary)
            wp_hits += 1
            intro = fetch_full_intro(title)
            if intro and len(intro) > len(entry.get("extract", "")):
                entry["intro_full"] = intro
            if family_used:
                entry["matched_family"] = family_used
        if wikidata:
            entry["wikidata"] = wikidata
            wd_hits += 1
            # If no Wikipedia thumbnail but Wikidata had P18 image, use it
            if not entry.get("thumbnail") and wikidata.get("image_url"):
                entry["thumbnail"] = wikidata["image_url"]
        if wikichip:
            entry.update(wikichip)
        if not summary and wikidata:
            wd_only += 1

        cache[pn] = entry
        new_count += 1
        flags = []
        if summary: flags.append(f"wp:{len(summary.get('extract', ''))}")
        if wikidata: flags.append(f"wd:{len(wikidata)}")
        if wikichip: flags.append("wc")
        if family_used: flags.append(f"fam={family_used}")
        if not summary and wikidata: flags.append("WD-only")
        print(f"[{i:>3}/{len(chips)}] {pn:<22} ✓  ({' '.join(flags)})")
        time.sleep(0.4)

        if new_count % 25 == 0:
            with open(OUT_PATH, "w") as f:
                json.dump(cache, f, indent=2)

    with open(OUT_PATH, "w") as f:
        json.dump(cache, f, indent=2)

    enriched = sum(1 for v in cache.values() if v.get("extract") or v.get("wikichip_extract") or v.get("wikidata"))
    print(f"\n  Newly fetched: {new_count}")
    print(f"  Wikipedia hits: {wp_hits}, Wikidata hits: {wd_hits}, WD-only (no WP): {wd_only}, WikiChip hits: {wc_hits}")
    print(f"  Cache: {len(cache)} entries - {enriched} with any enrichment data")


if __name__ == "__main__":
    main()
