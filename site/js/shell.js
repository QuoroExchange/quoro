/* Quoro shell, every page: live header search, wallet pill and panel. */
(function () {
  var U = window.QuoroUI, F = U.fmt, API = window.QuoroAPI, W = window.QuoroWallet;
  var S = {
    'search.loading': 'Searching…', 'search.section.tokens': 'Tokens', 'search.stocks': 'Stock tokens', 'search.address': 'Check {short}', 'search.checking': 'Checking {short}…', 'wallet.loading': 'Loading balances…',
    'search.empty': 'No tokens match “{q}”.', 'search.noresults.hint': 'Paste a full address to check any token.',
    'search.error': 'Search isn’t available. Try again soon.', 'search.all': 'See all results', 'trending.buy': 'Buy', 'trending.score.pending': 'Scoring…',
    'score.f.dev': 'Dev share', 'score.f.buyers': 'Buyers and sellers', 'score.f.curve': 'Curve filled', 'score.f.fresh': 'Last trade', 'app.other.supply': 'Supply',
    'app.state.notfound': 'No token at this address on Robinhood Chain.', 'app.state.notatoken': 'This address is a contract on Robinhood Chain, but not a token.',
    'wallet.copy': 'Copy address', 'wallet.copied': 'Copied', 'wallet.total': 'On Robinhood Chain', 'wallet.portfolio': 'Portfolio', 'wallet.signout': 'Disconnect',
    'wallet.recent': 'Recent activity', 'wallet.viewall': 'View all', 'wallet.recent.empty': 'No buys yet.',
    'ai.brief.label': 'Quoro AI', 'app.activity.row': '{amount} {ticker}', 'app.activity.bought': 'Bought {amount} {ticker}', 'app.activity.sold': 'Sold {amount} {ticker}', 'app.activity.sold.got': 'received {amount} {coin}', 'app.activity.row.paid': 'for {amount} {coin} from {chain}', 'app.activity.done': 'Done', 'app.activity.pending': 'Pending', 'app.activity.failed': 'Failed'
  };
  var T = function (k, v) { return U.tpl(S[k], v || {}); };
  var esc = U.esc, MOCK = window.QUORO_MOCK ? '&mock' : '';
  var ON_FORM = !!document.getElementById('swapMount');

  /* ---------- identicon: 5×5 mirrored blocks from the address, lime/teal/violet palette ---------- */
  function identicon(addr, size) {
    /* a soft two-hue orb from the address (account avatar), stable per wallet */
    var a = String(addr || '').toLowerCase().replace(/^0x/, ''), h1 = parseInt(a.slice(0, 6) || '0', 16) % 360, h2 = (h1 + 40 + parseInt(a.slice(6, 8) || '0', 16) % 140) % 360;
    var cx = 30 + parseInt(a.charAt(8) || '0', 16) * 2.5, cy = 25 + parseInt(a.charAt(9) || '0', 16) * 2.5, id = 'g' + a.slice(0, 8);
    return '<svg class="idc" width="' + size + '" height="' + size + '" viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="' + id + '" cx="' + cx + '%" cy="' + cy + '%" r="80%"><stop offset="0" stop-color="hsl(' + h1 + ',90%,70%)"/><stop offset=".55" stop-color="hsl(' + h2 + ',75%,52%)"/><stop offset="1" stop-color="hsl(' + h2 + ',70%,28%)"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#' + id + ')"/></svg>';
  }
  U.identicon = identicon;

  /* ---------- live search ---------- */
  var form = document.querySelector('.topnav .nsearch'), input = form && form.querySelector('input');
  if (form && input) {
    var panel = document.createElement('div'); panel.className = 'spanel'; panel.id = 'searchPanel'; panel.hidden = true; panel.setAttribute('role', 'listbox');
    form.appendChild(panel); input.setAttribute('aria-controls', 'searchPanel'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'false');
    var timer = 0, seq = 0, items = [], active = -1;
    var open = function (h) { panel.innerHTML = h; panel.hidden = false; input.setAttribute('aria-expanded', 'true'); form.classList.add('open'); };
    var close = function () { panel.hidden = true; input.setAttribute('aria-expanded', 'false'); form.classList.remove('open'); active = -1; };
    var logo = function (r) { return '<span class="tk' + (r.logo ? ' img' + (r.kind === 'stock' ? ' dk' : '') : '') + '">' + (r.logo ? U.logoImg(r.logo, r.symbol) : esc(String(r.symbol || '?').slice(0, 4))) + '</span>'; };
    var pill = function (s) { return s == null ? '<span class="spill pend" data-slot="trending.score.pending">Scoring…</span>' : '<span class="spill ' + (s >= 7 ? 'hi' : s >= 5 ? 'mid' : 'lo') + '">' + s + '/10</span>'; };
    var compact = function (n) { if (n == null) return ''; var a = Math.abs(n); if (a >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B'; if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'; if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'; return '$' + Math.round(n); };
    var row = function (r, i) {
      var val = r.kind === 'stock' ? F.usd(r.priceUsd) : r.mcapUsd != null ? compact(r.mcapUsd) : r.priceUsd != null ? F.usd(r.priceUsd) : '';
      return '<a class="srow" role="option" id="sr' + i + '" data-i="' + i + '" href="/app?ca=' + r.ca + MOCK + '">' + logo(r) + '<span class="sn"><b>' + esc(r.name) + '</b><i>' + esc(r.symbol) + '</i></span><span class="sv">' + esc(val) + '</span>' + (r.kind === 'stock' ? '' : pill(r.score)) + '</a>';
    };
    var paint = function (q, res) {
      items = res; active = -1;
      if (!res.length) return open('<div class="smsg"><b data-slot="search.empty">' + esc(T('search.empty', { q: q })) + '</b><span data-slot="search.noresults.hint">Paste a full address to check any token.</span></div>');
      var tk = [], st = [];
      res.forEach(function (r, i) { (r.kind === 'stock' ? st : tk).push(row(r, i)); });
      open((tk.length ? '<div class="sphd" data-slot="search.section.tokens">' + esc(S['search.section.tokens']) + '</div>' + tk.join('') : '') +
        (st.length ? '<div class="sphd" data-slot="search.stocks">' + esc(S['search.stocks']) + '</div>' + st.join('') : '') +
        '<a class="sall" href="/explore?q=' + encodeURIComponent(q) + MOCK + '" data-slot="search.all">' + esc(S['search.all']) + ' →</a>');
    };
    var card = function (t, bf) {
      items = [t]; active = 0;
      var f = t.facts || {}, sc = t.score, facts = [];
      if (t.kind === 'launch') facts = [['score.f.dev', f.devPct == null ? '—' : F.pct(f.devPct)], ['score.f.buyers', F.int(f.buyers) + ' / ' + F.int(f.sellers)], ['score.f.curve', F.pct(t.curvePct)], ['score.f.fresh', F.mins(f.lastTradeMin)]];
      else if (t.kind === 'other') facts = [['app.other.supply', t.supply ? F.num(t.supply) : '—']];
      var cells = ''; if (sc) for (var i = 0; i < 10; i++) cells += '<i' + (i < sc.value ? ' class="h"' : '') + '></i>';
      open('<div class="scard"><div class="sch">' + logo(t) + '<span class="sn"><b>' + esc(t.name) + '</b><i>' + esc(t.symbol) + ' · ' + esc(F.short(t.ca)) + '</i></span>' +
        (sc ? '<span class="scs">' + sc.value + '<small>/10</small></span>' : t.priceUsd != null ? '<span class="scs sm">' + F.usd(t.priceUsd) + '</span>' : '') + '</div>' +
        (sc ? '<div class="cells10">' + cells + '</div>' : '') +
        (facts.length ? '<div class="sfacts">' + facts.map(function (x) { return '<div><span data-slot="' + x[0] + '">' + esc(S[x[0]]) + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div>' : '') +
        (t.kind === 'launch' && bf && !(bf.done && !bf.text) ? '<div class="sbrief' + (bf.text ? '' : ' loading') + '" id="sBrief"><span class="aib-h"><svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z"/></svg><b data-slot="ai.brief.label">Quoro AI</b></span><p>' + (bf.text ? esc(bf.text) : '<span class="skl w100"></span>') + '</p></div>' : '') +
        '<a class="btn btn-lime sbuy" id="sr0" data-i="0" href="/app?ca=' + t.ca + MOCK + '" data-slot="trending.buy">' + esc(S['trending.buy']) + '</a></div>');
    };
    var run = function () {
      var q = input.value.trim(), my = ++seq;
      if (!q) return close();
      if (U.isAddr(q)) {
        open('<div class="smsg"><span class="spin"></span><span data-slot="search.checking">' + esc(T('search.checking', { short: F.short(q) })) + '</span></div>');
        var bf = { done: false, text: '' };
        if (API.brief) API.brief(q).then(function (b) { bf.text = (b && b.text) || ''; }).catch(function () {}).then(function () {
          bf.done = true; if (my !== seq) return;
          var el = document.getElementById('sBrief'); if (!el) return;
          if (!bf.text) { el.remove(); return; }
          el.classList.remove('loading'); el.querySelector('p').textContent = bf.text;
        }); else bf.done = true;
        API.token(q).then(function (t) { if (my === seq) card(t, bf); }).catch(function (e) {
          if (my !== seq) return;
          open('<div class="smsg"><b>' + esc(e && e.code === 'not_a_token' ? S['app.state.notatoken'] : e && e.code === 'not_found' ? S['app.state.notfound'] : S['search.error']) + '</b></div>');
        });
        return;
      }
      open('<div class="smsg"><span class="spin"></span><span data-slot="search.loading">' + esc(S['search.loading']) + '</span></div>');
      API.search(q).then(function (r) { if (my === seq) paint(q, (r && r.results) || []); }).catch(function () { if (my === seq) open('<div class="smsg"><b data-slot="search.error">' + esc(S['search.error']) + '</b></div>'); });
    };
    var pick = function (r) {
      if (!r) return;
      close(); input.blur();
      if (ON_FORM && window.QuoroPick) { input.value = ''; window.QuoroPick(r.ca); return; }
      location.href = '/app?ca=' + r.ca + MOCK;
    };
    var mark = function (i) {
      var els = panel.querySelectorAll('[data-i]'); if (!els.length) return;
      active = (i + els.length) % els.length;
      els.forEach(function (e, k) { e.classList.toggle('on', k === active); });
      input.setAttribute('aria-activedescendant', els[active].id); els[active].scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, U.isAddr(input.value.trim()) ? 0 : 200); });
    input.addEventListener('focus', function () { if (input.value.trim() && panel.hidden) run(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mark(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mark(active < 0 ? -1 : active - 1); }   // nothing marked yet: the last row
      else if (e.key === 'Escape') { close(); input.blur(); }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); }
    });
    var go = function () {
      var q = input.value.trim(); if (!q) return;
      /* Enter takes the row highlighted with the arrows (DOM order ≠ API order) */
      var hl = active >= 0 ? panel.querySelectorAll('[data-i]')[active] : null;
      if (hl && items[+hl.getAttribute('data-i')]) return pick(items[+hl.getAttribute('data-i')]);
      if (U.isAddr(q)) return pick({ ca: q });
      location.href = '/explore?q=' + encodeURIComponent(q) + MOCK;
    };
    form.addEventListener('submit', function (e) { e.preventDefault(); e.stopImmediatePropagation(); go(); }, true);
    panel.addEventListener('click', function (e) {
      var a = e.target.closest('[data-i]'); if (!a) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault(); pick(items[+a.getAttribute('data-i')]);
    });
    document.addEventListener('click', function (e) { if (!form.contains(e.target)) close(); });
  }

  /* ---------- wallet pill + panel ---------- */
  var signBtn = document.getElementById('navSignIn'), acct = document.getElementById('navAcct');
  if (!signBtn || !acct || !W) return;
  var wp = document.createElement('div'); wp.className = 'wpanel'; wp.id = 'walletPanel'; wp.hidden = true; acct.parentNode.appendChild(wp);
  acct.setAttribute('aria-haspopup', 'dialog'); acct.setAttribute('aria-expanded', 'false'); acct.setAttribute('aria-controls', 'walletPanel');
  signBtn.addEventListener('click', function () { W.signIn(); });
  var addr = null, total = null;
  var CHN = {}; if (API && API.config) API.config().then(function (c) { (c && c.chains || []).forEach(function (x) { CHN[x.key] = x; }); }).catch(function () {});
  function loadTotal() {
    if (!addr || !API || !API.portfolio) return;
    var extra = ((W.history && W.history()) || []).map(function (r) { return r.ca; }).filter(U.isAddr);
    API.portfolio(addr, extra).then(function (p) { total = p ? p.totalUsd : null; if (!wp.hidden) paintPanel(); }).catch(function () {});
  }
  function paintPanel() {
    var rows = ((W.history && W.history()) || []).slice(0, 3);
    wp.innerHTML = '<div class="wph">' + identicon(addr, 44) + '<div class="wpa"><b>' + esc(F.short(addr)) + '</b><button type="button" class="wcopy" id="wCopy" data-slot="wallet.copy">' + esc(S['wallet.copy']) + '</button></div></div>' +
      '<div class="wpt"><span data-slot="wallet.total">' + esc(S['wallet.total']) + '</span><b>' + (total == null ? '<span class="wload" data-slot="wallet.loading">' + esc(S['wallet.loading']) + '</span>' : esc(F.usd(total))) + '</b></div>' +
      '<div class="wpb"><a class="btn btn-ghost" href="/portfolio' + (MOCK ? '?mock' : '') + '" data-slot="wallet.portfolio">' + esc(S['wallet.portfolio']) + '</a><button type="button" class="btn btn-ghost" id="wOut" data-slot="wallet.signout">Disconnect</button></div>' +
      '<div class="wpr"><div class="wprh"><b data-slot="wallet.recent">' + esc(S['wallet.recent']) + '</b><a href="/portfolio' + (MOCK ? '?mock' : '') + '#activity" data-slot="wallet.viewall">' + esc(S['wallet.viewall']) + '</a></div>' +
      (rows.length ? rows.map(function (r) {
        var L; return '<a class="wrow" ' + U.actAttrs(r) + '>' + U.tokIco(r.logo, r.symbol, '', r.ca) + '<span class="sn"><b>' + U.esc((L = U.actLines(r, function (k) { return CHN[k] || null; }))[0]) + '</b><i>' + U.esc(L[1]) + '</i></span>' + U.actTail(r) + '</a>';
      }).join('') : '<p class="wpe" data-slot="wallet.recent.empty">' + esc(S['wallet.recent.empty']) + '</p>') + '</div>';
    U.fillLogos(wp);
    document.getElementById('wCopy').onclick = function () {
      var b = this, ok = function () { b.textContent = S['wallet.copied']; b.setAttribute('data-slot', 'wallet.copied'); setTimeout(function () { b.textContent = S['wallet.copy']; b.setAttribute('data-slot', 'wallet.copy'); }, 1400); };
      /* «Copied» only when the clipboard really took it */
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(addr).then(ok, function () {}); } catch (e) {}
    };
    document.getElementById('wOut').onclick = function () { setPanel(false); W.signOut(); };
  }
  function setPanel(o) { if (o) paintPanel(); wp.hidden = !o; acct.setAttribute('aria-expanded', String(o)); if (o) loadTotal(); }
  acct.addEventListener('click', function (e) { e.stopPropagation(); setPanel(wp.hidden); });
  document.addEventListener('click', function (e) { if (!wp.hidden && !wp.contains(e.target)) setPanel(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !wp.hidden) { setPanel(false); acct.focus(); } });
  W.onChange(function (ws) {
    var s = ws.status === 'in';
    signBtn.hidden = s; acct.hidden = !s; signBtn.disabled = ws.status === 'loading';
    if (s && ws.address !== addr) { addr = ws.address; total = null; acct.innerHTML = identicon(addr, 26) + '<span>' + esc(F.short(addr)) + '</span>'; loadTotal(); }
    if (!s) { addr = null; total = null; setPanel(false); }
    document.querySelectorAll('[data-when="in"]').forEach(function (e) { e.hidden = !s; });
  });
})();
