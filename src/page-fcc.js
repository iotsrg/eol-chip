import { initNav } from './common.js'

initNav('fcc')

fetch('./data/fcc_devices.json')
  .then(r => r.json())
  .then(devices => {
    document.getElementById('fcc-count').textContent = devices.length.toLocaleString()
    const tbody = document.getElementById('fcc-body')

    if (!devices.length) {
      tbody.innerHTML = `<tr><td colspan="6">
        <div class="empty-state">
          No FCC data — run <code>python scripts/fetch_fcc.py</code> to populate.
        </div>
      </td></tr>`
      return
    }

    tbody.innerHTML = devices.map(d => `<tr>
      <td style="white-space:nowrap;font-family:monospace;font-size:12px">
        <a href="${d.url || '#'}" target="_blank" rel="noopener">${d.fcc_id || d.id || ''}</a>
      </td>
      <td style="font-weight:500">${d.title || '—'}</td>
      <td style="color:var(--text2)">${d.grantee || '—'}</td>
      <td style="color:var(--text2);font-size:12px">${d.equipment_class || '—'}</td>
      <td style="color:var(--text3);font-size:12px">${d.frequency || '—'}</td>
      <td style="color:var(--text3);white-space:nowrap">${d.date || '—'}</td>
    </tr>`).join('')
  })
