/* Quoro shared UI helpers. */
(function () {
  var RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* mobile menu: sheet under the header, closes on link, outside click and Esc */
  var mb = document.getElementById('mBtn'), ms = document.getElementById('mSheet');
  if (mb && ms) {
    var setM = function (o) { ms.hidden = !o; mb.setAttribute('aria-expanded', String(o)); };
    mb.addEventListener('click', function (e) { e.stopPropagation(); var o = ms.hidden; setM(o); if (o) { var f = ms.querySelector('a'); if (f) f.focus(); } });
    ms.addEventListener('click', function (e) { if (e.target.closest('a')) setM(false); });
    document.addEventListener('click', function (e) { if (!ms.hidden && !ms.contains(e.target)) setM(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !ms.hidden) { setM(false); mb.focus(); } });
  }
  /* nav: hairline once scrolled; "/" focuses the header search */
  var tn = document.getElementById('topnav');
  if (tn) { var onS = function () { tn.classList.toggle('scrolled', window.scrollY > 8); }; window.addEventListener('scroll', onS, { passive: true }); onS(); }
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || /INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
    var q = document.querySelector('.nsearch input'); if (q) { e.preventDefault(); q.focus(); }
  });

  var JUSTNOW = '<1 min'; /* copy: fmt.justnow */
  /* logo failed (CDN 404): its circle shows the ticker in text instead */
  window.quoroImgFail = function (img) { var p = img.parentNode; if (!p) return; p.classList.remove('img'); p.classList.add('txt'); p.textContent = String(img.getAttribute('data-sym') || '').slice(0, 4); };
  function logoImg(src, sym, size) { return '<img src="' + esc(src) + '" alt="" data-sym="' + esc(sym) + '"' + (size ? ' width="' + size + '" height="' + size + '"' : '') + ' loading="lazy" onerror="quoroImgFail(this)">'; }
  /* every ticker has an icon: token logo, or the ticker on a dark circle of the same size */
  function tokIco(logo, sym, cls, ca) {
    sym = String(sym || '?');
    return '<span class="tk' + (logo ? ' img' : '') + (cls ? ' ' + cls : '') + '"' + (ca && !logo ? ' data-lca="' + esc(ca) + '" data-sym="' + esc(sym) + '"' : '') + '>' + (logo ? logoImg(logo, sym) : esc(sym.slice(0, 4))) + '</span>';
  }
  /* history rows written before logos were stored: look the logo up once per token, keep it in this browser */
  var LKEY = 'quoro.logos', lmem = null, lwait = {};
  function lread() { if (lmem) return lmem; try { lmem = JSON.parse(localStorage.getItem(LKEY) || '{}') || {}; } catch (e) { lmem = {}; } return lmem; }
  function fillLogos(root) {
    if (!root || !window.QuoroAPI || !window.QuoroAPI.token) return;
    var map = lread();
    (root.querySelectorAll ? root.querySelectorAll('[data-lca]') : []).forEach(function (el) {
      var ca = String(el.getAttribute('data-lca')).toLowerCase(), sym = el.getAttribute('data-sym');
      var put = function (src) { if (!src || !el.isConnected) return; el.classList.add('img'); el.removeAttribute('data-lca'); el.innerHTML = logoImg(src, sym); };
      if (map[ca] !== undefined) return put(map[ca]);
      if (!lwait[ca]) lwait[ca] = window.QuoroAPI.token(ca).then(function (t) { map[ca] = (t && t.logo) || ''; try { localStorage.setItem(LKEY, JSON.stringify(map)); } catch (e) {} return map[ca]; }).catch(function () { return ''; });
      lwait[ca].then(put);
    });
  }
  /* Activity row tail, Recent activity: status pill only when it is not a success, then the time and ↗ to the explorer */
  var AS = { 'hero.try.clean': 'Clean launch', 'hero.try.flagged': 'Red flag', 'hero.try.stock': 'Stock token', 'app.activity.bought': 'Bought {amount} {ticker}', 'app.activity.sold': 'Sold {amount} {ticker}', 'app.activity.sold.got': 'received {amount} {coin}', 'app.activity.row': '{amount} {ticker}', 'app.activity.row.paid': 'for {amount} {coin} from {chain}', 'app.activity.quoted': '≈ {amount} {ticker}, quoted', 'time.now': 'now', 'time.m': '{n}m', 'time.h': '{n}h', 'time.d': '{n}d', 'app.activity.explorer': 'View in explorer', 'app.activity.pending': 'Pending', 'app.activity.failed': 'Failed' };
  function ago(ts) {
    var s = Math.max(0, (Date.now() - ts) / 1000), t = function (k, n) { return AS[k].replace('{n}', n); };
    if (s < 60) return t('time.now'); if (s < 3600) return t('time.m', Math.floor(s / 60)); if (s < 86400) return t('time.h', Math.floor(s / 3600));
    if (s < 7 * 86400) return t('time.d', Math.floor(s / 86400));
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function actTail(r) {
    var pill = r.status === 'failed' ? '<span class="stt failed" data-slot="app.activity.failed">Failed</span>'
      : r.status === 'done' ? '' : '<span class="stt pending" data-slot="app.activity.pending">Pending</span>';
    return '<span class="atail">' + pill + '<span class="atime">' + esc(ago(r.ts)) + '</span>' + (r.explorerUrl ? '<svg class="aext" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7m0 0H8m9 0v9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="sr" data-slot="app.activity.explorer">View in explorer</span>' : '') + '</span>';
  }
  /* Activity row text, one source for the form, the wallet panel and /portfolio. Only a finished trade shows what arrived;
 Pending and Failed show the quote as a quote. ch(key) → { name, native }. */
  function actLines(r, ch) {
    var t = function (k, v) { return tpl(AS[k], v); }, n = function (x, d) { return fmt.num(x, d); };
    var from = ch(r.from) || {}, to = ch(r.to) || {}, done = r.status === 'done';
    var amtIn = (+r.amountIn).toLocaleString('en-US', { maximumFractionDigits: 6 });
    if (r.side === 'sell') {
      var coin = r.outSymbol || to.native || 'ETH';
      return [t(done ? 'app.activity.sold' : 'app.activity.row', { amount: amtIn, ticker: r.symbol }),
        done && r.out != null ? t('app.activity.sold.got', { amount: n(r.out), coin: coin }) : !done && r.quoted != null ? t('app.activity.quoted', { amount: n(r.quoted), ticker: coin }) : (to.name || '')];
    }
    var paid = t('app.activity.row.paid', { amount: n(r.amountIn, 6), coin: from.native || 'ETH', chain: from.name || r.from || '' });
    if (done) return [r.out == null ? r.symbol : t('app.activity.bought', { amount: n(r.out), ticker: r.symbol }), paid];
    return [r.quoted != null ? t('app.activity.quoted', { amount: n(r.quoted), ticker: r.symbol }) : r.symbol, paid];
  }
  /* "Try one": three live examples from examples(): a clean launch (7+), a launch with a cap, a stock token */
  function pickExamples(ex) {
    ex = ex || [];
    var clean = ex.filter(function (e) { return e.kind === 'launch' && !e.capped && e.score >= 7; })[0];
    var flagged = ex.filter(function (e) { return e.kind === 'launch' && e.capped; })[0];
    var stock = ex.filter(function (e) { return e.kind === 'stock'; })[0];
    return [[clean, 'hero.try.clean'], [flagged, 'hero.try.flagged'], [stock, 'hero.try.stock']].filter(function (x) { return x[0]; });
  }
  function tryChips(box, onPick) {
    if (!box || !window.QuoroAPI || !window.QuoroAPI.examples) return;
    window.QuoroAPI.examples().then(function (ex) {
      var list = pickExamples(ex); if (!list.length) { box.hidden = true; return; }
      box.innerHTML = list.map(function (x) {
        var e = x[0], tier = e.score == null ? '' : e.score >= 7 ? 'hi' : e.score >= 5 ? 'mid' : 'lo';
        return '<button type="button" class="trychip" data-ca="' + esc(e.ca) + '">' + tokIco(e.logo, e.symbol, e.kind === 'stock' ? 'dk' : '', e.ca) +
          '<span class="tcl"><b data-slot="' + x[1] + '">' + esc(AS[x[1]]) + '</b><i>' + esc(e.symbol) + '</i></span>' + (e.score != null ? '<span class="spill ' + tier + '">' + e.score + '/10</span>' : '') + '</button>';
      }).join('');
      box.querySelectorAll('[data-ca]').forEach(function (b) { b.addEventListener('click', function () { onPick(b.getAttribute('data-ca')); }); });
      fillLogos(box);
    }).catch(function () { box.hidden = true; });
  }
  /* "QUADRA · QUADRA" reads once: the ticker only when it differs from the name */
  function nameTick(n, t) { return !t || String(n).toLowerCase() === String(t).toLowerCase() ? String(n || t || '') : n + ' · ' + t; }
  function actAttrs(r) { return r.explorerUrl ? 'href="' + esc(r.explorerUrl) + '" target="_blank" rel="noopener"' : ''; }
  var fmt = {
    int: function (n) { return n == null ? '—' : Math.round(n).toLocaleString('en-US'); },
    num: function (v, d) {
      if (v == null || v === '') return '—'; var n = +v; if (!isFinite(n)) return String(v);
      if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
      if (Math.abs(n) >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: d == null ? 2 : d });
      return n.toLocaleString('en-US', { maximumSignificantDigits: 4 });
    },
    usd: function (n) { if (n == null) return '—'; return '$' + (n >= 0.01 || n === 0 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toLocaleString('en-US', { maximumSignificantDigits: 3 })); }, /* $ always 2 decimals; prices under a cent keep 3 significant digits */
    fee: function (n) { if (n == null) return '—'; if (n < 0.01) return '<$0.01'; return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    pct: function (n) { return n == null ? '—' : (Math.round(n * 10) / 10) + '%'; },
    mins: function (m) { if (m == null) return '—'; if (m < 1) return JUSTNOW; if (Math.round(m) < 90) return Math.round(m) + ' min'; if (m < 2880) return Math.round(m / 60) + ' h'; return Math.round(m / 1440) + ' d'; }, /* copy fmt.justnow / fmt.min / fmt.h / fmt.d */
    short: function (a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }
  };
  /* template strings: copy-.md uses {placeholders}; fill them verbatim */
  function tpl(s, v) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? v[k] : ''; }); }
  function isAddr(s) { return /^0x[0-9a-fA-F]{40}$/.test(String(s || '').trim()); }

  /* CA forms → /app?ca= */
  document.querySelectorAll('form[data-caform]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      var v = f.querySelector('input').value.trim(), mk = window.QUORO_MOCK ? '&mock' : '';
      e.preventDefault();
      if (!v) { location.href = '/explore' + (mk ? '?mock' : ''); return; }
      /* C-n7: an address opens the buy form, anything else searches /explore */
      location.href = isAddr(v) ? '/app?ca=' + v + mk : '/explore?q=' + encodeURIComponent(v) + mk;
    });
  });

  window.QuoroUI = { nameTick: nameTick, pickExamples: pickExamples, tryChips: tryChips, actLines: actLines, actTail: actTail, actAttrs: actAttrs, tokIco: tokIco, fillLogos: fillLogos, logoImg: logoImg, ago: function (m) { return fmt.mins(m); }, RM: RM, el: el, esc: esc, fmt: fmt, tpl: tpl, isAddr: isAddr };
})();
