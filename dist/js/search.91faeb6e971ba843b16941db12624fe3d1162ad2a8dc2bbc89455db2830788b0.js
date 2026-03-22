(function() {
  var fuse = null;
  var input = document.getElementById('search-input');
  var resultsContainer = document.getElementById('search-results');
  var noResults = document.getElementById('no-results');
  var filters = document.querySelectorAll('.search-filters input[type="checkbox"]');
  var debounceTimer = null;

  var fuseOptions = {
    includeScore: true,
    threshold: 0.3,
    minMatchCharLength: 2,
    keys: [
      { name: 'title', weight: 0.35 },
      { name: 'id', weight: 0.25 },
      { name: 'description', weight: 0.2 },
      { name: 'manufacturer', weight: 0.1 },
      { name: 'part_number', weight: 0.1 }
    ]
  };

  function loadIndex() {
    var prefix = '';
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src');
      if (src && src.indexOf('search') !== -1) {
        prefix = src.substring(0, src.lastIndexOf('/js/'));
        break;
      }
    }
    fetch(prefix + '/search_index.json')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        fuse = new Fuse(data, fuseOptions);
        var q = new URLSearchParams(window.location.search).get('q');
        if (q) { input.value = q; doSearch(); }
      })
      .catch(function(e) { console.warn('Search index load failed:', e); });
  }

  function esc(s) {
    if (!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function trunc(s, n) {
    if (!s) return '';
    return s.length > n ? s.substring(0, n) + '...' : s;
  }

  function tagClass(type) {
    return 'tag tag-' + type;
  }

  function sevClass(sev) {
    if (!sev) return '';
    return 'tag tag-sev-' + sev.toLowerCase();
  }

  function getActiveTypes() {
    var t = [];
    filters.forEach(function(cb) { if (cb.checked) t.push(cb.getAttribute('data-type')); });
    return t;
  }

  function renderRow(item) {
    var type = '<span class="' + tagClass(item.type) + '">' + esc(item.type) + '</span>';
    var id = item.id || item.fcc_id || item.part_number || '';
    var link = item.url ? '<a href="' + esc(item.url) + '" target="_blank" rel="noopener">' + esc(id) + '</a>' : esc(id);
    var title = esc(trunc(item.title, 80));
    var extra = '';

    if (item.type === 'cve') {
      var sev = item.severity ? '<span class="' + sevClass(item.severity) + '">' + esc(item.severity) + '</span>' : '';
      extra = sev + (item.cvss_score ? ' ' + item.cvss_score : '');
    } else if (item.type === 'exploit') {
      extra = esc(item.platform || '');
    } else if (item.type === 'fcc') {
      extra = esc(item.grantee || '');
    } else if (item.type === 'eol') {
      extra = esc(item.manufacturer || '') + (item.status ? ' <span class="tag tag-eol">' + esc(item.status) + '</span>' : '');
    }

    return '<tr><td>' + type + '</td><td>' + link + '</td><td>' + title + '</td><td>' + extra + '</td><td>' + esc(item.date || '') + '</td></tr>';
  }

  function doSearch() {
    var query = input.value.trim();
    var active = getActiveTypes();
    resultsContainer.innerHTML = '';
    noResults.style.display = 'none';
    if (!query || !fuse) return;

    var results = fuse.search(query, { limit: 100 });
    var filtered = results.filter(function(r) { return active.indexOf(r.item.type) !== -1; });

    if (!filtered.length) { noResults.style.display = ''; return; }

    var html = '<table><thead><tr><th>Type</th><th>ID</th><th>Title</th><th>Details</th><th>Date</th></tr></thead><tbody>';
    filtered.forEach(function(r) { html += renderRow(r.item); });
    html += '</tbody></table>';
    resultsContainer.innerHTML = html;
  }

  input.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doSearch, 200);
  });
  filters.forEach(function(cb) { cb.addEventListener('change', doSearch); });
  loadIndex();
})();
