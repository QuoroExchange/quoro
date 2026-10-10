// window.QuoroAPI: the page's only way to the server. Every call is async and throws an
// Error with .code: not_found, no_route, no_score, bad_input, rate_limited, offline, network, server.
(() => {
  if (window.QuoroAPI) return;   // ?mock on localhost defines it first

  async function call(path, init) {
    let r;
    try { r = await fetch(path, init); } catch { throw Object.assign(new Error('network'), { code: 'network' }); }
    let body = null;
    try { body = await r.json(); } catch { /* an empty or broken answer */ }
    if (!r.ok || (body && body.error)) {
      const code = (body && body.error) || (r.status === 429 ? 'rate_limited' : 'server');
      throw Object.assign(new Error(code), { code, status: r.status });
    }
    return body;
  }

  const cache = new Map();   // the same answer within a few seconds: the landing and the app ask for the same things
  function cached(key, ms, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < ms) return hit.p;
    const p = fn().catch(e => { cache.delete(key); throw e; });
    cache.set(key, { t: Date.now(), p });
    return p;
  }

  window.QuoroAPI = {
    config: () => cached('config', 600e3, () => call('/api/config')),
    pulse: () => cached('pulse', 2e3, () => call('/api/pulse')),
    examples: () => cached('examples', 30e3, () => call('/api/examples')),
    stocks: () => cached('stocks', 30e3, () => call('/api/stocks')),
    launches: ({ sort = 'trending', limit = 50 } = {}) => cached(`launches:${sort}:${limit}`, 20e3, () => call(`/api/launches?sort=${encodeURIComponent(sort)}&limit=${+limit || 50}`)),
    token: ca => cached('token:' + String(ca).toLowerCase(), 15e3, () => call('/api/token/' + encodeURIComponent(String(ca).trim()))),

    // buy: { ca, from, amount } — amount in the coin of `from`; sell: { side: 'sell', ca, to, amount } — amount in the token
    quote({ ca, from, amount, account, slippage, side, to }) {
      const qs = side === 'sell' ? new URLSearchParams({ side, ca, to: to || 'rh', amount: String(amount) })
                                 : new URLSearchParams({ ca, from, amount: String(amount) });
      if (account) qs.set('account', account);
      if (slippage != null) qs.set('slippage', String(slippage));   // percent; 3 by default
      return call('/api/quote?' + qs);
    },

    // the AI's first line on a launch, shown as soon as the token is read: { ca, score, text }; no_score for stocks and others
    brief: ca => cached('brief:' + String(ca).toLowerCase(), 300e3, () => call('/api/brief/' + encodeURIComponent(String(ca).trim()))),

    // the AI reading arrives as server-sent events; onChunk gets the text so far
    async explain(ca, onChunk) {
      let r;
      try {
        r = await fetch('/api/explain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ca }) });
      } catch { throw Object.assign(new Error('network'), { code: 'network' }); }
      if (!r.ok) {
        let code = r.status === 429 ? 'rate_limited' : 'server';
        try { code = (await r.json()).error || code; } catch { /* keep the status code */ }
        throw Object.assign(new Error(code), { code });
      }
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '', text = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
          if (!line.startsWith('data:')) continue;
          const m = JSON.parse(line.slice(5));
          if (m.error) throw Object.assign(new Error(m.error), { code: m.error === 'model' ? 'offline' : m.error });
          if (m.d) { text += m.d; onChunk && onChunk(text); }
        }
      }
      return text;
    },

    search: q => call('/api/search?q=' + encodeURIComponent(String(q).slice(0, 80))),
    wallet: account => call('/api/wallet?account=' + account),
    portfolio: (account, extra = []) => call('/api/portfolio?account=' + account + (extra.length ? '&extra=' + extra.slice(0, 50).join(',') : '')),

    // used by wallet.js
    balances: (account, fresh) => call('/api/balances?account=' + account + (fresh ? '&fresh=1' : '')),
    holding: (ca, account) => call(`/api/holding?ca=${ca}&account=${account}`),
    status: ({ provider, tx, requestId, fromChain, toChain }) =>
      call('/api/status?' + new URLSearchParams({ provider, tx, fromChain: String(fromChain), toChain: String(toChain || 4663), ...(requestId ? { requestId } : {}) })),
  };
})();
