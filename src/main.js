import { initNav, tag, severityTag, badgeRow, renderSourcesFooter } from './common.js?v=43'
import Fuse from 'https://cdn.jsdelivr.net/npm/fuse.js@7/dist/fuse.mjs'

initNav('home')
renderSourcesFooter()

const input        = document.getElementById('search-input')
const resultsEl    = document.getElementById('search-results')
const noResultEl   = document.getElementById('no-results')
const quickLinksEl = document.getElementById('quick-links')

let fuse = null

Promise.all([
  fetch('./data/search_index.json?v=43').then(r => r.json()),
  fetch('./data/meta.json?v=43').then(r => r.ok ? r.json() : null).catch(() => null),
])
  .then(([data, meta]) => {
    const counts = { cve: 0, exploit: 0, cisa: 0, metasploit: 0, ghsa: 0, ics: 0, packetstorm: 0, eol: 0 }
    data.forEach(item => { if (counts[item.type] !== undefined) counts[item.type]++ })
    Object.keys(counts).forEach(k => {
      const el = document.getElementById('stat-' + k)
      if (el) el.textContent = counts[k].toLocaleString()
    })

    if (meta) {
      renderMeta(meta, counts)
    }

    fuse = new Fuse(data, {
      keys: [
        { name: 'title',        weight: 0.32 },
        { name: 'id',           weight: 0.22 },
        { name: 'description',  weight: 0.18 },
        { name: 'manufacturer', weight: 0.10 },
        { name: 'part_number',  weight: 0.08 },
        { name: 'vendors',      weight: 0.05 },
        { name: 'cves',         weight: 0.05 },
      ],
      threshold: 0.35,
      includeScore: true,
    })
    input.disabled = false
    input.placeholder = 'Search CVEs, exploits, EOL chips, FCC IDs, part numbers…'
  })
  .catch(() => { input.placeholder = 'Failed to load search index' })

input.disabled = true
input.placeholder = 'Loading…'

function renderMeta(meta, counts) {
  const lu = document.getElementById('last-updated')
  if (lu && meta.last_updated_human) {
    lu.innerHTML = `Last updated: <strong>${meta.last_updated_human}</strong> &middot; ${meta.total_items.toLocaleString()} entries indexed`
  }
  const fu = document.getElementById('footer-updated')
  if (fu && meta.last_updated_human) fu.textContent = `Updated ${meta.last_updated_human}`

  // Hero EOL stats
  const eolTotal = meta.eol_total || counts.eol || 0
  const eolRisk = meta.eol_at_risk || 0
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v }
  set('hero-eol-total', eolTotal.toLocaleString())
  set('hero-eol-risk', eolRisk.toLocaleString())
  set('hero-eol-cats', Object.keys(meta.eol_categories || {}).length)
  set('hero-eol-mfrs', meta.eol_manufacturer_count || 0)

  // High-risk chip grid
  renderRiskGrid(meta.high_risk_chips || [])
  renderEolStatus(meta.eol_status || {})

  const recent = meta.recent_7d || {}
  Object.keys(recent).forEach(k => {
    const el = document.getElementById('delta-' + k)
    if (el && recent[k] > 0) el.textContent = `+${recent[k]} this week`
  })

  // Trending CVEs
  const tEl = document.getElementById('trending-cves')
  if (tEl) {
    const list = (meta.trending_cves || []).slice(0, 8)
    if (!list.length) {
      tEl.innerHTML = '<p class="dash-empty">No trending CVEs in the last 30 days.</p>'
    } else {
      tEl.innerHTML = list.map(c => {
        const badges = []
        if (c.kev) badges.push('<span class="mini-badge mb-kev">KEV</span>')
        if (c.exploit_count) badges.push(`<span class="mini-badge mb-edb">EDB×${c.exploit_count}</span>`)
        if (c.msf_count) badges.push(`<span class="mini-badge mb-msf">MSF×${c.msf_count}</span>`)
        return `<a class="trend-row" href="${c.url}" target="_blank" rel="noopener">
          <span class="trend-id">${c.id}</span>
          ${severityTag(c.severity)}
          <span class="trend-title">${c.title || ''}</span>
          <span class="trend-badges">${badges.join(' ')}</span>
        </a>`
      }).join('')
    }
  }

  // Severity bars
  const sEl = document.getElementById('severity-bars')
  if (sEl) {
    const sev = meta.severity_30d || {}
    const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
    const max = Math.max(1, ...order.map(k => sev[k] || 0))
    sEl.innerHTML = order.map(k => {
      const v = sev[k] || 0
      const pct = (v / max * 100).toFixed(0)
      return `<div class="sev-row sev-${k.toLowerCase()}">
        <span class="sev-label">${k}</span>
        <span class="sev-bar"><span class="sev-fill" style="width:${pct}%"></span></span>
        <span class="sev-count">${v}</span>
      </div>`
    }).join('')
  }

  // Top vendors
  const vEl = document.getElementById('top-vendors')
  if (vEl) {
    const vendors = meta.top_vendors || []
    if (!vendors.length) {
      vEl.innerHTML = '<p class="dash-empty">No vendor data yet.</p>'
    } else {
      const max = Math.max(1, ...vendors.map(v => v.count))
      vEl.innerHTML = vendors.slice(0, 10).map(v => {
        const pct = (v.count / max * 100).toFixed(0)
        return `<div class="vendor-row">
          <span class="vendor-name">${v.name}</span>
          <span class="vendor-bar"><span class="vendor-fill" style="width:${pct}%"></span></span>
          <span class="vendor-count">${v.count}</span>
        </div>`
      }).join('')
    }
  }

  // Activity heatmap (last 30 days)
  const hEl = document.getElementById('activity-heatmap')
  if (hEl) {
    const activity = meta.activity_by_day || {}
    const today = new Date()
    const days = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today)
      d.setUTCDate(d.getUTCDate() - i)
      const iso = d.toISOString().slice(0, 10)
      days.push({ date: iso, count: activity[iso] || 0 })
    }
    const max = Math.max(1, ...days.map(d => d.count))
    hEl.innerHTML = `<div class="heatmap">
      ${days.map(d => {
        const intensity = d.count === 0 ? 0 : Math.min(4, Math.ceil(d.count / max * 4))
        return `<div class="heat-cell heat-${intensity}" title="${d.date}: ${d.count} new entries"></div>`
      }).join('')}
    </div>
    <div class="heatmap-legend">
      <span>Less</span>
      <div class="heat-cell heat-0"></div>
      <div class="heat-cell heat-1"></div>
      <div class="heat-cell heat-2"></div>
      <div class="heat-cell heat-3"></div>
      <div class="heat-cell heat-4"></div>
      <span>More</span>
    </div>`
  }
}

function renderRiskGrid(chips) {
  const el = document.getElementById('risk-grid')
  if (!el) return
  if (!chips.length) {
    el.innerHTML = `<div class="risk-empty">No EOL chips have linked threats yet - once the daily fetchers run with the expanded keyword list and historical CVE accumulation kicks in, high-risk parts will appear here.</div>`
    return
  }
  el.innerHTML = chips.slice(0, 12).map(c => {
    const badges = []
    if (c.kev_count) badges.push(`<span class="mini-badge mb-kev">KEV ${c.kev_count}</span>`)
    if (c.msf_count) badges.push(`<span class="mini-badge mb-msf">MSF ${c.msf_count}</span>`)
    if (c.exploit_count) badges.push(`<span class="mini-badge mb-edb">EDB ${c.exploit_count}</span>`)
    if (c.cve_count) badges.push(`<span class="mini-badge mb-cve">CVE ${c.cve_count}</span>`)
    return `<a class="risk-card" href="chip.html?id=${encodeURIComponent(c.part_number)}">
      <div class="risk-card-head">
        <span class="risk-card-pn">${c.part_number || c.id || ''}</span>
        <span class="risk-card-score" title="risk score">${c.risk_score}</span>
      </div>
      <div class="risk-card-name">${c.title || ''}</div>
      <div class="risk-card-meta">
        <span>${c.manufacturer || '-'}</span>
        <span class="risk-card-status">${c.status || ''}</span>
      </div>
      <div class="risk-card-badges">${badges.join(' ')}</div>
    </a>`
  }).join('')
}

function renderEolStatus(statusMap) {
  const el = document.getElementById('eol-status-bars')
  if (!el) return
  const entries = Object.entries(statusMap).sort((a, b) => b[1] - a[1])
  if (!entries.length) { el.innerHTML = '<p class="dash-empty">No EOL data.</p>'; return }
  const max = Math.max(1, ...entries.map(e => e[1]))
  el.innerHTML = entries.map(([status, n]) => {
    const pct = (n / max * 100).toFixed(0)
    const cls = status.toLowerCase().includes('obsolete') ? 'sev-critical'
      : status.toLowerCase().includes('eol') ? 'sev-high'
      : status.toLowerCase().includes('last') ? 'sev-medium'
      : 'sev-low'
    return `<div class="sev-row ${cls}">
      <span class="sev-label" style="font-size:10px;letter-spacing:0">${status}</span>
      <span class="sev-bar"><span class="sev-fill" style="width:${pct}%"></span></span>
      <span class="sev-count">${n}</span>
    </div>`
  }).join('')
}

// Add mb-cve badge class
const _style = document.createElement('style')
_style.textContent = `.mb-cve{background:var(--tag-cve)}`
document.head.appendChild(_style)

// FCC ID pattern
const FCC_RE = /^[A-Z0-9]{2,5}-[A-Z0-9]{2,}/i
function isFccId(q) { return FCC_RE.test(q.trim()) }

const DATASHEET_SITES = [
  { label: 'AllDatasheet',     url: q => `https://www.alldatasheet.com/search.jsp?Searchword=${encodeURIComponent(q)}` },
  { label: 'Datasheet4U',      url: q => `https://www.datasheet4u.com/search.php?q=${encodeURIComponent(q)}` },
  { label: 'DatasheetArchive', url: q => `https://www.datasheetarchive.com/search?q=${encodeURIComponent(q)}` },
  { label: 'DatasheetCatalog', url: q => `https://www.datasheetcatalog.com/search.asp?q=${encodeURIComponent(q)}` },
  { label: 'Datasheets360',    url: q => `https://www.datasheets360.com/search/?q=${encodeURIComponent(q)}` },
  { label: 'NXP',              url: q => `https://www.nxp.com/search#q=${encodeURIComponent(q)}` },
]
const FCC_SITES = [
  { label: 'fccid.io',   url: q => `https://fccid.io/${encodeURIComponent(q.replace(/\s/g,''))}` },
  { label: 'fcc.report', url: q => `https://fcc.report/FCC-ID/${encodeURIComponent(q.replace(/\s/g,''))}` },
  { label: 'FCC.gov',    url: q => `https://apps.fcc.gov/oetcf/eas/reports/GenericSearch.cfm?search_type=Beginning&fcc_id=${encodeURIComponent(q.replace(/\s/g,''))}` },
]

function renderQuickLinks(q) {
  if (!q || q.length < 2) { quickLinksEl.innerHTML = ''; return }
  const fccMatch = isFccId(q)
  const fccHtml = `<div class="ql-group">
    <span class="ql-label">${fccMatch ? '&#128225; FCC ID Lookup' : '&#128225; FCC Search'}</span>
    <div class="ql-links">${FCC_SITES.map(s => `<a href="${s.url(q)}" target="_blank" rel="noopener" class="ql-btn ql-btn--fcc">${s.label}</a>`).join('')}</div>
  </div>`
  const dsHtml = `<div class="ql-group">
    <span class="ql-label">&#128196; Datasheets</span>
    <div class="ql-links">${DATASHEET_SITES.map(s => `<a href="${s.url(q)}" target="_blank" rel="noopener" class="ql-btn ql-btn--ds">${s.label}</a>`).join('')}</div>
  </div>`
  quickLinksEl.innerHTML = `<div class="quick-links-wrap">${fccHtml}${dsHtml}</div>`
}

function activeTypes() {
  return new Set([...document.querySelectorAll('.filter-pill input:checked')].map(el => el.dataset.type))
}

function renderResults(items) {
  if (!items.length) { resultsEl.innerHTML = ''; noResultEl.style.display = 'block'; return }
  noResultEl.style.display = 'none'
  const shown = items.slice(0, 100)
  const more = items.length > 100 ? ` - showing first 100 of ${items.length.toLocaleString()}` : ''

  const rows = shown.map(item => {
    const sev = item.severity ? severityTag(item.severity)
      : item.cvss_score ? `<span style="color:var(--text2);font-size:12px;font-weight:600">${item.cvss_score}</span>` : ''
    return `<tr>
      <td>${tag('tag-' + item.type, (item.type || '').toUpperCase())}</td>
      <td style="white-space:nowrap"><a href="${item.url || '#'}" target="_blank" rel="noopener">${item.id || ''}</a></td>
      <td><span class="truncate">${item.title || ''}</span>${badgeRow(item)}</td>
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
        <thead><tr><th>Type</th><th>ID</th><th>Title</th><th>Severity</th><th>Date</th></tr></thead>
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
