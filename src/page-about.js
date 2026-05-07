import { initNav, loadMeta } from './common.js?v=16'

initNav('about')
loadMeta()

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// GitHub repo coords - adjust if you fork
const REPO = 'iotsrg/eol-chip'

const list = document.getElementById('contributors-list')

async function loadContributors() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contributors?per_page=100`,
      { headers: { Accept: 'application/vnd.github+json' } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const items = await r.json()
    if (!Array.isArray(items) || !items.length) {
      list.innerHTML = `<p class="dash-empty">No contributors found yet - be the first
        to <a href="https://github.com/${REPO}/pulls" target="_blank" rel="noopener">open a pull request</a>.</p>`
      return
    }
    list.innerHTML = items.map(c => `
      <a class="contributor-card" href="${c.html_url}" target="_blank" rel="noopener">
        <img class="contributor-avatar" src="${c.avatar_url}&s=80" alt="${escapeHtml(c.login)}" loading="lazy">
        <div class="contributor-body">
          <div class="contributor-name">${escapeHtml(c.login)}</div>
          <div class="contributor-stat">${c.contributions.toLocaleString()} commit${c.contributions === 1 ? '' : 's'}</div>
        </div>
      </a>`).join('')
  } catch (e) {
    // Fallback to known contributor (read from git log) if GitHub API is unreachable
    list.innerHTML = `
      <a class="contributor-card" href="https://github.com/Mr-IoT" target="_blank" rel="noopener">
        <img class="contributor-avatar" src="https://github.com/Mr-IoT.png?size=80" alt="Mr-IoT" loading="lazy">
        <div class="contributor-body">
          <div class="contributor-name">Mr-IoT</div>
          <div class="contributor-stat">project creator &amp; maintainer</div>
        </div>
      </a>
      <p class="dash-empty" style="grid-column:1/-1;font-size:11px">
        (GitHub API unreachable - showing offline fallback list. Live list available at
        <a href="https://github.com/${REPO}/graphs/contributors" target="_blank" rel="noopener">
          github.com/${REPO}/graphs/contributors</a>.)
      </p>`
  }
}

loadContributors()
