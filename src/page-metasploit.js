import { initNav } from './common.js'

initNav('metasploit')

fetch('./data/metasploit.json')
  .then(r => r.json())
  .then(items => {
    document.getElementById('msf-count').textContent = items.length.toLocaleString()
    const tbody = document.getElementById('msf-body')

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="3">
        <div class="empty-state">
          No Metasploit data — run <code>python scripts/fetch_metasploit.py</code> to populate.
        </div>
      </td></tr>`
      return
    }

    tbody.innerHTML = items.map(m => `<tr>
      <td style="white-space:nowrap;font-family:monospace;font-size:12px">
        <a href="${m.url || '#'}" target="_blank" rel="noopener">${m.id || ''}</a>
      </td>
      <td><span class="truncate" style="max-width:280px">${m.title || ''}</span></td>
      <td><span class="truncate" style="max-width:420px;color:var(--text2);font-size:12px">${m.description || '—'}</span></td>
    </tr>`).join('')
  })
