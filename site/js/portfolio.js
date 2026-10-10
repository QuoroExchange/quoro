/* Quoro portfolio: assets on Robinhood Chain, with an Activity tab. No value chart: there is no history to draw. */
(function () {
  var U = window.QuoroUI, F = U.fmt, API = window.QuoroAPI, W = window.QuoroWallet;
  var $ = function (id) { return document.getElementById(id); }, esc = U.esc, MOCK = window.QUORO_MOCK ? '&mock' : '';
  var S = {
    'portfolio.loading': 'Reading your wallet…', 'portfolio.error': 'Couldn’t read your wallet. Try again soon.',
    'portfolio.empty.title': 'No tokens here yet', 'portfolio.empty.body': 'This wallet holds no tokens on Robinhood Chain yet.', 'portfolio.empty.cta': 'Find a token',
    'portfolio.price.unknown': '—', 'portfolio.price.unknown.hint': 'No price yet.', 'portfolio.hidden': '{n} small or unverified tokens hidden', 'portfolio.hidden.one': '1 small or unverified token hidden',
    'trending.score.pending': 'Scoring…', 'portfolio.sell': 'Sell', 'app.activity.bought': 'Bought {amount} {ticker}', 'app.activity.sold': 'Sold {amount} {ticker}', 'app.activity.sold.got': 'received {amount} {coin}',
    'app.activity.empty': 'No buys yet.', 'app.activity.empty.sub': 'Tokens you buy with Quoro show up here.',
    'app.activity.row': '{amount} {ticker}', 'app.activity.row.paid': 'for {amount} {coin} from {chain}',
    'app.activity.done': 'Done', 'app.activity.pending': 'Pending', 'app.activity.failed': 'Failed'
  };
  var T = function (k, v) { return U.tpl(S[k], v || {}); };
  var CH = {}; if (API && API.config) API.config().then(function (c) { (c && c.chains || []).forEach(function (x) { CH[x.key] = x; }); if (!$('pfAct').hidden) paintAct(); }).catch(function () {});

  var addr = null, seq = 0;
  function skel() { var h = ''; for (var i = 0; i < 4; i++) h += '<div class="xr pfr sk"><div></div><div></div><div></div><div></div><div></div></div>'; $('pfRows').innerHTML = h; }
  function msg(b, sub, cta) { $('pfRows').innerHTML = '<div class="xmsg"><b>' + b + '</b>' + (sub || '') + (cta || '') + '</div>'; }
  function amt(n) { n = +n; if (!isFinite(n)) return '—'; if (n > 0 && n < 0.0001) return '<0.0001'; return n.toLocaleString('en-US', { maximumFractionDigits: n >= 1 ? 2 : 6, maximumSignificantDigits: n >= 1 ? undefined : 4 }); }
  function load() {
    var my = ++seq; skel(); $('pfTotal').innerHTML = '<span class="skv"></span>'; $('pfHidden').hidden = true;
    var extra = ((W && W.history && W.history()) || []).map(function (r) { return r.ca; }).filter(U.isAddr);
    API.portfolio(addr, extra).then(function (p) {
      if (my !== seq) return;
      var items = (p && p.items) || [];
      $('pfTotal').textContent = F.usd(p && p.totalUsd != null ? p.totalUsd : 0);
      var n = +(p && p.hidden) || 0, hk = n === 1 && S['portfolio.hidden.one'] ? 'portfolio.hidden.one' : 'portfolio.hidden';
      if (n > 0 && S[hk]) { $('pfHidden').textContent = T(hk, { n: n }); $('pfHidden').setAttribute('data-slot', hk); $('pfHidden').hidden = false; }
      if (!items.length) return msg('<span data-slot="portfolio.empty.title">' + esc(S['portfolio.empty.title']) + '</span>', '<span data-slot="portfolio.empty.body">' + esc(S['portfolio.empty.body']) + '</span>', '<a class="btn btn-lime" href="/explore' + (MOCK ? '?mock' : '') + '" data-slot="portfolio.empty.cta">' + esc(S['portfolio.empty.cta']) + '</a>');
      $('pfRows').innerHTML = items.map(function (r) {
        var sym = r.symbol || (r.ca ? F.short(r.ca) : '—'), nm = r.name || sym; /* no symbol → short address */
        var ico = r.logo ? '<span class="tk img' + (r.kind === 'stock' ? ' dk' : '') + '">' + U.logoImg(r.logo, sym) + '</span>' : '<span class="tk">' + esc(String(r.symbol || '?').slice(0, 4)) + '</span>';
        var price = r.priceUsd == null ? '<span title="' + esc(S['portfolio.price.unknown.hint']) + '" data-slot="portfolio.price.unknown">' + esc(S['portfolio.price.unknown']) + '</span>' : esc(F.usd(r.priceUsd));
        var sc = r.kind === 'launch' ? (r.score == null ? '<span class="spill pend" data-slot="trending.score.pending">Scoring…</span>' : '<span class="spill">' + r.score + '/10</span>') : '';
        var tag = 'div', href = r.ca ? ' data-href="/app?ca=' + r.ca + MOCK + '" tabindex="0" role="link"' : '';
        return '<' + tag + ' class="xr pfr"' + href + '><span class="tok">' + ico + '<b>' + esc(nm) + '<i>' + esc(sym) + '</i></b></span><span class="num c-price">' + price + '</span><span class="num">' + esc(amt(r.amount)) + '</span><span class="num pfv">' + (r.valueUsd == null ? '—' : esc(F.usd(r.valueUsd))) + '</span><span class="scc">' + sc + '</span>' + (r.ca && r.kind !== 'native' ? '<a class="btn btn-ghost pfsell" href="/app?ca=' + r.ca + '&sell' + MOCK + '" data-slot="portfolio.sell">' + esc(S['portfolio.sell']) + '</a>' : '<span></span>') + '</' + tag + '>';
      }).join('');
    }).catch(function () { if (my === seq) { $('pfTotal').textContent = '—'; msg('<span data-slot="portfolio.error">' + esc(S['portfolio.error']) + '</span>'); } });
  }
  $('pfRows').addEventListener('click', function (e) { if (e.target.closest('a')) return; var r = e.target.closest('[data-href]'); if (r) location.href = r.getAttribute('data-href'); });
  $('pfRows').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('[data-href]')) location.href = e.target.getAttribute('data-href'); });
  function paintAct() {
    var rows = (W && W.history && W.history()) || [], box = $('pfActList');
    if (!rows.length) { box.innerHTML = '<div class="actempty"><b data-slot="app.activity.empty">' + esc(S['app.activity.empty']) + '</b><p data-slot="app.activity.empty.sub">Tokens you buy with Quoro show up here.</p></div>'; return; }
    box.innerHTML = rows.map(function (r) {
      var c = CH[r.from] || { name: r.from, native: 'ETH' };
      var L; return '<a class="actrow" ' + U.actAttrs(r) + '>' + U.tokIco(r.logo, r.symbol, '', r.ca) + '<span><b>' + U.esc((L = U.actLines(r, function (k) { return CH[k] ? { name: CH[k].name, native: CH[k].native } : null; }))[0]) + '</b><i>' + U.esc(L[1]) + '</i></span>' + U.actTail(r) + '</a>';
    }).join('');
    U.fillLogos(box);
  }
  function tab(t) {
    document.querySelectorAll('.pftabs [data-tab]').forEach(function (b) { var on = b.getAttribute('data-tab') === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    $('pfTokens').hidden = t !== 'tokens'; $('pfAct').hidden = t !== 'activity'; if (t === 'activity') paintAct();
    try { history.replaceState(null, '', location.pathname + location.search + (t === 'activity' ? '#activity' : '')); } catch (e) {}
  }
  document.querySelectorAll('.pftabs [data-tab]').forEach(function (b) { b.addEventListener('click', function () { tab(b.getAttribute('data-tab')); }); });
  if (location.hash === '#activity') tab('activity');
  window.addEventListener('hashchange', function () { if (location.hash === '#activity') tab('activity'); });
  $('pfSign').addEventListener('click', function () { W && W.signIn(); });

  function onW(ws) {
    var s = ws.status === 'in', wait = ws.status === 'loading';
    $('pfOut').hidden = s || wait; $('pfIn').hidden = !(s || wait);
    if (s && ws.address !== addr) { addr = ws.address; $('pfAv').innerHTML = U.identicon ? U.identicon(addr, 56) : ''; $('pfAddr').textContent = F.short(addr); load(); if (!$('pfAct').hidden) paintAct(); }
    if (!s && !wait) addr = null;
  }
  if (W) W.onChange(onW); else { $('pfOut').hidden = false; $('pfIn').hidden = true; }

  if (API) API.pulse().then(function (p) { document.querySelectorAll('[data-pulse="block"]').forEach(function (e) { e.textContent = F.int(p.block); }); }).catch(function () {});
})();
