import './style.css'

export function initNav(activePage = '') {
  const nav = document.getElementById('nav')
  if (!nav) return

  const links = [
    { href: 'cves.html',     label: 'CVEs',     key: 'cves' },
    { href: 'exploits.html', label: 'Exploits', key: 'exploits' },
    { href: 'fcc.html',      label: 'FCC',      key: 'fcc' },
    { href: 'eol.html',      label: 'EOL Chips',key: 'eol' },
  ]

  nav.innerHTML = `
    <a href="/" class="nav-logo">
      <div class="nav-chip-icon">IC</div>
      EOL-CHIP
    </a>
    <div class="nav-links">
      ${links.map(l =>
        `<a href="${l.href}"${activePage === l.key ? ' class="nav-active"' : ''}>${l.label}</a>`
      ).join('')}
    </div>
  `
}

export function tag(cls, text) {
  return `<span class="tag ${cls}">${text}</span>`
}

export function severityTag(sev) {
  if (!sev) return ''
  return tag('tag-sev-' + sev.toLowerCase(), sev)
}

export function statusTag(status) {
  if (!status) return ''
  const lower = status.toLowerCase()
  if (lower.includes('active'))   return tag('tag-status-active', status)
  if (lower.includes('last buy')) return tag('tag-status-lastbuy', status)
  return tag('tag-eol', status)
}
