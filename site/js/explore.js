/* Quoro explore: table of Robinhood Chain tokens with their Data score. Row → /app?ca=. */
(function () {
  var U = window.QuoroUI, F = U.fmt, API = window.QuoroAPI;
  var $ = function (id) { return document.getElementById(id); };
  var box = $('xrows'), q = $('xq'), sort = 'all', rows = [], seq = 0, PAGE = 50, shown = PAGE, lastKey = '';
  /* 50 rows at a time: the rest come with "Show more" (the list is already loaded, so nothing waits on the network) */
  var more = document.createElement('button'); more.type = 'button'; more.className = 'btn btn-ghost xmore'; more.id = 'xmore'; more.hidden = true;
  more.setAttribute('data-slot', 'explore.more'); more.textContent = 'Show more';
  box.parentNode.insertBefore(more, box.nextSibling);
  more.addEventListener('click', function () { shown += PAGE; paint(); });
  var qm = location.search.match(/[?&]q=([^&]*)/); if (qm) try { q.value = decodeURIComponent(qm[1].replace(/\+/g, ' ')); } catch (e) {}
  var tm = location.search.match(/[?&]tab=(all|trending|recent|stocks)\b/); if (tm) sort = tm[1];
  var S = {
    'explore.loading': 'Loading tokens…', 'explore.none': 'No tokens to show yet. Check back in a minute.', 'explore.empty': 'No tokens match your search.', 'explore.empty.hint': 'Paste the full address to check any token.',
    'explore.error': 'Couldn’t load tokens. Try again in a moment.', 'explore.score.pending': 'Still scoring. Back in about a minute.'
  };
  function usd(n) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n), u = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (var i = 0; i < u.length; i++) if (a >= u[i][0]) return '$' + (n / u[i][0]).toFixed(a / u[i][0] >= 100 ? 0 : 1).replace(/\.0$/, '') + u[i][1];
    return '$' + Math.round(n);
  }
  function chg(n) { if (n == null || !isFinite(n)) return '<span class="chgv">—</span>'; return '<span class="chgv ' + (n >= 0 ? 'up' : 'dn') + '">' + (n >= 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(n * 10) / 10) + '%</span>'; }
  function skel() { var h = ''; for (var i = 0; i < 10; i++) h += '<div class="xr sk"><div></div><div></div><div class="c-mcap"></div><div class="c-1h"></div><div class="c-24h"></div><div class="c-vol"></div><div></div><div class="c-age"></div></div>'; box.innerHTML = h; }
  function msg(k, hint, link) { box.innerHTML = '<div class="xmsg"><b data-slot="' + k + '">' + U.esc(S[k]) + '</b>' + (hint ? (link ? '<a href="' + link + '" data-slot="' + hint + '">' + U.esc(S[hint]) + '</a>' : '<span data-slot="' + hint + '">' + U.esc(S[hint]) + '</span>') : '') + '</div>'; }
  function paint() {
    var f = (q.value || '').trim().toLowerCase();
    if (U.isAddr(f) && !rows.some(function (r) { return r.ca.toLowerCase() === f; })) return msg('explore.empty', 'explore.empty.hint', '/app?ca=' + f + (window.QUORO_MOCK ? '&mock' : ''));
    var list = !f ? rows : rows.filter(function (r) { return (r.symbol + ' ' + r.name + ' ' + r.ca).toLowerCase().indexOf(f) > -1; });
    more.hidden = true;
    if (!list.length) return f ? msg('explore.empty', 'explore.empty.hint') : msg('explore.none');
    var key = sort + '|' + f; if (key !== lastKey) { lastKey = key; shown = PAGE; }
    more.hidden = list.length <= shown; list = list.slice(0, shown);
    if (sort === 'stocks') {
      box.innerHTML = list.map(function (r, i) {
        return '<a class="xr xs" href="/app?ca=' + r.ca + (window.QUORO_MOCK ? '&mock' : '') + '"><span class="rk">' + (i + 1) + '</span><span class="tok"><span class="tk img">' + U.logoImg(r.logo, r.symbol) + '</span><b>' + U.esc(r.name) + '<i>' + U.esc(r.symbol) + '</i></b></span><span class="num">' + F.usd(r.priceUsd) + '</span><span class="num">' + chg(r.change24h) + '</span></a>';
      }).join('');
      return;
    }
    box.innerHTML = list.map(function (r, i) {
      var ico = r.logo ? '<span class="tk img">' + U.logoImg(r.logo, r.symbol) + '</span>' : '<span class="tk">' + U.esc(r.symbol.slice(0, 4)) + '</span>';
      var sc = r.score == null ? '<span class="spill pend" title="' + U.esc(S['explore.score.pending']) + '">—</span>' : '<span class="spill' + (r.score >= 7 ? '' : r.score >= 5 ? ' mid' : ' lo') + '">' + r.score + '/10</span>';
      return '<a class="xr" href="/app?ca=' + r.ca + (window.QUORO_MOCK ? '&mock' : '') + '"><span class="rk">' + (i + 1) + '</span><span class="tok">' + ico + '<b>' + U.esc(r.name) + '<i>' + U.esc(r.symbol) + '</i></b></span>' +
        '<span class="num c-mcap">' + usd(r.mcapUsd) + '</span><span class="num c-1h">' + chg(r.change1h) + '</span><span class="num c-24h">' + chg(r.change24h) + '</span><span class="num c-vol">' + usd(r.vol24hUsd) + '</span>' +
        '<span class="scc">' + sc + '</span><span class="num c-age">' + U.ago(r.ageMin) + '</span></a>';
    }).join('');
  }
  var stocksP = null;
  function stocksList() {
    if (!stocksP) stocksP = API.stocks().then(function (l) { return (l || []).map(function (x) { return { ca: x.ca, symbol: x.ticker, name: x.name, logo: x.logo, priceUsd: x.priceUsd, change24h: x.change24h }; }); }).catch(function (e) { stocksP = null; throw e; });
    return stocksP;
  }
  function match(list, f) { return list.filter(function (r) { return (r.symbol + ' ' + r.name + ' ' + r.ca).toLowerCase().indexOf(f) > -1; }); }
  function setTab(t) { sort = t; try { var u = new URL(location.href); u.searchParams.set('tab', t); var v = (q.value || '').trim(); if (v) u.searchParams.set('q', v); else u.searchParams.delete('q'); history.replaceState(null, '', u.pathname + u.search); } catch (e) {} }
  function load(first) {
    var my = ++seq; if (first) skel();
    if (!API || !API.launches) return msg('explore.error');
    modeUI();
    var src = sort === 'stocks' ? stocksList() : API.launches({ sort: sort, limit: 300 }).then(function (r) { return (r && r.rows) || r || []; });
    src.then(function (r) {
      if (my !== seq) return; rows = r;
      /* N-2: a name or ticker that only matches a stock token opens the Stock tokens tab */
      var f = (q.value || '').trim().toLowerCase();
      if (f && !U.isAddr(f) && sort !== 'stocks' && !match(rows, f).length) {
        return stocksList().then(function (st) { if (my !== seq) return; if (match(st, f).length) { setTab('stocks'); rows = st; modeUI(); } paint(); }).catch(function () { paint(); });
      }
      paint();
    }).catch(function () { if (my === seq && first) msg('explore.error'); });
  }
  function modeUI() {
    var st = sort === 'stocks';
    document.querySelector('.xr.xl').hidden = st; document.querySelector('.xr.xs').hidden = !st; $('xnote').hidden = !st;
    document.querySelectorAll('.xtabs [data-sort]').forEach(function (x) { var on = x.getAttribute('data-sort') === sort; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); });
  }
  document.querySelectorAll('.xtabs [data-sort]').forEach(function (b) {
    b.addEventListener('click', function () {
      setTab(b.getAttribute('data-sort')); load(true);
    });
  });
  var qt = 0;
  q.addEventListener('input', function () {
    if (rows.length) paint();
    clearTimeout(qt); qt = setTimeout(function () { var f = (q.value || '').trim().toLowerCase(); if (f && sort !== 'stocks' && !U.isAddr(f) && !match(rows, f).length) load(false); else setTab(sort); }, 350);
  });
  load(true); setInterval(function () { load(false); }, 60000);

  /* footer block */
  if (API) {
    var P = null, t0 = 0;
    var tick = function () { if (!P) return; var b = P.block + (U.RM ? 0 : Math.floor((Date.now() - t0) / (P.blockMs || 100))); document.querySelectorAll('[data-pulse="block"]').forEach(function (e) { e.textContent = F.int(b); }); };
    var lp = function () { API.pulse().then(function (p) { P = p; t0 = Date.now(); tick(); }).catch(function () {}); };
    lp(); setInterval(lp, 30000); if (!U.RM) setInterval(tick, 500);
  }
})();
