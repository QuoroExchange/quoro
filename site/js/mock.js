/* Quoro mocks — same shapes as the server API. Loaded ONLY on localhost with ?mock (see boot.js).
 Defines window.QuoroAPI / window.QuoroWallet only if absent (or always with ?mock=force).
 Test addresses (paste in /app?mock):
 0x0cb3…fb5b LOC launch 9/10 0x7a11…0007 ARGAN launch 7, age cap
 0x1d1e…1d1e IDLE launch 4, idle cap 0x9a27…0003 PART partial read
 0x322f…2d00 TSLA stock 0x1111…1111 OTHER other ERC-20
 0xdead…dead not found 0x5ca1…5ca1 slow read (12 s)
 Wallet scenarios via URL: &bal=none (no ETH anywhere) · &bal=rh0 (no ETH on Robinhood Chain) ·
 &fail=slippage|gas|refunded|rejected|unknown · &switch (wallet on wrong network first) · &noroute
 &requote (first execute() throws {code:'requote'}) · &long (pending_long) · &noamount (done without received) */
(function () {
  if (!window.QUORO_MOCK) return;
  var force = /[?&]mock=force\b/.test(location.search), q = location.search;
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var err = function (code) { var e = new Error(code); e.code = code; return e; };
  var arg = function (k) { var m = q.match(new RegExp('[?&]' + k + '(?:=([^&]*))?')); return m ? (m[1] || true) : null; };
  var NV = 'https://cdn.jsdelivr.net/gh/nvstly/icons@main/ticker_icons/';
  var CA = {
    loc: '0x0cb3a7e0b0c1d2e3f4a5b6c7d8e9f0a1b2c3fb5b', argan: '0x7a11000000000000000000000000000000000007',
    old: '0x1d1e000000000000000000000000000000001d1e', part: '0x9a27000000000000000000000000000000000003',
    tsla: '0x322f00000000000000000000000000000c1c2d00', other: '0x1111111111111111111111111111111111111111',
    dead: '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead', slow: '0x5ca15ca15ca15ca15ca15ca15ca15ca15ca15ca1'
  };
  function caps(applied) { return ['flag', 'dev', 'dev25', 'idle', 'age', 'partial'].map(function (id) { return { id: id, limit: { flag: 5, dev: 5, dev25: 3, idle: 4, age: 7, partial: 8 }[id], applied: applied.indexOf(id) > -1 }; }); }
  function F(h, b, d, l, sm) { return [{ id: 'hygiene', points: h, max: 10 }, { id: 'buyers', points: b, max: 4 }, { id: 'depth', points: d, max: 3 }, { id: 'liveness', points: l, max: 2 }, { id: 'smart', points: sm, max: 1 }]; }
  function launch(ca, sym, name, ageMin, curve, facts, sc) {
    return { kind: 'launch', ca: ca, symbol: sym, name: name, logo: null, decimals: 18, priceUsd: 0.0000277, change24h: 3.1, mcapUsd: 27700,
      pair: 'ETH', ageMin: ageMin, curvePct: curve, graduated: false, facts: facts, score: sc, flags: [] };
  }
  var TOK = {};
  TOK[CA.loc] = launch(CA.loc, 'LOC', 'Line Of Credit', 80, 32, { buyers: 82, sellers: 34, devPct: 0, devBurned: true, snipersPct: 0, taxExempt: 0, creatorTaxBps: 200, smartWallets: 8, lastTradeMin: 3 },
    { value: 9, hygiene: 10, market: 7, partial: false, caps: caps([]), factors: F(10, 2, 2, 2, 1) });
  TOK[CA.argan] = launch(CA.argan, 'ARGAN', 'Argan', 0.6, 7.6, { buyers: 17, sellers: 2, devPct: 0.91, devBurned: false, snipersPct: 0, taxExempt: 0, creatorTaxBps: 0, smartWallets: 0, lastTradeMin: 0 },
    { value: 7, hygiene: 10, market: 4, partial: false, caps: caps(['age']), factors: F(10, 1, 1, 2, 0) });
  TOK[CA.old] = launch(CA.old, 'IDLE', 'Idle Example', 5760, 6.4, { buyers: 41, sellers: 19, devPct: 0, devBurned: false, snipersPct: 4, taxExempt: 0, creatorTaxBps: 300, smartWallets: 0, lastTradeMin: 5760 },
    { value: 4, hygiene: 9, market: 3, partial: false, caps: caps(['idle']), factors: F(9, 2, 1, 0, 0) });
  TOK[CA.part] = launch(CA.part, 'PART', 'Partial Read', 210, 18, { buyers: 64, sellers: 20, devPct: 2, devBurned: false, snipersPct: 1, taxExempt: 0, creatorTaxBps: 100, smartWallets: 3, lastTradeMin: 9 },
    { value: 8, hygiene: 9, market: 6, partial: true, caps: caps(['partial']), factors: F(9, 2, 1, 2, 1) });
  TOK[CA.tsla] = { kind: 'stock', ca: CA.tsla, symbol: 'TSLA', name: 'Tesla', logo: NV + 'TSLA.png', decimals: 18, priceUsd: 431.2, change24h: -1.4, mcapUsd: null, facts: null, score: null,
    spark: [20, 21, 19, 22, 23, 22, 24, 23, 21, 22, 24, 25, 24, 23, 25, 26, 24, 25, 27, 26, 25, 26, 27, 28] };
  TOK['0x0000000000000000000000000000000000000000'] = { kind: 'native', ca: '0x0000000000000000000000000000000000000000', symbol: 'ETH', name: 'Ether', logo: '/assets/chains/eth-coin.svg', decimals: 18, priceUsd: 2496, facts: null, score: null };
  TOK[CA.other] = { kind: 'other', ca: CA.other, symbol: 'OTHER', name: 'Some Token', logo: null, decimals: 18, priceUsd: null, change24h: null, facts: null, score: null, supply: '1000000000' };
  TOK[CA.slow] = launch(CA.slow, 'SLOW', 'Slow Read', 12, 9, TOK[CA.argan].facts, TOK[CA.argan].score);

  var STOCKS = [['NVDA', 'NVIDIA', 182.4], ['TSLA', 'Tesla', 431.2], ['AAPL', 'Apple', 254.1], ['AMZN', 'Amazon', 221.8], ['MSFT', 'Microsoft', 512.6], ['META', 'Meta Platforms', 712.3],
    ['GOOGL', 'Alphabet', 241.5], ['COIN', 'Coinbase', 352.9], ['PLTR', 'Palantir', 178.2], ['AMD', 'AMD', 214.7], ['NFLX', 'Netflix', 1211.4], ['SPY', 'SPDR S&P 500', 669.3]];
  var t0 = Date.now(), B0 = 4182907;
  var api = {
    pulse: function () { return wait(250).then(function () { return { block: B0 + Math.floor((Date.now() - t0) / 100), blockMs: 100, tokens: 323, stocks: 64, scored: 42, flagged: 30, ts: Math.floor(Date.now() / 1000) }; }); },
    examples: function () { return wait(300).then(function () { return [
      { ca: CA.loc, symbol: 'LOC', name: 'Line Of Credit', logo: null, score: 9, kind: 'launch', capped: false },
      { ca: CA.argan, symbol: 'ARGAN', name: 'Argan', logo: null, score: 7, kind: 'launch', capped: true },
      { ca: CA.tsla, symbol: 'TSLA', name: 'Tesla', logo: NV + 'TSLA.png', score: null, kind: 'stock' }]; }); },
    token: function (ca) {
      ca = String(ca).toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(ca)) return Promise.reject(err('bad_input'));
      return wait(ca === CA.slow ? 12000 : 900).then(function () {
        if (ca === CA.dead) throw err('not_found');
        if (ca === '0xc0de0000000000000000000000000000000c0de0') throw err('not_a_token');
        return JSON.parse(JSON.stringify(TOK[ca] || Object.assign({}, TOK[CA.loc], { ca: ca })));
      });
    },
    explain: function (ca, onChunk) {
      var t = TOK[String(ca).toLowerCase()] || TOK[CA.loc];
      var text = t.symbol === 'LOC' ? 'Clean launch. No tax-free wallets, no snipers in the first blocks, and the creator sold nothing. 82 buyers, the curve is 32% full, last trade 3 minutes ago. Creator tax is 2% on every trade.'
        : t.symbol + ': mock explanation of the ' + (t.score ? t.score.value : '') + '/10 from the facts above.';
      var words = text.split(' '), out = '';
      return words.reduce(function (p, w) { return p.then(function () { out += (out ? ' ' : '') + w; onChunk && onChunk(out); return wait(35); }); }, wait(300)).then(function () { return out; });
    },
    brief: function (ca) {
      var t = TOK[String(ca).toLowerCase()] || TOK[CA.loc];
      return wait(arg('slowbrief') ? 4000 : 1500).then(function () {
        if (arg('nobrief') || !t.score) throw err('no_score');
        return { ca: t.ca, score: t.score.value, text: t.symbol === 'LOC' ? 'Clean launch: the creator sold nothing and 82 wallets bought in. The curve is a third full, so price still moves fast. 2% creator tax on every trade.' : t.symbol + ' scores ' + t.score.value + '/10: mock brief from the facts.' };
      });
    },
    config: function () { return wait(50).then(function () { return { chains: CHAINS }; }); },
    wallet: function () { return wait(300).then(function () {
      var rows = CHAINS.map(function (c) { var a = +(BAL[c.key] || 0); return { key: c.key, chainId: c.id, name: c.name, symbol: c.native, amount: String(a), usd: +(a * (c.native === 'ETH' ? 2496 : c.native === 'BNB' ? 610 : 0.11)).toFixed(2) }; })
        .filter(function (r) { return +r.amount > 0; }).sort(function (a, b) { return b.usd - a.usd; });
      return { total: rows.reduce(function (t, r) { return t + r.usd; }, 0), rows: rows }; }); },
    portfolio: function () { return wait(500).then(function () { if (arg('emptyp')) return { totalUsd: 0, items: [], hidden: 0 };
      var items = [{ ca: null, kind: 'native', symbol: 'ETH', name: 'Ether', logo: '/assets/chains/eth-coin.svg', amount: '0.2', priceUsd: 2496, valueUsd: 499.2, change24h: 1.2, score: null },
        { ca: CA.loc, kind: 'launch', symbol: 'LOC', name: 'Line Of Credit', logo: null, amount: '4412906', priceUsd: 0.0000277, valueUsd: 122.24, change24h: 3.1, score: 9 },
        { ca: CA.tsla, kind: 'stock', symbol: 'TSLA', name: 'Tesla', logo: NV + 'TSLA.png', amount: '0.25', priceUsd: 431.2, valueUsd: 107.8, change24h: -1.4, score: null },
        { ca: CA.other, kind: 'other', symbol: 'OTHER', name: 'Some Token', logo: null, amount: '1200', priceUsd: null, valueUsd: null, change24h: null, score: null }];
      return { totalUsd: 729.24, items: items, hidden: 3 }; }); },
    search: function (q) { return wait(250).then(function () { q = String(q || '').trim().toLowerCase();
      if (/^0x[0-9a-f]{40}$/.test(q)) { var t = TOK[q]; if (!t) throw err('not_found'); return { results: [{ ca: t.ca, kind: t.kind, symbol: t.symbol, name: t.name, logo: t.logo, priceUsd: t.priceUsd, mcapUsd: t.mcapUsd || null, score: t.score ? t.score.value : null }] }; }
      var all = Object.keys(TOK).map(function (k) { var t = TOK[k]; return { ca: t.ca, kind: t.kind, symbol: t.symbol, name: t.name, logo: t.logo, priceUsd: t.priceUsd, mcapUsd: t.mcapUsd || null, score: t.score ? t.score.value : null }; });
      return { results: all.filter(function (r) { return (r.symbol + ' ' + r.name).toLowerCase().indexOf(q) > -1; }).slice(0, 8) }; }); },
    launches: function (o) { o = o || {}; return wait(300).then(function () {
      var names = [['FUSION', 'Fusion'], ['SLPI', 'Slop Inspector'], ['LOC', 'Line Of Credit'], ['JITTER', 'Jitterbug'], ['ARGAN', 'Argan'], ['MEMEPIT', 'MemePit'], ['HOOJA', 'Hooja'], ['XULT', 'Xulture']];
      var rows = names.map(function (n, i) { var sp = []; for (var k = 0; k < 24; k++) sp.push(1 + Math.sin(i + k / 3) * .2 + k * (i % 2 ? .02 : -.01));
        return { ca: '0x' + String(i + 1).padStart(40, 'a'), symbol: n[0], name: n[1], logo: null, mcapUsd: 4000 + i * 3100, change1h: i % 3 ? 4.2 * i : -6.1, change24h: i % 2 ? 12.5 * i : -3.3, vol24hUsd: 5000 + i * 2200, ageMin: 10 + i * 37, graduated: false, buyers: 20 + i * 9, score: i === 1 ? null : 9 - i % 6, spark: sp }; });
      if (o.sort === 'recent') rows.sort(function (a, b) { return a.ageMin - b.ageMin; });
      return { rows: rows.slice(0, o.limit || 50), t: Math.floor(Date.now() / 1000) }; }); },
    stocks: function () { return wait(400).then(function () { return STOCKS.map(function (s, i) {
      var sp = [], v = 20; for (var k = 0; k < 24; k++) { v += Math.sin(i * 3 + k * .9) * 2 + (k % 3 - 1); sp.push(+(s[2] * (1 + v / 1000)).toFixed(2)); }
      return { ticker: s[0], name: s[1], logo: NV + s[0] + '.png', priceUsd: s[2], change24h: i % 3 ? 1.2 : -0.8, spark: sp }; }); }); },
    holding: function (ca) { return wait(250).then(function () { var t = TOK[String(ca).toLowerCase()]; var amt = arg('hold0') ? '0' : t && t.kind === 'stock' ? '0.25' : '4412906.5'; return { raw: (BigInt(Math.round(+amt * 1e6)) * 1000000000000n).toString(), amount: amt, decimals: 18 }; }); },
    quote: function (o) {
      if (o.side === 'sell') return wait(500).then(function () {
        var t = TOK[String(o.ca).toLowerCase()] || TOK[CA.loc], amt = +o.amount || 0, price = t.priceUsd || 0.0000277, usd = amt * price, to = o.to || 'rh';
        var c = CHAINS.filter(function (x) { return x.key === to; })[0] || CHAINS[0], px = c.native === 'ETH' ? 2496 : c.native === 'BNB' ? 610 : 0.11, out = usd * 0.97 / px, slip = o.slippage || 3;
        var w = []; if (t.facts && t.facts.creatorTaxBps) w.push('creator_tax'); if (arg('nogas')) w.push('no_gas');
        var appr = !arg('noapprove');
        return { side: 'sell', slippagePct: slip, amountIn: String(o.amount), inSymbol: t.symbol, outSymbol: c.native, inUsd: usd, out: String(+out.toPrecision(6)), outMin: String(+(out * (1 - slip / 100)).toPrecision(6)), outUsd: usd * 0.97,
          token: { ca: t.ca, symbol: t.symbol, decimals: 18, logo: t.logo }, route: { from: 'rh', to: to, toName: c.name, label: 'Sell', signatures: appr ? 2 : 1 },
          fees: { relayerUsd: to === 'rh' ? null : 0.03, routeUsd: t.kind === 'stock' ? usd * 0.0025 : 0, creatorTaxPct: t.facts ? t.facts.creatorTaxBps / 100 : 0, creatorTaxUsd: t.facts ? usd * t.facts.creatorTaxBps / 10000 : 0, networkUsd: 0.01, impactPct: 0.6 },
          costPct: arg('costly') && !local ? 27.7 : 2.1, warnings: w, expiresAt: Math.floor(Date.now() / 1000) + 30, signable: true, recipient: wallet.state.address,
          steps: (appr ? [{ chainId: 4663, to: '0x0', data: '0x', value: '0', kind: 'approve' }] : []).concat([{ chainId: 4663, to: '0x0', data: '0x', value: '0', kind: 'sell' }]) };
      });
      return wait(500).then(function () {
        if (arg('noroute')) throw err('no_route');
        var slip = o.slippage || 3;
        var t = TOK[String(o.ca).toLowerCase()] || TOK[CA.loc], amt = +o.amount || 0, usd = amt * 2496, local = o.from === 'rh';
        var price = t.priceUsd || 0.0000277, out = usd * 0.98 / price;
        var bal = wallet.state.balances && wallet.state.balances[o.from];
        var w = []; if (t.facts && t.facts.creatorTaxBps) w.push('creator_tax'); if (amt >= 1) w.push('high_impact'); if (arg('costly') && !local) w.push('costly_route');
        if (wallet.state.status === 'in' && bal != null && amt > +bal) w.push('over_balance');
        return { slippagePct: slip, amountIn: String(o.amount), inUsd: usd, out: String(out), outMin: String(out * (1 - slip / 100)), outUsd: usd * 0.98,
          route: { from: o.from, label: local ? 'Buy on curve' : 'Bridge + buy on curve', signatures: 1, etaSec: local ? 1 : 2 },
          fees: { relayerUsd: local ? null : 0.03, routeUsd: 0.31, creatorTaxPct: t.facts ? t.facts.creatorTaxBps / 100 : 0, creatorTaxUsd: t.facts ? usd * t.facts.creatorTaxBps / 10000 : 0, networkUsd: 0.01, impactPct: amt >= 1 ? 6.2 : 0.8 },
          costPct: arg('costly') && !local ? 27.7 : 2.1, warnings: w, expiresAt: Math.floor(Date.now() / 1000) + 30,
          steps: [{ chainId: local ? 4663 : 8453, to: '0x0', data: '0x', value: '0', kind: local ? 'buy' : 'bridge' }] };
      });
    }
  };
  var CHAINS = [['rh', 4663, 'Robinhood Chain', 'ETH', 0.00005], ['ethereum', 1, 'Ethereum', 'ETH', 0.0005], ['base', 8453, 'Base', 'ETH', 0.00005], ['arbitrum', 42161, 'Arbitrum', 'ETH', 0.00005], ['optimism', 10, 'Optimism', 'ETH', 0.00005], ['bnb', 56, 'BNB Chain', 'BNB', 0.0005], ['polygon', 137, 'Polygon', 'POL', 0.05], ['unichain', 130, 'Unichain', 'ETH', 0.00005], ['linea', 59144, 'Linea', 'ETH', 0.00005], ['zksync', 324, 'ZKsync', 'ETH', 0.00005], ['scroll', 534352, 'Scroll', 'ETH', 0.00005], ['blast', 81457, 'Blast', 'ETH', 0.00005], ['ink', 57073, 'Ink', 'ETH', 0.00005], ['worldchain', 480, 'World Chain', 'ETH', 0.00005], ['soneium', 1868, 'Soneium', 'ETH', 0.00005], ['abstract', 2741, 'Abstract', 'ETH', 0.00005], ['mode', 34443, 'Mode', 'ETH', 0.00005]]
    .map(function (c) { return { key: c[0], id: c[1], name: c[2], native: c[3], reserve: c[4], explorer: '#', logo: '/assets/chains/' + c[0] + '.svg', nativeLogo: '/assets/chains/' + c[3].toLowerCase() + '-coin.svg' }; });
  var listeners = [], hist = [];
  if (arg('hist')) { var ex0 = 'https://explorer.mainnet.chain.robinhood.com/tx/0xabc', n0 = Date.now();
    hist = [{ ts: n0 - 40e3, side: 'buy', symbol: 'LOC', ca: CA.loc, logo: null, amountIn: '0.01', from: 'base', to: 'rh', out: null, quoted: '361203', txHash: '0xabc', explorerUrl: ex0, status: 'pending' },
      { ts: n0 - 2 * 60e3, side: 'sell', symbol: 'LOC', ca: CA.loc, logo: null, amountIn: '120000', from: 'rh', to: 'base', outSymbol: 'ETH', out: '0.0031', txHash: '0xabc', explorerUrl: ex0, status: 'done' },
      { ts: n0 - 3600e3 * 3, side: 'buy', symbol: 'LOC', ca: CA.loc, logo: null, amountIn: '0.05', from: 'arbitrum', to: 'rh', out: null, quoted: '1804112', txHash: '0xabc', explorerUrl: ex0, status: 'failed' },
      { ts: n0 - 86400e3 * 2, side: 'buy', symbol: 'LOC', ca: CA.loc, logo: null, amountIn: '0.02', from: 'rh', to: 'rh', out: '722410', txHash: '0xabc', explorerUrl: ex0, status: 'done' },
      { ts: n0 - 86400e3 * 9, side: 'buy', symbol: 'LOC', ca: CA.loc, logo: null, amountIn: '0.2', from: 'polygon', to: 'rh', out: '91022', txHash: '0xabc', explorerUrl: ex0, status: 'done' }]; }
  var BAL = arg('bal') === 'none' ? { rh: '0', base: '0', arbitrum: '0', ethereum: '0' } : arg('bal') === 'rh0' ? { rh: '0', base: '0.412', arbitrum: '0.05', ethereum: '0' } : { rh: '0.20', base: '0.412', arbitrum: '0.05', ethereum: '0', linea: '0.000094899364', polygon: '0.899023252043', bnb: '0.0123', zksync: '0.000000004' };
  var wallet = {
    state: { status: 'out', address: null, balances: { rh: null, base: null, arbitrum: null, ethereum: null } },
    onChange: function (cb) { listeners.push(cb); cb(wallet.state); return function () { listeners = listeners.filter(function (x) { return x !== cb; }); }; },
    _emit: function () { var s = wallet.state; listeners.forEach(function (cb) { cb(s); }); },
    signIn: function () { wallet.state = { status: 'loading', address: null, balances: wallet.state.balances }; wallet._emit();
      return wait(700).then(function () { wallet.state = { status: 'in', address: '0x8f3c00000000000000000000000000000000a21e', balances: Object.assign({}, BAL) }; wallet._emit(); }); },
    signOut: function () { wallet.state = { status: 'out', address: null, balances: { rh: null, base: null, arbitrum: null, ethereum: null } }; wallet._emit(); return Promise.resolve(); },
    refresh: function () { wallet._emit(); return Promise.resolve(); },
    history: function () { return hist.slice(); },
    execute: function (quote, onStatus) {
      var fail = arg('fail'), of = quote.steps.length, ex = 'https://explorer.mainnet.chain.robinhood.com/tx/0xabc';
      if (arg('requote') && !wallet._rq) { wallet._rq = 1; var nq = Object.assign({}, quote, { out: String(+quote.out * 0.97), outMin: String(+quote.outMin * 0.97), expiresAt: Math.floor(Date.now() / 1000) + 30 });
        return wait(400).then(function () { var e = err('requote'); e.quote = nq; throw e; }); }
      var p = wait(200);
      if (arg('switch')) p = p.then(function () { onStatus({ step: 1, of: of, phase: 'switch', chainId: 8453, chainName: 'Base' }); return wait(1200); });
      if (quote.side === 'sell' && quote.steps[0].kind === 'approve') p = p.then(function () { onStatus({ step: 1, of: of, phase: 'approve' }); return wait(1300); }).then(function () { onStatus({ step: 1, of: of, phase: 'pending', approving: true, explorerUrl: ex }); return wait(900); });
      return p.then(function () { onStatus({ step: of, of: of, phase: 'sign' }); return wait(1200); })
        .then(function () {
          if (fail === 'rejected') { onStatus({ step: 1, of: of, phase: 'failed', reason: 'rejected' }); return; }
          onStatus({ step: 1, of: of, phase: 'pending', txHash: '0xabc', explorerUrl: ex });
          return wait(1800).then(function () {
            var row = { ts: Date.now(), side: quote.side === 'sell' ? 'sell' : 'buy', to: quote.route.to || 'rh', outSymbol: quote.outSymbol, symbol: quote.side === 'sell' ? quote.inSymbol : 'LOC', ca: CA.loc, logo: (quote.token && quote.token.logo) || null, amountIn: quote.amountIn, from: quote.route.from, out: quote.out, txHash: '0xabc', explorerUrl: ex, status: 'done' };
            if (arg('long')) { onStatus({ step: 1, of: of, phase: 'pending_long', txHash: '0xabc', explorerUrl: ex }); row.status = 'pending'; }
            else if (fail) { onStatus({ step: 1, of: of, phase: 'failed', reason: fail, txHash: '0xabc', explorerUrl: ex }); row.status = 'failed'; var fe = err(fail); fe.reason = fail; hist.unshift(row); throw fe; }
            else onStatus({ step: 1, of: of, phase: 'done', txHash: '0xabc', explorerUrl: ex, received: arg('noamount') ? null : quote.out });
            hist.unshift(row);
          });
        });
    },
    addToken: function () { return wait(300); }
  };
  if (force || !window.QuoroAPI) window.QuoroAPI = api;
  if (force || !window.QuoroWallet) window.QuoroWallet = wallet;
  window.QUORO_MOCK_CA = CA;
})();
