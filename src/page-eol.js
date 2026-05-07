import { initNav, tag, statusTag, severityTag, badgeRow, loadMeta } from './common.js?v=16'

initNav('eol')
loadMeta()

const tbody = document.getElementById('eol-body')
const filterEl = document.getElementById('risk-filter')
const searchEl = document.getElementById('eol-search')
const catFilter = document.getElementById('cat-filters')
const detailEl = document.getElementById('chip-detail')

let chips = []
let threatStore = { cve: [], cisa: [], exploit: [], metasploit: [], ghsa: [] }
let chipFacts = {}
let activeFilter = 'all'
let activeCat = 'all'
let searchQuery = ''

const STATUS_RANK = {
  'Obsolete': 0,
  'EOL Announced': 1,
  'Last Buy': 2,
  'Active': 3,
}

function render() {
  let list = chips
  if (activeFilter === 'risk') list = list.filter(c => (c.risk_score || 0) > 0)
  else if (activeFilter === 'kev') list = list.filter(c => (c.kev_count || 0) > 0)
  else if (activeFilter === 'exploit') list = list.filter(c => (c.exploit_count || 0) > 0)
  else if (activeFilter === 'obsolete') list = list.filter(c => (c.status || '').toLowerCase().includes('obsolete'))

  if (activeCat !== 'all') list = list.filter(c => c.category === activeCat)

  if (searchQuery) {
    const q = searchQuery.toLowerCase()
    list = list.filter(c =>
      (c.part_number || '').toLowerCase().includes(q) ||
      (c.title || '').toLowerCase().includes(q) ||
      (c.manufacturer || '').toLowerCase().includes(q) ||
      (c.category || '').toLowerCase().includes(q)
    )
  }

  // Sort: risk desc, then status (Obsolete first), then name
  list = [...list].sort((a, b) => {
    const ra = b.risk_score || 0, rb = a.risk_score || 0
    if (ra !== rb) return ra - rb
    const sa = STATUS_RANK[a.status] ?? 9
    const sb = STATUS_RANK[b.status] ?? 9
    if (sa !== sb) return sa - sb
    return (a.part_number || '').localeCompare(b.part_number || '')
  })

  document.getElementById('eol-count').textContent = list.length.toLocaleString()

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">No chips match the current filters.</div></td></tr>`
    return
  }

  tbody.innerHTML = list.map(chip => {
    const threats = []
    if (chip.kev_count) threats.push(`<span class="mini-badge mb-kev">KEV ${chip.kev_count}</span>`)
    if (chip.msf_count) threats.push(`<span class="mini-badge mb-msf">MSF ${chip.msf_count}</span>`)
    if (chip.exploit_count) threats.push(`<span class="mini-badge mb-edb">EDB ${chip.exploit_count}</span>`)
    if (chip.cve_count) threats.push(`<span class="mini-badge mb-cve">CVE ${chip.cve_count}</span>`)
    const rowClass = chip.kev_count ? 'row-kev' : (chip.risk_score ? 'row-risk' : '')
    return `<tr class="${rowClass}" data-pn="${chip.part_number}">
      <td style="white-space:nowrap;font-family:monospace;font-size:11px">
        <a href="${chip.url || '#'}" target="_blank" rel="noopener">${chip.part_number || ''}</a>
      </td>
      <td><span class="truncate" style="max-width:280px">${chip.title || ''}</span></td>
      <td style="color:var(--text2);font-size:11px">${chip.manufacturer || ''}</td>
      <td>${tag('tag-cat', chip.category || '')}</td>
      <td>${statusTag(chip.status)}</td>
      <td style="color:var(--text3);white-space:nowrap;font-size:11px">${chip.eol_date || '-'}</td>
      <td>${threats.length ? `<span class="badge-row" style="margin:0">${threats.join(' ')}</span>` : '<span style="color:var(--text3);font-size:11px">-</span>'}</td>
      <td>${chip.datasheet
        ? `<a href="${chip.datasheet}" target="_blank" rel="noopener" style="font-size:11px;color:var(--text2)">&#128196; PDF</a>`
        : '<span style="color:var(--text3)">-</span>'}</td>
    </tr>`
  }).join('')

  tbody.querySelectorAll('tr[data-pn]').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('a')) return
      const pn = tr.dataset.pn
      // Navigate to the proper article page
      location.href = `chip.html?id=${encodeURIComponent(pn)}`
    })
  })
}

function formatExtract(text) {
  if (!text) return ''
  // Split into paragraphs on blank lines, escape minimal HTML, render as <p>
  return text.split(/\n\s*\n/).map(p =>
    `<p>${p.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`
  ).join('')
}

function showChip(chip) {
  const matchedCves = (chip.matched_cves || []).slice(0, 50)
  const matchedKev = (chip.matched_kev || []).slice(0, 50)
  const facts = chipFacts[chip.part_number] || {}
  detailEl.style.display = 'block'
  document.getElementById('cd-title').textContent = `${chip.part_number} - ${chip.title || ''}`
  document.getElementById('cd-summary').innerHTML = `
    <span><strong>${chip.cve_count || 0}</strong> CVE</span>
    <span><strong>${chip.kev_count || 0}</strong> KEV</span>
    <span><strong>${chip.exploit_count || 0}</strong> Exploit-DB</span>
    <span><strong>${chip.msf_count || 0}</strong> Metasploit</span>
    <span><strong>${chip.ghsa_count || 0}</strong> GHSA</span>
    <span><strong>Risk score: ${chip.risk_score || 0}</strong></span>
  `

  // Wikipedia + Wikidata + WikiChip enrichment
  const wikiEl = document.getElementById('cd-wiki')
  const hasWp = !!facts.extract
  const hasWd = facts.wikidata && Object.keys(facts.wikidata).length > 0
  const hasWc = !!facts.wikichip_extract
  if (hasWp || hasWd || hasWc) {
    const wd = facts.wikidata || {}
    // Spec rows from Wikidata - rendered as a 2-col table
    const SPECS = [
      ['type', 'Type'],
      ['manufacturer', 'Manufacturer'],
      ['introduced', 'Introduced'],
      ['released', 'Released'],
      ['discontinued', 'Discontinued'],
      ['fabrication_method', 'Process'],
      ['clock_frequency', 'Clock frequency'],
      ['transistor_count', 'Transistor count'],
      ['die_area', 'Die area'],
      ['follows', 'Successor of'],
      ['followed_by', 'Succeeded by'],
      ['part_of', 'Family / part of'],
      ['subclass_of', 'Subclass of'],
      ['used_by', 'Used by'],
      ['operating_system', 'Operating system'],
      ['named_after', 'Named after'],
      ['material', 'Material'],
      ['units_sold', 'Units sold'],
    ]
    const specRows = SPECS.flatMap(([key, label]) => {
      const v = wd[key]
      if (!v) return []
      const formatted = Array.isArray(v) ? v.join(', ') : v
      return [`<tr><th>${label}</th><td>${formatted}</td></tr>`]
    })

    const mainText = facts.intro_full || facts.extract || ''
    const familyNote = facts.matched_family
      ? `<span class="wiki-family-note">Family page (${facts.matched_family})</span>` : ''
    const thumb = facts.thumbnail || (wd.image_url || '')

    let wpBlock = ''
    if (hasWp || hasWd) {
      wpBlock = `
        <div class="wiki-card">
          ${thumb ? `<img class="wiki-thumb" src="${thumb}" alt="${facts.title || ''}" loading="lazy" onerror="this.style.display='none'">` : ''}
          <div class="wiki-body">
            <div class="wiki-head">
              <h3>${facts.title || chip.title || ''} ${familyNote}</h3>
              ${facts.description || wd.wd_description
                ? `<span class="wiki-tagline">${facts.description || wd.wd_description}</span>` : ''}
            </div>
            ${mainText ? `<div class="wiki-extract">${formatExtract(mainText)}</div>` : ''}
            ${specRows.length ? `<table class="spec-table"><tbody>${specRows.join('')}</tbody></table>` : ''}
            ${facts.wp_url ? `<a class="wiki-link" href="${facts.wp_url}" target="_blank" rel="noopener">Read on Wikipedia →</a>` : ''}
          </div>
        </div>`
    }

    let wcBlock = ''
    if (hasWc) {
      wcBlock = `
        <div class="wiki-card wikichip-card">
          <div class="wiki-body">
            <div class="wiki-head">
              <h3>WikiChip <span class="wiki-tagline">technical chip database</span></h3>
            </div>
            <p class="wiki-extract">${facts.wikichip_extract}</p>
            ${facts.wikichip_url ? `<a class="wiki-link" href="${facts.wikichip_url}" target="_blank" rel="noopener">Read on WikiChip →</a>` : ''}
          </div>
        </div>`
    }

    wikiEl.innerHTML = wpBlock + wcBlock
    wikiEl.style.display = 'block'
  } else {
    wikiEl.style.display = 'none'
  }

  document.getElementById('cd-meta').innerHTML = `
    <div><span>Manufacturer</span><strong>${chip.manufacturer || '-'}</strong></div>
    <div><span>Category</span><strong>${chip.category || '-'}</strong></div>
    <div><span>Status</span><strong>${chip.status || '-'}</strong></div>
    <div><span>EOL date</span><strong>${chip.eol_date || '-'}</strong></div>
    <div><span>Last order</span><strong>${chip.last_order_date || '-'}</strong></div>
    ${chip.fcc_id ? `<div><span>FCC ID</span><strong>${chip.fcc_id}</strong></div>` : ''}
  `

  const cveSet = new Set(matchedCves)
  const kevSet = new Set(matchedKev)
  const linkedCves = threatStore.cve.filter(c => cveSet.has(c.id))
  const linkedKev = threatStore.cisa.filter(c => kevSet.has(c.id))
  const lcKws = chip.part_number ? [chip.part_number.toLowerCase()] : []
  const linkedExploits = threatStore.exploit.filter(e => {
    const hay = ((e.title || '') + ' ' + (e.description || '')).toLowerCase()
    return lcKws.some(k => hay.includes(k))
  }).slice(0, 30)
  const linkedMsf = threatStore.metasploit.filter(m => {
    const hay = ((m.title || '') + ' ' + (m.description || '') + ' ' + (m.module_path || '')).toLowerCase()
    return lcKws.some(k => hay.includes(k))
  }).slice(0, 30)

  const sections = []
  if (linkedKev.length) sections.push(threatTable('CISA KEV (active threats)', linkedKev))
  if (linkedCves.length) sections.push(threatTable('CVEs', linkedCves))
  if (linkedExploits.length) sections.push(threatTable('Exploit-DB', linkedExploits))
  if (linkedMsf.length) sections.push(threatTable('Metasploit modules', linkedMsf))
  if (!sections.length) sections.push(`<p class="dash-empty">No linked threat records yet for this chip. The cross-linker will pick them up as the daily fetchers grow the corpus.</p>`)

  document.getElementById('cd-threats').innerHTML = sections.join('')
  detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
  history.replaceState(null, '', '#' + encodeURIComponent(chip.part_number))
}

function threatTable(title, items) {
  return `<div class="cd-section">
    <h3>${title} <span style="color:var(--text3);font-weight:400;font-size:11px">(${items.length})</span></h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Title</th><th>Severity</th><th>Date</th></tr></thead>
        <tbody>
          ${items.map(it => `<tr>
            <td style="font-family:monospace;font-size:11px;white-space:nowrap">
              <a href="${it.url || '#'}" target="_blank" rel="noopener">${it.id || ''}</a>
            </td>
            <td><span class="truncate" style="max-width:380px">${it.title || ''}</span>${badgeRow(it)}</td>
            <td>${severityTag(it.severity)}</td>
            <td style="color:var(--text3);white-space:nowrap;font-size:11px">${it.date || '-'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`
}

function setupCatFilters() {
  const cats = [...new Set(chips.map(c => c.category).filter(Boolean))].sort()
  document.getElementById('cat-count').textContent = cats.length
  catFilter.innerHTML =
    `<button class="cat-btn active" data-cat="all">All (${chips.length})</button>` +
    cats.map(c => {
      const n = chips.filter(x => x.category === c).length
      return `<button class="cat-btn" data-cat="${c}">${c} <span style="opacity:.6;font-size:10px">${n}</span></button>`
    }).join('')

  catFilter.addEventListener('click', e => {
    const btn = e.target.closest('.cat-btn')
    if (!btn) return
    catFilter.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    activeCat = btn.dataset.cat
    render()
  })
}

function updateRiskCounts() {
  const counts = {
    risk: chips.filter(c => (c.risk_score || 0) > 0).length,
    kev: chips.filter(c => (c.kev_count || 0) > 0).length,
    exploit: chips.filter(c => (c.exploit_count || 0) > 0).length,
  }
  document.querySelectorAll('[data-stat]').forEach(el => {
    el.textContent = counts[el.dataset.stat] || 0
  })
}

Promise.all([
  fetch('./data/eol_chips.json?v=16').then(r => r.json()),
  fetch('./data/cves.json?v=16').then(r => r.ok ? r.json() : []).catch(() => []),
  fetch('./data/cisa_kev.json?v=16').then(r => r.ok ? r.json() : []).catch(() => []),
  fetch('./data/exploits.json?v=16').then(r => r.ok ? r.json() : []).catch(() => []),
  fetch('./data/metasploit.json?v=16').then(r => r.ok ? r.json() : []).catch(() => []),
  fetch('./data/chip_facts.json?v=16').then(r => r.ok ? r.json() : {}).catch(() => ({})),
]).then(([cs, cves, kev, exploits, msf, facts]) => {
  chips = cs
  threatStore = { cve: cves, cisa: kev, exploit: exploits, metasploit: msf, ghsa: [] }
  chipFacts = facts || {}
  setupCatFilters()
  updateRiskCounts()
  render()

  if (location.hash.length > 1) {
    const target = decodeURIComponent(location.hash.slice(1))
    const chip = chips.find(c => c.part_number === target)
    if (chip) showChip(chip)
  }
})

filterEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-filter]')
  if (!btn) return
  filterEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn))
  activeFilter = btn.dataset.filter
  render()
})

let st
searchEl.addEventListener('input', () => {
  clearTimeout(st)
  st = setTimeout(() => { searchQuery = searchEl.value.trim(); render() }, 150)
})
