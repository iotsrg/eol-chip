#!/usr/bin/env python3
"""Convert chips.yaml to data/eol_chips.json."""

import json
import os
import yaml


def main():
    yaml_path = os.path.join(os.path.dirname(__file__), "..", "chips.yaml")
    out_path = os.path.join(os.path.dirname(__file__), "..", "data", "eol_chips.json")

    with open(yaml_path, "r") as f:
        data = yaml.safe_load(f)

    chips = []
    for chip in data.get("chips", []):
        chips.append({
            "id": f"EOL-{chip['part_number']}",
            "type": "eol",
            "title": chip["name"],
            "description": chip.get("description", ""),
            "manufacturer": chip.get("manufacturer", ""),
            "part_number": chip["part_number"],
            "category": chip.get("category", ""),
            "source": "Manual",
            "date": chip.get("eol_date", ""),
            "url": chip.get("url", ""),
            "eol_date": chip.get("eol_date", ""),
            "last_order_date": chip.get("last_order_date", ""),
            "status": chip.get("status", ""),
            "datasheet": chip.get("datasheet", ""),
            "fcc_id": chip.get("fcc_id", ""),
        })

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(chips, f, indent=2)

    print(f"Processed {len(chips)} EOL chips -> {out_path}")


if __name__ == "__main__":
    main()
