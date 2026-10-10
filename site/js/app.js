/* Quoro swap component logic: token check, quotes, Review, buy and sell. Talks only to window.QuoroAPI and window.QuoroWallet. */
(function () {
  var U = window.QuoroUI, F = U.fmt, API = window.QuoroAPI, W = window.QuoroWallet;
  var $ = function (id) { return document.getElementById(id); };
  var mount = $('swapMount'); if (!mount || !window.QUORO_SWAP_TPL) return;
  var LAYOUT = mount.getAttribute('data-layout') || 'app';
  mount.innerHTML = window.QUORO_SWAP_TPL; mount.classList.add('swapc', 'lay-' + LAYOUT); if (/[?&]sell\b/.test(location.search)) mount.classList.add('selling'); /* before the first paint */
  /* dialogs live on <body>, outside the hero's stacking context, so nothing on the page can sit above them */
  ['payModal', 'review'].forEach(function (id) { var m = document.getElementById(id); if (m) document.body.appendChild(m); });
  /* landing card labels (copy v1.4 hero.card.*) */
  if (LAYOUT === 'landing') { var gl = mount.querySelector('.f-get .flabel'); gl.textContent = 'You buy'; gl.setAttribute('data-slot', 'hero.card.buy'); }
  /* "Select token" row: big 0 + lime pill; the pill opens the address field in place */
  (function () {
    var cap = document.getElementById('caForm');
    var row = document.createElement('div'); row.className = 'fr mt pickrow';
    row.innerHTML = '<span class="amt ph0" aria-hidden="true">0</span><button class="btn btn-lime pickbtn" type="button" id="pickBtn"><span data-slot="hero.card.select">Paste token address</span><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    cap.parentNode.insertBefore(row, cap);
  })();
  /* copy-.md strings (verbatim, keyed by slot) */
  var S = {
    'app.state.empty': 'Paste a token address. Quoro checks it before you buy.',
    'app.state.reading': 'Checking the token…', 'app.state.reading.slow': 'New tokens take longer to read. Still checking.',
    'app.state.badaddress': 'That’s not an address. It starts with 0x and has 42 characters.',
    'app.state.notfound': 'No token at this address on Robinhood Chain.', 'app.state.notfound.hint': 'Check the address, try one of the examples below, or browse launches in Explore.', 'app.state.notatoken.hint': 'Check the address, or try one of the examples below.',
    'app.card.tag.launch': 'Memecoin', 'app.card.tag.stock': 'Stock token', 'app.card.tag.other': 'Token',
    'app.card.meta': '{age} old · paired with {pair}', 'app.card.curve': 'curve\u00a0{n}%\u00a0full', 'app.card.graduated': 'Trading in a pool',
    'app.state.ready': 'Data score {score}/10', 'app.card.launch': 'Launch {n}/10', 'app.card.market': 'Market {n}/10', 'app.card.caps.none': 'No caps', 'app.card.caps.one': '1 cap', 'app.card.caps.many': '{n} caps',
    'score.caps.none': 'No caps', 'score.viz.rounds': 'rounds to',
    'score.cap.flag': 'Serious launch flag', 'score.cap.dev10': 'Dev holds over 10%', 'score.cap.dev25': 'Dev holds over 25%',
    'score.cap.idle': 'No trades for 24 hours', 'score.cap.age': 'Under 10 minutes old', 'score.cap.partial': 'Partial read', 'score.cap.max': 'max {n}',
    'score.cap.flag.hint': 'Bundled launch, heavy snipers, a serial or farm deployer, or a dev who sold on the curve.',
    'app.amount.empty': 'Enter an amount', 'app.quote.loading': 'Getting a quote…',
    'app.warn.tax': 'This token has a creator tax of {n}% on every trade, your buy included.',
    'app.impact.high': 'High price impact. You get noticeably less for this amount.',
    'app.balance.low': 'Not enough {coin} on {chain}.', 'app.balance.low.sub': 'You have {balance} {coin} there. Lower the amount or pay from another chain.',
    'app.nofunds.row': '{balance} {coin}', 'app.balance': 'Balance', 'app.max': 'Max',
    'app.route.local': 'On Robinhood Chain · 1\u00a0signature', 'app.route.value': '{chain} → Robinhood Chain · 1\u00a0signature',
    'app.signin': 'Connect wallet to buy', 'app.review': 'Review', 'app.confirm': 'Sign and buy', 'app.sign.wait': 'Confirm in your wallet',
    'app.sell': 'You sell', 'app.flip.sell': 'Switch to selling', 'app.flip.buy': 'Switch to buying', 'app.receive.on': 'Receive on',
    'app.sell.balance': '{amount} {ticker}', 'app.sell.none': 'You don’t hold {ticker} in this wallet.', 'app.sell.review': 'Review sale', 'app.sell.signin': 'Connect wallet to sell',
    'app.sell.low': 'Not enough {ticker}', 'app.sell.low.sub': 'You have {balance} {ticker}.', 'app.sell.warn.tax': 'This token has a creator tax of {n}% on sales too.',
    'app.sell.review.title': 'Review your sale', 'app.review.title': 'Review your buy',
    'app.sell.route.local.one': 'On Robinhood Chain · 1\u00a0signature', 'app.sell.route.local.two': 'On Robinhood Chain · 2\u00a0signatures',
    'app.sell.route.value.one': 'Robinhood Chain → {chain} · 1\u00a0signature', 'app.sell.route.value.two': 'Robinhood Chain → {chain} · 2\u00a0signatures',
    'app.sell.approve.note': 'First allow exactly this amount of {ticker} to be sold, then sign the sale.', 'app.sell.confirm': 'Sign and sell',
    'app.sell.approve': 'Allow {ticker}', 'app.sell.step': 'Step {n} of {of}', 'app.sell.pending.local': 'Selling {ticker}…', 'app.sell.pending': 'On its way to {chain}…',
    'app.sell.done': 'Received {amount} {coin}.', 'app.sell.done.noamount': 'Your sale went through. Check your wallet for the amount.', 'app.sell.done.another': 'Sell another token',
    'app.sell.failed': 'This sale didn’t go through. Your {ticker} is still in your wallet.', 'app.sell.failed.slippage': 'The price moved more than your {n}% slippage. Nothing was sold.',
    'app.sell.nogas': 'You need a little ETH on Robinhood Chain to pay the network fee.', 'app.sell.nogas.hint': 'Buy a small amount of ETH on Robinhood Chain with this form, from any of 17 chains.',
    'app.sell.nogas.button': 'Not enough ETH for fee', 'app.sell.failed.gas': 'Not enough ETH on Robinhood Chain for the network fee. Add a little and try again.',
    'app.sell.pending_long.hint': 'It can take a few more minutes. Track it in the explorer and don’t sell again until it arrives.',
    'app.sell.failed.rejected': 'Signature cancelled. Nothing was sold.', 'app.sell.failed.refunded': 'The sale couldn’t be completed. Your funds are back in your wallet on Robinhood Chain.',
    'app.activity.bought': 'Bought {amount} {ticker}', 'app.activity.sold': 'Sold {amount} {ticker}', 'app.activity.sold.got': 'received {amount} {coin}',
    'ai.brief.label': 'Quoro AI', 'ai.brief.aria': 'Quoro AI on this token',
    'pay.title': 'Pay with', 'pay.search': 'Search coins or networks', 'pay.networks.all': 'All networks', 'pay.yours': 'Your balances', 'pay.list': 'All 17 chains', 'app.max.hint': 'Max keeps a little {coin} for the network fee.',
    'pay.row': '{symbol} on {chain}', 'pay.signedout': 'Connect a wallet to see your balances.', 'pay.signedout.cta': 'Connect wallet', 'pay.zero': 'No balance on supported chains yet.', 'pay.loading': 'Loading balances…', 'app.review.score': 'Data score', 'app.review.score.capped': '{n}/10 · capped by {flag}', 'app.routecost.title': 'Costly route', 'app.routecost.warn': 'This route costs about {n}% of what you pay.', 'app.routecost.hint': 'A larger amount or another chain usually costs less.', 'app.routecost.confirm': 'Pay {n}% and continue', 'app.routecost.cancel': 'Change amount', 'pay.empty': 'Nothing matches “{q}”.',
    'app.wrongnet.button': 'Switch to {chain}', 'app.switching': 'Switching to {chain}…', 'app.balance.low.button': 'Not enough {coin}',
    'app.state.error': 'Couldn’t read this token. Try again in a moment.', 'app.quote.error': 'Couldn’t get a quote. Try again in a moment.',
    'app.fee.relayer': 'Bridge fee', 'app.fee.network': 'Network fee', 'app.fee.route': 'Route fee', 'app.fee.creator': 'Creator tax',
    'score.viz.capped': 'capped at\u00a0{n}', 'score.f.dev.unknown': '—', 'score.f.dev.unknown.hint': 'Couldn’t read the deployer’s current share.',
    'score.flag.bundle': 'Wallets exempt from the opening tax', 'score.flag.snipers_heavy': 'Snipers took over 15% in the first blocks', 'score.flag.snipers': 'Snipers took over 5% in the first blocks',
    'score.flag.serial_dev': 'Deployer has 5+ launches, none moved to a pool', 'score.flag.mill': 'Mass deployer, almost none move to a pool', 'score.flag.farm': 'Same launch pattern from other wallets',
    'score.flag.dev_sold_here': 'Deployer sold on this token’s curve', 'score.flag.dev_dumps': 'Deployer sold on earlier launches', 'score.flag.dev_heavy': 'Deployer bought over 12% at launch',
    'score.flag.tax': 'Creator tax above 3%', 'score.flag.fees_elsewhere': 'Creator fees go to a third party', 'score.flag.no_socials': 'No socials at launch',
    'score.credit.burned': 'Deployer’s supply is burned', 'score.credit.proven_dev': 'Proven deployer: moved to a pool, never sold',
    'app.pending.local': 'Buying {ticker}…', 'app.pending': 'On its way to Robinhood Chain…', 'app.explorer': 'View in explorer ↗',
    'app.done': '{amount} {ticker} is in your wallet.', 'app.done.received': 'Received', 'app.done.add': 'Add {ticker} to your wallet',
    'app.done.add.note': 'New tokens often don’t show in wallets until you add them.', 'app.done.again': 'Check it again', 'app.done.another': 'Buy another token',
    'app.failed': 'This swap didn’t go through. Check your wallet, then try again.',
    'app.failed.slippage': 'The price moved more than your {n}% slippage. Nothing was bought.',
    'app.failed.gas': 'Not enough {coin} left for the network fee. Lower the amount and try again.',
    'app.failed.graduated': 'This token finished its launch while you were signing. Get a new quote to buy it in its pool.',
    'app.failed.rejected': 'Signature cancelled. Nothing was sent.', 'app.failed.retry': 'Get a new quote',
    'app.activity.empty': 'No buys yet.', 'app.activity.empty.sub': 'Tokens you buy with Quoro show up here.', 'app.activity.signin': 'Connect a wallet to see your buys.',
    'app.activity.row': '{amount} {ticker}', 'app.activity.row.paid': 'for {amount} {coin} from {chain}',
    'app.activity.done': 'Done', 'app.activity.pending': 'Pending', 'app.activity.failed': 'Failed',
    'app.empty.live.row': '{ticker} · {score}/10', 'nav.signin': 'Connect wallet',
    'app.noroute': 'No route for this buy right now.', 'app.noroute.hint': 'Try a different amount or another chain, or check back in a few minutes.',
    'app.state.notatoken': 'This address is a contract on Robinhood Chain, but not a token.', 'app.other.supply': 'Supply',
    'app.wrongnet': 'Your wallet is on {wallet_chain}.',
    'app.pending_long': 'Sent. Still waiting for confirmation.', 'app.pending_long.hint': 'It can take a few more minutes. Track it in the explorer and don’t buy again until it arrives.',
    'app.failed.refunded': 'The buy didn’t go through, so your {coin} went back to your wallet on {chain}.', 'app.requote': 'The price updated. Check the new numbers and confirm again.',
    'app.warn.slippage': 'High slippage. You may get up to {n}% less.', 'app.done.noamount': 'Your buy went through. Check your wallet for the amount.',
    'hero.card.cta': 'Check token', 'hero.card.buy': 'You buy', 'hero.card.select': 'Paste token address'
  };
  var T = function (k, v) { return U.tpl(S[k], v || {}); };
  var CHAIN = { rh: 'Robinhood Chain', base: 'Base', arbitrum: 'Arbitrum', ethereum: 'Ethereum' };
  /* 17 chains from config(): {key, name, native, reserve, logo, nativeLogo} */
  var CH = [{ key: 'rh', name: 'Robinhood Chain', native: 'ETH', reserve: null, logo: '/assets/chains/rh.svg', nativeLogo: '/assets/chains/eth-coin.svg' }], CHK = { rh: CH[0] };
  function ch(k) { return CHK[k] || CH[0]; }
  var ZERO = '0x0000000000000000000000000000000000000000';
  function coin() { return ch(st.from).native; }
  /* icons next to every ticker: token logo or ticker on a dark circle; coins with their network badge */
  function tIco(cls) { var t = st.token || {}; return U.tokIco(t.logo, t.symbol, 'tkin' + (cls ? ' ' + cls : ''), t.ca); }
  function cIco(key, cls) { var c = ch(key); return '<span class="tl tkin' + (cls ? ' ' + cls : '') + '"><img src="' + U.esc(c.nativeLogo) + '" alt="" width="20" height="20"><img class="cb" src="' + U.esc(c.logo) + '" alt="" width="10" height="10"></span>'; }
  var SLIP = 3; try { var sv = parseFloat(localStorage.getItem('quoro.slippage')); if (sv > 0 && sv <= 20) SLIP = sv; } catch (e) {}
  var st = { side: /[?&]sell\b/.test(location.search) ? 'sell' : 'buy', to: 'rh', hold: null, holdStr: null, token: null, ca: null, from: 'rh', quote: null, qTimer: 0, qSeq: 0, expTimer: 0, readSeq: 0, quoting: false, qErr: null, userPicked: false };
  if (!API || !W) console.info('Quoro: QuoroAPI / QuoroWallet not loaded');

  /* ---------- token panel states ---------- */
  function show(state) { document.querySelectorAll('#tpanel .st').forEach(function (e) { e.hidden = e.getAttribute('data-state') !== state; }); mount.setAttribute('data-state', state); }
  show('empty');
  function picking(on, focus) { mount.classList.toggle('picking', !!on); if (on && focus) setTimeout(function () { $('caInput').focus(); }, 0); }
  $('pickBtn').addEventListener('click', function () { picking(true, true); });
  if (LAYOUT === 'app') picking(true);
  $('caInput').addEventListener('keydown', function (e) { if (e.key === 'Escape' && !this.value) picking(false); });
  if (API && API.config) API.config().then(function (c) {
    if (!c || !c.chains || !c.chains.length) return;
    CH = c.chains; CHK = {}; CH.forEach(function (x) { CHK[x.key] = x; CHAIN[x.key] = x.name; });
    paintSources(); if (!$('payModal').hidden) paintPay();
  }).catch(function () {});

  function check(ca) {
    ca = String(ca || '').trim();
    $('caMsg').textContent = '';
    if (!U.isAddr(ca)) { show('missing'); $('missMsg').textContent = S['app.state.badaddress']; resetToken(); return; }
    var seq = ++st.readSeq; st.ca = ca; resetToken();
    if (LAYOUT === 'app') try { history.replaceState(null, '', '/app?ca=' + ca + (st.side === 'sell' ? '&sell' : '') + (window.QUORO_MOCK ? '&mock' : '')); } catch (e) {}
    show('reading'); $('readMsg').textContent = S['app.state.reading'];
    mount.classList.add('has-token'); /* receive field takes its token shape at once (no jump when the card lands) */
    var slow = setTimeout(function () { if (seq === st.readSeq) $('readMsg').textContent = S['app.state.reading.slow']; }, 10000);
    API.token(ca).then(function (t) { if (seq !== st.readSeq) return; clearTimeout(slow); st.token = t; renderToken(t); loadBrief(t); loadHolding(); requote(0); })
      .catch(function (err) {
        if (seq !== st.readSeq) return; clearTimeout(slow); show('missing'); mount.classList.remove('has-token'); picking(true);   /* the address stays editable */
        $('missMsg').textContent = err && err.code === 'bad_input' ? S['app.state.badaddress'] : err && err.code === 'not_found' ? S['app.state.notfound'] : err && err.code === 'not_a_token' ? S['app.state.notatoken'] : S['app.state.error'];
        /* not a dead end: a hint, Explore and the same examples as on the landing */
        var nf = err && err.code === 'not_found', nt = err && err.code === 'not_a_token';
        $('missHint').hidden = !(nf || nt); $('missHint').textContent = nf ? S['app.state.notfound.hint'] : nt ? S['app.state.notatoken.hint'] : '';
        $('missHint').setAttribute('data-slot', nf ? 'app.state.notfound.hint' : 'app.state.notatoken.hint');
        $('missLink').hidden = !nf; $('missLink').href = '/explore' + (window.QUORO_MOCK ? '?mock' : '');
        $('missTry').hidden = !(nf || nt); if ((nf || nt) && U.tryChips) U.tryChips($('missTry'), function (x) { window.QuoroPick(x); });
      });
  }
  function resetToken() { clearTimeout(st.qTimer); st.qSeq++; mount.classList.remove('has-token'); st.token = null; st.quote = null; clearTimeout(st.expTimer); paintReceive(); paintQuote(); paintButton(); }
  /* header search picks a token: fill the form in place, no page load */
  window.QuoroPick = function (ca, o) {
    $('caInput').value = ca; picking(true); check(ca);
    if (o && o.live) return;   /* landing opens on a just-checked launch: no scroll */
    var r = mount.getBoundingClientRect(); if (r.top < 64 || r.top > window.innerHeight * 0.5) window.scrollTo({ top: window.scrollY + r.top - 88, behavior: U.RM ? 'auto' : 'smooth' });
  };
  $('caForm').addEventListener('submit', function (e) { e.preventDefault(); check($('caInput').value); });
  $('caInput').addEventListener('paste', function () { setTimeout(function () { var v = $('caInput').value.trim(); if (U.isAddr(v)) check(v); }, 0); });

  function renderToken(t) {
    show('token'); mount.classList.add('has-token');
    try { document.dispatchEvent(new CustomEvent('quoro:token', { detail: t })); } catch (e) {}
    var ico = $('tIco'); ico.className = 'tk' + (t.logo ? ' img' : '') + (t.kind === 'stock' ? ' dk' : ''); ico.innerHTML = t.logo ? '<img src="' + U.esc(t.logo) + '" alt="" width="24" height="24">' : U.esc(t.symbol.slice(0, 4));
    $('tName').textContent = U.nameTick(t.name, t.symbol);
    $('tTag').textContent = S['app.card.tag.' + t.kind] || '';
    $('tTime').textContent = new Date().toTimeString().slice(0, 5);
    $('launchBlock').hidden = t.kind !== 'launch'; $('stockBlock').hidden = t.kind !== 'stock'; $('otherBlock').hidden = t.kind !== 'other';
    $('aiText').textContent = ''; $('askBtn').disabled = false;
    if (t.kind === 'launch') {
      var meta = T('app.card.meta', { age: U.ago(t.ageMin), pair: t.pair }) + ' · ' + (t.graduated ? S['app.card.graduated'] : T('app.card.curve', { n: t.curvePct > 0 && t.curvePct < 1 ? '<1' : Math.round(t.curvePct) }));
      $('tMeta').textContent = meta;
      var sc = t.score || {}, f = t.facts || {};
      $('tScore').textContent = sc.value; $('tReady').textContent = T('app.state.ready', { score: sc.value });
      document.querySelectorAll('#tCells i').forEach(function (c, i) { c.className = i < sc.value ? 'h' : ''; }); document.querySelectorAll('#tDial path').forEach(function (p, i) { p.setAttribute('class', i === 0 ? 'tail' : i < sc.value ? 'on' : ''); });
      var applied = (sc.caps || []).filter(function (c) { return c.applied; });
      $('tLaunch').innerHTML = U.esc(T('app.card.launch', { n: sc.hygiene })); $('tMarket').textContent = T('app.card.market', { n: sc.market });
      $('tCaps').textContent = !applied.length ? S['app.card.caps.none'] : applied.length === 1 ? S['app.card.caps.one'] : T('app.card.caps.many', { n: applied.length });
      $('tPartial').hidden = !sc.partial;
      var CAPK = { flag: 'score.cap.flag', dev: 'score.cap.dev10', dev25: 'score.cap.dev25', idle: 'score.cap.idle', age: 'score.cap.age', partial: 'score.cap.partial' };
      $('tCapList').innerHTML = (sc.caps || []).map(function (c) {
        return '<div class="caprow' + (c.applied ? ' on' : '') + '"' + (c.id === 'flag' ? ' title="' + U.esc(S['score.cap.flag.hint']) + '"' : '') + '><span>' + U.esc(S[CAPK[c.id]] || c.id) + '</span><span class="mono">' + U.esc(T('score.cap.max', { n: c.limit })) + '</span></div>';
      }).join('');
      var raw = Math.round((sc.hygiene * .6 + sc.market * .4) * 10) / 10;
      var rounded = Math.min(10, Math.max(1, Math.floor(raw + 0.5)));
      $('tFormula').textContent = '0.6 × ' + sc.hygiene + ' + 0.4 × ' + sc.market + ' = ' + raw.toFixed(1) + ', ' + S['score.viz.rounds'] + ' ' + rounded + (sc.value < rounded ? ' · ' + T('score.viz.capped', { n: sc.value }) : '');
      /* C-n4: why — every launch finding by key (engine text is never shown), credits +1 */
      var fl = (sc.flags || []).filter(function (x) { return S['score.flag.' + x.k]; }), cr = (sc.credits || []).filter(function (k) { return S['score.credit.' + k]; });
      $('tFlags').innerHTML = fl.map(function (x) { return '<div class="flag"><span data-slot="score.flag.' + U.esc(x.k) + '">' + U.esc(S['score.flag.' + x.k]) + '</span><span class="dpt">−' + (+x.points || 0) + '</span></div>'; }).join('') +
        cr.map(function (k) { return '<div class="flag"><span data-slot="score.credit.' + U.esc(k) + '">' + U.esc(S['score.credit.' + k]) + '</span><span class="dpt plus">+1</span></div>'; }).join('');
      $('tFlags').hidden = !(fl.length || cr.length);
      $('fDev').textContent = f.devPct == null ? S['score.f.dev.unknown'] : F.pct(f.devPct); $('fDev').title = f.devPct == null ? S['score.f.dev.unknown.hint'] : ''; $('fSnip').textContent = F.pct(f.snipersPct); $('fFree').textContent = F.int(f.taxExempt);
      $('fTax').textContent = F.pct((f.creatorTaxBps || 0) / 100); $('fBuy').textContent = F.int(f.buyers) + ' / ' + F.int(f.sellers);
      $('fCurve').textContent = F.pct(t.curvePct); $('fLast').textContent = F.mins(f.lastTradeMin); $('fSmart').textContent = F.int(f.smartWallets);
    } else if (t.kind === 'stock') {
      $('tMeta').textContent = U.short(t.ca);
      $('sPrice').textContent = F.usd(t.priceUsd);
      var ch = $('sChg'); ch.textContent = t.change24h == null ? '' : (t.change24h > 0 ? '+' : '') + F.pct(t.change24h); ch.className = 'mono chg' + (t.change24h < 0 ? ' dn' : '');
      var a = t.spark || []; if (a.length > 1) { var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a), d = mx - mn || 1; $('sSpark').setAttribute('points', a.map(function (v, i) { return (i * 240 / (a.length - 1)).toFixed(1) + ',' + (60 - (v - mn) / d * 56).toFixed(1); }).join(' ')); }
    } else { $('tMeta').textContent = U.short(t.ca); $('oSupply').textContent = t.supply ? F.num(t.supply) : '—'; }
    paintReceive();
  }
  U.short = F.short;
  /* AI line right after the read: skeleton of two lines, then 1–2 lines; any error hides it quietly */
  function loadBrief(t) {
    var box = $('tBrief'), txt = $('tBriefText');
    if (!t || t.kind !== 'launch' || !API.brief) { box.hidden = true; return; }
    box.hidden = false; box.classList.add('loading'); txt.innerHTML = '<span class="skl w100"></span><span class="skl w70"></span>';
    var ca = t.ca;
    API.brief(ca).then(function (b) {
      if (!st.token || st.token.ca !== ca) return;
      if (!b || !b.text) { box.hidden = true; return; }
      box.classList.remove('loading'); txt.textContent = b.text;
    }).catch(function () { if (st.token && st.token.ca === ca) box.hidden = true; });
  }
  $('howBtn').addEventListener('click', function () { var b = $('howBox'); b.hidden = !b.hidden; this.setAttribute('aria-expanded', String(!b.hidden)); });
  $('askBtn').addEventListener('click', function () {
    var b = this; if (!st.token) return; b.disabled = true; var out = $('aiText'); out.classList.add('streaming');
    API.explain(st.token.ca, function (txt) { out.textContent = txt; }).then(function (txt) { if (txt) out.textContent = txt; })
      .catch(function () { out.textContent = ''; b.disabled = false; }).then(function () { out.classList.remove('streaming'); });
  });

  /* ---------- swap card ---------- */
  function wstate() { return (W && W.state) || { status: 'out', balances: {} }; }
  function bal(k) { var b = wstate().balances || {}; return b[k] == null ? null : +b[k]; }
  /* balance text: ≤5 significant digits, tiny amounts as «<0.00001», never wraps */
  function fbal(n) {
    if (n == null || !isFinite(n)) return ''; if (n <= 0) return '0'; if (n < 0.00001) return '<0.00001';
    return n.toLocaleString('en-US', n >= 1 ? { maximumFractionDigits: 4, roundingMode: 'trunc' } : { maximumSignificantDigits: 3, roundingMode: 'trunc' }); /* never shows more than there is */
  }
  function spendable(k) { var b = bal(k), r = ch(k).reserve; return b == null || r == null ? null : Math.max(0, b - r); } /* reserve only from config(), never assumed */
  function paintSources() {
    var ws = wstate(), signed = ws.status === 'in', selling = st.side === 'sell', c = ch(selling ? st.to : st.from), b = bal(st.from);
    $('payCoin').src = c.nativeLogo; $('payChain').src = c.logo; $('payChain').alt = c.name; $('paySym').textContent = c.native;
    $('paySel').setAttribute('aria-label', T('pay.row', { symbol: c.native, chain: c.name }));
    $('amount').setAttribute('aria-label', 'Amount in ' + c.native);
    $('balLine').textContent = signed && b != null ? fbal(b) + ' ' + c.native : '';
    $('pcts').hidden = selling || !(signed && spendable(st.from) > 0);
    document.querySelector('#pcts [data-pct="100"]').title = T('app.max.hint', { coin: c.native });
    mount.setAttribute('data-from', st.from);
    /* 7. nothing on Robinhood Chain → pay from another chain */
    var noRh = signed && st.from === 'rh' && bal('rh') != null && bal('rh') <= 0;
    $('noFunds').hidden = !noRh;
    var any = CH.some(function (x) { return x.key !== 'rh' && bal(x.key) > 0; });
    $('noFundsNone').hidden = !(noRh && !any);
  }
  document.querySelectorAll('#pcts [data-pct]').forEach(function (b) {
    b.addEventListener('click', function () {
      var sp = spendable(st.from); if (!(sp > 0)) return; var p = +b.getAttribute('data-pct');
      var v = p === 100 ? sp : Math.min(sp, bal(st.from) * p / 100);
      $('amount').value = v > 0 ? (Math.floor(v * 1e8) / 1e8).toFixed(8).replace(/\.?0+$/, '') : '0';   // always rounded down: never more than the wallet holds
      requote(0);
    });
  });
  function pickFrom(k) { if ((!CHK[k] && k !== 'rh') || !$('review').hidden) return; if (st.side === 'sell') { st.to = k; paintSources(); requote(0); return; } st.from = k; st.userPicked = true; paintSources(); requote(0); }
  function autoPick() {
    /* default = chain with the most value (wallet() rows are sorted by $), Robinhood Chain when nothing is there */
    if (st.userPicked || wstate().status !== 'in' || !$('review').hidden) return;
    var rows = st.walletRows || []; var top = rows.filter(function (r) { return +r.amount > 0 && CHK[r.key]; })[0];
    var was = st.from;
    if (top) st.from = top.key; else if (bal('rh') === 0) st.from = 'rh';
    if (st.from !== was) { paintSources(); if (st.token) requote(0); } /* a new chain always gets a new quote */
  }
  function loadWallet() {
    var ws = wstate(); if (ws.status !== 'in' || !API || !API.wallet) return;
    API.wallet(ws.address).then(function (w) { st.walletRows = (w && w.rows) || []; autoPick(); paintSources(); if (!$('payModal').hidden) paintPay(); }).catch(function () {});
  }

  /* ---------- sell side: the arrow flips the form ---------- */
  function paintSell() {
    var t = st.token, signed = wstate().status === 'in', sell = st.side === 'sell';
    $('tokBal').textContent = sell && t && signed && st.hold != null ? T('app.sell.balance', { amount: fbal(st.hold), ticker: t.symbol }) : '';
    $('tpcts').hidden = !(sell && t && signed && st.hold > 0);
  }
  function loadHolding() {
    var ws = wstate(), t = st.token; st.hold = null; st.holdStr = null; paintSell();
    if (st.side !== 'sell' || !t || ws.status !== 'in' || !API.holding) return;
    var ca = t.ca;
    API.holding(ca, ws.address).then(function (h) { if (!st.token || st.token.ca !== ca) return; st.holdRaw = h && h.raw != null ? String(h.raw) : null; st.holdDec = h && h.decimals != null ? +h.decimals : 18; st.holdStr = h && h.amount != null ? String(h.amount) : '0'; st.hold = +st.holdStr || 0; paintSell(); paintButton(); })
      .catch(function () { paintSell(); });
  }
  document.querySelectorAll('#tpcts [data-tpct]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!(st.hold > 0)) return; var p = +b.getAttribute('data-tpct');
      $('sellAmt').value = p === 100 ? st.holdStr : share(p); fitAmt($('sellAmt')); requote(0);
    });
  });
  /* a share of the balance in exact units (BigInt from raw), never scientific notation */
  function share(p) {
    try {
      var raw = BigInt(st.holdRaw), d = st.holdDec, part = raw * BigInt(p) / 100n, base = 10n ** BigInt(d);
      var w = (part / base).toString(), f = (part % base).toString().padStart(d, '0').replace(/0+$/, '');
      return f ? w + '.' + f : w;
    } catch (e) { return (st.hold * p / 100).toFixed(Math.min(18, (st.holdDec || 18))).replace(/\.?0+$/, ''); }
  }
  function setSide(side) {
    if (!$('review').hidden || st.side === side) return;
    st.side = side; mount.classList.toggle('selling', side === 'sell');
    $('amount').value = ''; $('sellAmt').value = ''; st.quote = null; st.qErr = null;
    $('flipBtn').setAttribute('aria-label', S[side === 'sell' ? 'app.flip.buy' : 'app.flip.sell']); $('flipBtn').setAttribute('data-slot-aria', side === 'sell' ? 'app.flip.buy' : 'app.flip.sell');
    paintSources(); loadHolding(); requote(0);
    if (LAYOUT === 'app' && st.ca) try { history.replaceState(null, '', '/app?ca=' + st.ca + (side === 'sell' ? '&sell' : '') + (window.QUORO_MOCK ? '&mock' : '')); } catch (e) {}
  }
  $('flipBtn').addEventListener('click', function () { setSide(st.side === 'sell' ? 'buy' : 'sell'); });
  $('sellAmt').addEventListener('input', function () {
    var v = this.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'), d = st.token && st.token.decimals != null ? +st.token.decimals : st.holdDec;
    if (d != null && v.indexOf('.') > -1) v = d === 0 ? v.split('.')[0] : v.slice(0, v.indexOf('.') + 1 + d); /* no more digits than the token has */
    this.value = v; requote(400);
  });

  /* ---------- Pay with: "Select a token" modal ---------- */
  var payNet = '';
  function coinIco(x, big) { return '<span class="tl' + (big ? ' big' : '') + '"><img src="' + U.esc(x.nativeLogo) + '" alt="" width="40" height="40"><img class="cb" src="' + U.esc(x.logo) + '" alt="" width="16" height="16"></span>'; }
  function paintPay() {
    var q = ($('payQ').value || '').trim().toLowerCase(), selling = st.side === 'sell', signed = !selling && wstate().status === 'in', curKey = selling ? st.to : st.from;
    $('payTitle').textContent = S[selling ? 'app.receive.on' : 'pay.title']; $('payTitle').setAttribute('data-slot', selling ? 'app.receive.on' : 'pay.title');
    var ok = function (x) { return (!payNet || x.key === payNet) && (!q || (x.name + ' ' + x.native + ' ' + x.key).toLowerCase().indexOf(q) > -1); };
    var cur = payNet ? ch(payNet) : null;
    $('payNetIco').innerHTML = cur ? '<img src="' + U.esc(cur.logo) + '" alt="" width="22" height="22"><span>' + U.esc(cur.name) + '</span>' : '<span class="allnets">' + CH.slice(0, 4).map(function (x) { return '<img src="' + U.esc(x.logo) + '" alt="" width="16" height="16">'; }).join('') + '</span><span data-slot="pay.networks.all">' + U.esc(S['pay.networks.all']) + '</span>';
    $('payNetList').innerHTML = '<button type="button" role="option" data-net=""' + (payNet ? '' : ' class="on"') + '><span class="allnets">' + CH.slice(0, 4).map(function (x) { return '<img src="' + U.esc(x.logo) + '" alt="" width="16" height="16">'; }).join('') + '</span><span data-slot="pay.networks.all">' + U.esc(S['pay.networks.all']) + '</span></button>' +
      CH.map(function (x) { return '<button type="button" role="option" data-net="' + x.key + '"' + (payNet === x.key ? ' class="on"' : '') + '><img src="' + U.esc(x.logo) + '" alt="" width="28" height="28"><span>' + U.esc(x.name) + '</span></button>'; }).join('');
    var tiles = ['rh', 'base', 'arbitrum', 'ethereum', 'bnb'].map(function (k) { return CHK[k]; }).filter(Boolean);
    $('payTiles').innerHTML = tiles.map(function (x) { return '<button type="button" class="ptile' + (x.key === curKey ? ' on' : '') + '" data-pay="' + x.key + '" title="' + U.esc(T('pay.row', { symbol: x.native, chain: x.name })) + '">' + coinIco(x) + '<b>' + U.esc(x.native) + '</b><i>' + U.esc(x.name) + '</i></button>'; }).join('');
    $('payTiles').hidden = !!q || !!payNet;
    var row = function (x, r) {
      return '<button type="button" class="prow' + (x.key === curKey ? ' on' : '') + '" data-pay="' + x.key + '">' + coinIco(x, 1) + '<span class="pn"><b>' + U.esc(T('pay.row', { symbol: x.native, chain: x.name })) + '</b><i>' + U.esc(x.native) + '</i></span>' +
        (r ? '<span class="pv"><b>' + (r.usd != null ? F.usd(r.usd) : '') + '</b><i>' + U.esc(fbal(+r.amount) + ' ' + x.native) + '</i></span>' : '') + '</button>';
    };
    var h = '';
    if (signed) {
      var rows = (st.walletRows || []).filter(function (r) { return +r.amount > 0 && CHK[r.key] && ok(CHK[r.key]); });
      h += '<div class="phead" data-slot="pay.yours">' + U.esc(S['pay.yours']) + '</div>' + (rows.length ? rows.map(function (r) { return row(CHK[r.key], r); }).join('') : (q || payNet ? '' : st.walletRows == null ? '<p class="pnote" data-slot="pay.loading">' + U.esc(S['pay.loading']) + '</p>' : '<p class="pnote" data-slot="pay.zero">' + U.esc(S['pay.zero']) + '</p>'));
    } else if (!selling) {
      h += '<div class="phead" data-slot="pay.yours">' + U.esc(S['pay.yours']) + '</div><div class="pnote psign"><span data-slot="pay.signedout">Connect a wallet to see your balances.</span><button type="button" class="btn btn-lime btn-pill" id="paySign" data-slot="pay.signedout.cta">Connect wallet</button></div>';
    }
    var all = CH.filter(ok);
    h += '<div class="phead" data-slot="pay.list">' + U.esc(S['pay.list']) + '</div>' + (all.length ? all.map(function (x) { return row(x); }).join('') : '<p class="pnote" data-slot="pay.empty">' + U.esc(T('pay.empty', { q: $('payQ').value.trim() })) + '</p>');
    $('payList').innerHTML = h;
    var ps = $('paySign'); if (ps) ps.onclick = function () { W && W.signIn(); };
  }
  function openPay() {
    if (!$('review').hidden) return;
    $('payQ').value = ''; payNet = ''; paintPay(); $('payModal').hidden = false; document.body.classList.add('modal-open');
    if (window.matchMedia('(pointer:fine)').matches) $('payQ').focus();
  }
  function closePay() { $('payModal').hidden = true; $('payNetList').hidden = true; $('payNetBtn').setAttribute('aria-expanded', 'false'); if ($('review').hidden) document.body.classList.remove('modal-open'); $('paySel').focus(); }
  $('paySel').addEventListener('click', openPay);
  $('payClose').addEventListener('click', closePay);
  $('payModal').addEventListener('click', function (e) {
    if (e.target === this) return closePay();
    var p = e.target.closest('[data-pay]'); if (p) { pickFrom(p.getAttribute('data-pay')); closePay(); return; }
    var n = e.target.closest('[data-net]'); if (n) { payNet = n.getAttribute('data-net'); $('payNetList').hidden = true; $('payNetBtn').setAttribute('aria-expanded', 'false'); paintPay(); return; }
    if (!e.target.closest('.pnet')) { $('payNetList').hidden = true; $('payNetBtn').setAttribute('aria-expanded', 'false'); }
  });
  $('payNetBtn').addEventListener('click', function () { var l = $('payNetList'); l.hidden = !l.hidden; this.setAttribute('aria-expanded', String(!l.hidden)); });
  $('payQ').addEventListener('input', paintPay);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('payModal').hidden) { if (!$('payNetList').hidden) { $('payNetList').hidden = true; } else closePay(); } });
  function paintReceive() {
    var t = st.token;
    $('outSym').textContent = t ? t.symbol : '—';
    var ico = $('outIco'); ico.innerHTML = t ? (t.logo ? '<img src="' + U.esc(t.logo) + '" alt="" width="22" height="22">' : U.esc(t.symbol.slice(0, 4))) : '—'; ico.className = 'loc' + (t && t.logo ? ' img' : '') + (t && t.kind === 'stock' ? ' dk' : '');
    var b = $('outBadge'); b.hidden = !(t && t.score); if (t && t.score) { b.textContent = t.score.value + '/10'; b.classList.toggle('mid', t.score.value >= 5 && t.score.value < 7); b.classList.toggle('lo', t.score.value < 5); }
    $('outCa').textContent = t ? F.short(t.ca) : '';
  }
  $('outSel').addEventListener('click', function () { st.readSeq++; st.ca = null; resetToken(); show('empty'); $('caInput').value = ''; picking(true, true); });
  $('amount').addEventListener('input', function () { this.value = this.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); requote(400); });

  function requote(delay) {
    if (!$('review').hidden) return; /* B1: the quote is frozen while Review is open */
    clearTimeout(st.qTimer); clearTimeout(st.expTimer);
    var amt = amtEl().value;
    if (!st.token || !(+amt > 0)) { st.quote = null; st.quoting = false; st.qErr = null; paintQuote(); paintButton(); return; }
    st.quoting = true; st.qErr = null; paintQuote(); paintButton();
    st.qTimer = setTimeout(function () {
      if (!st.token) { st.quoting = false; paintQuote(); paintButton(); return; }
      var seq = ++st.qSeq, ws = wstate();
      API.quote(st.side === 'sell' ? { side: 'sell', ca: st.token.ca, to: st.to, amount: amt, account: ws.address || undefined, slippage: SLIP }
        : { ca: st.token.ca, from: st.from, amount: amt, account: ws.address || undefined, slippage: SLIP }).then(function (q) {
        if (seq !== st.qSeq) return; st.quote = q; st.quoting = false; paintQuote(); paintButton();
        var exp = (q.expiresAt < 1e12 ? q.expiresAt * 1000 : q.expiresAt) - Date.now();
        st.expTimer = setTimeout(function () { if ($('review').hidden) requote(0); }, Math.max(1000, exp));
      }).catch(function (e) { if (seq !== st.qSeq) return; st.quote = null; st.quoting = false; st.qErr = e; paintQuote(); paintButton(); });
    }, delay);
  }
  /* long amounts shrink to fit next to the token pill; the field's value is never changed */
  function fitAmt(el) {
    if (!el) return;
    el.style.fontSize = '';
    var txt = el.value != null && el.tagName === 'INPUT' ? el.value : el.textContent, w = el.clientWidth;
    if (!txt || !w) return;
    var cs = getComputedStyle(el), base = parseFloat(cs.fontSize);
    fitAmt.c = fitAmt.c || document.createElement('canvas').getContext('2d');
    fitAmt.c.font = cs.fontWeight + ' ' + base + 'px ' + cs.fontFamily;
    var need = fitAmt.c.measureText(txt).width + 4;
    if (need > w) el.style.fontSize = Math.max(14, Math.floor(base * w / need)) + 'px';
  }
  function fitAll() { ['amount', 'sellAmt', 'outAmt', 'recvAmt'].forEach(function (id) { fitAmt($(id)); }); }
  ['amount', 'sellAmt'].forEach(function (id) { $(id).addEventListener('input', function () { fitAmt(this); }); });
  if (window.MutationObserver) ['outAmt', 'recvAmt'].forEach(function (id) { new MutationObserver(function () { fitAmt($(id)); }).observe($(id), { childList: true, characterData: true, subtree: true }); });
  window.addEventListener('resize', fitAll);
  function amtEl() { return st.side === 'sell' ? $('sellAmt') : $('amount'); }
  function sellRoute(q) {
    var to = (q && q.route && q.route.to) || st.to, two = q && ((q.route && q.route.signatures === 2) || (q.steps && q.steps[0] && q.steps[0].kind === 'approve'));
    return to === 'rh' ? S['app.sell.route.local.' + (two ? 'two' : 'one')] : T('app.sell.route.value.' + (two ? 'two' : 'one'), { chain: CHAIN[to] || (q && q.route && q.route.toName) || to });
  }
  function paintQuote() {
    var q = st.quote, selling = st.side === 'sell', local = selling ? st.to === 'rh' : st.from === 'rh';
    mount.classList.toggle('noquote', !q && !st.quoting && !st.qErr);
    $('rRelayer').hidden = local; $('rRouteFeeRow').hidden = !!(q && q.fees && !(q.fees.routeUsd > 0));   /* kept while there is no quote yet: its place is held */
    if (st.quoting) { $('rRoute').textContent = S['app.quote.loading']; }
    if (!q) {
      if (!st.quoting) $('rRoute').textContent = st.qErr && st.qErr.code !== 'no_route' ? S['app.quote.error'] : '—';
      if (st.qErr && st.qErr.code === 'no_route') $('warns').innerHTML = '<p class="warn err"><b>' + U.esc(S['app.noroute']) + '</b> ' + U.esc(S['app.noroute.hint']) + '</p>';
      ['rRelay', 'rRouteFee', 'rTax', 'rNet', 'rImpact', 'rMin'].forEach(function (id) { $(id).textContent = '—'; });
      $('outAmt').textContent = '0'; $('outUsd').innerHTML = '&nbsp;'; $('inUsd').innerHTML = '&nbsp;'; $('recvAmt').textContent = '0'; $('recvUsd').innerHTML = '&nbsp;'; $('sellUsd').innerHTML = '&nbsp;'; if (!(st.qErr && st.qErr.code === 'no_route')) $('warns').innerHTML = '';
      $('rrows').classList.toggle('dim', st.quoting); return;
    }
    $('rrows').classList.toggle('dim', st.quoting);
    if (selling) { $('recvAmt').textContent = F.num(q.out); $('recvUsd').textContent = F.usd(q.outUsd); $('sellUsd').textContent = F.usd(q.inUsd); }
    else { $('outAmt').textContent = F.num(q.out); $('outUsd').textContent = F.usd(q.outUsd); $('inUsd').textContent = F.usd(q.inUsd); }
    if (!st.quoting) $('rRoute').textContent = selling ? sellRoute(q) : local ? S['app.route.local'] : T('app.route.value', { chain: CHAIN[st.from] });
    $('rRelay').textContent = q.fees.relayerUsd == null ? '—' : F.fee(q.fees.relayerUsd); $('rRouteFee').textContent = F.fee(q.fees.routeUsd);
    $('rTax').textContent = q.fees.creatorTaxPct ? F.pct(q.fees.creatorTaxPct) + ' · ' + F.fee(q.fees.creatorTaxUsd) : '0%';
    $('rNet').textContent = (q.fees.networkUsd < 0.01 ? '' : '~') + F.fee(q.fees.networkUsd); $('rImpact').textContent = F.pct(q.fees.impactPct);
    $('rMin').innerHTML = U.esc(F.num(q.outMin) + ' ' + (selling ? (q.outSymbol || ch(st.to).native) : st.token.symbol)) + (selling ? cIco(st.to) : tIco());
    var w = q.warnings || [], h = '';
    if (selling && w.indexOf('no_gas') > -1) h += '<p class="warn err">' + cIco('rh') + '<span><b data-slot="app.sell.nogas">' + U.esc(S['app.sell.nogas']) + '</b> <button type="button" class="linkish wlink" id="nogasBuy" data-slot="app.sell.nogas.hint">' + U.esc(S['app.sell.nogas.hint']) + '</button></span></p>';
    if (selling && w.indexOf('over_balance') > -1) h += '<p class="warn err">' + tIco() + '<b>' + U.esc(T('app.sell.low', { ticker: st.token.symbol })) + '</b> ' + U.esc(T('app.sell.low.sub', { balance: st.hold == null ? '0' : fbal(st.hold), ticker: st.token.symbol })) + '</p>';
    else if (w.indexOf('over_balance') > -1) h += '<p class="warn err"><b>' + U.esc(T('app.balance.low', { chain: CHAIN[st.from], coin: coin() })) + '</b> ' + U.esc(T('app.balance.low.sub', { balance: fbal(bal(st.from)), coin: coin() })) + '</p>';
    if (costly(q)) h += '<p class="warn err"><span><b data-slot="app.routecost.title">' + U.esc(S['app.routecost.title']) + '</b> ' + U.esc(T('app.routecost.warn', { n: costN(q) })) + '</span></p>';
    else if (w.indexOf('high_impact') > -1) h += '<p class="warn">' + U.esc(S['app.impact.high']) + '</p>';
    if (w.indexOf('creator_tax') > -1 && !costly(q)) h += '<p class="warn">' + tIco() + U.esc(T(selling ? 'app.sell.warn.tax' : 'app.warn.tax', { n: q.fees.creatorTaxPct })) + '</p>';
    if (SLIP > 5) h += '<p class="warn">' + U.esc(T('app.warn.slippage', { n: SLIP })) + '</p>';
    $('warns').innerHTML = h;
    var ng = $('nogasBuy'); if (ng) ng.onclick = function () {
      /* buy a little ETH on Robinhood Chain: the native "token" 0x000…0 bought from the chain with the most value, never rh itself */
      var top = (st.walletRows || []).filter(function (r) { return r.key !== 'rh' && +r.amount > 0 && CHK[r.key]; })[0];
      setSide('buy'); st.from = top ? top.key : 'base'; st.userPicked = true; paintSources();
      $('caInput').value = ZERO; picking(true); check(ZERO);
    };
  }
  function paintButton() {
    var b = $('mainBtn'), ws = wstate(), q = st.quote, key, dis = false;
    if (!st.token) { key = 'hero.card.cta'; dis = !!st.ca && st.ca === ($('caInput').value || '').trim(); }
    else if (st.side === 'sell' && wstate().status === 'in' && st.hold === 0) { b.textContent = T('app.sell.none', { ticker: st.token.symbol }); b.disabled = true; b.dataset.act = ''; return; }
    else if (!(+amtEl().value > 0)) { key = 'app.amount.empty'; dis = true; }
    else if (!st.quoting && !q && st.qErr && st.qErr.code === 'no_route') { key = 'app.noroute'; dis = true; }
    else if (ws.status !== 'in') { key = st.side === 'sell' ? 'app.sell.signin' : 'app.signin'; dis = ws.status === 'loading'; }
    else if (st.quoting) { key = 'app.quote.loading'; dis = true; }
    else if (!q && st.qErr && st.qErr.code === 'no_route') { key = 'app.noroute'; dis = true; }
    else if (!q) { key = 'app.failed.retry'; }
    else if (st.side === 'sell' && (q.warnings || []).indexOf('no_gas') > -1) { b.textContent = S['app.sell.nogas.button']; b.disabled = true; b.dataset.act = ''; return; }
    else if (st.side === 'sell' && ((q.warnings || []).indexOf('over_balance') > -1 || (st.hold != null && +amtEl().value > st.hold))) { b.textContent = T('app.sell.low', { ticker: st.token.symbol }); b.disabled = true; b.dataset.act = ''; return; }
    else if (st.side === 'sell') { key = 'app.sell.review'; }
    else if ((q.warnings || []).indexOf('over_balance') > -1 || (spendable(st.from) != null && +$('amount').value > spendable(st.from))) { b.textContent = T('app.balance.low.button', { coin: coin() }); b.disabled = true; b.dataset.act = ''; return; }
    else { key = 'app.review'; }
    b.textContent = S[key]; b.disabled = dis; b.dataset.act = key;
  }
  $('mainBtn').addEventListener('click', function () {
    var a = this.dataset.act;
    if (a === 'hero.card.cta') { var v = $('caInput').value.trim(); if (v) return check(v); return picking(true, true); }
    if (a === 'app.signin' || a === 'app.sell.signin') return W && W.signIn();
    if (a === 'app.sell.review') return openReview();
    if (a === 'app.failed.retry') return requote(0);
    if (a === 'app.review') openReview();
  });

  /* ---------- review + execute (states 9–11) ---------- */
  function qFrom(q) { return (q && q.route && q.route.from) || (isSell(q) ? 'rh' : st.from); }
  function qCoin(q) { return (q && q.inSymbol) || ch(qFrom(q)).native; }
  function isSell(q) { return q && q.side === 'sell'; }
  function paintReviewSell(q) {
    var t = st.token, to = (q.route && q.route.to) || st.to, c = ch(to), coinS = q.outSymbol || c.native, appr = q.steps && q.steps[0] && q.steps[0].kind === 'approve';
    $('revTitle').textContent = S['app.sell.review.title']; $('revTitle').setAttribute('data-slot', 'app.sell.review.title');
    $('vPayLbl').textContent = S['app.sell']; $('vPayLbl').setAttribute('data-slot', 'app.sell');
    $('vPay').textContent = (+q.amountIn).toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ' + t.symbol; /* exactly what is sold, never rounded */ $('vFrom').textContent = CHAIN.rh;
    var w = $('vPayIco') ? $('vPayIco').parentNode : $('vPayIcoW'); w.id = 'vPayIcoW'; w.hidden = false; w.className = 'rpico'; w.innerHTML = U.tokIco(t.logo, t.symbol, 'rtk', t.ca);
    $('vOut').textContent = F.num(q.out) + ' ' + coinS; $('vTo').textContent = CHAIN[to] || to;
    $('vOutIcoW').hidden = false; $('vOutIcoW').className = 'tl big rpico'; $('vOutIcoW').innerHTML = '<img src="' + U.esc(c.nativeLogo) + '" alt="" width="40" height="40"><img class="cb" src="' + U.esc(c.logo) + '" alt="" width="16" height="16">';
    var rows = [['app.route', sellRoute(q)]];
    if (to !== 'rh') rows.push(['app.fee.relayer', q.fees.relayerUsd == null ? '—' : F.fee(q.fees.relayerUsd)]);
    if (q.fees.routeUsd > 0) rows.push(['app.fee.route', F.fee(q.fees.routeUsd)]);
    rows.push(['app.fee.creator', q.fees.creatorTaxPct ? F.pct(q.fees.creatorTaxPct) + ' · ' + F.fee(q.fees.creatorTaxUsd) : '0%'], ['app.fee.network', (q.fees.networkUsd < 0.01 ? '' : '~') + F.fee(q.fees.networkUsd)], ['app.impact', F.pct(q.fees.impactPct)], ['app.minreceived', F.num(q.outMin) + ' ' + coinS]);
    var LBL = { 'app.review.score': S['app.review.score'], 'app.route': 'Route', 'app.fee.relayer': S['app.fee.relayer'], 'app.fee.route': S['app.fee.route'], 'app.fee.creator': S['app.fee.creator'], 'app.fee.network': S['app.fee.network'], 'app.impact': 'Price impact', 'app.minreceived': 'Minimum received' };
    $('vRows').innerHTML = rows.map(function (r) { return '<div class="rr"><span class="k" data-slot="' + r[0] + '">' + LBL[r[0]] + '</span><span class="v">' + U.esc(r[1]) + (r[0] === 'app.minreceived' ? cIco(to) : '') + '</span></div>'; }).join('') +
      (appr ? '<p class="warn appr" data-slot="app.sell.approve.note">' + U.esc(T('app.sell.approve.note', { ticker: t.symbol })) + '</p>' : '') +
      (SLIP > 5 ? '<p class="warn">' + U.esc(T('app.warn.slippage', { n: SLIP })) + '</p>' : '');
  }
  function paintReview(q) {
    if (isSell(q)) return paintReviewSell(q);
    $('revTitle').textContent = S['app.review.title']; $('revTitle').setAttribute('data-slot', 'app.review.title');
    $('vPayLbl').textContent = S['app.pay']; $('vPayLbl').setAttribute('data-slot', 'app.pay');
    $('vOutIcoW').hidden = false; $('vOutIcoW').className = 'rpico'; $('vOutIcoW').innerHTML = U.tokIco(st.token.logo, st.token.symbol, 'rtk', st.token.ca); $('vTo').textContent = CHAIN.rh;
    var t = st.token, from = qFrom(q);
    $('vPay').textContent = F.num(q.amountIn, 6) + ' ' + qCoin(q); $('vFrom').textContent = CHAIN[from] || from;
    var c = ch(from), pw = $('vPayIco') ? $('vPayIco').parentNode : $('vPayIcoW'); pw.id = 'vPayIcoW'; pw.hidden = false; pw.className = 'tl big rpico'; pw.innerHTML = '<img src="' + U.esc(c.nativeLogo) + '" alt="" width="40" height="40"><img class="cb" src="' + U.esc(c.logo) + '" alt="" width="16" height="16">';
    $('vOut').textContent = F.num(q.out) + ' ' + t.symbol;
    var rows = [];
    var sc = t.kind === 'launch' && t.score;   /* Know before you buy: the score is on the sign step too */
    if (sc && sc.value != null) {
      var cap = (sc.caps || []).filter(function (c) { return c.applied; })[0];
      var CAPK = { flag: 'score.cap.flag', dev: 'score.cap.dev10', dev25: 'score.cap.dev25', idle: 'score.cap.idle', age: 'score.cap.age', partial: 'score.cap.partial' };
      rows.push(['app.review.score', cap ? T('app.review.score.capped', { n: sc.value, flag: (S[CAPK[cap.id]] || cap.id).toLowerCase() }) : sc.value + '/10']);
    }
    rows.push(['app.route', from === 'rh' ? S['app.route.local'] : T('app.route.value', { chain: CHAIN[from] || from })]);
    if (from !== 'rh') rows.push(['app.fee.relayer', q.fees.relayerUsd == null ? '—' : F.fee(q.fees.relayerUsd)]);
    if (q.fees.routeUsd > 0) rows.push(['app.fee.route', F.fee(q.fees.routeUsd)]);
    rows.push(['app.fee.creator', q.fees.creatorTaxPct ? F.pct(q.fees.creatorTaxPct) + ' · ' + F.fee(q.fees.creatorTaxUsd) : '0%'], ['app.fee.network', (q.fees.networkUsd < 0.01 ? '' : '~') + F.fee(q.fees.networkUsd)], ['app.impact', F.pct(q.fees.impactPct)], ['app.minreceived', F.num(q.outMin) + ' ' + t.symbol]);
    var LBL = { 'app.review.score': S['app.review.score'], 'app.route': 'Route', 'app.fee.relayer': S['app.fee.relayer'], 'app.fee.route': S['app.fee.route'], 'app.fee.creator': S['app.fee.creator'], 'app.fee.network': S['app.fee.network'], 'app.impact': 'Price impact', 'app.minreceived': 'Minimum received' };
    $('vRows').innerHTML = rows.map(function (r) { return '<div class="rr"><span class="k" data-slot="' + r[0] + '">' + LBL[r[0]] + '</span><span class="v">' + U.esc(r[1]) + (r[0] === 'app.minreceived' ? tIco() : '') + '</span></div>'; }).join('') +
      (SLIP > 5 ? '<p class="warn">' + U.esc(T('app.warn.slippage', { n: SLIP })) + '</p>' : '');
  }
  /* a route that costs more than 15% of the payment (server: warnings costly_route, quote.costPct) needs its own
 press before the sign button appears */
  function costly(q) { return !!q && (((q.warnings || []).indexOf('costly_route') > -1) || q.costPct > 15); }
  function costN(q) { return Math.round(q.costPct != null ? q.costPct : (q.fees && q.fees.impactPct) || 0); }
  function confirmButton() {
    if (costly(st.review) && !st.costOk) {
      var n = costN(st.review);
      var vr = $('vRows'), rc = vr.querySelector('.rcost'); if (!rc) { rc = document.createElement('div'); rc.className = 'rcost'; vr.appendChild(rc); }   /* under all the rows, Minimum received stays in view */
      rc.innerHTML = '<b data-slot="app.routecost.title">' + U.esc(S['app.routecost.title']) + '</b><p>' + U.esc(T('app.routecost.warn', { n: n })) + '</p><p class="hint" data-slot="app.routecost.hint">' + U.esc(S['app.routecost.hint']) + '</p>';
      $('revActs').innerHTML = '<div class="two"><button class="btn btn-ghost" type="button" id="costNo" data-slot="app.routecost.cancel">' + U.esc(S['app.routecost.cancel']) + '</button><button class="btn btn-lime" type="button" id="confirmBtn" data-slot="app.routecost.confirm">' + U.esc(T('app.routecost.confirm', { n: n })) + '</button></div>';
      $('costNo').onclick = function () { closeReview(); try { $('amount').focus(); } catch (e) {} };
      $('confirmBtn').onclick = function () { st.costOk = true; var r = $('vRows').querySelector('.rcost'); if (r) r.classList.add('ok'); confirmButton(); $('confirmBtn').focus(); };
      return;
    } var k = isSell(st.review) ? 'app.sell.confirm' : 'app.confirm'; $('revActs').innerHTML = '<button class="btn btn-lime btn-wide" type="button" id="confirmBtn" data-slot="' + k + '">' + U.esc(S[k]) + '</button>'; $('confirmBtn').onclick = runExecute; }
  /* B1: the quote is frozen when Review opens; "Sign and buy" signs exactly st.review */
  function openReview() {
    var q = st.quote; if (!q) return;
    clearTimeout(st.qTimer); clearTimeout(st.expTimer); st.qSeq++;
    st.review = q; st.ended = false; st.costOk = false; $('review').classList.remove('sold'); paintReview(q); $('review').classList.remove('ended');
    $('vRequote').hidden = true; $('phase').innerHTML = ''; confirmButton();
    $('review').hidden = false; document.body.classList.add('modal-open'); lockPage(true); $('confirmBtn').focus();
  }
  /* while Review is open nothing behind it can be reached — no chain change, no Enter on the page */
  function lockPage(on) {
    Array.prototype.forEach.call(document.body.children, function (el) { if (el !== $('review') && el.tagName !== 'SCRIPT') { if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert'); } });
    $('paySel').disabled = on; $('amount').readOnly = on;
  }
  $('review').addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var f = Array.prototype.filter.call($('review').querySelectorAll('button,a[href],input'), function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) { e.preventDefault(); return; }
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  function closeReview() {
    if (st.busy) return; $('review').hidden = true; document.body.classList.remove('modal-open'); lockPage(false);
    st.review = null; if (st.token) requote(0);
    var back = $('mainBtn'); if (back) back.focus();   // focus returns to the button that opened the review
  }
  $('revClose').addEventListener('click', closeReview);
  $('review').addEventListener('click', function (e) { if (e.target === this) closeReview(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('review').hidden) closeReview(); });

  function phaseLine(text, spin, link, hint, ico) { $('phase').innerHTML = '<p class="ph' + (spin ? ' spin' : '') + '">' + (ico || '') + U.esc(text) + (link ? ' <a href="' + U.esc(link) + '" target="_blank" rel="noopener">' + U.esc(S['app.explorer']) + '</a>' : '') + (hint ? '<span class="hint">' + U.esc(hint) + '</span>' : '') + '</p>'; }
  function runExecute() {
    var q = st.review, t = st.token; if (!q || st.busy) return;
    st.busy = true; st.ended = false; $('revActs').innerHTML = ''; $('revClose').disabled = true; $('vRequote').hidden = true;
    W.execute(q, function (s) {
      if (s.phase === 'switch') phaseLine(T('app.switching', { chain: s.chainName || CHAIN[qFrom(q)] }), true);
      else if (isSell(q) && s.phase === 'approve') phaseLine(T('app.sell.approve', { ticker: t.symbol }) + ' · ' + T('app.sell.step', { n: s.step || 1, of: s.of || 2 }), true, null, null, tIco());
      else if (isSell(q) && s.phase === 'sign') phaseLine(S['app.sign.wait'] + (s.of > 1 ? ' · ' + T('app.sell.step', { n: s.step, of: s.of }) : ''), true);
      else if (isSell(q) && s.phase === 'pending') { if (s.approving) phaseLine(T('app.sell.approve', { ticker: t.symbol }) + ' · ' + T('app.sell.step', { n: s.step || 1, of: s.of || 2 }), true, s.explorerUrl, null, tIco()); else phaseLine(((q.route && q.route.to) || 'rh') === 'rh' ? T('app.sell.pending.local', { ticker: t.symbol }) : T('app.sell.pending', { chain: CHAIN[q.route.to] || q.route.to }), true, s.explorerUrl, null, ((q.route && q.route.to) || 'rh') === 'rh' ? tIco() : cIco(q.route.to)); }
      else if (s.phase === 'approve' || s.phase === 'sign') phaseLine(S['app.sign.wait'], true);
      else if (s.phase === 'pending') phaseLine(qFrom(q) === 'rh' ? T('app.pending.local', { ticker: t.symbol }) : S['app.pending'], true, s.explorerUrl, null, tIco());
      else if (s.phase === 'pending_long') pendingLong(s);
      else if (s.phase === 'done') done(s);
      else if (s.phase === 'failed') failed(s);
    }).catch(function (e) {
      if (e && e.code === 'requote' && e.quote) { /* not signed: show the new numbers, wait for a second press */
        st.busy = false; $('revClose').disabled = false; st.review = e.quote; st.quote = e.quote;
        paintReview(e.quote); $('phase').innerHTML = ''; $('vRequote').textContent = S['app.requote']; $('vRequote').hidden = false; confirmButton(); paintQuote();
        return;
      }
      if (!st.ended) failed({ reason: (e && (e.reason || e.code)) || 'unknown', explorerUrl: e && e.explorerUrl }); /* C1: onStatus('failed') already painted the reason */
    });
  }
  function showPhase() { setTimeout(function () { try { $('phase').scrollIntoView({ block: 'end', behavior: U.RM ? 'auto' : 'smooth' }); } catch (e) {} }, 0); }   /* after the actions below have their final height */
  function pendingLong(s) {
    st.busy = false; st.ended = true; $('revClose').disabled = false;
    phaseLine(S['app.pending_long'], false, s.explorerUrl, S[isSell(st.review) ? 'app.sell.pending_long.hint' : 'app.pending_long.hint']);
    $('revActs').innerHTML = '';
    if (W.refresh) W.refresh();
  }
  function doneSell(s) {
    $('review').classList.add('sold');   /* the result says the amount; the review above it and its note are done */
    var q = st.review, t = st.token, has = s.received != null, amt = has ? F.num(s.received) : '', coinS = (q && q.outSymbol) || ch(st.to).native;
    st.busy = false; st.ended = true; $('revClose').disabled = false; /* nothing above the result moves; the result scrolls into view */
    $('phase').innerHTML = '<div class="done"><span class="ok">✓</span>' + (has ? '<b class="dn-amt" data-slot="app.sell.done">' + cIco((q && q.route && q.route.to) || st.to, 'big') + U.esc(T('app.sell.done', { amount: amt, coin: coinS })) + '</b><p>' + U.esc(CHAIN[(q && q.route && q.route.to) || st.to] || '') + '</p>' : '<p data-slot="app.sell.done.noamount">' + U.esc(S['app.sell.done.noamount']) + '</p>') +
      (s.explorerUrl ? '<a href="' + U.esc(s.explorerUrl) + '" target="_blank" rel="noopener">' + U.esc(S['app.explorer']) + '</a>' : '') + '</div>';
    showPhase();
    $('revActs').innerHTML = '<button class="btn btn-lime btn-wide" type="button" id="another" data-slot="app.sell.done.another">' + U.esc(S['app.sell.done.another']) + '</button>';
    $('another').onclick = function () { closeReview(); $('caInput').value = ''; $('sellAmt').value = ''; st.ca = null; resetToken(); show('empty'); picking(true, true); };
    if (W.refresh) W.refresh();
  }
  function done(s) {
    if (isSell(st.review)) return doneSell(s);
    var t = st.token, has = s.received != null, amt = has ? F.num(s.received) : '';
    st.busy = false; st.ended = true; $('revClose').disabled = false; /* nothing above the result moves; the result scrolls into view */
    $('phase').innerHTML = '<div class="done"><span class="ok">✓</span>' + (has ? '<span class="tag">' + U.esc(S['app.done.received']) + '</span><b class="dn-amt">' + tIco('big') + U.esc(amt + ' ' + t.symbol) + '</b>' : '<p>' + U.esc(S['app.done.noamount']) + '</p>') +
      (s.explorerUrl ? '<a href="' + U.esc(s.explorerUrl) + '" target="_blank" rel="noopener">' + U.esc(S['app.explorer']) + '</a>' : '') + '</div>';
    showPhase();
    $('revActs').innerHTML = '<button class="btn btn-lime btn-wide" type="button" id="addTok">' + U.esc(T('app.done.add', { ticker: t.symbol })) + '</button><p class="note">' + U.esc(S['app.done.add.note']) + '</p>' +
      '<div class="two"><button class="btn btn-ghost" type="button" id="again">' + U.esc(S['app.done.again']) + '</button><button class="btn btn-ghost" type="button" id="another">' + U.esc(S['app.done.another']) + '</button></div>';
    $('addTok').onclick = function () { W.addToken(t); };
    $('again').onclick = function () { closeReview(); check(t.ca); };
    $('another').onclick = function () { closeReview(); $('caInput').value = ''; $('amount').value = ''; st.ca = null; resetToken(); show('empty'); picking(true, true); };
    if (W.refresh) W.refresh();
  }
  function failed(s) {
    st.busy = false; st.ended = true; $('revClose').disabled = false;
    var sell = isSell(st.review);
    var k = sell ? ({ slippage: 'app.sell.failed.slippage', gas: 'app.sell.failed.gas', rejected: 'app.sell.failed.rejected', refunded: 'app.sell.failed.refunded' }[s.reason] || 'app.sell.failed')
      : ({ slippage: 'app.failed.slippage', gas: 'app.failed.gas', rejected: 'app.failed.rejected', refunded: 'app.failed.refunded' }[s.reason] || 'app.failed');
    $('phase').innerHTML = '<p class="ph err" data-slot="' + k + '">' + U.esc(T(k, { n: (st.review && st.review.slippagePct) || SLIP, chain: CHAIN[qFrom(st.review)], coin: sell ? ch('rh').native : qCoin(st.review), ticker: st.token ? st.token.symbol : '' })) + (s.explorerUrl ? ' <a href="' + U.esc(s.explorerUrl) + '" target="_blank" rel="noopener">' + U.esc(S['app.explorer']) + '</a>' : '') + '</p>';
    $('revActs').innerHTML = '<button class="btn btn-lime btn-wide" type="button" id="retry">' + U.esc(S['app.failed.retry']) + '</button>';
    $('retry').onclick = function () { closeReview(); };
  }

  /* ---------- tabs + activity ---------- */
  function tab(act) {
    $('tabSwap').classList.toggle('on', !act); $('tabAct').classList.toggle('on', act);
    $('tabSwap').setAttribute('aria-selected', String(!act)); $('tabAct').setAttribute('aria-selected', String(act));
    $('paneSwap').hidden = act; $('paneAct').hidden = !act; if (act) paintActivity();
  }
  $('tabSwap').addEventListener('click', function () { tab(false); }); $('tabAct').addEventListener('click', function () { tab(true); });
  function paintActivity() {
    var box = $('actList'), ws = wstate();
    if (ws.status !== 'in') { box.innerHTML = '<div class="actempty"><p>' + U.esc(S['app.activity.signin']) + '</p><button class="btn btn-lime" type="button" id="actSign">' + U.esc(S['nav.signin']) + '</button></div>'; $('actSign').onclick = function () { W && W.signIn(); }; return; }
    var rows = (W.history && W.history()) || [];
    if (!rows.length) { box.innerHTML = '<div class="actempty"><b>' + U.esc(S['app.activity.empty']) + '</b><p>' + U.esc(S['app.activity.empty.sub']) + '</p></div>'; return; }
    box.innerHTML = rows.map(function (r) {
      var L; return '<a class="actrow" ' + U.actAttrs(r) + '>' + U.tokIco(r.logo, r.symbol, '', r.ca) + '<span><b>' + U.esc((L = U.actLines(r, function (k) { var c = CHK[k]; return c ? { name: c.name, native: c.native } : null; }))[0]) + '</b><i>' + U.esc(L[1]) + '</i></span>' + U.actTail(r) + '</a>';
    }).join('');
    U.fillLogos(box);
  }

  /* ---------- settings ---------- */
  function paintSlip() {
    $('slipVal').textContent = SLIP + '%';
    $('slipNow').textContent = SLIP + '%'; var sw = $('slipWarn'); sw.hidden = !(SLIP > 5); sw.textContent = SLIP > 5 ? T('app.warn.slippage', { n: SLIP }) : '';
    document.querySelectorAll('[data-slip]').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-slip') === SLIP); });
    var c = $('slipCustom'); if (document.activeElement !== c) c.value = [0.5, 1, 3, 5].indexOf(SLIP) > -1 ? '' : SLIP;
  }
  function setSlip(v) { v = Math.round(parseFloat(v) * 10) / 10; if (!(v > 0 && v <= 20)) return; SLIP = v; try { localStorage.setItem('quoro.slippage', String(v)); } catch (e) {} paintSlip(); requote(300); }
  $('gear').addEventListener('click', function () { var n = $('slipBox'); n.hidden = !n.hidden; this.setAttribute('aria-expanded', String(!n.hidden)); });
  document.querySelectorAll('[data-slip]').forEach(function (b) { b.addEventListener('click', function () { setSlip(b.getAttribute('data-slip')); }); });
  document.addEventListener('click', function (e) { var n = $('slipBox'); if (!n.hidden && !e.target.closest('#slipBox,#gear')) { n.hidden = true; $('gear').setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('slipBox').hidden) { $('slipBox').hidden = true; $('gear').setAttribute('aria-expanded', 'false'); } });
  $('slipCustom').addEventListener('input', function () { this.value = this.value.replace(/[^0-9.]/g, ''); if (+this.value > 20) this.value = '20'; setSlip(this.value); });
  paintSlip();

  /* ---------- wallet + nav ---------- */
  function onWallet(ws) {
    var signed = ws.status === 'in';
    if (signed && ws.address !== st.waddr) { st.waddr = ws.address; loadWallet(); } if (!signed) { st.walletRows = null; st.waddr = null; }
    autoPick(); paintSources(); paintButton(); if (!$('paneAct').hidden) paintActivity(); if (!$('payModal').hidden) paintPay();
    if (signed && st.token) { loadHolding(); requote(0); }
  }
  if (W) { W.onChange(onWallet); onWallet(wstate()); } else { paintSources(); }

  /* ---------- footer block ---------- */
  if (API && LAYOUT !== 'landing') {   /* on the landing the network strip and the footer share landing.js's block counter */
    var P = null, t0 = 0;
    var paint = function () { if (!P) return; var b = P.block + (U.RM ? 0 : Math.floor((Date.now() - t0) / (P.blockMs || 100))); document.querySelectorAll('[data-pulse="block"]').forEach(function (e) { e.textContent = F.int(b); }); };
    var load = function () { API.pulse().then(function (p) { P = p; t0 = Date.now(); paint(); }).catch(function () {}); };
    load(); setInterval(load, 30000); if (!U.RM) setInterval(paint, 500);
  }

  paintQuote(); paintButton();
  /* /app?ca=0x… → check immediately */
  if (st.side === 'sell') { mount.classList.add('selling'); $('flipBtn').setAttribute('aria-label', S['app.flip.buy']); $('flipBtn').setAttribute('data-slot-aria', 'app.flip.buy'); paintSources(); }
  var m = location.search.match(/[?&]ca=(0x[0-9a-fA-F]{40})/);
  if (m && API) { $('caInput').value = m[1]; check(m[1]); }
})();
