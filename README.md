# EOL-CHIP

[![Build & Deploy](https://github.com/iotsrg/eol-chip/actions/workflows/build-deploy.yml/badge.svg)](https://github.com/iotsrg/eol-chip/actions/workflows/build-deploy.yml)
[![Pages](https://img.shields.io/badge/site-iotsrg.github.io%2Feol--chip-blue)](https://iotsrg.github.io/eol-chip/)

End-of-life chip catalog cross-referenced with CVEs, CISA KEV, public exploits, Metasploit modules, GHSA, ICS-CERT and Packet Storm advisories — plus **PCB Inspect**, a vision-model PCB analyzer for hardware-security research.

→ Live site: **https://iotsrg.github.io/eol-chip/**

## What's inside

| Page | What it does |
|---|---|
| `/` | Full-text fuzzy search across 4 000+ entries (EOL chips, CVEs, exploits, KEV, ICS, GHSA, MSF) |
| `/eol.html` | EOL chip catalog with lifecycle status (Active / Last Buy / EOL / Obsolete) |
| `/vendors.html` | Browse by manufacturer (Intel, NXP, Espressif, Microchip, etc.) |
| `/chip.html?id=…` | Wiki-style article per chip: specs, Wikipedia summary, linked CVEs / exploits / KEV / MSF |
| `/cves.html` `/cisa.html` `/exploits.html` `/metasploit.html` `/ghsa.html` `/ics.html` `/packetstorm.html` | Per-source threat indexes |
| `/pcb-inspect.html` | Drop a PCB photo or PDF — vision model identifies chips, debug interfaces (UART / JTAG / SWD / ISP / I²C / SPI) and attack vectors with EMB3D references |

## Architecture

- **Static-only**: served from GitHub Pages, no backend, no database, no analytics.
- **Daily pipeline** (`.github/workflows/build-deploy.yml`): 10 Python fetchers pull from NVD, CISA KEV, Exploit-DB, Metasploit, GHSA, OSV, ICS-CERT, Packet Storm, NHTSA recalls, and vendor PSIRTs (Cisco / Fortinet / SonicWall / HPE). A single search index is built and deployed.
- **PCB Inspect**: BYO-key vision-model calls (Anthropic / Gemini / Ollama) made *directly from the visitor's browser*. Keys live only in the visitor's `localStorage`. No backend.

## Security

- Repo has secret scanning + push protection enabled
- `main` is force-push / delete protected
- PCB Inspect page ships with CSP meta + SRI-pinned CDN dependencies
- Visitor API keys never reach our servers (verifiable in [`src/page-pcb.js`](src/page-pcb.js))

## Data sources

| | |
|---|---|
| Vulnerabilities | [NVD](https://nvd.nist.gov/) |
| Active threats | [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) |
| Public exploits | [Exploit-DB](https://www.exploit-db.com/) |
| Exploit modules | [Metasploit Framework](https://github.com/rapid7/metasploit-framework) |
| Open vulnerabilities | [OSV.dev](https://osv.dev/) |
| GitHub advisories | [GHSA](https://github.com/advisories) |
| ICS / Medical | [CISA ICS-CERT](https://www.cisa.gov/news-events/cybersecurity-advisories) |
| Vendor PSIRTs | Cisco, Fortinet, SonicWall, HPE |
| Vehicle recalls | [NHTSA](https://www.nhtsa.gov/recalls) |
| Packet Storm | [packetstormsecurity.com](https://packetstormsecurity.com/) |
| Chip facts | [Wikipedia](https://en.wikipedia.org/) + [Wikidata](https://www.wikidata.org/) + [WikiChip](https://en.wikichip.org/) |
| EOL inventory | Community-curated [`chips.yaml`](chips.yaml) |

## Contributing

- **Add a chip** → edit [`chips.yaml`](chips.yaml) and PR
- **Add a data source** → drop a new `scripts/fetch_*.py` following the same pattern, register it in `build_search_index.py` and the workflow
- **Fix data** → wrong EOL date / missing chip / broken link → open an issue or PR

## Development

```bash
# Serve locally
python3 -m http.server 8000

# Local data refresh (avoids NVD rate-limit hassles on GitHub Actions)
export NVD_API_KEY=...        # https://nvd.nist.gov/developers/request-an-api-key
export GITHUB_TOKEN=...        # for GHSA + Metasploit fetchers
bash scripts/refresh.sh                # fetch + build, no commit
bash scripts/refresh.sh --commit       # fetch + build + commit + push to main
bash scripts/refresh.sh --only=cves    # rerun just one fetcher

# Or run individual scripts manually
pip install -r scripts/requirements.txt
python3 scripts/process_eol.py
python3 scripts/fetch_cves.py
python3 scripts/build_search_index.py
```

### Why local refresh?

NVD's rate limits are per source IP. GitHub Actions runners share egress with every other repo on GitHub — so even with our API key we often hit 429s. Running the refresh from your home IP gives you the full 50-req / 30s quota to yourself, and you can re-run just a failed fetcher without spending 25 minutes in CI.

The workflow still runs weekly as a fallback, and you can always trigger it manually from the Actions tab.

## License

Code & site: open source.
Chip catalog (`chips.yaml`): community-curated under the same terms.
Trademarks belong to their respective owners. EOL-CHIP is not affiliated with NIST, CISA, MITRE, Offensive Security, Rapid7, or any manufacturer.
