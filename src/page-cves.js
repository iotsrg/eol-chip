import { initNav, severityTag } from './common.js'

initNav('cves')

function cvssColor(score) {
  if (!score) return 'var(--text3)'
  if (score >= 9) return 'var(--sev-critical)'
  if (score >= 7) return 'var(--sev-high)'
  if (score >= 4) return 'var(--sev-medium)'
  return 'var(--sev-low)'
}

fetch('/data/cves.json')
  .then(r => r.json())
  .then(cves => {
    document.getElementById('cve-count').textContent = cves.length.toLocaleString()
    const tbody = document.getElementById('cve-body')

    if (!cves.length) {
      tbody.innerHTML = `<tr><td colspan="6">
        <div class="empty-state">
          No CVE data — run <code>python scripts/fetch_cves.py</code> to populate.
        </div>
      </td></tr>`
      return
    }

    tbody.innerHTML = cves.map(cve => `<tr>
      <td style="white-space:nowrap">
        <a href="${cve.url || '#'}" target="_blank" rel="noopener">${cve.id || ''}</a>
      </td>
      <td><span class="truncate" style="max-width:320px">${cve.title || ''}</span></td>
      <td>${severityTag(cve.severity)}</td>
      <td style="font-weight:600;color:${cvssColor(cve.cvss_score)}">${cve.cvss_score || '—'}</td>
      <td style="color:var(--text3);font-size:12px">${cve.cwe || '—'}</td>
      <td style="color:var(--text3);white-space:nowrap">${cve.date || '—'}</td>
    </tr>`).join('')
  })
