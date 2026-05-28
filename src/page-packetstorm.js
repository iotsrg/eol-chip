import { initNav, loadMeta } from './common.js?v=47'

initNav('packetstorm')
loadMeta()

fetch('./data/packetstorm.json?v=47')
  .then(r => r.ok ? r.json() : [])
  .then(items => {
    document.getElementById('ps-count').textContent = items.length.toLocaleString()
    const tbody = document.getElementById('ps-body')

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">
        No Packet Storm data - run <code>python scripts/fetch_packetstorm.py</code> to populate.
      </div></td></tr>`
      return
    }

    tbody.innerHTML = items.map(p => `<tr>
      <td style="white-space:nowrap;font-family:monospace;font-size:11px">
        <a href="${p.url || '#'}" target="_blank" rel="noopener">${p.id || ''}</a>
      </td>
      <td><span class="truncate" style="max-width:480px">${p.title || ''}</span></td>
      <td style="font-family:monospace;font-size:11px;color:var(--text2)">${(p.cves || []).slice(0, 3).join(', ') || '-'}</td>
      <td style="color:var(--text3);white-space:nowrap;font-size:11px">${p.date || '-'}</td>
    </tr>`).join('')
  })
