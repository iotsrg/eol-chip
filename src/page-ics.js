import { initNav, loadMeta } from './common.js?v=47'

initNav('ics')
loadMeta()

fetch('./data/ics_advisories.json?v=47')
  .then(r => r.ok ? r.json() : [])
  .then(items => {
    document.getElementById('ics-count').textContent = items.length.toLocaleString()
    const tbody = document.getElementById('ics-body')

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">
        No ICS advisory data - run <code>python scripts/fetch_ics_advisories.py</code> to populate.
      </div></td></tr>`
      return
    }

    tbody.innerHTML = items.map(a => `<tr>
      <td style="white-space:nowrap;font-family:monospace;font-size:11px">
        <a href="${a.url || '#'}" target="_blank" rel="noopener">${a.id || ''}</a>
      </td>
      <td><span class="truncate" style="max-width:420px">${a.title || ''}</span></td>
      <td style="font-family:monospace;font-size:11px;color:var(--text2)">${(a.cves || []).slice(0, 3).join(', ') || '-'}</td>
      <td style="color:var(--text3);font-size:11px">${a.source || '-'}</td>
      <td style="color:var(--text3);white-space:nowrap;font-size:11px">${a.date || '-'}</td>
    </tr>`).join('')
  })
