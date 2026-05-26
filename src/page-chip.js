import { initNav, tag, statusTag, severityTag, badgeRow, loadMeta } from './common.js?v=43'

initNav('eol')
loadMeta()

const params = new URLSearchParams(location.search)
const requestedPn = params.get('id') || location.hash.slice(1)

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatExtract(text) {
  if (!text) return ''
  return text.split(/\n\s*\n/).map(p => `<p>${escapeHtml(p.trim())}</p>`).join('')
}

function buildInfobox(chip, facts) {
  const wd = facts.wikidata || {}
  const rows = []

  // Photo - ONLY show when the Wikipedia title contains this chip's
  // exact part number with proper digit boundary. e.g. ATmega8 must NOT
  // accept "ATmega88" (sibling chip), and Intel 4004 must NOT accept
  // "Intel 4004A" if such a page existed. We check that the char after
  // the part-number substring isn't itself a digit/letter that would
  // make this a different model.
  const norm = s => (s || '').toLowerCase().replace(/[-_.\s]/g, '')
  const titleNorm = norm(facts.title)
  const pnNorm = norm(chip.part_number)
  let isExactMatch = false
  if (titleNorm && pnNorm && !facts.matched_family) {
    const idx = titleNorm.indexOf(pnNorm)
    if (idx >= 0) {
      const after = titleNorm.charAt(idx + pnNorm.length) // '' if at end
      const before = idx === 0 ? '' : titleNorm.charAt(idx - 1)
      // Boundary OK if next/previous char is not a digit (would mean
      // it's a different, longer model number)
      const goodAfter = after === '' || !/[0-9a-z]/.test(after) || !/[0-9]/.test(pnNorm.slice(-1) + after)
      const goodBefore = before === '' || !/[0-9]/.test(before)
      // Stricter: simply require non-digit boundary on both sides
      isExactMatch = (after === '' || !/[0-9]/.test(after)) && (before === '' || !/[0-9]/.test(before))
    }
  }
  const img = (isExactMatch && (facts.thumbnail || facts.image)) || ''
  let imgBlock = ''
  if (img) {
    imgBlock = `<div class="infobox-image">
      <img src="${img}" alt="${escapeHtml(chip.title || chip.part_number)}" loading="lazy" onerror="this.parentElement.style.display='none'">
      <div class="infobox-caption">${escapeHtml(facts.title || chip.title || chip.part_number)}</div>
    </div>`
  }

  // Identification
  const ident = []
  ident.push(['Part number', `<code>${escapeHtml(chip.part_number)}</code>`])
  if (chip.manufacturer) ident.push(['Manufacturer', escapeHtml(chip.manufacturer)])
  if (chip.category) ident.push(['Category', escapeHtml(chip.category)])

  // Lifecycle (always shown)
  const lifecycle = []
  if (chip.status) lifecycle.push(['Status', statusTag(chip.status)])
  if (chip.eol_date) lifecycle.push(['EOL date', escapeHtml(chip.eol_date)])
  if (chip.last_order_date) lifecycle.push(['Last order', escapeHtml(chip.last_order_date)])
  if (chip.fcc_id) lifecycle.push(['FCC ID', `<a href="https://fccid.io/${encodeURIComponent(chip.fcc_id.replace(/-/g, '/'))}" target="_blank" rel="noopener">${escapeHtml(chip.fcc_id)}</a>`])

  // Wikidata specs
  const SPEC_ORDER = [
    ['type', 'Type'],
    ['introduced', 'Introduced'],
    ['released', 'Released'],
    ['discontinued', 'Discontinued'],
    ['fabrication_method', 'Process'],
    ['clock_frequency', 'Clock rate'],
    ['transistor_count', 'Transistors'],
    ['die_area', 'Die area'],
    ['follows', 'Predecessor'],
    ['followed_by', 'Successor'],
    ['part_of', 'Part of'],
    ['subclass_of', 'Subclass of'],
    ['used_by', 'Used in'],
    ['operating_system', 'OS'],
    ['material', 'Material'],
    ['units_sold', 'Units sold'],
    ['named_after', 'Named after'],
  ]
  const specs = []
  for (const [key, label] of SPEC_ORDER) {
    const v = wd[key]
    if (!v) continue
    const formatted = Array.isArray(v) ? v.join(', ') : v
    specs.push([label, escapeHtml(formatted)])
  }

  // Threat summary
  const threats = []
  threats.push(['Risk score', `<strong>${chip.risk_score || 0}</strong>`])
  if (chip.cve_count) threats.push(['CVEs', String(chip.cve_count)])
  if (chip.kev_count) threats.push(['CISA KEV', `<span class="mini-badge mb-kev">${chip.kev_count}</span>`])
  if (chip.exploit_count) threats.push(['Exploit-DB', `<span class="mini-badge mb-edb">${chip.exploit_count}</span>`])
  if (chip.msf_count) threats.push(['Metasploit', `<span class="mini-badge mb-msf">${chip.msf_count}</span>`])
  if (chip.ghsa_count) threats.push(['GHSA', `<span class="mini-badge mb-ghsa">${chip.ghsa_count}</span>`])

  // Sources
  const sources = []
  if (facts.wp_url) sources.push(['Wikipedia', `<a href="${facts.wp_url}" target="_blank" rel="noopener">View →</a>`])
  if (facts.wikichip_url) sources.push(['WikiChip', `<a href="${facts.wikichip_url}" target="_blank" rel="noopener">View →</a>`])
  if (chip.url && !chip.url.includes('wikipedia')) sources.push(['Manufacturer', `<a href="${chip.url}" target="_blank" rel="noopener">Product page →</a>`])
  if (chip.datasheet) sources.push(['Datasheet', `<a href="${chip.datasheet}" target="_blank" rel="noopener">PDF →</a>`])

  function tableSection(name, items) {
    if (!items.length) return ''
    return `<div class="infobox-section">${name}</div>` +
      `<table><tbody>${items.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`
  }

  return `<div class="infobox-title">${escapeHtml(chip.part_number)}</div>` +
    imgBlock +
    tableSection('Identification', ident) +
    tableSection('Lifecycle', lifecycle) +
    (specs.length ? tableSection('Specifications', specs) : '') +
    tableSection('Threats', threats) +
    (sources.length ? tableSection('External links', sources) : '')
}

function buildIntroSection(chip, facts) {
  const text = facts.intro_full || facts.extract || ''
  let intro = ''

  if (text) {
    intro += formatExtract(text)
    if (facts.matched_family) {
      intro = `<p style="font-size:12px;color:var(--text3);font-style:italic">
        (Family page - describes ${escapeHtml(facts.matched_family)} family rather than the exact part variant)
      </p>` + intro
    }
  } else {
    // Fallback intro composed from chip metadata
    const parts = []
    if (chip.title) parts.push(`<strong>${escapeHtml(chip.part_number)}</strong> - ${escapeHtml(chip.title)}`)
    else parts.push(`<strong>${escapeHtml(chip.part_number)}</strong>`)
    if (chip.manufacturer) parts.push(`is a ${escapeHtml(chip.category || 'chip')} manufactured by <em>${escapeHtml(chip.manufacturer)}</em>`)
    if (chip.description) parts.push(`<br><br>${escapeHtml(chip.description)}`)
    intro = `<p>${parts.join(' ')}.</p>`
  }

  // WikiChip block (separate)
  if (facts.wikichip_extract) {
    intro += `<div style="background:#e0f6fa;border-left:3px solid var(--tag-metasploit);padding:10px 14px;margin-top:14px">
      <div style="font-weight:600;color:var(--tag-metasploit);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">
        From WikiChip
      </div>
      <p style="font-size:13px;line-height:1.6;margin:0">${escapeHtml(facts.wikichip_extract)}</p>
      ${facts.wikichip_url ? `<p style="margin-top:6px;margin-bottom:0;font-size:12px"><a href="${facts.wikichip_url}" target="_blank" rel="noopener">Read on WikiChip →</a></p>` : ''}
    </div>`
  }

  return intro
}

function threatTable(items) {
  return `<table><thead><tr>
    <th>Type</th><th>ID</th><th>Title</th><th>Severity</th><th>Date</th>
  </tr></thead><tbody>
    ${items.map(it => `<tr>
      <td>${tag('tag-' + it.type, (it.type || '').toUpperCase())}</td>
      <td style="white-space:nowrap;font-family:monospace;font-size:11px">
        <a href="${it.url || '#'}" target="_blank" rel="noopener">${escapeHtml(it.id || '')}</a>
      </td>
      <td><span class="truncate" style="max-width:380px">${escapeHtml(it.title || '')}</span>${badgeRow(it)}</td>
      <td>${severityTag(it.severity)}</td>
      <td style="color:var(--text3);white-space:nowrap;font-size:11px">${escapeHtml(it.date || '-')}</td>
    </tr>`).join('')}
  </tbody></table>`
}

function buildSectionsTOC(sections) {
  const items = sections.filter(s => s.show)
  if (!items.length) return ''
  // Number top-level sections; nest sub-sections inside the previous top-level
  let html = '', topNum = 0, subNum = 0, openSub = false
  for (const s of items) {
    if (!s.sub) {
      if (openSub) { html += '</ol></li>'; openSub = false }
      topNum++; subNum = 0
      html += `<li><a href="#sec-${s.id}">${topNum} ${escapeHtml(s.title)}</a>`
      // Peek if next ones are sub
      html += ''
    } else {
      if (!openSub) { html += '<ol class="toc-sub">'; openSub = true }
      subNum++
      html += `<li><a href="#sec-${s.id}">${topNum}.${subNum} ${escapeHtml(s.title)}</a></li>`
    }
  }
  if (openSub) html += '</ol></li>'
  return html
}

async function main() {
  const titleEl = document.getElementById('ca-title')
  const subtitleEl = document.getElementById('ca-subtitle')

  if (!requestedPn) {
    titleEl.textContent = 'No chip specified'
    subtitleEl.textContent = 'Open a specific chip via /chip.html?id=PARTNUMBER'
    return
  }

  const [chips, cves, kev, exploits, msf, ghsa, facts] = await Promise.all([
    fetch('./data/eol_chips.json?v=43').then(r => r.json()),
    fetch('./data/cves.json?v=43').then(r => r.ok ? r.json() : []).catch(() => []),
    fetch('./data/cisa_kev.json?v=43').then(r => r.ok ? r.json() : []).catch(() => []),
    fetch('./data/exploits.json?v=43').then(r => r.ok ? r.json() : []).catch(() => []),
    fetch('./data/metasploit.json?v=43').then(r => r.ok ? r.json() : []).catch(() => []),
    fetch('./data/ghsa.json?v=43').then(r => r.ok ? r.json() : []).catch(() => []),
    fetch('./data/chip_facts.json?v=43').then(r => r.ok ? r.json() : {}).catch(() => ({})),
  ])

  const chip = chips.find(c => c.part_number === requestedPn)
  if (!chip) {
    titleEl.textContent = 'Chip not found'
    subtitleEl.innerHTML = `<a href="eol.html">Back to chip index →</a>`
    return
  }

  const chipFacts = facts[chip.part_number] || {}
  const wd = chipFacts.wikidata || {}

  // Title + subtitle - always show the chip's actual part number first.
  // Wikipedia title (when different) is shown as a secondary breadcrumb.
  document.title = `${chip.part_number} - EOL-CHIP`
  titleEl.innerHTML = escapeHtml(chip.title || chip.part_number)
  const baseDesc = chip.description || (chip.category + ' from ' + chip.manufacturer)
  let subBits = [`<em>${escapeHtml(baseDesc)}</em>`]
  if (chipFacts.matched_family && chipFacts.title) {
    subBits.push(`<span style="color:var(--text3);font-size:12px">Wikipedia article: <a href="${chipFacts.wp_url}" target="_blank" rel="noopener">${escapeHtml(chipFacts.title)}</a> (family page)</span>`)
  } else if (chipFacts.title && chipFacts.title.toLowerCase() !== (chip.title || '').toLowerCase()) {
    subBits.push(`<span style="color:var(--text3);font-size:12px">Wikipedia: <a href="${chipFacts.wp_url}" target="_blank" rel="noopener">${escapeHtml(chipFacts.title)}</a></span>`)
  }
  subtitleEl.innerHTML = subBits.join(' &middot; ')

  // Intro
  document.getElementById('ca-intro').innerHTML = buildIntroSection(chip, chipFacts)

  // Sections - threat tables for each source that has hits.
  // Use the server-side cross-link results (word-boundary-validated, in
  // scripts/cross_link.py). Naive client-side substring match produced
  // false positives like "Thor" matching "Authorization Bypass" CVEs.
  const matchedCves = new Set(chip.matched_cves || [])
  const matchedKev = new Set(chip.matched_kev || [])
  const matchedExp = new Set(chip.matched_exploits || [])
  const matchedMsf = new Set(chip.matched_msf || [])
  const matchedGhsa = new Set(chip.matched_ghsa || [])

  const linkedCves = cves.filter(c => matchedCves.has(c.id))
  const linkedKev = kev.filter(k => matchedKev.has(k.id))
  const linkedExp = exploits.filter(e => matchedExp.has(e.id))
  const linkedMsf = msf.filter(m => matchedMsf.has(m.id))
  const linkedGhsa = ghsa.filter(g => matchedGhsa.has(g.id))

  const hasAnyThreat = linkedCves.length || linkedKev.length || linkedExp.length || linkedMsf.length || linkedGhsa.length
  const sections = [
    { id: 'lifecycle', title: 'Lifecycle', show: !!(chip.status || chip.eol_date) },
    { id: 'security', title: 'Security', show: hasAnyThreat },
    { id: 'vulnerabilities', title: 'Vulnerabilities', show: linkedCves.length > 0, sub: true },
    { id: 'active', title: 'Active exploitation', show: linkedKev.length > 0, sub: true },
    { id: 'known-exploits', title: 'Known exploits', show: linkedExp.length > 0, sub: true },
    { id: 'exploit-modules', title: 'Exploit modules', show: linkedMsf.length > 0, sub: true },
    { id: 'advisories', title: 'Other advisories', show: linkedGhsa.length > 0, sub: true },
    { id: 'references', title: 'References', show: true },
    { id: 'external', title: 'External links', show: true },
  ]

  const tocList = buildSectionsTOC(sections)
  if (tocList) {
    document.getElementById('ca-toc').style.display = 'inline-block'
    document.getElementById('ca-toc-list').innerHTML = tocList
  }

  let html = ''

  // Lifecycle section
  if (sections.find(s => s.id === 'lifecycle').show) {
    html += `<section class="article-section" id="sec-lifecycle">
      <h2>Lifecycle</h2>
      <p>
        <strong>${escapeHtml(chip.part_number)}</strong> is currently marked
        <strong>${escapeHtml(chip.status || 'unknown status')}</strong>${
          chip.manufacturer ? ` by ${escapeHtml(chip.manufacturer)}` : ''}.
        ${chip.eol_date ? ` End-of-life is scheduled for <strong>${escapeHtml(chip.eol_date)}</strong>.` : ''}
        ${chip.last_order_date ? ` Last-time-buy date: <strong>${escapeHtml(chip.last_order_date)}</strong>.` : ''}
      </p>
    </section>`
  }

  // Security parent + sub-sections
  if (hasAnyThreat) {
    html += `<section class="article-section" id="sec-security">
      <h2>Security</h2>
      <p>This part has <strong>${chip.cve_count || 0}</strong> known CVE${chip.cve_count === 1 ? '' : 's'}, ` +
        `<strong>${chip.kev_count || 0}</strong> CISA KEV listing${chip.kev_count === 1 ? '' : 's'}, ` +
        `<strong>${chip.exploit_count || 0}</strong> public exploit${chip.exploit_count === 1 ? '' : 's'}, ` +
        `and <strong>${chip.msf_count || 0}</strong> Metasploit module${chip.msf_count === 1 ? '' : 's'} ` +
        `cross-linked from public threat-intelligence feeds.</p>
    </section>`

    function subSection(id, title, items, sourceLink) {
      return `<section class="article-section sub-section" id="sec-${id}">
        <h3>${title}${sourceLink ? ` <span class="src-note">(source: ${sourceLink})</span>` : ''}</h3>
        ${threatTable(items)}
      </section>`
    }

    if (linkedCves.length) html += subSection('vulnerabilities', 'Vulnerabilities', linkedCves, '<a href="https://nvd.nist.gov/" target="_blank" rel="noopener">NVD</a>')
    if (linkedKev.length) html += subSection('active', 'Active exploitation', linkedKev, '<a href="https://www.cisa.gov/known-exploited-vulnerabilities-catalog" target="_blank" rel="noopener">CISA KEV</a>')
    if (linkedExp.length) html += subSection('known-exploits', 'Known exploits', linkedExp, '<a href="https://www.exploit-db.com/" target="_blank" rel="noopener">Exploit-DB</a>')
    if (linkedMsf.length) html += subSection('exploit-modules', 'Exploit modules', linkedMsf, '<a href="https://github.com/rapid7/metasploit-framework" target="_blank" rel="noopener">Metasploit Framework</a>')
    if (linkedGhsa.length) html += subSection('advisories', 'Other advisories', linkedGhsa, '<a href="https://github.com/advisories" target="_blank" rel="noopener">GitHub Advisory DB</a>')
  }

  // References section - what we cite
  const refs = []
  let refNum = 1
  if (chipFacts.wp_url) refs.push(`<li id="ref-${refNum}"><span class="ref-num">${refNum++}</span><a href="${chipFacts.wp_url}" target="_blank" rel="noopener">Wikipedia: ${escapeHtml(chipFacts.title || chip.part_number)}</a> - chip overview, history</li>`)
  if (chipFacts.wikichip_url) refs.push(`<li id="ref-${refNum}"><span class="ref-num">${refNum++}</span><a href="${chipFacts.wikichip_url}" target="_blank" rel="noopener">WikiChip: ${escapeHtml(chip.part_number)}</a> - technical chip database</li>`)
  if (chipFacts.wikidata_id) refs.push(`<li id="ref-${refNum}"><span class="ref-num">${refNum++}</span><a href="https://www.wikidata.org/wiki/${chipFacts.wikidata_id}" target="_blank" rel="noopener">Wikidata: ${chipFacts.wikidata_id}</a> - structured properties</li>`)
  refs.push(`<li id="ref-${refNum}"><span class="ref-num">${refNum++}</span><a href="https://nvd.nist.gov/" target="_blank" rel="noopener">NIST National Vulnerability Database</a> - CVE source</li>`)
  refs.push(`<li id="ref-${refNum}"><span class="ref-num">${refNum++}</span><a href="https://www.cisa.gov/known-exploited-vulnerabilities-catalog" target="_blank" rel="noopener">CISA Known Exploited Vulnerabilities Catalog</a> - active-threat list</li>`)
  refs.push(`<li id="ref-${refNum}"><span class="ref-num">${refNum++}</span><a href="https://www.exploit-db.com/" target="_blank" rel="noopener">Exploit Database (Offensive Security)</a> - public-exploit archive</li>`)

  html += `<section class="article-section" id="sec-references">
    <h2>References</h2>
    <ol class="references">${refs.join('')}</ol>
  </section>`

  // External links section
  const ext = []
  if (chip.url && !chip.url.includes('wikipedia')) ext.push(`<li><a href="${chip.url}" target="_blank" rel="noopener">${escapeHtml(chip.manufacturer || 'Manufacturer')} product page</a></li>`)
  if (chip.datasheet) ext.push(`<li><a href="${chip.datasheet}" target="_blank" rel="noopener">Official datasheet (PDF)</a></li>`)
  if (chip.fcc_id) ext.push(`<li><a href="https://fccid.io/${encodeURIComponent(chip.fcc_id.replace(/-/g, '/'))}" target="_blank" rel="noopener">FCC ID lookup: ${escapeHtml(chip.fcc_id)}</a></li>`)
  ext.push(`<li><a href="https://www.alldatasheet.com/view.jsp?Searchword=${encodeURIComponent(chip.part_number)}" target="_blank" rel="noopener">AllDatasheet - ${escapeHtml(chip.part_number)}</a></li>`)
  ext.push(`<li><a href="https://www.datasheetarchive.com/?q=${encodeURIComponent(chip.part_number)}" target="_blank" rel="noopener">Datasheet Archive - ${escapeHtml(chip.part_number)}</a></li>`)
  ext.push(`<li><a href="https://www.datasheets.com/en/search/${encodeURIComponent(chip.part_number)}" target="_blank" rel="noopener">Datasheets.com - ${escapeHtml(chip.part_number)}</a></li>`)
  ext.push(`<li><a href="https://octopart.com/search?q=${encodeURIComponent(chip.part_number)}" target="_blank" rel="noopener">Octopart - distributor pricing &amp; inventory</a></li>`)
  ext.push(`<li><a href="https://www.findchips.com/search/${encodeURIComponent(chip.part_number)}" target="_blank" rel="noopener">FindChips - search across distributors</a></li>`)
  ext.push(`<li><a href="https://www.google.com/search?q=${encodeURIComponent(chip.part_number + ' datasheet pdf')}" target="_blank" rel="noopener">Google: <code>${escapeHtml(chip.part_number)} datasheet pdf</code></a></li>`)

  html += `<section class="article-section" id="sec-external">
    <h2>External links</h2>
    <ul class="references">${ext.join('')}</ul>
  </section>`

  document.getElementById('ca-sections').innerHTML = html

  // Categories
  const cats = []
  if (chip.category) cats.push(chip.category)
  if (chip.manufacturer) cats.push(chip.manufacturer)
  if (chip.status) cats.push(chip.status)
  if (chip.kev_count) cats.push('Actively exploited')
  if (chip.risk_score > 0) cats.push('Has known threats')
  const catEl = document.getElementById('ca-cats')
  catEl.innerHTML = '<b>Categories:</b> ' + cats.map(c => `<a href="eol.html?cat=${encodeURIComponent(c)}">${escapeHtml(c)}</a>`).join(' · ')
  catEl.style.display = 'block'

  // Infobox
  document.getElementById('ca-infobox').innerHTML = buildInfobox(chip, chipFacts)
}

main().catch(e => {
  document.getElementById('ca-title').textContent = 'Error loading chip'
  console.error(e)
})
