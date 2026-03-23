import { initNav, tag, severityTag } from './common.js'
import Fuse from 'https://cdn.jsdelivr.net/npm/fuse.js@7/dist/fuse.mjs'

initNav()

const input       = document.getElementById('search-input')
const resultsEl   = document.getElementById('search-results')
const noResultEl  = document.getElementById('no-results')
const quickLinksEl = document.getElementById('quick-links')

let fuse = null

fetch('./data/search_index.json')
  .then(r => r.json())
  .then(data => {
    const counts = { cve: 0, exploit: 0, eol: 0 }
    data.forEach(item => { if (counts[item.type] !== undefined) counts[item.type]++ })
    document.getElementById('stat-cve').textContent     = counts.cve.toLocaleString()
    document.getElementById('stat-exploit').textContent = counts.exploit.toLocaleString()
    document.getElementById('stat-eol').textContent     = counts.eol.toLocaleString()

    fuse = new Fuse(data, {
      keys: [
        { name: 'title',        weight: 0.35 },
        { name: 'id',           weight: 0.25 },
        { name: 'description',  weight: 0.20 },
        { name: 'manufacturer', weight: 0.10 },
        { name: 'part_number',  weight: 0.10 },
      ],
      threshold: 0.35,
      includeScore: true,
    })
    input.disabled = false
    input.placeholder = 'Search CVEs, exploits, EOL chips, FCC IDs, part numbers…'
  })
  .catch(() => {
    input.placeholder = 'Failed to load search index'
  })

input.disabled = true
input.placeholder = 'Loading…'

// FCC ID pattern: e.g. 2AFIW-ESP32, BCG-A1707, XPYNINAW10
const FCC_RE = /^[A-Z0-9]{2,5}-[A-Z0-9]{2,}/i

function isFccId(q) {
  return FCC_RE.test(q.trim())
}

const DATASHEET_SITES = [
  { label: 'AllDatasheet',      url: q => `https://www.alldatasheet.com/search.jsp?Searchword=${encodeURIComponent(q)}` },
  { label: 'Datasheet4U',       url: q => `https://www.datasheet4u.com/search.php?q=${encodeURIComponent(q)}` },
  { label: 'DatasheetArchive',  url: q => `https://www.datasheetarchive.com/search?q=${encodeURIComponent(q)}` },
  { label: 'DatasheetCatalog',  url: q => `https://www.datasheetcatalog.com/search.asp?q=${encodeURIComponent(q)}` },
  { label: 'Datasheets360',     url: q => `https://www.datasheets360.com/search/?q=${encodeURIComponent(q)}` },
  { label: 'NXP',               url: q => `https://www.nxp.com/search#q=${encodeURIComponent(q)}` },
]

const FCC_SITES = [
  { label: 'fccid.io',    url: q => `https://fccid.io/${encodeURIComponent(q.replace(/\s/g,''))}` },
  { label: 'fcc.report',  url: q => `https://fcc.report/FCC-ID/${encodeURIComponent(q.replace(/\s/g,''))}` },
  { label: 'FCC.gov',     url: q => `https://apps.fcc.gov/oetcf/eas/reports/GenericSearch.cfm?search_type=Beginning&fcc_id=${encodeURIComponent(q.replace(/\s/g,''))}` },
]

function renderQuickLinks(q) {
  if (!q || q.length < 2) {
    quickLinksEl.innerHTML = ''
    return
  }

  const fccMatch = isFccId(q)

  const fccHtml = `
    <div class="ql-group">
      <span class="ql-label">${fccMatch ? '&#128225; FCC ID Lookup' : '&#128225; FCC Search'}</span>
      <div class="ql-links">
        ${FCC_SITES.map(s => `<a href="${s.url(q)}" target="_blank" rel="noopener" class="ql-btn ql-btn--fcc">${s.label}</a>`).join('')}
      </div>
    </div>`

  const dsHtml = `
    <div class="ql-group">
      <span class="ql-label">&#128196; Datasheets</span>
      <div class="ql-links">
        ${DATASHEET_SITES.map(s => `<a href="${s.url(q)}" target="_blank" rel="noopener" class="ql-btn ql-btn--ds">${s.label}</a>`).join('')}
      </div>
    </div>`

  quickLinksEl.innerHTML = `<div class="quick-links-wrap">${fccHtml}${dsHtml}</div>`
}

function activeTypes() {
  return new Set(
    [...document.querySelectorAll('.filter-pill input:checked')].map(el => el.dataset.type)
  )
}

function renderResults(items) {
  if (!items.length) {
    resultsEl.innerHTML = ''
    noResultEl.style.display = 'block'
    return
  }
  noResultEl.style.display = 'none'

  const shown = items.slice(0, 100)
  const more = items.length > 100
    ? ` — showing first 100 of ${items.length.toLocaleString()}`
    : ''

  const rows = shown.map(item => {
    const sev = item.severity
      ? severityTag(item.severity)
      : item.cvss_score
        ? `<span style="color:var(--text2);font-size:12px;font-weight:600">${item.cvss_score}</span>`
        : ''
    return `<tr>
      <td>${tag('tag-' + item.type, item.type.toUpperCase())}</td>
      <td style="white-space:nowrap">
        <a href="${item.url || '#'}" target="_blank" rel="noopener">${item.id || ''}</a>
      </td>
      <td><span class="truncate">${item.title || ''}</span></td>
      <td>${sev}</td>
      <td style="color:var(--text3);white-space:nowrap">${item.date || ''}</td>
    </tr>`
  }).join('')

  resultsEl.innerHTML = `
    <div class="results-header">
      <span class="results-count">${items.length.toLocaleString()} result${items.length !== 1 ? 's' : ''}${more}</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Type</th><th>ID</th><th>Title</th><th>Severity</th><th>Date</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}

let debounce
input.addEventListener('input', () => {
  clearTimeout(debounce)
  debounce = setTimeout(() => {
    const q = input.value.trim()
    renderQuickLinks(q)
    if (!fuse) return
    if (!q) { resultsEl.innerHTML = ''; noResultEl.style.display = 'none'; return }
    const types = activeTypes()
    const results = fuse.search(q).map(r => r.item).filter(item => types.has(item.type))
    renderResults(results)
  }, 200)
})

document.querySelectorAll('.filter-pill input').forEach(el =>
  el.addEventListener('change', () => input.dispatchEvent(new Event('input')))
)
