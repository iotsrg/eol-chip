import { initNav, severityTag, badgeRow, loadMeta } from './common.js?v=47'

initNav('cves')
loadMeta()

function cvssColor(score) {
  if (!score) return 'var(--text3)'
  if (score >= 9) return 'var(--sev-critical)'
  if (score >= 7) return 'var(--sev-high)'
  if (score >= 4) return 'var(--sev-medium)'
  return 'var(--sev-low)'
}

const SEV_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, '': 4 }

let allCves = []
let activeFilter = 'all'  // all | kev | exploit | msf
let searchQuery = ''

const filterEl = document.getElementById('cve-filter')
const searchEl = document.getElementById('cve-search')

function render() {
  const tbody = document.getElementById('cve-body')
  if (!allCves.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      No CVE data - run <code>python scripts/fetch_cves.py</code> to populate.
    </div></td></tr>`
    return
  }

  let list = allCves
  if (activeFilter === 'kev') list = list.filter(c => c.kev)
  else if (activeFilter === 'exploit') list = list.filter(c => c.exploit_count > 0)
  else if (activeFilter === 'msf') list = list.filter(c => c.msf_count > 0)

  if (searchQuery) {
    const q = searchQuery.toLowerCase()
    list = list.filter(c =>
      (c.id || '').toLowerCase().includes(q) ||
      (c.title || '').toLowerCase().includes(q) ||
      (c.vendors || []).some(v => v.toLowerCase().includes(q))
    )
  }

  document.getElementById('cve-count').textContent = list.length.toLocaleString()

  tbody.innerHTML = list.slice(0, 1000).map(cve => {
    const isKev = cve.kev ? ' class="row-kev"' : ''
    const vendors = (cve.vendors || []).slice(0, 3).join(', ')
    return `<tr${isKev}>
      <td style="white-space:nowrap;font-family:monospace;font-size:12px">
        <a href="${cve.url || '#'}" target="_blank" rel="noopener">${cve.id || ''}</a>
      </td>
      <td><span class="truncate" style="max-width:340px">${cve.title || ''}</span>${badgeRow(cve)}</td>
      <td>${severityTag(cve.severity)}</td>
      <td style="font-weight:600;color:${cvssColor(cve.cvss_score)}">${cve.cvss_score || '-'}</td>
      <td style="color:var(--text3);font-size:11px">${cve.cwe || '-'}</td>
      <td style="color:var(--text2);font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${vendors}">${vendors || '-'}</td>
      <td style="color:var(--text3);white-space:nowrap;font-size:11px">${cve.date || '-'}</td>
    </tr>`
  }).join('')

  if (list.length > 1000) {
    tbody.innerHTML += `<tr><td colspan="7" style="text-align:center;padding:12px;color:var(--text3);font-size:11px">
      Showing first 1,000 of ${list.length.toLocaleString()} - refine search or use the filters above
    </td></tr>`
  }
}

fetch('./data/cves.json?v=47')
  .then(r => r.json())
  .then(cves => {
    allCves = cves.sort((a, b) => {
      const ra = SEV_RANK[a.severity] ?? 4
      const rb = SEV_RANK[b.severity] ?? 4
      if (ra !== rb) return ra - rb
      return (b.date || '').localeCompare(a.date || '')
    })

    // Update sub-stats
    const counts = {
      kev: cves.filter(c => c.kev).length,
      exploit: cves.filter(c => c.exploit_count > 0).length,
      msf: cves.filter(c => c.msf_count > 0).length,
    }
    document.querySelectorAll('[data-cve-stat]').forEach(el => {
      const k = el.dataset.cveStat
      el.textContent = counts[k] || 0
    })

    render()
  })

if (filterEl) {
  filterEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]')
    if (!btn) return
    activeFilter = btn.dataset.filter
    filterEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn))
    render()
  })
}

if (searchEl) {
  let t
  searchEl.addEventListener('input', () => {
    clearTimeout(t)
    t = setTimeout(() => { searchQuery = searchEl.value.trim(); render() }, 150)
  })
}
