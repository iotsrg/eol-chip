import { initNav, tag, loadMeta } from './common.js?v=47'

initNav('cisa')
loadMeta()

fetch('./data/cisa_kev.json?v=47')
  .then(r => r.json())
  .then(items => {
    document.getElementById('cisa-count').textContent = items.length.toLocaleString()
    const tbody = document.getElementById('cisa-body')

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6">
        <div class="empty-state">
          No CISA KEV data - run <code>python scripts/fetch_cisa.py</code> to populate.
        </div>
      </td></tr>`
      return
    }

    tbody.innerHTML = items.map(v => {
      const ransomware = v.ransomware === 'Known'
        ? tag('tag-sev-critical', 'Ransomware')
        : `<span style="color:var(--text3)">-</span>`
      return `<tr>
        <td style="white-space:nowrap;font-family:monospace;font-size:12px">
          <a href="${v.url || '#'}" target="_blank" rel="noopener">${v.id || ''}</a>
        </td>
        <td><span class="truncate" style="max-width:320px">${v.title || ''}</span></td>
        <td style="color:var(--text2);font-size:12px">${v.manufacturer || '-'}</td>
        <td style="color:var(--text2);font-size:12px">${v.part_number || '-'}</td>
        <td>${ransomware}</td>
        <td style="color:var(--text3);white-space:nowrap">${v.date || '-'}</td>
      </tr>`
    }).join('')
  })
