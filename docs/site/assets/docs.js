/* a-workbench docs — theme, nav, search, code UX, diagrams. No framework. */
(function () {
  'use strict';

  var BASE = window.__WB_BASE__ || '';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ------------------------------------------------------------ theme -- */

  var themeBtn = $('.theme-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var cur = document.documentElement.dataset.theme;
      if (!cur) cur = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('wb-theme', next); } catch (e) {}
      renderMermaid(true);
    });
  }

  /* -------------------------------------------------------- mobile nav -- */

  var menuBtn = $('.menu-btn');
  var sidebar = $('.sidebar');
  function closeNav() {
    if (!sidebar) return;
    sidebar.classList.remove('open');
    document.body.classList.remove('nav-open');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
  }
  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', function () {
      var open = sidebar.classList.toggle('open');
      document.body.classList.toggle('nav-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) {
      if (document.body.classList.contains('nav-open') &&
          !sidebar.contains(e.target) && !menuBtn.contains(e.target)) closeNav();
    });
  }

  /* --------------------------------------------------------------- copy -- */

  $$('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var code = btn.closest('.code').querySelector('code');
      navigator.clipboard.writeText(code.innerText).then(function () {
        btn.textContent = 'Copied';
        btn.classList.add('done');
        setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1600);
      });
    });
  });

  /* ------------------------------------------------- table scroll hints -- */

  $$('.table-wrap').forEach(function (wrap) {
    function sync() {
      var over = wrap.scrollWidth - wrap.clientWidth > 2;
      wrap.classList.toggle('is-scrollable', over);
      wrap.classList.toggle('at-end', over && wrap.scrollLeft >= wrap.scrollWidth - wrap.clientWidth - 2);
    }
    wrap.addEventListener('scroll', sync, { passive: true });
    addEventListener('resize', sync);
    sync();
  });

  /* ----------------------------------------------------------- copy page -- */

  var copyPage = $('.copy-page');
  if (copyPage) {
    copyPage.addEventListener('click', function () {
      var article = $('.prose');
      var label = $('span', copyPage);
      // Strip the chrome the reader did not ask for; keep the prose and code.
      var clone = article.cloneNode(true);
      $$('.anchor, .copy, .code-lang, .page-head button', clone).forEach(function (n) { n.remove(); });
      navigator.clipboard.writeText(document.title + '\n\n' + clone.innerText.replace(/\n{3,}/g, '\n\n').trim())
        .then(function () {
          label.textContent = 'Copied';
          copyPage.classList.add('done');
          setTimeout(function () { label.textContent = 'Copy page'; copyPage.classList.remove('done'); }, 1600);
        });
    });
  }

  /* --------------------------------------------------------------- tabs -- */

  $$('.tabs').forEach(function (group) {
    $$('.tab', group).forEach(function (tab) {
      tab.addEventListener('click', function () {
        var i = tab.dataset.i;
        $$('.tab', group).forEach(function (t) { t.classList.toggle('active', t === tab); });
        $$('.tab-panel', group).forEach(function (p) { p.classList.toggle('active', p.dataset.i === i); });
      });
    });
  });

  /* ----------------------------------------------------------- scrollspy -- */

  var tocLinks = $$('.toc a');
  if (tocLinks.length) {
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var targets = Object.keys(map).map(function (id) { return document.getElementById(id); }).filter(Boolean);
    var spy = new IntersectionObserver(function () {
      var best = null;
      var top = 140;
      targets.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top <= top) best = el;
      });
      if (!best && targets.length) best = targets[0];
      tocLinks.forEach(function (a) { a.classList.remove('active'); });
      if (best && map[best.id]) map[best.id].classList.add('active');
    }, { rootMargin: '-120px 0px -70% 0px', threshold: [0, 1] });
    targets.forEach(function (t) { spy.observe(t); });
    addEventListener('scroll', function () { spy.takeRecords(); }, { passive: true });
  }

  /* -------------------------------------------------------------- search -- */

  var overlay = $('.search-overlay');
  var input = overlay && $('input', overlay);
  var results = overlay && $('.search-results', overlay);
  var index = null;
  var sel = 0;

  function openSearch() {
    if (!overlay) return;
    overlay.hidden = false;
    input.value = '';
    render([]);
    input.focus();
    loadIndex();
  }
  function closeSearch() { if (overlay) overlay.hidden = true; }

  function loadIndex() {
    if (index) return Promise.resolve(index);
    return fetch(BASE + 'search-index.json')
      .then(function (r) { return r.json(); })
      .then(function (j) { index = j; return j; })
      .catch(function () { index = []; return index; });
  }

  function score(page, terms) {
    var hay = (page.t + ' ' + page.d + ' ' + page.s).toLowerCase();
    var body = page.b.toLowerCase();
    var s = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      if (page.t.toLowerCase().indexOf(t) === 0) s += 60;
      else if (hay.indexOf(t) !== -1) s += 24;
      var n = body.split(t).length - 1;
      if (!n && hay.indexOf(t) === -1) return 0;
      s += Math.min(n, 6) * 3;
      for (var h = 0; h < page.h.length; h++) {
        if (page.h[h].t.toLowerCase().indexOf(t) !== -1) { s += 14; break; }
      }
    }
    return s;
  }

  function snippet(page, terms) {
    var body = page.b;
    var low = body.toLowerCase();
    var at = -1;
    for (var i = 0; i < terms.length && at < 0; i++) at = low.indexOf(terms[i]);
    if (at < 0) return page.d || body.slice(0, 120);
    var start = Math.max(0, at - 48);
    var text = (start ? '…' : '') + body.slice(start, start + 150).trim() + '…';
    return text;
  }

  function highlight(text, terms) {
    var out = text.replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; });
    terms.forEach(function (t) {
      if (!t) return;
      out = out.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
    });
    return out;
  }

  function render(list, terms) {
    if (!results) return;
    if (!list.length) {
      results.innerHTML = '<p class="search-empty">' +
        (terms && terms.length ? 'No matches.' : 'Type to search the documentation.') + '</p>';
      return;
    }
    sel = 0;
    results.innerHTML = list.map(function (p, i) {
      return '<a class="sr' + (i === 0 ? ' sel' : '') + '" href="' + BASE + p.u + '">' +
        '<span class="sr-crumb">' + p.s + '</span>' +
        '<span class="sr-title">' + highlight(p.t, terms) + '</span>' +
        '<span class="sr-snip">' + highlight(snippet(p, terms), terms) + '</span></a>';
    }).join('');
  }

  function runSearch() {
    var q = input.value.trim().toLowerCase();
    if (!q) return render([]);
    var terms = q.split(/\s+/).filter(Boolean);
    loadIndex().then(function (idx) {
      var hits = idx.map(function (p) { return { p: p, s: score(p, terms) }; })
        .filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 8)
        .map(function (x) { return x.p; });
      render(hits, terms);
    });
  }

  if (input) {
    var t;
    input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(runSearch, 90); });
    input.addEventListener('keydown', function (e) {
      var items = $$('.sr', results);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        items[sel] && items[sel].classList.remove('sel');
        sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        items[sel].classList.add('sel');
        items[sel].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (items[sel]) { e.preventDefault(); location.href = items[sel].getAttribute('href'); }
      }
    });
  }

  $$('[data-search-open]').forEach(function (b) { b.addEventListener('click', openSearch); });
  if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) closeSearch(); });

  addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
    else if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
    else if (e.key === 'Escape') { closeSearch(); closeNav(); }
  });

  /* ------------------------------------------------- syntax highlighting -- */

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  if (document.querySelector('pre code')) {
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js')
      .then(function () {
        return Promise.all(['typescript', 'bash', 'json', 'yaml', 'sql', 'dockerfile', 'ini', 'http', 'xml']
          .map(function (l) {
            return loadScript('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/languages/' + l + '.min.js')
              .catch(function () {});
          }));
      })
      .then(function () {
        $$('pre code').forEach(function (el) {
          try { window.hljs.highlightElement(el); } catch (e) {}
        });
      })
      .catch(function () {});
  }

  /* ------------------------------------------------------------ mermaid -- */

  var mermaidLoaded = null;
  var mermaidSource = [];

  function isDark() {
    var t = document.documentElement.dataset.theme;
    if (t) return t === 'dark';
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function mermaidTheme() {
    var dark = isDark();
    return {
      startOnLoad: false,
      securityLevel: 'strict',
      fontFamily: "'Inter', system-ui, sans-serif",
      // Set through mermaid, not CSS: it measures label boxes at init.
      fontSize: 14,
      theme: 'base',
      // Diagrams are read, not decorated: give nodes room, keep edges straight
      // enough to follow, and stop labels colliding with the lines they name.
      flowchart: { curve: 'basis', nodeSpacing: 46, rankSpacing: 54, padding: 14, useMaxWidth: true },
      sequence: {
        useMaxWidth: true, actorMargin: 52, boxMargin: 12, messageMargin: 40,
        noteMargin: 12, mirrorActors: false, wrap: true,
      },
      er: { useMaxWidth: true, entityPadding: 14, minEntityWidth: 120 },
      // These mirror the CSS custom properties in docs.css and must be kept in
      // step with them by hand: mermaid measures label boxes at init, so the
      // palette cannot come from CSS variables the way the rest of the site's
      // does. Nodes take the brand tint, edges and text the neutral ramp, notes
      // the warn tint.
      themeVariables: dark ? {
        background: '#111928',       /* --surface */
        primaryColor: '#2a122e',     /* --accent-soft */
        primaryTextColor: '#f9faf8', /* --text */
        primaryBorderColor: '#d68ee4', /* brand 300 — a node outline is structure,
                                          not decoration, so it takes a step
                                          that clears 3:1 rather than the
                                          decorative --accent-line */
        secondaryColor: '#1a2433',   /* --surface-2 */
        tertiaryColor: '#111928',
        lineColor: '#8e95a3',        /* --text-3 */
        textColor: '#c6cad0',        /* --text-2 */
        mainBkg: '#2a122e',
        nodeBorder: '#d68ee4',
        clusterBkg: '#0b1018',       /* --bg */
        clusterBorder: '#2a3444',    /* --border */
        edgeLabelBackground: '#111928',
        actorBkg: '#2a122e',
        actorBorder: '#d68ee4',
        actorTextColor: '#f9faf8',
        signalColor: '#c6cad0',
        signalTextColor: '#c6cad0',
        labelBoxBkgColor: '#2a122e',
        labelBoxBorderColor: '#d68ee4',
        labelTextColor: '#f9faf8',
        loopTextColor: '#c6cad0',
        noteBkgColor: '#2a1d0a',     /* --warn-soft */
        noteBorderColor: '#543a16',  /* --warn-line */
        noteTextColor: '#f9faf8',
        sequenceNumberColor: '#0b1018',
      } : {
        background: '#ffffff',       /* --surface */
        primaryColor: '#fef3ff',     /* --accent-soft */
        primaryTextColor: '#111928', /* --text */
        primaryBorderColor: '#a642b7', /* brand 400 — see the dark theme note */
        secondaryColor: '#f9faf8',   /* --surface-2 */
        tertiaryColor: '#ffffff',
        lineColor: '#6b7280',        /* --text-3 */
        textColor: '#525c6a',        /* --text-2 */
        mainBkg: '#fef3ff',
        nodeBorder: '#a642b7',
        clusterBkg: '#f9faf8',
        clusterBorder: '#e5e7eb',    /* --border */
        edgeLabelBackground: '#ffffff',
        actorBkg: '#fef3ff',
        actorBorder: '#a642b7',
        actorTextColor: '#111928',
        signalColor: '#525c6a',
        signalTextColor: '#525c6a',
        labelBoxBkgColor: '#fef3ff',
        labelBoxBorderColor: '#a642b7',
        labelTextColor: '#111928',
        loopTextColor: '#525c6a',
        noteBkgColor: '#fdf4e9',     /* --warn-soft */
        noteBorderColor: '#f6d9ac',  /* --warn-line */
        noteTextColor: '#111928',
        sequenceNumberColor: '#ffffff',
      },
    };
  }

  function renderMermaid(rerender) {
    var blocks = $$('.mermaid');
    if (!blocks.length) return;
    if (!mermaidSource.length) blocks.forEach(function (b) { mermaidSource.push(b.textContent); });
    if (rerender) {
      blocks.forEach(function (b, i) {
        b.removeAttribute('data-processed');
        b.innerHTML = '';
        b.textContent = mermaidSource[i];
      });
    }
    if (!mermaidLoaded) {
      mermaidLoaded = import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs')
        .then(function (m) { window.__mermaid = m.default; return m.default; });
    }
    // Mermaid measures every label box at render time. If the webfont has not
    // arrived yet it measures in the fallback and renders in Inter,
    // and every edge label ends up clipped. Wait for the font first.
    var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.all([mermaidLoaded, fonts]).then(function (r) {
      var mermaid = r[0];
      mermaid.initialize(mermaidTheme());
      return mermaid.run({ nodes: $$('.mermaid') });
    }).catch(function () {});
  }

  renderMermaid(false);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if (!document.documentElement.dataset.theme) renderMermaid(true);
  });
})();
