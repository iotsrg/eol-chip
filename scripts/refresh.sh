#!/usr/bin/env bash
# scripts/refresh.sh
#
# Run the full data-refresh pipeline LOCALLY (so we don't hammer NVD
# from the shared GitHub Actions egress and don't burn Actions minutes).
#
# Usage:
#   export NVD_API_KEY=...                 # optional but strongly recommended
#   export GITHUB_TOKEN=ghp_...            # for GHSA + Metasploit fetchers
#   bash scripts/refresh.sh                # fetch + build, no commit
#   bash scripts/refresh.sh --commit       # fetch + build + commit + push
#   bash scripts/refresh.sh --only=cves    # run a single fetcher
#
# What it does:
#   1. Installs Python deps (idempotent)
#   2. Runs the 10 fetchers, then process / enrich / cross-link / build-index
#   3. Reports per-file counts so you can see if anything came back empty
#   4. Optionally commits data/*.json and pushes to main
#
# Why local instead of the workflow:
#   - NVD's rate limits are per-IP; your home IP isn't shared with
#     every other GitHub Actions runner
#   - You can re-run a single failed fetcher without 25 minutes of CI
#   - No Actions minutes spent

set -e

cd "$(dirname "$0")/.."

# ---------- args ----------
COMMIT=0
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --commit) COMMIT=1 ;;
    --only=*) ONLY="${arg#--only=}" ;;
    -h|--help)
      sed -n '2,28p' "$0"; exit 0 ;;
  esac
done

# ---------- 1. deps ----------
echo "==> Ensuring Python deps..."
pip install -q -r scripts/requirements.txt

# ---------- 2. each fetcher ----------
run_step () {
  local name="$1"; shift
  if [ -n "$ONLY" ] && [ "$ONLY" != "$name" ]; then
    return
  fi
  echo "==> $name"
  "$@"
}

run_step cves           python3 scripts/fetch_cves.py
run_step exploits       python3 scripts/fetch_exploits.py
run_step cisa           python3 scripts/fetch_cisa.py
run_step ics            python3 scripts/fetch_ics_advisories.py
run_step ghsa           python3 scripts/fetch_ghsa.py
run_step packetstorm    python3 scripts/fetch_packetstorm.py
run_step osv            python3 scripts/fetch_osv.py
run_step recalls        python3 scripts/fetch_recalls.py
run_step psirts         python3 scripts/fetch_vendor_psirts.py
run_step metasploit     python3 scripts/fetch_metasploit.py

# When running only one fetcher, skip the heavy post-processing.
if [ -z "$ONLY" ]; then
  echo "==> Process EOL chips"
  python3 scripts/process_eol.py
  echo "==> Enrich chips with Wikipedia + Wikidata"
  python3 scripts/fetch_chip_facts.py
  echo "==> Cross-link CVEs ↔ KEV / Exploit / Metasploit"
  python3 scripts/cross_link.py
  echo "==> Build search index + meta"
  python3 scripts/build_search_index.py
fi

# ---------- 3. summary ----------
echo
echo "==> Summary"
for f in data/cves.json data/exploits.json data/cisa_kev.json data/metasploit.json data/ghsa.json data/osv.json data/eol_chips.json data/meta.json; do
  if [ -f "$f" ]; then
    count=$(python3 -c "import json; d=json.load(open('$f')); print(len(d) if isinstance(d, list) else len(d.get('total_items', d) if isinstance(d, dict) else d))" 2>/dev/null || echo "?")
    size=$(du -h "$f" | cut -f1)
    printf "  %-30s  %6s items  %s\n" "$(basename "$f")" "$count" "$size"
  fi
done

# ---------- 4. optional commit + push ----------
if [ "$COMMIT" = "1" ]; then
  echo
  echo "==> Committing + pushing"
  git add data/
  if git diff --cached --quiet; then
    echo "  (no data changes — nothing to commit)"
  else
    DATE=$(date -u +"%Y-%m-%d %H:%M UTC")
    git commit -m "Data refresh: $DATE (local run)" \
               -m "Ran scripts/refresh.sh locally to avoid Actions / NVD rate limits."
    git push origin "$(git rev-parse --abbrev-ref HEAD)"
    echo "  Push complete — GitHub Pages will redeploy in ~1 min."
  fi
fi

echo
echo "Done."
