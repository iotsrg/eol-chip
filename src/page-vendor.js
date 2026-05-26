import { initNav, tag, statusTag, loadMeta } from './common.js?v=43'

initNav('vendors')
loadMeta()

const params = new URLSearchParams(location.search)
const requestedVendor = (params.get('name') || '').trim()

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Match chip's manufacturer field flexibly: "Intel", "Intel (Habana Labs)",
// "Intel (Altera)", "NXP Semiconductors (Freescale/Motorola)" all match "Intel" / "NXP" etc.
function chipMatchesVendor(chipMfr, vendor) {
  if (!chipMfr || !vendor) return false
  const cm = chipMfr.toLowerCase()
  const v = vendor.toLowerCase()
  return cm === v || cm.startsWith(v + ' ') || cm.startsWith(v + '(') || cm.includes(' ' + v + ' ') || cm.includes('(' + v)
}

function statusOrder(s) {
  const o = { 'Active': 0, 'Last Buy': 1, 'EOL Announced': 2, 'Obsolete': 3 }
  return o[s] !== undefined ? o[s] : 4
}

let allChips = []
let activeFilter = 'all'
let searchQuery = ''

function render() {
  let chips = allChips.filter(c => chipMatchesVendor(c.manufacturer, requestedVendor))

  if (activeFilter === 'risk') chips = chips.filter(c => (c.risk_score || 0) > 0)
  else if (activeFilter === 'active') chips = chips.filter(c => /active/i.test(c.status || ''))
  else if (activeFilter === 'obsolete') chips = chips.filter(c => /obsolete|discontinued|last buy|eol/i.test(c.status || ''))

  if (searchQuery) {
    const q = searchQuery.toLowerCase()
    chips = chips.filter(c =>
      (c.part_number || '').toLowerCase().includes(q) ||
      (c.title || '').toLowerCase().includes(q) ||
      (c.category || '').toLowerCase().includes(q)
    )
  }

  // Group by category
  const byCat = {}
  for (const c of chips) {
    const cat = c.category || 'Uncategorized'
    if (!byCat[cat]) byCat[cat] = []
    byCat[cat].push(c)
  }

  // Sort categories alphabetically; within each, by status then part_number
  const sortedCats = Object.keys(byCat).sort()
  for (const cat of sortedCats) {
    byCat[cat].sort((a, b) => {
      const sa = statusOrder(a.status), sb = statusOrder(b.status)
      if (sa !== sb) return sa - sb
      return (a.part_number || '').localeCompare(b.part_number || '')
    })
  }

  const out = document.getElementById('vc-categories')
  if (!chips.length) {
    out.innerHTML = `<div class="empty-state">No chips match the current filters.</div>`
    return
  }

  out.innerHTML = sortedCats.map(cat => `
    <section class="vc-cat" id="vc-cat-${cat.replace(/\s+/g, '-')}">
      <h2>${escapeHtml(cat)} <span class="count-pill">${byCat[cat].length}</span></h2>
      <div class="vc-grid">
        ${byCat[cat].map(c => {
          const badges = []
          if (c.kev_count) badges.push(`<span class="mini-badge mb-kev">KEV ${c.kev_count}</span>`)
          if (c.exploit_count) badges.push(`<span class="mini-badge mb-edb">EDB ${c.exploit_count}</span>`)
          if (c.msf_count) badges.push(`<span class="mini-badge mb-msf">MSF ${c.msf_count}</span>`)
          if (c.cve_count && !c.kev_count) badges.push(`<span class="mini-badge mb-cve">CVE ${c.cve_count}</span>`)
          const rowClass = c.risk_score ? 'vc-card--risk' : ''
          return `<a class="vc-card ${rowClass}" href="chip.html?id=${encodeURIComponent(c.part_number)}">
            <div class="vc-card-pn">${escapeHtml(c.part_number)}</div>
            <div class="vc-card-name">${escapeHtml(c.title || '')}</div>
            <div class="vc-card-foot">
              ${statusTag(c.status)}
              <span class="vc-card-eol">${escapeHtml(c.eol_date || '')}</span>
            </div>
            ${badges.length ? `<div class="vc-card-badges">${badges.join(' ')}</div>` : ''}
          </a>`
        }).join('')}
      </div>
    </section>
  `).join('')
}

async function main() {
  if (!requestedVendor) {
    document.getElementById('vc-title').textContent = 'No vendor specified'
    document.getElementById('vc-subtitle').innerHTML = '<a href="vendors.html">← Back to vendor index</a>'
    return
  }

  document.title = `${requestedVendor} - EOL-CHIP`
  document.getElementById('vc-name').textContent = requestedVendor
  document.getElementById('vc-title').textContent = requestedVendor
  document.getElementById('vc-subtitle').innerHTML = `<em>End-of-life and historical chip catalog for <strong>${escapeHtml(requestedVendor)}</strong></em>`

  allChips = await fetch('./data/eol_chips.json?v=43').then(r => r.json())

  const vendorChips = allChips.filter(c => chipMatchesVendor(c.manufacturer, requestedVendor))

  if (!vendorChips.length) {
    document.getElementById('vc-stats').style.display = 'none'
    document.getElementById('vc-categories').innerHTML =
      `<div class="empty-state">No chips found for <code>${escapeHtml(requestedVendor)}</code>. ` +
      `<a href="vendors.html">Browse all vendors →</a></div>`
    return
  }

  // Stats
  document.getElementById('vc-total').textContent = vendorChips.length.toLocaleString()
  document.getElementById('vc-risk').textContent = vendorChips.filter(c => (c.risk_score || 0) > 0).length
  document.getElementById('vc-cats').textContent = new Set(vendorChips.map(c => c.category)).size
  document.getElementById('vc-active').textContent = vendorChips.filter(c => /active/i.test(c.status || '')).length
  document.querySelectorAll('[data-stat]').forEach(el => {
    if (el.dataset.stat === 'risk') el.textContent = vendorChips.filter(c => (c.risk_score || 0) > 0).length
  })

  render()
}

document.getElementById('vc-filter').addEventListener('click', e => {
  const btn = e.target.closest('[data-filter]')
  if (!btn) return
  document.querySelectorAll('#vc-filter .filter-btn').forEach(b => b.classList.toggle('active', b === btn))
  activeFilter = btn.dataset.filter
  render()
})

let st
document.getElementById('vc-search').addEventListener('input', () => {
  clearTimeout(st)
  st = setTimeout(() => { searchQuery = document.getElementById('vc-search').value.trim(); render() }, 150)
})

main().catch(e => {
  document.getElementById('vc-title').textContent = 'Error loading vendor'
  console.error(e)
})
