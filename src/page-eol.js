import { initNav, tag, statusTag } from './common.js'

initNav('eol')

fetch('/data/eol_chips.json')
  .then(r => r.json())
  .then(chips => {
    document.getElementById('eol-count').textContent = chips.length.toLocaleString()

    const cats = [...new Set(chips.map(c => c.category).filter(Boolean))].sort()
    document.getElementById('cat-count').textContent = cats.length

    const catFilter = document.getElementById('cat-filters')
    catFilter.innerHTML =
      `<button class="cat-btn active" data-cat="all">All (${chips.length})</button>` +
      cats.map(c => {
        const n = chips.filter(x => x.category === c).length
        return `<button class="cat-btn" data-cat="${c}">${c} <span style="opacity:.6;font-size:10px">${n}</span></button>`
      }).join('')

    const tbody = document.getElementById('eol-body')

    function renderRows(cat = 'all') {
      const rows = cat === 'all' ? chips : chips.filter(c => c.category === cat)
      tbody.innerHTML = rows.map(chip => `<tr>
        <td>${tag('tag-cat', chip.category || '')}</td>
        <td style="white-space:nowrap;font-family:monospace;font-size:12px">
          <a href="${chip.url || '#'}" target="_blank" rel="noopener">${chip.part_number || ''}</a>
        </td>
        <td style="font-weight:500">${chip.title || chip.name || ''}</td>
        <td style="color:var(--text2)">${chip.manufacturer || ''}</td>
        <td>${statusTag(chip.status)}</td>
        <td style="color:var(--text3);white-space:nowrap">${chip.eol_date || '—'}</td>
        <td>${chip.datasheet
          ? `<a href="${chip.datasheet}" target="_blank" rel="noopener"
               style="font-size:11px;color:var(--text2)">&#128196; PDF</a>`
          : '<span style="color:var(--text3)">—</span>'
        }</td>
      </tr>`).join('')
    }

    renderRows()

    catFilter.addEventListener('click', e => {
      const btn = e.target.closest('.cat-btn')
      if (!btn) return
      catFilter.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      renderRows(btn.dataset.cat)
    })
  })
