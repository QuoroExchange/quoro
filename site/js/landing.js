/* Quoro landing: the swap component opens on a just-checked launch, then network strip, live feed, Data score,
   route, wallet, stock tokens and the final call. Every live box keeps its size while loading. */
(function () {
  var U = window.QuoroUI, F = U.fmt, API = window.QuoroAPI;
  var $ = function (id) { return document.getElementById(id); };
  if (!API) { console.info('Quoro: QuoroAPI not loaded'); return; }
  var MOCK = window.QUORO_MOCK ? '&mock' : '';
  function href(ca) { return '/app?ca=' + ca + MOCK; }
  function logo(src, sym, cls) { return '<span class="tk' + (src ? ' img' : '') + (cls ? ' ' + cls : '') + '">' + (src ? U.logoImg(src, sym) : U.esc(String(sym || '?').slice(0, 4))) + '</span>'; }
  function tier(s) { return s == null ? 'pend' : s >= 7 ? 'hi' : s >= 5 ? 'mid' : 'lo'; }

  /* ---- network strip; the block ticks locally between polls ---- */
  var P = null, t0 = 0, last = 0;
  function paintBlock() {
    if (!P) return;
    var b = P.block + (U.RM ? 0 : Math.max(0, Math.floor((Date.now() - t0) / (P.blockMs || 100))));
    if (b === last) return; last = b;
    var s = F.int(b); document.querySelectorAll('[data-pulse="block"]').forEach(function (e) { e.textContent = s; });
  }
  function loadPulse() {
    API.pulse().then(function (p) {
      P = p; t0 = Date.now(); last = 0; paintBlock();
      var v = { blockMs: p.blockMs + ' ms', tokens: F.int(p.tokens), stocks: F.int(p.stocks), flagged: p.scored ? U.tpl('{flagged} of {scored}', { flagged: F.int(p.flagged), scored: F.int(p.scored) }) : '—' };   /* pulse.flagged.value */
      for (var k in v) document.querySelectorAll('[data-pulse="' + k + '"]').forEach(function (e) { e.textContent = v[k]; });
    }).catch(function () {});
  }
  loadPulse(); setInterval(loadPulse, 15000);
  if (!U.RM) setInterval(paintBlock, 250);

  /* {time} for live labels: how long ago this page read the token */
  function since(t0) { return F.mins((Date.now() - t0) / 60000) + ' ago'; }

  /* ---- hero: address field + Check token, three examples, and the form opens on a live, clean launch ---- */
  var liveCa = null, liveT0 = 0, hc = $('heroCheck');
  function pick(ca) { if (window.QuoroPick) window.QuoroPick(ca); else location.href = href(ca); }
  if (hc) hc.addEventListener('submit', function (e) {
    var v = $('heroCa').value.trim(); if (!U.isAddr(v)) return;   /* a bad address goes to /app, which explains it */
    e.preventDefault(); pick(v);
  });
  U.tryChips($('tryChips'), pick);
  function liveLabel(on) {
    var th = document.querySelector('#tpanel .st-token .thx'), l = $('liveLbl');
    if (!th) return;
    if (!l) { l = document.createElement('p'); l.className = 'livelbl'; l.id = 'liveLbl'; l.setAttribute('data-slot', 'hero.live.label'); th.insertBefore(l, th.firstChild); }
    l.hidden = !on; if (on) l.textContent = U.tpl('Live example · {time}', { time: since(liveT0) });
  }
  document.addEventListener('quoro:token', function (e) {
    var t = e.detail || {}, live = !!liveCa && t.ca && t.ca.toLowerCase() === liveCa;
    if (live) liveT0 = Date.now();
    liveLabel(live);
  });
  setInterval(function () { var l = $('liveLbl'); if (l && !l.hidden) liveLabel(true); }, 30000);

  /* ---- Data score block: a launch with a flag (the second example), its split and its own AI line ---- */
  var scoreT0 = 0;
  function paintScore(t) {
    var sc = t.score; scoreT0 = Date.now();
    $('sScore').textContent = sc.value;
    document.querySelectorAll('#sDial path').forEach(function (p, i) { p.setAttribute('class', i === 0 ? 'tail' : i < sc.value ? 'on' : ''); });
    $('sLaunch').textContent = sc.hygiene != null ? sc.hygiene : '—'; $('sMarket').textContent = sc.market != null ? sc.market : '—';
    $('sTok').innerHTML = logo(t.logo, t.symbol, 'tkin big') + U.esc(U.nameTick(t.name, t.symbol));
    U.fillLogos($('sTok'));
    var lbl = function () { $('sLabel').textContent = U.tpl('Caught by Quoro · {time}', { time: since(scoreT0) }); $('sLabel').setAttribute('data-slot', 'score.example.label'); };
    lbl(); setInterval(lbl, 30000);
    if (API.brief) API.brief(t.ca).then(function (b) {
      if (!b || !b.text) { $('sAi').parentNode.hidden = true; return; }
      $('sAi').textContent = b.text;
      var h = $('sAiH'); if (h) { var lb = h.querySelector('b'); lb.textContent = U.tpl('Quoro AI · {time}', { time: since(Date.now()) }); lb.setAttribute('data-slot', 'ai.brief.time'); }
    }).catch(function () { $('sAi').parentNode.hidden = true; });
  }
  API.examples().then(function (ex) {
    var list = U.pickExamples(ex), clean = list.filter(function (x) { return x[1] === 'hero.try.clean'; })[0], flagged = list.filter(function (x) { return x[1] === 'hero.try.flagged'; })[0];
    var live = clean || flagged;
    var m = $('swapMount');
    if (live && window.QuoroPick && !(m && m.classList.contains('has-token'))) { liveCa = live[0].ca.toLowerCase(); window.QuoroPick(live[0].ca, { live: true }); }
    var ex2 = flagged || clean;
    if (ex2) API.token(ex2[0].ca).then(function (t) { if (t && t.kind === 'launch' && t.score) paintScore(t); }).catch(function () {});
  }).catch(function () {});

  /* ---- live feed: New / Trending, scored launches ---- */
  var feed = 'recent', fr = $('feedRows');
  function cells(n) { var o = ''; for (var i = 0; i < 10; i++) o += '<i' + (n != null && i < n ? ' class="h"' : '') + '></i>'; return '<span class="cells">' + o + '</span>'; }
  function paintFeed() {
    if (!fr || !API.launches) return;
    var my = feed;
    API.launches({ sort: feed, limit: 30 }).then(function (r) {
      if (my !== feed) return;
      var rows = ((r && r.rows) || r || []).filter(function (x) { return x.score != null; }).slice(0, 6);
      if (!rows.length) return;
      fr.innerHTML = rows.map(function (x) {
        return '<a class="frow" href="' + href(x.ca) + '">' + logo(x.logo, x.symbol) + '<span class="fn"><b>' + U.esc(x.name) + '</b><span>' + U.esc(x.symbol) + ' · ' + U.esc(U.ago(x.ageMin)) + '</span></span>' +
          cells(x.score) + '<span class="fs ' + tier(x.score) + '">' + x.score + '<small>/10</small></span></a>';
      }).join('');
    }).catch(function () {});
  }
  document.querySelectorAll('[data-feed]').forEach(function (b) {
    b.addEventListener('click', function () {
      feed = b.getAttribute('data-feed');
      document.querySelectorAll('[data-feed]').forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
      paintFeed();
    });
  });
  paintFeed(); setInterval(paintFeed, 60000);

  /* ---- route: the 17 chains you can pay from (config) ---- */
  var cg = $('chainGrid');
  if (cg && API.config) API.config().then(function (c) {
    var ch = (c && c.chains) || [];
    cg.innerHTML = ch.map(function (x) { return '<span class="chn"><img src="' + U.esc(x.logo || ('/assets/chains/' + x.key + '.svg')) + '" alt="" width="28" height="28"><span>' + U.esc(x.name) + '</span></span>'; }).join('');
  }).catch(function () {});

  /* ---- stock tokens: a calm grid, no ticker ---- */
  var sg = $('stockGrid');
  API.stocks().then(function (list) {
    list = list || []; if (!sg || !list.length) return;
    var pick = ['NVDA', 'TSLA', 'AAPL', 'SPY', 'MSFT', 'AMZN', 'META', 'GOOGL'], rows = pick.map(function (t) { return list.filter(function (s) { return s.ticker === t; })[0]; }).filter(Boolean);
    if (rows.length < 8) rows = rows.concat(list.filter(function (s) { return rows.indexOf(s) < 0; })).slice(0, 8);
    sg.innerHTML = rows.map(function (s) {
      var c = s.change24h == null ? null : Math.round(s.change24h * 10) / 10, up = c > 0;   /* under 0.05% reads as 0%, no colour */
      return '<a class="stile" href="' + href(s.ca) + '">' + logo(s.logo, s.ticker, 'dk') + '<b>' + U.esc(s.ticker) + '</b><span>' + F.usd(s.priceUsd) +
        (c != null ? ' <i class="' + (c === 0 ? '' : up ? 'up' : 'dn') + '">' + (c === 0 ? '0' : (up ? '+' : '−') + Math.abs(c)) + '%</i>' : '') + '</span></a>';
    }).join('');
  }).catch(function () {});
})();
