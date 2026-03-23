#!/usr/bin/env python3
"""Combine all data JSON files into a single search index."""

import json
import os


DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
FILES = ["cves.json", "exploits.json", "cisa_kev.json", "metasploit.json", "eol_chips.json"]


def main():
    combined = []
    for fname in FILES:
        path = os.path.join(DATA_DIR, fname)
        if os.path.exists(path):
            with open(path) as f:
                items = json.load(f)
                combined.extend(items)
                print(f"  Loaded {len(items)} items from {fname}")
        else:
            print(f"  Skipped {fname} (not found)")

    out_path = os.path.join(DATA_DIR, "search_index.json")
    with open(out_path, "w") as f:
        json.dump(combined, f)

    print(f"Built search index with {len(combined)} total items -> {out_path}")


if __name__ == "__main__":
    main()
