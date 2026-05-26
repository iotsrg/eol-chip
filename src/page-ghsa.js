import { initNav, severityTag, loadMeta } from './common.js?v=43'

initNav('ghsa')
loadMeta()

fetch('./data/ghsa.json?v=43')
  .then(r => r.ok ? r.json() : [])
  .then(items => {
    document.getElementById('ghsa-count').textContent = items.length.toLocaleString()
    const tbody = document.getElementById('ghsa-body')

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">
        No GHSA data - run <code>python scripts/fetch_ghsa.py</code> (requires <code>GITHUB_TOKEN</code>) to populate.
      </div></td></tr>`
      return
    }

    tbody.innerHTML = items.map(g => `<tr>
      <td style="white-space:nowrap;font-family:monospace;font-size:11px">
        <a href="${g.url || '#'}" target="_blank" rel="noopener">${g.id || ''}</a>
      </td>
      <td><span class="truncate" style="max-width:380px">${g.title || ''}</span></td>
      <td>${severityTag(g.severity)}</td>
      <td style="font-family:monospace;font-size:11px;color:var(--text2)">${(g.cves || []).slice(0, 3).join(', ') || '-'}</td>
      <td style="color:var(--text3);font-size:11px">${(g.packages || []).slice(0, 3).join(', ') || '-'}</td>
      <td style="color:var(--text3);white-space:nowrap;font-size:11px">${g.date || '-'}</td>
    </tr>`).join('')
  })
