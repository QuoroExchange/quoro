# Quoro

**The first AI DEX on Robinhood Chain.** Know before you buy.

Paste the address of any Robinhood Chain token to see its facts. Every launch gets a Data score from 1 to 10, and Quoro AI
explains it in plain words. Then you buy with ETH, BNB or POL from 17 chains, or sell, from your own wallet.

Live at [quoro.exchange](https://quoro.exchange) · [@quoroexchange](https://x.com/quoroexchange)

This repository is the whole product: the server and the site, exactly what runs in production. It is public so anyone can
check how a score is counted and what happens to their money. Quoro never holds it.

## Non-custodial by design

Every trade is a transaction you sign in your own wallet. Here is what the code does to keep it that way.

- Quoro never holds funds and has no keys. The server prices a route and returns the transaction; **you sign it in your own
  wallet**. There is no Quoro contract between you and the trade.
- Before a transaction is returned, the server checks it against what the page shows: the chain of every step equals the chain
  you pay from, the value sent is never more than the amount you entered, and the recipient is your connected address.
  A quote priced before you connect carries no transaction at all.
- Selling needs an ERC-20 approval. Quoro writes it itself: **exactly the amount you sell**, to the contract that then takes
  the tokens, checked against the route (never an unlimited approval).
- The wallet signs exactly the quote you confirmed. If it went stale or the address changed, nothing is signed: you see the new
  numbers and confirm again. A route that costs more than 15% of what you pay needs an explicit second confirmation.
- Your history of buys and sales is kept in your browser only.

Code: `server/server.py` (`quote`, `sell`, `lifi_quote`, `relay_quote`) and `site/js/wallet.js` (`execute`).

## The Data score

`score = round(0.6 × launch + 0.4 × market)`, then the lowest cap that applies.

- **Launch, 0–10.** Launch hygiene: 10 minus deductions (wallets exempt from the opening tax −3, snipers over 15% / 5% of
  supply in the first blocks −2 / −1, a deployer with 5+ launches and none moved to a pool −2, a launch mill −2, a farm
  fingerprint −2, the deployer sold on this curve −2, the deployer sold earlier launches −1, the deployer bought over 12% −1,
  creator tax above 3% −1, creator fees to a third party −1, no socials −1), plus credits (the deployer's share burned +1,
  a deployer who moved launches to a pool and never sold +1).
- **Market, 0–10.** Buyers (0–4), how full the curve is (0–3), the last trade (0–2), smart wallets (0–1).
- **Caps.** A red flag caps the score at 5; the deployer holding over 10% caps it at 5, over 25% at 3; no trades for 24 hours
  at 4; under 10 minutes old at 7; an incomplete read at 8.

Stock tokens and other tokens get facts but no score. The score describes the launch and how it trades, not the future price.
It is not financial advice. Code: `score()` in `server/server.py`; the full rules are also at
[quoro.exchange/docs](https://quoro.exchange/docs#score).

**Quoro AI** explains a launch's score from the same facts, in one or two lines and on request in full. It names no numbers it
was not given, gives no advice and makes no predictions (`BRIEF_SYSTEM`, `SYSTEM` in `server/server.py`).

## How a trade is routed

Every quote asks [LI.FI](https://li.fi) and [Relay](https://relay.link) at once and keeps the route that delivers more.
Stock tokens route only through LI.FI. Payment is the native coin of one of 17 chains: Robinhood Chain, Ethereum, Base,
Arbitrum, Optimism, BNB Chain, Polygon, Unichain, Linea, ZKsync, Scroll, Blast, Ink, World Chain, Soneium, Abstract, Mode.
Every route is one transaction for a buy; a sale is an approval plus the sale. Fees are shown before you sign: network fee,
bridge fee, the route provider's fee (LI.FI takes 0.25% on its routes), the token's creator tax and the price impact.
Quoro itself takes no fee.

## Public API

The reads behind the site are open: no key, no sign-up, and any site may call them from the browser (they answer
with `access-control-allow-origin: *`).

| endpoint | what it returns |
|---|---|
| `GET /api/token/{address}` | a Robinhood Chain token: facts, its Data score and the flags behind it (60 requests a minute) |
| `GET /api/launches?sort=trending\|recent\|all&limit=50` | scored launches, newest or most traded first |
| `GET /api/pulse` | chain numbers: block, new tokens in 24 hours, how many tracked launches are red-flagged |
| `GET /api/stocks` | the 64 stock tokens of Robinhood Chain and their prices |

Everything else (quotes, wallets, portfolio) answers only the site itself. Docs: [quoro.exchange/docs#api](https://quoro.exchange/docs#api).

## @QuoroAI, the reply account

[@QuoroAI](https://x.com/QuoroAI) answers on X. Tag it with a Robinhood Chain token address, or reply to one of its
posts with one, and it replies with that token's Data score and up to three flags, read from `GET /api/token`.

- It answers only when asked: the handle typed in the person's own words, or a direct reply to its post. X adds the
  thread's handles to every reply, and those alone are not a request.
- No address, no reply. If the address is not in the mention it looks in the post being answered, and buys a full
  copy of that post when X sends it truncated.
- One reply per mention, marked before it is sent, so a crash can lose an answer but never send a second one.
  "stop" opts a person out for good.
- The reply text is built from rules, not written by a model, and carries one cashtag and no link.

Code: `bot/` (`worker.py` the loop, `render.py` the reply text, `xapi.py` the X API calls, standard library only).

## Run it

```bash
cp server/.env.example server/.env    # fill ENGINE_URL and PRIVY_APP_ID at least
pip install -r server/requirements.txt
python3 server/server.py              # http://127.0.0.1:8795
```

The server is one Python process (standard library plus Pillow for thumbnails). Token facts come from a launch data engine
(`ENGINE_URL`); prices of the 64 stock tokens are read from their Robinhood Chain pools; quotes come from LI.FI and Relay.

The wallet window is a small Privy bundle, prebuilt at `site/js/privy.js`. To rebuild it (Node 22):

```bash
cd privy && npm install && node build.mjs
```

`site/js/mock.js` fakes the server and the wallet for UI work; it loads only with `?mock` on localhost and is removed from the
production image (`Dockerfile`).

## Layout

```
server/server.py     API, score, quotes, the site
server/stocks.json   the 64 stock tokens of Robinhood Chain and their pools
site/                pages, styles, scripts, assets
privy/               source of the wallet-connection bundle
bot/                 the @QuoroAI reply account
Dockerfile           production image
```

## Disclaimer

Quoro shows data and quotes and returns transactions for you to sign. It is not financial advice. New tokens are risky and can
lose all of their value. Stock tokens are not available to persons in the United States and are restricted in Canada, the
United Kingdom, Switzerland and other countries: check the rules where you live before you buy.

## License

MIT
