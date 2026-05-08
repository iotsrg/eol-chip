export function initNav(activePage = '') {
  const nav = document.getElementById('nav')
  if (!nav) return

  const links = [
    { href: 'index.html',   label: 'Home',    key: 'home' },
    { href: 'vendors.html', label: 'Vendors', key: 'vendors' },
    { href: 'about.html',   label: 'About',   key: 'about' },
  ]

  nav.innerHTML = `
    <a href="./index.html" class="nav-logo">
      <div class="nav-chip-icon">IC</div>
      EOL-CHIP
    </a>
    <div class="nav-links">
      ${links.map(l =>
        `<a href="${l.href}"${activePage === l.key ? ' class="nav-active"' : ''}>${l.label}</a>`
      ).join('')}
      <button class="theme-toggle" id="theme-toggle" type="button"
        title="Toggle light / dark theme" aria-label="Toggle theme">
        <span class="icon-dark">&#9788;</span><span class="icon-light">&#9789;</span>
      </button>
    </div>
  `

  document.getElementById('theme-toggle').addEventListener('click', toggleTheme)
}

export function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme)
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
  try { localStorage.setItem('eol-theme', theme) } catch (_) {}
}

export function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme')
  applyTheme(cur === 'dark' ? 'light' : 'dark')
}

// Apply saved theme as soon as this module loads - avoids flash of light
// theme on dark-preferring users.
try {
  const saved = localStorage.getItem('eol-theme')
  if (saved) applyTheme(saved)
  else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark')
  }
} catch (_) {}

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

// Render mini-badges (KEV / EDB / MSF / Ransomware) inline next to a title.
export function badgeRow(item) {
  const out = []
  if (item.kev) out.push('<span class="mini-badge mb-kev" title="CISA Known Exploited">KEV</span>')
  if (item.exploit_count > 0) out.push(`<span class="mini-badge mb-edb" title="Exploit-DB entries">EDB×${item.exploit_count}</span>`)
  if (item.msf_count > 0) out.push(`<span class="mini-badge mb-msf" title="Metasploit modules">MSF×${item.msf_count}</span>`)
  if (item.ghsa_count > 0) out.push(`<span class="mini-badge mb-ghsa" title="GitHub advisories">GHSA×${item.ghsa_count}</span>`)
  if (item.ransomware === 'Known') out.push('<span class="mini-badge mb-ransom" title="Known ransomware use">Ransomware</span>')
  if (!out.length) return ''
  return ` <span class="badge-row">${out.join(' ')}</span>`
}

// Inject a "Data sources" link strip into the footer on every page.
// Renders into [data-sources-footer] if present, otherwise no-op.
export function renderSourcesFooter() {
  const el = document.querySelector('[data-sources-footer]')
  if (!el) return
  const sources = [
    ['cves.html', 'NVD CVEs'],
    ['cisa.html', 'CISA KEV'],
    ['ics.html', 'CISA ICS-CERT'],
    ['exploits.html', 'Exploit-DB'],
    ['metasploit.html', 'Metasploit'],
    ['ghsa.html', 'GHSA'],
    ['packetstorm.html', 'Packet Storm'],
  ]
  el.innerHTML = '<b>Data source indexes:</b> ' +
    sources.map(([h, l]) => `<a href="${h}">${l}</a>`).join(' &middot; ')
}

export async function loadMeta() {
  renderSourcesFooter()
  try {
    const r = await fetch('./data/meta.json?v=21')
    if (!r.ok) return null
    const m = await r.json()
    const fu = document.getElementById('footer-updated')
    if (fu && m.last_updated_human) fu.textContent = `Updated ${m.last_updated_human}`
    return m
  } catch {
    return null
  }
}
