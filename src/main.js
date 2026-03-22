import { initNav, tag, severityTag } from './common.js'
import Fuse from 'https://cdn.jsdelivr.net/npm/fuse.js@7/dist/fuse.mjs'

initNav()

const input      = document.getElementById('search-input')
const resultsEl  = document.getElementById('search-results')
const noResultEl = document.getElementById('no-results')

let fuse = null

// Load search index
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
    input.placeholder = 'Search CVEs, exploits, EOL chips…'
  })
  .catch(() => {
    input.placeholder = 'Failed to load search index'
  })

input.disabled = true
input.placeholder = 'Loading…'

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
    if (!fuse) return
    const q = input.value.trim()
    if (!q) { resultsEl.innerHTML = ''; noResultEl.style.display = 'none'; return }
    const types = activeTypes()
    const results = fuse.search(q).map(r => r.item).filter(item => types.has(item.type))
    renderResults(results)
  }, 200)
})

document.querySelectorAll('.filter-pill input').forEach(el =>
  el.addEventListener('change', () => input.dispatchEvent(new Event('input')))
)
