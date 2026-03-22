import { initNav, tag, statusTag } from './common.js'

initNav('eol')

Promise.all([
  fetch('./data/eol_chips.json').then(r => r.json()),
  fetch('./data/fcc_devices.json').then(r => r.json()).catch(() => []),
])
  .then(([chips, fccDevices]) => {
    // Build a lookup: lowercase words from title/grantee -> fcc_id
    const fccMap = {}
    fccDevices.forEach(f => {
      const key = (f.title || '').toLowerCase()
      fccMap[key] = f.fcc_id
      // also index by grantee+partial title for broader matching
      const words = key.split(/\s+/).filter(w => w.length > 4)
      words.forEach(w => { if (!fccMap[w]) fccMap[w] = f.fcc_id })
    })
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

    function fccLink(chip) {
      // prefer explicit fcc_id on chip, fall back to fuzzy match
      const id = chip.fcc_id || (() => {
        const titleWords = (chip.title || '').toLowerCase().split(/\s+/)
        for (const w of titleWords) {
          if (fccMap[w]) return fccMap[w]
        }
        const pn = (chip.part_number || '').toLowerCase()
        return fccMap[pn] || null
      })()
      if (!id) return '<span style="color:var(--text3)">—</span>'
      return `<a href="https://fccid.io/${id.replace('-','/')}" target="_blank" rel="noopener"
        style="font-size:11px;font-family:monospace;color:var(--accent)">${id}</a>`
    }

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
        <td>${fccLink(chip)}</td>
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
