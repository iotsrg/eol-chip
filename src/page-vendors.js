import { initNav, loadMeta } from './common.js?v=47'

initNav('vendors')
loadMeta()

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const grid = document.getElementById('vendor-grid')
const search = document.getElementById('vendor-search')

let vendors = []

fetch('./data/eol_chips.json?v=47')
  .then(r => r.json())
  .then(chips => {
    // Group chips by manufacturer (use the canonical "primary" name)
    const byVendor = {}
    for (const c of chips) {
      const mfr = (c.manufacturer || '').trim()
      if (!mfr) continue
      // Canonicalise: strip parenthetical suffix so "Intel (Habana Labs)"
      // and "Intel" land together
      const canonical = mfr.split('(')[0].trim() || mfr
      if (!byVendor[canonical]) byVendor[canonical] = {
        name: canonical, total: 0, cve: 0, kev: 0, exploit: 0, msf: 0,
        active: 0, eol: 0, categories: new Set(),
      }
      const v = byVendor[canonical]
      v.total++
      v.cve += c.cve_count || 0
      v.kev += c.kev_count || 0
      v.exploit += c.exploit_count || 0
      v.msf += c.msf_count || 0
      if (/active/i.test(c.status || '')) v.active++
      if (/obsolete|discontinued|eol|last buy/i.test(c.status || '')) v.eol++
      if (c.category) v.categories.add(c.category)
    }
    vendors = Object.values(byVendor).sort((a, b) => b.total - a.total)
    document.getElementById('vendor-count').textContent = vendors.length.toLocaleString()
    render(vendors)

    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase()
        render(vendors.filter(v => v.name.toLowerCase().includes(q)))
      })
    }
  })

function render(list) {
  if (!list.length) {
    grid.innerHTML = '<div class="empty-state">No vendors match.</div>'
    return
  }
  grid.innerHTML = list.map(v => {
    const badges = []
    if (v.kev) badges.push(`<span class="mini-badge mb-kev">KEV ${v.kev}</span>`)
    if (v.exploit) badges.push(`<span class="mini-badge mb-edb">EDB ${v.exploit}</span>`)
    if (v.msf) badges.push(`<span class="mini-badge mb-msf">MSF ${v.msf}</span>`)
    if (v.cve && !v.kev) badges.push(`<span class="mini-badge mb-cve">CVE ${v.cve}</span>`)
    return `<a class="vendor-card" href="vendor.html?name=${encodeURIComponent(v.name)}">
      <div class="vendor-card-head">
        <span class="vendor-card-name">${escapeHtml(v.name)}</span>
        <span class="vendor-card-total">${v.total}</span>
      </div>
      <div class="vendor-card-meta">${v.categories.size} categor${v.categories.size === 1 ? 'y' : 'ies'} &middot; ${v.active} active &middot; ${v.eol} EOL</div>
      <div class="vendor-card-badges">${badges.join(' ') || '<span class="vendor-card-meta">no known threats</span>'}</div>
    </a>`
  }).join('')
}
