// window.QuoroWallet: sign-in, balances, buying and selling. The 5 MB Privy bundle loads only
// when someone presses Sign in or has signed in before on this browser. Quoro never holds money: every transaction is signed
// in the person's own wallet, and the history of buys lives in this browser only.
(() => {
  if (window.QuoroWallet) return;   // ?mock on localhost defines it first
  const API = () => window.QuoroAPI;
  const KEY_IN = 'quoro.in';
  const listeners = new Set();
  const state = { status: 'out', address: null, balances: null };
  let privy = null, loading = null;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: nothing kept */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* same */ } },
  };

  function emit() { for (const cb of listeners) { try { cb({ ...state }); } catch (e) { console.error(e); } } }

  function apply(p) {
    privy = p;
    const was = state.address;
    if (!p.ready) { state.status = 'loading'; }
    else if (p.authenticated && p.address) { state.status = 'in'; state.address = p.address; store.set(KEY_IN, 1); }
    else if (p.authenticated) { state.status = 'loading'; }   // signed in, the wallet is still being made or connected
    else { state.status = 'out'; state.address = null; state.balances = null; store.del(KEY_IN); }
    emit();
    if (state.address && state.address !== was) refresh();
  }

  function load() {
    if (loading) return loading;
    state.status = 'loading'; emit();
    loading = (async () => {
      const cfg = await API().config();
      if (!cfg.privy) throw Object.assign(new Error('offline'), { code: 'offline' });
      window.PRIVY_APP_ID = cfg.privy;
      window.addEventListener('quoro-privy', e => apply(e.detail));
      await new Promise((ok, fail) => {
        const s = document.createElement('script');
        s.src = '/js/privy.js?v=' + (cfg.privyV || ''); s.async = true; s.onload = ok; s.onerror = () => fail(Object.assign(new Error('network'), { code: 'network' }));
        document.head.appendChild(s);
      });
      await until(() => privy && privy.ready, 20e3);
      return privy;
    })().catch(e => { loading = null; state.status = 'out'; emit(); throw e; });
    return loading;
  }

  function until(test, ms) {
    return new Promise((ok, fail) => {
      const t0 = Date.now();
      (function tick() {
        if (test()) return ok();
        if (Date.now() - t0 > ms) return fail(Object.assign(new Error('timeout'), { code: 'network' }));
        setTimeout(tick, 150);
      })();
    });
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function refresh() {
    if (!state.address) return;
    try { state.balances = await API().balances(state.address); emit(); } catch (e) { console.warn('balances', e.code || e); }
  }

  // ---- history (this browser only) ----
  const hkey = () => 'quoro.history.' + (state.address || '').toLowerCase();   // this browser's buys and sales
  function remember(entry) {
    const list = store.get(hkey(), []).filter(x => x.txHash !== entry.txHash);
    list.unshift(entry); store.set(hkey(), list.slice(0, 50));
  }

  function reason(e) {
    const m = String((e && (e.message || e.shortMessage)) || e || '').toLowerCase();
    if (e && (e.code === 4001 || e.code === 'ACTION_REJECTED') || /reject|denied|cancel/.test(m)) return 'rejected';
    if (/insufficient funds|gas required exceeds|intrinsic gas/.test(m)) return 'gas';
    if (/slippage|too little received|insufficient output|minout|min_out/.test(m)) return 'slippage';
    return 'unknown';
  }

  async function receipt(provider, hash) {
    for (let i = 0; i < 240; i++) {
      try {
        const r = await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] });
        if (r) return r;
      } catch { /* the node may not know the hash for a moment */ }
      await sleep(i < 20 ? 500 : 1500);
    }
    throw Object.assign(new Error('timeout'), { code: 'timeout' });
  }

  const hex = v => '0x' + BigInt(v || 0).toString(16);
  let NAMES = { 4663: 'Robinhood Chain' }, SOURCE = { rh: 4663 };   // filled from /api/config: every chain money can come from
  const loadChains = () => API().config().then(cfg => { for (const c of cfg.chains || []) { NAMES[c.id] = c.name; SOURCE[c.key] = c.id; } }).catch(() => {});
  let chainsReady = loadChains();


  // Signs exactly the quote the page showed. If that quote can't be signed as it is (priced before sign-in, stale, or for
  // another address), nothing is signed: a fresh quote comes back as Error{code:'requote', quote} for the page to show and
  // confirm again.
  // a native amount string from the server ("0.0012") as wei
  const toWei = v => { if (v == null) return null; const [w, f = ''] = String(v).split('.'); return BigInt(w || '0') * 10n ** 18n + BigInt((f + '0'.repeat(18)).slice(0, 18)); };
  const nativeOn = async (key, account) => { try { const b = await API().balances(account, true); return toWei(b[key]); } catch { return null; } };   // fresh: never a cached balance

  async function execute(quote, onStatus = () => {}) {
    if (state.status !== 'in') await signIn();
    const account = state.address;
    if (!account) throw Object.assign(new Error('auth'), { code: 'auth' });
    const qt = quote, selling = qt.side === 'sell';
    if (!qt.signable || !qt.steps || !qt.steps.length || Date.now() / 1000 > qt.expiresAt - 5 ||
        String(qt.recipient || '').toLowerCase() !== account.toLowerCase()) {
      const fresh = await API().quote(selling
        ? { side: 'sell', ca: qt.token.ca, to: qt.route.to, amount: qt.amountIn, account, slippage: qt.slippagePct }
        : { ca: qt.token.ca, from: qt.route.from, amount: qt.amountIn, account, slippage: qt.slippagePct });
      throw Object.assign(new Error('requote'), { code: 'requote', quote: fresh });
    }
    await chainsReady;
    if (!SOURCE[qt.route.from]) { chainsReady = loadChains(); await chainsReady; }   // config failed at load: ask once more
    const steps = qt.steps, of = steps.length, explorer = qt.explorer, want = SOURCE[qt.route.from];
    if (steps.some(s => s.chainId !== want)) throw Object.assign(new Error('chain mismatch'), { code: 'unknown' });   // never sign elsewhere
    // what is counted on arrival: the token bought, or the coin a sale pays out (on the chain it pays out on)
    const dst = selling ? (qt.route.to || 'rh') : 'rh', local = selling ? dst === 'rh' : qt.route.from === 'rh';
    const read = async () => selling ? nativeOn(dst, account)
      : (async () => { try { return BigInt((await API().holding(qt.token.ca, account)).raw); } catch { return null; } })();
    const before = await read();
    let gasSpent = 0n;   // a sale on Robinhood Chain pays its gas from the same ETH it receives
    const entry = { ts: Date.now(), side: selling ? 'sell' : 'buy', symbol: qt.token.symbol, ca: qt.token.ca, logo: qt.token.logo || null,
                    inSymbol: qt.inSymbol, amountIn: qt.amountIn,
                    from: qt.route.from, to: dst, outSymbol: selling ? qt.outSymbol : qt.token.symbol, quoted: qt.out, out: null,   // `out` only once it arrived
                    txHash: null, explorerUrl: null, status: 'pending' };
    let hash = null;
    const later = () => {   // sent, not confirmed yet: never "failed" (it may still land), never "received"
      Object.assign(entry, { status: 'pending' }); remember(entry);
      onStatus({ step: of, of, phase: 'pending_long', txHash: hash, explorerUrl: entry.explorerUrl });
      refresh();
      return entry;
    };
    try {
      for (let i = 0; i < of; i++) {
        const s = steps[i], approving = s.kind === 'approve';
        if (!approving && i > 0 && Date.now() / 1000 > qt.expiresAt - 5) {   // the permission took long: price the sale again first
          const fresh = await API().quote(selling
            ? { side: 'sell', ca: qt.token.ca, to: qt.route.to, amount: qt.amountIn, account, slippage: qt.slippagePct }
            : { ca: qt.token.ca, from: qt.route.from, amount: qt.amountIn, account, slippage: qt.slippagePct });
          throw Object.assign(new Error('requote'), { code: 'requote', quote: fresh, why: 'requote' });
        }
        onStatus({ step: i + 1, of, phase: 'switch', chainId: s.chainId, chainName: NAMES[s.chainId] });
        await privy.switchChain(s.chainId);
        const provider = await privy.provider();
        onStatus({ step: i + 1, of, phase: approving ? 'approve' : 'sign' });
        const tx = { from: account, to: s.to, data: s.data, value: hex(s.value), chainId: hex(s.chainId) };
        if (s.gas) tx.gas = hex(s.gas);
        const h = await provider.request({ method: 'eth_sendTransaction', params: [tx] });
        const explorerUrl = explorer + '/tx/' + h;
        if (!approving) { hash = h; Object.assign(entry, { txHash: h, explorerUrl }); remember(entry); }
        onStatus({ step: i + 1, of, phase: 'pending', txHash: h, explorerUrl, approving });
        let r;
        try { r = await receipt(provider, h); }
        catch (e) { if (e.code === 'timeout') { if (approving) throw Object.assign(new Error('approve timeout'), { why: 'unknown' }); return later(); } throw e; }
        if (r.status !== '0x1') throw Object.assign(new Error('reverted'), { why: approving ? 'unknown' : local ? 'slippage' : 'unknown' });
        try { gasSpent += BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice || '0x0'); } catch { /* no price on the receipt */ }
      }
      let received = null, landed = local;
      for (let i = 0; i < 150; i++) {
        let now = await read();
        if (selling && local && now !== null) {
          if (now + gasSpent <= before) { await sleep(2000); continue; }   // nothing arrived yet: never report the gas as the payout
          now += gasSpent;   // the gas left the same balance the sale paid into
        }
        if (before !== null && now !== null && now > before) { received = now - before; landed = true; break; }
        if (!local && i % 2 === 1) {
          let st = null;
          try { st = await API().status({ ...qt.track, tx: hash }); } catch { /* ask again */ }
          if (st && st.status === 'failed') throw Object.assign(new Error('bridge failed'), { why: 'refunded' });
          if (st && st.status === 'done') landed = true;
        }
        if (landed && (local ? i >= 3 : i >= 8)) break;   // settled; the balance read may lag a little
        await sleep(2000);
      }
      if (!landed) return later();
      const got = received === null ? null : fmt(received, selling ? 18 : (qt.token.decimals || 18));
      Object.assign(entry, { status: 'done', out: got }); remember(entry);   // no amount read: no number shown
      onStatus({ step: of, of, phase: 'done', txHash: hash, explorerUrl: entry.explorerUrl, received: got });
      refresh();
      return entry;
    } catch (e) {
      if (e.code === 'requote') throw e;   // nothing failed: the page shows the new price and waits (the permission stays)
      const why = e.why || reason(e);
      if (entry.txHash) { entry.status = 'failed'; remember(entry); }
      onStatus({ step: 0, of, phase: 'failed', txHash: hash, explorerUrl: entry.explorerUrl, reason: why });
      refresh();
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { code: why, reason: why });
    }
  }

  function fmt(raw, dec) {
    const s = raw.toString().padStart(dec + 1, '0');
    const whole = s.slice(0, s.length - dec), frac = s.slice(s.length - dec).replace(/0+$/, '').slice(0, 6);
    return frac ? `${whole}.${frac}` : whole;
  }

  async function signIn() {
    const p = await load();
    if (p.authenticated && p.address) return;
    p.login();
    await until(() => privy.authenticated && privy.address, 10 * 60e3);
  }

  window.QuoroWallet = {
    get state() { return { ...state }; },
    onChange(cb) { listeners.add(cb); cb({ ...state }); return () => listeners.delete(cb); },
    signIn,
    async signOut() { if (privy) await privy.logout(); store.del(KEY_IN); state.status = 'out'; state.address = null; state.balances = null; emit(); },
    refresh,
    execute,
    async addToken(t) {
      if (!privy || !state.address) return false;
      await privy.switchChain(4663);
      const provider = await privy.provider();
      const image = t.logo && /^https:/.test(t.logo) ? t.logo : t.logo ? location.origin + t.logo : undefined;
      return provider.request({ method: 'wallet_watchAsset',
        params: { type: 'ERC20', options: { address: t.ca, symbol: String(t.symbol || '').slice(0, 11), decimals: t.decimals || 18, image } } });
    },
    history() { return state.address ? store.get(hkey(), []) : []; },
  };

  // signed in here before: bring the session back without a click
  if (store.get(KEY_IN, 0)) load().catch(() => {});
})();
