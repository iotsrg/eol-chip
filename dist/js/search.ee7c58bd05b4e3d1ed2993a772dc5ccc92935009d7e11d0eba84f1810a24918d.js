(function() {
  var searchIndex = null;
  var fuse = null;
  var input = document.getElementById('search-input');
  var resultsContainer = document.getElementById('search-results');
  var noResults = document.getElementById('no-results');
  var filters = document.querySelectorAll('.search-filters input[type="checkbox"]');
  var debounceTimer = null;

  var fuseOptions = {
    includeScore: true,
    includeMatches: true,
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

  function getBaseURL() {
    var base = document.querySelector('base');
    if (base) return base.href;
    var scripts = document.querySelectorAll('script[src*="search"]');
    if (scripts.length) {
      var src = scripts[0].src;
      return src.substring(0, src.indexOf('/js/'));
    }
    return '';
  }

  function loadIndex() {
    var base = document.querySelector('link[rel="canonical"]');
    var prefix = '';
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src');
      if (src && src.indexOf('search') !== -1) {
        prefix = src.substring(0, src.lastIndexOf('/js/'));
        break;
      }
    }
    var url = prefix + '/search_index.json';
    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        searchIndex = data;
        fuse = new Fuse(data, fuseOptions);
        var params = new URLSearchParams(window.location.search);
        var q = params.get('q');
        if (q) {
          input.value = q;
          doSearch();
        }
      })
      .catch(function(err) {
        console.warn('Could not load search index:', err);
      });
  }

  function getActiveTypes() {
    var types = [];
    filters.forEach(function(cb) {
      if (cb.checked) types.push(cb.getAttribute('data-type'));
    });
    return types;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  }

  function severityClass(sev) {
    if (!sev) return '';
    var s = sev.toLowerCase();
    if (s === 'critical') return 'severity-critical';
    if (s === 'high') return 'severity-high';
    if (s === 'medium') return 'severity-medium';
    if (s === 'low') return 'severity-low';
    return '';
  }

  function statusClass(status) {
    if (!status) return '';
    var s = status.toLowerCase();
    if (s === 'obsolete') return 'status-obsolete';
    if (s.indexOf('eol') !== -1) return 'status-eol-announced';
    if (s.indexOf('last') !== -1) return 'status-last-buy';
    if (s === 'active') return 'status-active';
    return '';
  }

  function renderCard(item) {
    var card = document.createElement('div');
    card.className = 'result-card';
    var html = '';

    if (item.type === 'cve') {
      html = '<div class="card-header">' +
        '<span class="card-type-badge badge-cve">CVE</span>' +
        '<span class="card-id">' + escapeHtml(item.id) + '</span>' +
        (item.severity ? ' <span class="severity-badge ' + severityClass(item.severity) + '">' + escapeHtml(item.severity) + '</span>' : '') +
        '</div>' +
        '<div class="card-title"><a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">' + escapeHtml(item.title) + '</a></div>' +
        '<div class="card-description">' + escapeHtml(truncate(item.description, 200)) + '</div>' +
        '<div class="card-meta">' +
        (item.cvss_score ? '<span class="card-meta-item">CVSS: ' + item.cvss_score + '</span>' : '') +
        (item.date ? '<span class="card-meta-item">' + escapeHtml(item.date) + '</span>' : '') +
        (item.cwe ? '<span class="card-meta-item">' + escapeHtml(item.cwe) + '</span>' : '') +
        '</div>';
    } else if (item.type === 'exploit') {
      html = '<div class="card-header">' +
        '<span class="card-type-badge badge-exploit">Exploit</span>' +
        '<span class="card-id">' + escapeHtml(item.id) + '</span>' +
        (item.verified ? ' <span class="verified-badge">&#10003; Verified</span>' : '') +
        '</div>' +
        '<div class="card-title"><a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">' + escapeHtml(item.title) + '</a></div>' +
        '<div class="card-description">' + escapeHtml(truncate(item.description, 200)) + '</div>' +
        '<div class="card-meta">' +
        (item.author ? '<span class="card-meta-item">By: ' + escapeHtml(item.author) + '</span>' : '') +
        (item.platform ? '<span class="card-meta-item">' + escapeHtml(item.platform) + '</span>' : '') +
        (item.date ? '<span class="card-meta-item">' + escapeHtml(item.date) + '</span>' : '') +
        '</div>';
    } else if (item.type === 'fcc') {
      html = '<div class="card-header">' +
        '<span class="card-type-badge badge-fcc">FCC</span>' +
        '<span class="card-id">' + escapeHtml(item.fcc_id) + '</span>' +
        '</div>' +
        '<div class="card-title"><a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">' + escapeHtml(item.title) + '</a></div>' +
        '<div class="card-description">' + escapeHtml(truncate(item.description, 200)) + '</div>' +
        '<div class="card-meta">' +
        (item.grantee ? '<span class="card-meta-item">' + escapeHtml(item.grantee) + '</span>' : '') +
        (item.frequency ? '<span class="card-meta-item">' + escapeHtml(item.frequency) + '</span>' : '') +
        (item.date ? '<span class="card-meta-item">' + escapeHtml(item.date) + '</span>' : '') +
        '</div>';
    } else if (item.type === 'eol') {
      html = '<div class="card-header">' +
        '<span class="card-type-badge badge-eol">EOL</span>' +
        '<span class="card-id">' + escapeHtml(item.part_number) + '</span>' +
        (item.status ? ' <span class="status-badge ' + statusClass(item.status) + '">' + escapeHtml(item.status) + '</span>' : '') +
        '</div>' +
        '<div class="card-title"><a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">' + escapeHtml(item.title) + '</a></div>' +
        '<div class="card-description">' + escapeHtml(truncate(item.description, 200)) + '</div>' +
        '<div class="card-meta">' +
        (item.manufacturer ? '<span class="card-meta-item">' + escapeHtml(item.manufacturer) + '</span>' : '') +
        (item.eol_date ? '<span class="card-meta-item">EOL: ' + escapeHtml(item.eol_date) + '</span>' : '') +
        (item.replacement ? '<span class="card-meta-item">Replace: ' + escapeHtml(item.replacement) + '</span>' : '') +
        '</div>';
    }

    card.innerHTML = html;
    return card;
  }

  function doSearch() {
    var query = input.value.trim();
    var activeTypes = getActiveTypes();

    resultsContainer.innerHTML = '';
    noResults.style.display = 'none';

    if (!query || !fuse) return;

    var results = fuse.search(query, { limit: 100 });
    var filtered = results.filter(function(r) {
      return activeTypes.indexOf(r.item.type) !== -1;
    });

    if (filtered.length === 0) {
      noResults.style.display = '';
      return;
    }

    var fragment = document.createDocumentFragment();
    filtered.forEach(function(r) {
      fragment.appendChild(renderCard(r.item));
    });
    resultsContainer.appendChild(fragment);
  }

  input.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doSearch, 200);
  });

  filters.forEach(function(cb) {
    cb.addEventListener('change', doSearch);
  });

  loadIndex();
})();
