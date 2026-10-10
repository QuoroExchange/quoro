"""The Quoro server: any Robinhood Chain token by address — its launch facts, a Data score from 1 to 10 and an AI reading of
that score — and a quote to buy it with the native coin of 17 chains (ETH, BNB or POL), Robinhood Chain among them. Quoro never holds money: the
server only prices the route and hands back the transaction; the person signs it in their own wallet.

One process, stdlib only:
- a data thread keeps the chain's head block, the 24 h launch count, ETH in dollars, the 64 stock-token prices (slot0 of each
  token's pool, one Multicall3 call a minute; our own history gives the 24 h change and the sparkline) and three example
  tokens for the empty screen;
- token facts come from the data engine's /api/check (launches), our stock list, or the token contract itself;
- the score is 0.6 · launch hygiene (the engine's) + 0.4 · market, with caps (see score() below and /docs#score);
- quotes ask LI.FI and Relay at once and keep the one that delivers more (stock tokens: LI.FI only — Relay won't route them).

Config is env (and server/.env): OPENROUTER_API_KEY, LLM_MODEL, PRIVY_APP_ID, ENGINE_URL, RPC_URL, PORT, HOST, DB_PATH,
SITE_DIR, EXPLAIN_DAILY (per visitor), TOKEN_CA, TOKEN_TICKER.
"""
from __future__ import annotations
import concurrent.futures as cf, gzip, io, hashlib, http.client, ipaddress, json, os, re, socket, sqlite3, threading, time, urllib.error, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
try:
    from PIL import Image   # token pictures shrunk to thumbnails; without it they pass through as they are
except ImportError:
    Image = None

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_env(path: str) -> None:
    try:
        for line in open(path):
            k, _, v = line.strip().partition("=")
            if k and not k.startswith("#") and k not in os.environ: os.environ[k] = v
    except FileNotFoundError:
        pass


_load_env(os.path.join(HERE, ".env"))
ENGINE = os.environ.get("ENGINE_URL", "").rstrip("/")   # the launch data engine (token checks, launch lists, candles): required
SITE = os.environ.get("SITE_DIR", os.path.join(HERE, "..", "site"))
DB_PATH = os.environ.get("DB_PATH", os.path.join(HERE, "data", "quoro.db"))
IMG_DIR = os.path.join(os.path.dirname(DB_PATH), "img")
PORT = int(os.environ.get("PORT", "8795"))
OR_KEY = os.environ.get("OPENROUTER_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "anthropic/claude-haiku-5.5")
EXPLAIN_DAILY = int(os.environ.get("EXPLAIN_DAILY", "40"))
PRIVY_APP_ID = os.environ.get("PRIVY_APP_ID", "").strip()
TOKEN_CA = os.environ.get("TOKEN_CA", "").strip()
ALCHEMY_KEY = os.environ.get("ALCHEMY_KEY", "").strip()   # optional: lets the portfolio see every token a wallet holds on Robinhood Chain
TOKEN_TICKER = os.environ.get("TOKEN_TICKER", "").strip()
UA = {"user-agent": "quoro/1", "accept": "application/json"}   # the official node refuses Python-urllib's default UA
MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11"
NATIVE = "0x0000000000000000000000000000000000000000"
QUOTE_FROM = "0x000000000000000000000000000000000000dEaD"   # stands in for the buyer until they sign in: prices only, never signed

def _chain(cid, name, rpc, explorer, native="ETH", reserve=0.0001):
    return {"id": cid, "name": name, "rpc": rpc, "explorer": explorer, "native": native, "reserve": reserve}


# where the money can come from, Robinhood Chain first. Every one checked (Oct 2026) with live quotes: a memecoin (Relay, one
# transaction) and NVDA (LI.FI, one transaction) both route from it. Avalanche, Sonic, Mantle, Berachain, ApeChain, HyperEVM
# route memecoins only, Zora and Celo neither in one signature: left out. `reserve` is the gas kept back by MAX.
CHAINS = {
    "rh": _chain(4663, "Robinhood Chain", os.environ.get("RPC_URL", "https://rpc.mainnet.chain.robinhood.com"), "https://robinhoodchain.blockscout.com"),
    "ethereum": _chain(1, "Ethereum", "https://ethereum-rpc.publicnode.com", "https://etherscan.io", reserve=0.001),
    "base": _chain(8453, "Base", "https://base-rpc.publicnode.com", "https://basescan.org"),
    "arbitrum": _chain(42161, "Arbitrum", "https://arbitrum-one-rpc.publicnode.com", "https://arbiscan.io"),
    "optimism": _chain(10, "Optimism", "https://optimism-rpc.publicnode.com", "https://optimistic.etherscan.io"),
    "bnb": _chain(56, "BNB Chain", "https://bsc-rpc.publicnode.com", "https://bscscan.com", "BNB", 0.001),
    "polygon": _chain(137, "Polygon", "https://polygon-bor-rpc.publicnode.com", "https://polygonscan.com", "POL", 1.0),   # measured: a buy's gas is 0.25–0.31 POL
    "unichain": _chain(130, "Unichain", "https://unichain-rpc.publicnode.com", "https://uniscan.xyz"),
    "linea": _chain(59144, "Linea", "https://linea-rpc.publicnode.com", "https://lineascan.build"),
    "zksync": _chain(324, "ZKsync", "https://mainnet.era.zksync.io", "https://explorer.zksync.io", reserve=0.0005),   # gas ~0.0003 ETH, measured
    "scroll": _chain(534352, "Scroll", "https://scroll-rpc.publicnode.com", "https://scrollscan.com"),
    "blast": _chain(81457, "Blast", "https://blast-rpc.publicnode.com", "https://blastscan.io"),
    "ink": _chain(57073, "Ink", "https://rpc-gel.inkonchain.com", "https://explorer.inkonchain.com"),
    "worldchain": _chain(480, "World Chain", "https://worldchain-mainnet.g.alchemy.com/public", "https://worldscan.org"),
    "soneium": _chain(1868, "Soneium", "https://rpc.soneium.org", "https://soneium.blockscout.com"),
    "abstract": _chain(2741, "Abstract", "https://api.mainnet.abs.xyz", "https://abscan.org"),
    "mode": _chain(34443, "Mode", "https://mainnet.mode.network", "https://modescan.io"),
}
STOCKS = json.load(open(os.path.join(HERE, "stocks.json")))           # knowledge/robinhood-stock-tokens-4663.md
STOCK_BY_ADDR = {s["token"].lower(): s for s in STOCKS}
_NVSTLY = "https://cdn.jsdelivr.net/gh/nvstly/icons@main/ticker_icons/{}.png"
_FMP = "https://financialmodelingprep.com/image-stock/{}.png"
# nvstly has no icon for these (404, checked Oct 2026); FMP has all 15
_FMP_ONLY = {"SPY", "QQQ", "GLD", "SOXX", "SGOV", "VTI", "SLV", "SPCX", "SKHY", "SNDK", "CRCL", "FIG", "GLXY", "USAR", "WYFI"}


class _Logo:
    def format(self, t: str) -> str: return (_FMP if t in _FMP_ONLY else _NVSTLY).format(t)


LOGO = _Logo()
POOL = cf.ThreadPoolExecutor(max_workers=16)          # what a visitor waits for: quotes, balances
BG = cf.ThreadPoolExecutor(max_workers=4)             # background scoring of the launch lists: never ahead of a quote


def log(kind: str, **kv) -> None:
    print(time.strftime("%H:%M:%S"), kind, json.dumps(kv, ensure_ascii=False), flush=True)


class Fail(Exception):
    """An answer for the page: a code it knows (not_found, no_route, bad_input, rate_limited, offline) and an HTTP status."""
    def __init__(self, code: str, status: int = 400):
        super().__init__(code); self.code = code; self.status = status


# ---- storage ---------------------------------------------------------------------------------------------------------------
_db_lock = threading.Lock()


def db() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.executescript("""
    pragma journal_mode=wal;
    create table if not exists px (ticker text, t integer, usd real);
    create index if not exists px_t on px(ticker, t);
    create table if not exists asks (who text, t integer);
    create index if not exists asks_who on asks(who, t);
    """)
    return c


DB = db()


def q(sql: str, args=()):
    with _db_lock:
        cur = DB.execute(sql, args); rows = cur.fetchall(); DB.commit(); return rows


# ---- http helpers ----------------------------------------------------------------------------------------------------------
LIFI_KEY = os.environ.get("LIFI_KEY", "").strip()   # without it LI.FI rate-limits by IP: 75 quotes per 2 h for the whole server


_LIFI_PAUSE = {"until": 0.0}   # after a 429 LI.FI is left alone until its reset instead of hammered (Relay still quotes memecoins)


def _get(url: str, timeout: float = 15):
    lifi = url.startswith("https://li.quest/")
    if lifi and time.time() < _LIFI_PAUSE["until"]: raise urllib.error.URLError("li.fi rate-limited, paused")
    headers = {**UA, "x-lifi-api-key": LIFI_KEY} if LIFI_KEY and lifi else UA
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        if lifi and e.code == 429:
            try: wait = int(e.headers.get("ratelimit-reset") or e.headers.get("retry-after") or 60)
            except ValueError: wait = 60
            _LIFI_PAUSE["until"] = time.time() + min(max(wait, 5), 3600); log("lifi", paused_s=wait)
        raise


RELAY_KEY = os.environ.get("RELAY_KEY", "").strip()   # Relay's partner key: higher limits than an anonymous server IP


def _post(url: str, body: dict, timeout: float = 15):
    headers = {**UA, "content-type": "application/json"}
    if RELAY_KEY and url.startswith("https://api.relay.link/"): headers["x-api-key"] = RELAY_KEY
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r: return json.load(r)


def _rpc(method: str, params: list, chain: str = "rh"):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(CHAINS[chain]["rpc"], data=body, headers={**UA, "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=12) as r: j = json.load(r)
    if "error" in j: raise ValueError(str(j["error"])[:160])
    return j["result"]


def _w(n: int) -> str: return format(n, "064x")


def multicall(calls: list[tuple[str, str]]) -> list[bytes | None]:
    """Multicall3.aggregate3 with allowFailure=true: [(target, calldata hex)] -> [returndata or None]. Encoded by hand."""
    heads, tails, off = [], [], 32 * len(calls)
    for target, data in calls:
        b = bytes.fromhex(data[2:] if data.startswith("0x") else data)
        pad = b + b"\0" * (-len(b) % 32)
        tup = _w(int(target, 16)) + _w(1) + _w(0x60) + _w(len(b)) + pad.hex()
        heads.append(_w(off)); tails.append(tup); off += len(tup) // 2
    cd = "0x82ad56cb" + _w(0x20) + _w(len(calls)) + "".join(heads) + "".join(tails)
    out = bytes.fromhex(_rpc("eth_call", [{"to": MULTICALL3, "data": cd}, "latest"])[2:])
    word = lambda o: int.from_bytes(out[o:o + 32], "big")
    base = word(0) + 32; n = word(base - 32); res = []
    for i in range(n):
        t = base + word(base + 32 * i)
        ok = word(t) == 1; bo = t + word(t + 32); ln = word(bo)
        res.append(out[bo + 32: bo + 32 + ln] if ok else None)
    return res


def _abi_str(b: bytes | None) -> str:
    if not b: return ""
    if len(b) >= 96 and int.from_bytes(b[:32], "big") == 32:   # dynamic string: offset, length, bytes (length is word 1)
        n = int.from_bytes(b[32:64], "big"); return b[64:64 + n].decode("utf-8", "ignore")
    return b[:32].rstrip(b"\0").decode("utf-8", "ignore")      # bytes32 symbol


def _fmt_units(raw: int, dec: int) -> str:
    """Exact: integer arithmetic, never a float (a float rounded a balance up and Max asked to sell more than the wallet holds)."""
    whole, frac = divmod(int(raw), 10 ** dec)
    f = str(frac).rjust(dec, "0").rstrip("0") if dec else ""
    return f"{whole}.{f}" if f else str(whole)


# ---- live data -------------------------------------------------------------------------------------------------------------
SNAP = {"block": 0, "block_t": 0.0, "launches_24h": None, "eth_usd": 0.0, "stocks": {}, "stocks_t": 0.0, "examples": []}
POOL_META: dict = {}   # pool -> (stock is token0, quote decimals, quote is a dollar stable)


def load_pool_meta() -> None:
    calls = []
    for st in STOCKS: calls += [(st["pool"], "0x0dfe1681"), (st["pool"], "0xd21220a7")]   # token0(), token1()
    res = multicall(calls)
    quotes = {}
    for i, st in enumerate(STOCKS):
        t0, t1 = res[2 * i], res[2 * i + 1]
        if not t0 or not t1: continue
        a0 = "0x" + t0[12:32].hex(); a1 = "0x" + t1[12:32].hex()
        stock0 = a0 == st["token"].lower()
        quotes[st["pool"]] = (stock0, a1 if stock0 else a0)
    uniq = sorted({qt for _, qt in quotes.values()})
    meta = multicall([c for a in uniq for c in ((a, "0x313ce567"), (a, "0x95d89b41"))])   # decimals(), symbol()
    info = {a: (int.from_bytes(meta[2 * k][:32], "big") if meta[2 * k] else 18, _abi_str(meta[2 * k + 1])) for k, a in enumerate(uniq)}
    for pool, (stock0, qt) in quotes.items():
        dec, sym = info[qt]
        POOL_META[pool] = (stock0, dec, sym.upper() in ("USDG", "USDC", "USDT", "USD"))


def refresh_stocks() -> None:
    if not POOL_META: load_pool_meta()
    res = multicall([(st["pool"], "0x3850c7bd") for st in STOCKS])   # slot0()
    eth = SNAP["eth_usd"]; now = int(time.time()); out = {}
    for i, st in enumerate(STOCKS):
        slot0, m = res[i], POOL_META.get(st["pool"])
        if not slot0 or not m: continue
        stock0, qdec, stable = m
        sp = int.from_bytes(slot0[:32], "big") / 2**96
        raw = sp * sp                                    # token1 per token0 in raw units; stock tokens have 18 decimals
        per_stock = raw * 10 ** (18 - qdec) if stock0 else (10 ** (18 - qdec)) / raw if raw else 0
        usd = per_stock if stable else per_stock * eth
        if usd <= 0: continue
        out[st["ticker"]] = {"ticker": st["ticker"], "name": st["name"], "ca": st["token"], "logo": LOGO.format(st["ticker"]), "priceUsd": usd}
        q("insert into px values (?,?,?)", (st["ticker"], now, usd))
    for tk, d in out.items():   # our own history: the node keeps none. 24 hourly points for the sparkline
        rows = q("select usd, t from px where ticker=? and t>=? order by t", (tk, now - 86400))
        first = rows[0] if rows else None
        d["change24h"] = round(100 * (d["priceUsd"] / first["usd"] - 1), 2) if first and now - first["t"] > 6 * 3600 else None
        spark, edge = [], now - 86400
        for r in rows:
            if r["t"] >= edge: spark.append(r["usd"]); edge = r["t"] + 3600
        d["spark"] = spark[-24:] + ([d["priceUsd"]] if not spark else [])
    q("delete from px where t<?", (now - 2 * 86400,))
    if out: SNAP["stocks"] = out; SNAP["stocks_t"] = time.time()


def refresh_engine() -> None:
    try:
        st = _get(ENGINE + "/api/stats?window=24h")
        SNAP["launches_24h"] = ((st.get("flow") or {}).get("launches"))
    except Exception as e: log("stats", error=str(e)[:120])   # noqa: BLE001
    t = _get(ENGINE + "/api/tops?window=1h&limit=24", timeout=25)
    if t.get("eth_usd"): SNAP["eth_usd"] = float(t["eth_usd"])
    return t


def refresh_examples(tops: dict) -> None:
    """Three tokens to try: one of the hour's busiest clean launches (7+), one held down by a red flag (the thing Quoro catches),
    and NVDA. The page shows the clean one first."""
    good = flagged = None
    for r in (tops.get("buyers") or [])[:30]:
        try: t = token_view(r["token"])
        except Fail: continue
        if t["kind"] != "launch" or not t.get("logo"): continue
        row = {"ca": t["ca"], "symbol": t["symbol"], "name": t["name"], "logo": t["logo"], "score": t["score"]["value"], "kind": "launch",
               "capped": any(c["applied"] for c in t["score"]["caps"])}
        if not good and t["score"]["value"] >= 7: good = row
        if not flagged and any(c["applied"] and c["id"] in ("flag", "dev", "dev25") for c in t["score"]["caps"]): flagged = row
        if good and flagged: break
    out = [x for x in (good, flagged) if x]
    nv = SNAP["stocks"].get("NVDA")
    if nv: out.append({"ca": nv["ca"], "symbol": "NVDA", "name": nv["name"], "logo": nv["logo"], "score": None, "kind": "stock"})
    if out: SNAP["examples"] = out


# ---- launches: the chain's tokens as lists (trending / recent / all), each with its Data score -------------------------
LAUNCHES = {"trending": [], "recent": [], "all": [], "t": 0.0}
_SCORE: dict = {}       # ca -> (time, score or None)
_SCORING: set = set()
_SPARK: dict = {}       # ca -> (time, closes)


def _score_later(ca: str) -> None:
    """Read and score a token in the background (the engine's /check can take a while when cold); the list shows it next poll."""
    hit = _SCORE.get(ca)
    if (hit and time.time() - hit[0] < 300) or ca in _SCORING or len(_SCORING) > 24: return
    _SCORING.add(ca)
    def run():
        try:
            t = token_view(ca)
            if len(_SCORE) > 3000:
                for k, _v in sorted(_SCORE.items(), key=lambda kv: kv[1][0])[:1000]: _SCORE.pop(k, None)
            sc = t.get("score")
            flagged = bool(sc) and any(c["applied"] and c["id"] in ("flag", "dev", "dev25") for c in sc["caps"])
            _SCORE[ca] = (time.time(), sc["value"] if sc else None, flagged)
        except Exception as e: log("score", ca=ca, error=str(e)[:80]); _SCORE[ca] = (time.time(), None)   # noqa: BLE001
        finally: _SCORING.discard(ca)
    BG.submit(run)


def _spark(ca: str) -> list:
    hit = _SPARK.get(ca)
    if hit and time.time() - hit[0] < 120: return hit[1]
    try: closes = [k["c"] for k in (_get(ENGINE + f"/api/token/{ca}/candles?tf=5m", timeout=8).get("candles") or [])][-24:]
    except Exception: closes = hit[1] if hit else []   # noqa: BLE001
    _SPARK[ca] = (time.time(), closes)
    if len(_SPARK) > 300: _SPARK.clear()
    return closes


def _row(r: dict, chg1h: dict, chg24h: dict, vol24: dict) -> dict:
    ca = r["token"].lower()
    _score_later(ca)
    hit = _SCORE.get(ca)
    return {"ca": ca, "symbol": r.get("symbol"), "name": r.get("name"), "logo": _img(r.get("image")),
            "mcapUsd": r.get("mcap_usd"), "change1h": chg1h.get(ca), "change24h": chg24h.get(ca), "vol24hUsd": vol24.get(ca),
            "ageMin": int((r.get("age_s") or 0) // 60), "graduated": bool(r.get("graduated")), "buyers": r.get("buyers"),
            "score": hit[1] if hit else None, "flagged": hit[2] if hit and len(hit) > 2 else None}


def refresh_launches() -> None:
    t1 = _get(ENGINE + "/api/tops?window=1h&limit=300", timeout=25)
    t24 = _get(ENGINE + "/api/tops?window=24h&limit=300", timeout=25)
    feed = _get(ENGINE + "/api/feed?limit=200", timeout=20).get("rows") or []
    chg1h = {r["token"].lower(): r.get("w_chg_pct") for r in t1.get("gainers") or []}
    chg24h = {r["token"].lower(): r.get("w_chg_pct") for r in t24.get("gainers") or []}
    vol24 = {r["token"].lower(): r.get("w_vol_usd") for r in t24.get("volume") or []}
    seen, every = set(), []
    for r in (t24.get("volume") or []) + (t1.get("volume") or []) + feed:
        k = r["token"].lower()
        if k in seen: continue
        seen.add(k); every.append(r)
    trending = [_row(r, chg1h, chg24h, vol24) for r in (t1.get("volume") or [])[:12]]
    for x in trending: x["spark"] = _spark(x["ca"])
    LAUNCHES["trending"] = trending
    LAUNCHES["recent"] = [_row(r, chg1h, chg24h, vol24) for r in sorted(feed, key=lambda r: r.get("age_s") or 1e12)[:100]]
    LAUNCHES["all"] = sorted([_row(r, chg1h, chg24h, vol24) for r in every], key=lambda x: -(x["vol24hUsd"] or 0))[:300]
    LAUNCHES["t"] = time.time()
    warm_images([r.get("image") for r in every[:300]])


def block_loop() -> None:
    while True:
        try: SNAP["block"] = int(_rpc("eth_blockNumber", []), 16); SNAP["block_t"] = time.time()
        except Exception as e: log("block", error=str(e)[:120])   # noqa: BLE001
        time.sleep(3)


def data_loop() -> None:
    last_ex = 0.0
    while True:
        tops = {}
        try: tops = refresh_engine()
        except Exception as e: log("engine", error=str(e)[:160])   # noqa: BLE001 - keep the loop alive whatever the engine does
        if SNAP["eth_usd"]:
            try: refresh_stocks()
            except Exception as e: log("stocks", error=str(e)[:160])   # noqa: BLE001
        try: refresh_launches()
        except Exception as e: log("launches", error=str(e)[:160])   # noqa: BLE001
        if tops and time.time() - last_ex > 120:
            try: refresh_examples(tops); last_ex = time.time()
            except Exception as e: log("examples", error=str(e)[:160])   # noqa: BLE001
        time.sleep(60)


# ---- token facts and the score ---------------------------------------------------------------------------------------------
_CHECK: dict = {}
RED = {"bundle", "snipers_heavy", "serial_dev", "mill", "farm", "dev_sold_here"}


def check_token(addr: str) -> dict:
    """GET /api/check/<addr> on the engine: a launch read from the chain (slow when cold: cached 60 s)."""
    hit = _CHECK.get(addr)
    if hit and time.time() - hit[0] < 60: return hit[1]
    try: d = _get(ENGINE + "/api/check/" + addr, timeout=45)
    except urllib.error.HTTPError as e:
        try: d = json.load(e)
        except ValueError: d = {"error": f"check failed ({e.code})"}
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e: d = {"error": "check failed"}; log("check", error=str(e)[:120])
    if len(_CHECK) > 400: _CHECK.clear()
    _CHECK[addr] = (time.time(), d)
    return d


def _dev_pct(c: dict) -> float | None:
    """What the creator holds now (None when the engine couldn't read it: no cap, the card shows a dash)."""
    v = c.get("dev_holds_pct")
    return float(v) if isinstance(v, (int, float)) else None


def score(c: dict) -> dict:
    """0.6 · hygiene + 0.4 · market, rounded half up, then the lowest cap that fired (the rules are published at /docs#score)."""
    hy = c.get("hygiene") or {}
    H = int(hy.get("score") or 0)
    grad = bool(c.get("graduated"))
    buyers = int(c.get("buyers") or 0); prog = float(c.get("progress") or 0); idle = c.get("idle_s"); smart = int(c.get("smart") or 0)
    b = 0 if buyers < 10 else 1 if buyers < 30 else 2 if buyers < 100 else 3 if buyers < 250 else 4
    d = 3 if grad else 0 if prog < 5 else 1 if prog < 20 else 2 if prog < 50 else 3
    lv = 1 if grad else (2 if idle is not None and idle < 600 else 1 if idle is not None and idle < 3600 else 0)
    sm = 1 if smart >= 3 else 0
    M = b + d + lv + sm
    raw = 0.6 * H + 0.4 * M
    val = int(raw + 0.5)
    lost = hy.get("lost") or []
    partial = bool(hy.get("partial")) or c.get("read_complete") is False
    dev = _dev_pct(c)
    caps = [
        {"id": "flag", "limit": 5, "applied": any(x.get("k") in RED for x in lost)},
        {"id": "dev", "limit": 5, "applied": isinstance(dev, (int, float)) and dev > 10},
        {"id": "dev25", "limit": 3, "applied": isinstance(dev, (int, float)) and dev > 25},
        {"id": "idle", "limit": 4, "applied": not grad and idle is not None and idle > 86400},
        {"id": "age", "limit": 7, "applied": c.get("age_s") is not None and c["age_s"] < 600},
        {"id": "partial", "limit": 8, "applied": partial},
    ]
    for cap in caps:
        if cap["applied"]: val = min(val, cap["limit"])
    return {"value": max(1, min(10, val)), "hygiene": H, "market": M, "raw": round(raw, 1), "partial": partial, "caps": caps,
            "factors": [{"id": "hygiene", "points": H, "max": 10}, {"id": "buyers", "points": b, "max": 4},
                        {"id": "depth", "points": d, "max": 3}, {"id": "liveness", "points": lv, "max": 2},
                        {"id": "smart", "points": sm, "max": 1}],
            "flags": [{"k": x.get("k"), "points": x.get("points"), "text": x.get("text")} for x in lost],
            "credits": [x.get("k") if isinstance(x, dict) else x for x in hy.get("gained") or []]}


_KNOWN_IMAGES: set = set()


def _img(src: str | None) -> str | None:
    if not src: return None
    if len(_KNOWN_IMAGES) > 5000: _KNOWN_IMAGES.clear()
    _KNOWN_IMAGES.add(src)
    return "/img?u=" + urllib.parse.quote(src, safe="")


def _launch(c: dict) -> dict:
    s = score(c)
    pair = c.get("quote") or "ETH"
    mcap = c.get("mcap_usd")
    idle = c.get("idle_s")
    return {"kind": "launch", "ca": c["token"].lower(), "symbol": c.get("symbol"), "name": c.get("name"), "logo": _img(c.get("image")),
            "decimals": 18, "priceUsd": (c.get("price_eth") or 0) * SNAP["eth_usd"] if pair == "ETH" and c.get("price_eth") else None,
            "change24h": None, "mcapUsd": mcap, "pair": pair, "ageMin": int((c.get("age_s") or 0) // 60),
            "curvePct": round(float(c.get("progress") or 0), 1), "graduated": bool(c.get("graduated")),
            "facts": {"buyers": c.get("buyers"), "sellers": c.get("sellers"),
                      "devPct": None if _dev_pct(c) is None else round(_dev_pct(c), 2),
                      "devBurned": (c.get("burned_pct") or 0) >= 0.5, "snipersPct": round(float(c.get("snipe_pct") or 0), 1),
                      "taxExempt": c.get("exempt_n") or 0, "creatorTaxBps": c.get("creator_tax_bps") or 0,
                      "smartWallets": c.get("smart") or 0, "lastTradeMin": None if idle is None else int(idle // 60)},
            "socials": {"x": c.get("x_url"), "site": c.get("site"), "tg": c.get("tg_url")},
            "score": s}


def _erc20(addr: str) -> dict | None:
    """name / symbol / decimals / supply straight from the contract; None when the address holds no code at all."""
    if _rpc("eth_getCode", [addr, "latest"]) in ("0x", "0x0", None): return None
    r = multicall([(addr, "0x06fdde03"), (addr, "0x95d89b41"), (addr, "0x313ce567"), (addr, "0x18160ddd")])
    if not r[1] or not r[2]: raise Fail("not_a_token", 404)   # a contract, but not a token
    dec = int.from_bytes(r[2][:32], "big")
    return {"name": _abi_str(r[0]), "symbol": _abi_str(r[1]), "decimals": dec,
            "supply": _fmt_units(int.from_bytes(r[3][:32], "big"), dec) if r[3] else None}


_TOKEN: dict = {}


def token_view(addr: str) -> dict:
    addr = addr.lower()
    if not re.fullmatch(r"0x[0-9a-f]{40}", addr): raise Fail("bad_input")
    hit = _TOKEN.get(addr)
    if hit and time.time() - hit[0] < 30: return hit[1]
    if addr == NATIVE:   # ETH on Robinhood Chain itself: the form can bring it in (a bridge), e.g. to pay a sale's gas
        return {"kind": "native", "ca": NATIVE, "symbol": "ETH", "name": "Ether", "logo": "/assets/chains/eth-coin.svg", "decimals": 18,
                "priceUsd": SNAP["eth_usd"] or None, "change24h": None, "mcapUsd": None, "facts": None, "score": None}
    st = STOCK_BY_ADDR.get(addr)
    if st:
        live = SNAP["stocks"].get(st["ticker"]) or {}
        v = {"kind": "stock", "ca": addr, "symbol": st["ticker"], "name": st["name"], "logo": LOGO.format(st["ticker"]), "decimals": 18,
             "priceUsd": live.get("priceUsd"), "change24h": live.get("change24h"), "mcapUsd": None, "spark": live.get("spark") or [],
             "facts": None, "score": None}
    else:
        c = check_token(addr)
        if c.get("token") and c.get("hygiene"): v = _launch(c)
        else:
            try: e = _erc20(addr)
            except (ValueError, OSError, urllib.error.URLError) as ex: log("erc20", error=str(ex)[:120]); raise Fail("network", 502)
            if not e: raise Fail("not_found", 404)
            v = {"kind": "other", "ca": addr, **e, "logo": None, "priceUsd": None, "change24h": None, "mcapUsd": None, "facts": None, "score": None}
    if len(_TOKEN) > 500: _TOKEN.clear()
    _TOKEN[addr] = (time.time(), v)
    return v


# ---- the AI reading --------------------------------------------------------------------------------------------------------
SYSTEM = """You explain a token's Data score on Robinhood Chain to someone about to buy it. Use only the DATA below.
Rules:
- 3 to 5 short sentences, at most 80 words. Plain words, numbers with their units exactly as given.
- Talk about the facts, not the formula: who bought, how full the curve is, snipers, tax-exempt wallets, what the creator
  holds or sold, the creator tax, when the last trade was. Say what lifted the score and what held it back.
- Name every cap that applied (caps where "applied" is true). Do not recite points, weights or the formula.
- Example of the tone: "Clean launch: no wallet was exempt from tax, no snipers in the first blocks, and the creator sold
  nothing. 82 different buyers, the curve is 32% full, last trade 3 minutes ago. Creator tax is 2% on every trade."
- Facts only: no advice, no "buy" or "sell", no price predictions, never "scam", "rug" or "fraud", never guess intent.
- Never name a launchpad, an aggregator or a data provider.
DATA:
{d}"""

CAP_WORDS = {"flag": "a red flag in the launch caps the score at 5", "dev": "the creator holds over 10% of supply (capped at 5)",
             "dev25": "the creator holds over 25% of supply (capped at 3)",
             "idle": "no trades for over 24 hours caps it at 4", "age": "launched under 10 minutes ago, so it is capped at 7",
             "partial": "the chain read was incomplete, so it is capped at 8"}


def explain_data(t: dict) -> str:
    s, f = t["score"], t["facts"]
    caps = [{"cap": CAP_WORDS[c["id"]], "applied": c["applied"]} for c in s["caps"]]
    return json.dumps({
        "token": f"{t['symbol']} ({t['name']})", "data_score": f"{s['value']}/10",
        "formula": f"0.6 x launch {s['hygiene']}/10 + 0.4 x market {s['market']}/10 = {s['raw']}",
        "launch_deductions": [f"-{x['points']}: {x['text']}" for x in s["flags"]] or ["none"],
        "launch_credits": s["credits"] or ["none"],
        "market_points": {x["id"]: f"{x['points']}/{x['max']}" for x in s["factors"] if x["id"] != "hygiene"},
        "caps": caps,
        "facts": {"age": f"{t['ageMin']} min", "buyers": f["buyers"], "sellers": f["sellers"], "creator_holds": "unknown" if f["devPct"] is None else f"{f['devPct']:g}%",
                  "creator_share_burned": f["devBurned"], "snipers_first_blocks": f"{f['snipersPct']:g}%",
                  "tax_exempt_wallets": f["taxExempt"], "creator_tax": f"{f['creatorTaxBps'] / 100:g}% per trade",
                  "smart_wallets": f["smartWallets"], "last_trade": "unknown" if f["lastTradeMin"] is None else "under a minute ago" if f["lastTradeMin"] < 1 else f"{f['lastTradeMin']} min ago",
                  "bonding_curve_filled": f"{t['curvePct']:g}%", "graduated_to_pool": t["graduated"]}}, ensure_ascii=False)


BRIEF_SYSTEM = """You write the one-line read a trader sees the moment they paste a token on Robinhood Chain. Use only the DATA below.
Rules:
- One or two short sentences, at most 30 words. Lead with what matters most: a red flag or cap if any, else the strongest fact.
- Numbers exactly as given. Facts only: no advice, no "buy" or "sell", no predictions, never "scam", "rug" or "fraud".
- Never name a launchpad, an aggregator or a data provider. Never write the score or "x/10": the page already shows it.
- Never mention the token's age or minutes since the last trade: they change every minute and the page shows them live.
DATA:
{d}"""
_BRIEF: dict = {}


def brief(t: dict) -> str | None:
    """The AI's first line on a launch, shown as soon as the token is read. One small call per token and score,
    cached for everyone ten minutes; the full reading stays behind Ask why."""
    key = (t["ca"], t["score"]["value"])   # the line changes when the score does, not with every small move of the market part
    hit = _BRIEF.get(key)
    if hit and time.time() - hit[0] < 600: return hit[1]
    body = {"model": LLM_MODEL, "max_tokens": 90, "temperature": 0.2, "reasoning": {"enabled": False},
            "messages": [{"role": "system", "content": BRIEF_SYSTEM.format(d=explain_data(t))}, {"role": "user", "content": "One line."}]}
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"authorization": f"Bearer {OR_KEY}", "content-type": "application/json", "x-title": "Quoro"})
    with urllib.request.urlopen(req, timeout=25) as r: j = json.load(r)
    text = ((j.get("choices") or [{}])[0].get("message") or {}).get("content", "").strip()
    if re.search(r"(?i)\b\d{1,2}\s*(?:/|out of)\s*10\b", text):   # restated the score: ask once to say it without the number
        body["messages"] += [{"role": "assistant", "content": text}, {"role": "user", "content": "Say the same without any score or x/10."}]
        req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=json.dumps(body).encode(),
                                     headers={"authorization": f"Bearer {OR_KEY}", "content-type": "application/json", "x-title": "Quoro"})
        with urllib.request.urlopen(req, timeout=25) as r: j = json.load(r)
        text = ((j.get("choices") or [{}])[0].get("message") or {}).get("content", "").strip() or text
    # and if it still does, the number is cut: the card shows it, so the line never does
    text = re.sub(r"(?i)\b(?:scores?|is scored|rated|gets?)\s+(?:an?\s+)?\d{1,2}\s*(?:/|out of)\s*10\b[,;:]?\s*", "", text).strip()
    text = re.sub(r"(?i)\(?\b\d{1,2}\s*/\s*10\b\)?[,;:]?\s*", "", text).strip()
    if text: text = text[0].upper() + text[1:]
    if not text: return None
    if len(_BRIEF) > 2000: _BRIEF.clear()
    _BRIEF[key] = (time.time(), text)
    return text


_EXPLAINED: dict = {}


def stream_explain(t: dict, emit) -> str:
    key = (t["ca"], t["score"]["value"], t["score"]["raw"])
    hit = _EXPLAINED.get(key)
    if hit and time.time() - hit[0] < 600:
        emit(hit[1]); return hit[1]
    body = {"model": LLM_MODEL, "max_tokens": 400, "temperature": 0.3, "stream": True, "reasoning": {"enabled": False},
            "messages": [{"role": "system", "content": SYSTEM.format(d=explain_data(t))},
                         {"role": "user", "content": f"Explain the {t['score']['value']}."}]}
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"authorization": f"Bearer {OR_KEY}", "content-type": "application/json", "x-title": "Quoro"})
    text = []
    with urllib.request.urlopen(req, timeout=60) as resp:
        for raw in resp:
            line = raw.decode("utf-8", "ignore").strip()
            if not line.startswith("data:"): continue
            data = line[5:].strip()
            if data == "[DONE]": break
            try: j = json.loads(data)
            except ValueError: continue
            for ch in j.get("choices") or []:
                piece = (ch.get("delta") or {}).get("content")
                if piece: text.append(piece); emit(piece)
    out = "".join(text)
    if out:
        if len(_EXPLAINED) > 300: _EXPLAINED.clear()
        _EXPLAINED[key] = (time.time(), out)
    return out


# ---- quotes ----------------------------------------------------------------------------------------------------------------
def _wei(amount: str) -> int:
    if not re.fullmatch(r"\d{1,9}(\.\d{1,18})?", amount or ""): raise Fail("bad_input")
    whole, _, frac = amount.partition(".")
    v = int(whole) * 10**18 + int((frac + "0" * 18)[:18])
    if v <= 0: raise Fail("bad_input")
    return v


def _hexint(v) -> int:
    if v is None: return 0
    return int(v, 16) if isinstance(v, str) and v.startswith("0x") else int(v)


def lifi_quote(src: str, ca: str, wei: int, user: str, slip: float) -> dict | None:
    qs = urllib.parse.urlencode({"fromChain": CHAINS[src]["id"], "toChain": 4663, "fromToken": NATIVE, "toToken": ca,
                                 "fromAmount": str(wei), "fromAddress": user, "toAddress": user, "slippage": f"{slip:.4f}"})
    try: d = _get("https://li.quest/v1/quote?" + qs, timeout=20)
    except urllib.error.HTTPError as e: log("lifi", code=e.code, body=e.read()[:200].decode("utf-8", "ignore")); return None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e: log("lifi", error=str(e)[:120]); return None
    e, tx = d.get("estimate") or {}, d.get("transactionRequest") or {}
    if not e.get("toAmount") or not tx.get("to"): return None
    fees = e.get("feeCosts") or []
    bridge_usd = sum(float(f.get("amountUSD") or 0) for f in fees if "LIFI" not in (f.get("name") or ""))
    route_usd = sum(float(f.get("amountUSD") or 0) for f in fees if "LIFI" in (f.get("name") or ""))
    return {"provider": "lifi", "tool": d.get("tool"), "out": int(e["toAmount"]), "outMin": int(e["toAmountMin"]),
            "outUsd": float(e.get("toAmountUSD") or 0), "inUsd": float(e.get("fromAmountUSD") or 0),
            "relayerUsd": round(bridge_usd, 4) if src != "rh" else None, "routeUsd": round(route_usd, 4),
            "networkUsd": round(sum(float(g.get("amountUSD") or 0) for g in e.get("gasCosts") or []), 4),
            "etaSec": int(e.get("executionDuration") or 0), "decimals": (d.get("action") or {}).get("toToken", {}).get("decimals", 18),
            "steps": [{"chainId": int(tx.get("chainId") or CHAINS[src]["id"]), "to": tx["to"], "data": tx.get("data") or "0x",
                       "value": str(_hexint(tx.get("value"))), "gas": str(_hexint(tx.get("gasLimit"))) if tx.get("gasLimit") else None,
                       "kind": "bridge" if src != "rh" else "swap"}],
            "track": {"provider": "lifi", "fromChain": CHAINS[src]["id"], "toChain": 4663}}


def relay_quote(src: str, ca: str, wei: int, user: str, slip: float) -> dict | None:
    body = {"user": user, "recipient": user, "originChainId": CHAINS[src]["id"], "destinationChainId": 4663, "originCurrency": NATIVE,
            "destinationCurrency": ca, "amount": str(wei), "tradeType": "EXACT_INPUT", "slippageTolerance": str(int(slip * 10000))}
    try: d = _post("https://api.relay.link/quote/v2", body, timeout=20)
    except urllib.error.HTTPError as e: log("relay", code=e.code, body=e.read()[:200].decode("utf-8", "ignore")); return None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e: log("relay", error=str(e)[:120]); return None
    det, fees = d.get("details") or {}, d.get("fees") or {}
    co = det.get("currencyOut") or {}
    steps, req_id = [], None
    for s in d.get("steps") or []:
        if s.get("kind") != "transaction": return None   # a signature step: not a one-signature route
        req_id = req_id or s.get("requestId")
        for it in s.get("items") or []:
            x = it.get("data") or {}
            steps.append({"chainId": int(x.get("chainId") or CHAINS[src]["id"]), "to": x["to"], "data": x.get("data") or "0x",
                          "value": str(_hexint(x.get("value"))), "gas": str(_hexint(x["gas"])) if x.get("gas") else None,
                          "kind": "bridge" if src != "rh" else "swap"})
    if len(steps) != 1 or not co.get("amount"): return None   # one signature, or not this route
    imp = (det.get("swapImpact") or {}).get("percent")
    return {"provider": "relay", "tool": "relay", "out": int(co["amount"]), "outMin": int(co.get("minimumAmount") or co["amount"]),
            "outUsd": float(co.get("amountUsd") or 0), "inUsd": float((det.get("currencyIn") or {}).get("amountUsd") or 0),
            "relayerUsd": round(float((fees.get("relayer") or {}).get("amountUsd") or 0), 4) if src != "rh" else None, "routeUsd": 0.0,
            "networkUsd": round(float((fees.get("gas") or {}).get("amountUsd") or 0), 4),
            "etaSec": int(det.get("timeEstimate") or 0), "decimals": (co.get("currency") or {}).get("decimals", 18),
            "impactPct": abs(float(imp)) if imp not in (None, "") else None,
            "steps": steps, "track": {"provider": "relay", "requestId": req_id, "fromChain": CHAINS[src]["id"], "toChain": 4663}}


def quote(ca: str, src: str, amount: str, account: str | None, slippage: str | None = None) -> dict:
    if src not in CHAINS: raise Fail("bad_input")
    try: slip = min(max(float(slippage or 3), 0.1), 20) / 100   # percent from the page, 3% by default
    except ValueError: raise Fail("bad_input")
    wei = _wei(amount)
    t = token_view(ca)
    if t["kind"] == "native" and src == "rh": raise Fail("no_route", 404)   # ETH for ETH on the same chain is no trade
    user = account if account and re.fullmatch(r"0x[0-9a-fA-F]{40}", account) and account.lower() != QUOTE_FROM.lower() else QUOTE_FROM
    signable = user != QUOTE_FROM
    jobs = [POOL.submit(lifi_quote, src, t["ca"], wei, user, slip)]
    if t["kind"] != "stock": jobs.append(POOL.submit(relay_quote, src, t["ca"], wei, user, slip))   # Relay doesn't route stock tokens
    got = [j.result() for j in jobs]
    # what the wallet will sign must be what the page shows: the source chain and no more ETH than the amount
    got = [g for g in got if g and all(st["chainId"] == CHAINS[src]["id"] for st in g["steps"]) and sum(int(st["value"]) for st in g["steps"]) <= wei]
    if not got: raise Fail("no_route", 404)
    best = max(got, key=lambda g: g["out"])
    dec = best.get("decimals") or t.get("decimals") or 18
    tax_bps = ((t.get("facts") or {}).get("creatorTaxBps") or 0) if t["kind"] == "launch" else 0
    in_usd = best["inUsd"] or (wei / 1e18 * SNAP["eth_usd"] if CHAINS[src]["native"] == "ETH" else 0)
    fee_usd = (best["relayerUsd"] or 0) + best["routeUsd"] + in_usd * tax_bps / 1e4   # gas is paid on top of the amount, not out of it
    impact = best.get("impactPct")
    if impact is not None: impact = max(0.0, impact - tax_bps / 100)   # Relay's swap impact includes the creator tax, shown on its own line
    if impact is None and in_usd > 0 and best["outUsd"] > 0:
        impact = max(0.0, 100 * (1 - best["outUsd"] / max(in_usd - fee_usd, 1e-9)))
    warnings = []
    if tax_bps > 0: warnings.append("creator_tax")
    if impact is not None and impact > 5: warnings.append("high_impact")
    cost = round(100 * (1 - best["outUsd"] / in_usd), 2) if in_usd > 0 and best["outUsd"] > 0 else None   # all of it: fees, tax, impact
    if cost is not None and cost > 15: warnings.append("costly_route")
    if signable:
        try: have = int(_rpc("eth_getBalance", [user, "latest"], src), 16) / 1e18
        except Exception: have = None   # noqa: BLE001 - no warning rather than a wrong one
        coin_usd = SNAP["eth_usd"] if CHAINS[src]["native"] == "ETH" else price_usd(CHAINS[src]["id"], NATIVE)
        gas = max(CHAINS[src]["reserve"] / 2, (best["networkUsd"] / coin_usd) if coin_usd else 0)   # what the wallet will want on top
        if have is not None and have < wei / 1e18 + gas: warnings.append("over_balance")
    labels = {("rh", "stock"): "Swap on Robinhood Chain", ("rh", "launch"): "Buy on Robinhood Chain", ("rh", "other"): "Swap on Robinhood Chain"}
    label = "Bring ETH to Robinhood Chain" if t["kind"] == "native" else labels.get((src, t["kind"])) or "Bridge and buy in one step"
    return {"amountIn": amount, "inSymbol": CHAINS[src]["native"], "inUsd": round(in_usd, 2), "costPct": cost, "out": _fmt_units(best["out"], dec), "outMin": _fmt_units(best["outMin"], dec),
            "outUsd": round(best["outUsd"], 2) if best["outUsd"] else None,
            "route": {"from": src, "fromName": CHAINS[src]["name"], "label": label, "signatures": len(best["steps"]),
                      "etaSec": best["etaSec"], "provider": best["provider"]},
            "fees": {"relayerUsd": best["relayerUsd"], "routeUsd": round(best["routeUsd"], 2) if best["routeUsd"] else 0, "creatorTaxPct": tax_bps / 100, "creatorTaxUsd": round(in_usd * tax_bps / 1e4, 2),
                     "networkUsd": best["networkUsd"], "impactPct": None if impact is None else round(impact, 2)},
            "warnings": warnings, "slippagePct": round(slip * 100, 2), "expiresAt": int(time.time()) + 45, "signable": signable,
            "recipient": user if signable else None,
            "token": {"ca": t["ca"], "symbol": t["symbol"], "decimals": dec, "logo": t.get("logo")},
            "steps": best["steps"] if signable else [],   # a quote priced for the stand-in address is never signable
            "track": best["track"], "explorer": CHAINS[src]["explorer"]}


# ---- selling: a Robinhood Chain token back to the native coin, here or on any of the 17 chains --------------------------------
def _units(amount: str, dec: int) -> int:
    if not re.fullmatch(r"\d{1,15}(\.\d{1,18})?", amount or ""): raise Fail("bad_input")
    whole, _, frac = amount.partition(".")
    if len(frac) > dec: raise Fail("bad_input")   # the token can't hold that much precision: never sign a silently shorter amount
    v = int(whole) * 10**dec + int((frac + "0" * dec)[:dec] or 0)
    if v <= 0: raise Fail("bad_input")
    return v


def _allowance(token: str, owner: str, spender: str) -> int:
    r = _rpc("eth_call", [{"to": token, "data": "0xdd62ed3e" + _w(int(owner, 16)) + _w(int(spender, 16))}, "latest"])
    return int(r, 16) if r and r != "0x" else 0


def lifi_sell(ca: str, dst: str, units: int, user: str, slip: float) -> dict | None:
    qs = urllib.parse.urlencode({"fromChain": 4663, "toChain": CHAINS[dst]["id"], "fromToken": ca, "toToken": NATIVE,
                                 "fromAmount": str(units), "fromAddress": user, "toAddress": user, "slippage": f"{slip:.4f}"})
    try: d = _get("https://li.quest/v1/quote?" + qs, timeout=20)
    except urllib.error.HTTPError as e: log("lifi", code=e.code, body=e.read()[:200].decode("utf-8", "ignore")); return None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e: log("lifi", error=str(e)[:120]); return None
    e, tx = d.get("estimate") or {}, d.get("transactionRequest") or {}
    if not e.get("toAmount") or not tx.get("to") or not e.get("approvalAddress"): return None
    if e["approvalAddress"].lower() != tx["to"].lower(): return None   # the permission goes only to the contract the sale then calls
    fees = e.get("feeCosts") or []
    return {"provider": "lifi", "out": int(e["toAmount"]), "outMin": int(e["toAmountMin"]),
            "outUsd": float(e.get("toAmountUSD") or 0), "inUsd": float(e.get("fromAmountUSD") or 0),
            "relayerUsd": round(sum(float(f.get("amountUSD") or 0) for f in fees if "LIFI" not in (f.get("name") or "")), 4) if dst != "rh" else None,
            "routeUsd": round(sum(float(f.get("amountUSD") or 0) for f in fees if "LIFI" in (f.get("name") or "")), 4),
            "networkUsd": round(sum(float(g.get("amountUSD") or 0) for g in e.get("gasCosts") or []), 4),
            "etaSec": int(e.get("executionDuration") or 0), "spender": e["approvalAddress"].lower(), "impactPct": None,
            "steps": [{"chainId": int(tx.get("chainId") or 4663), "to": tx["to"], "data": tx.get("data") or "0x",
                       "value": str(_hexint(tx.get("value"))), "gas": str(_hexint(tx.get("gasLimit"))) if tx.get("gasLimit") else None,
                       "kind": "swap" if dst == "rh" else "bridge"}],
            "track": {"provider": "lifi", "fromChain": 4663, "toChain": CHAINS[dst]["id"]}}


def relay_sell(ca: str, dst: str, units: int, user: str, slip: float) -> dict | None:
    body = {"user": user, "recipient": user, "originChainId": 4663, "destinationChainId": CHAINS[dst]["id"], "originCurrency": ca,
            "destinationCurrency": NATIVE, "amount": str(units), "tradeType": "EXACT_INPUT", "slippageTolerance": str(int(slip * 10000))}
    try: d = _post("https://api.relay.link/quote/v2", body, timeout=20)
    except urllib.error.HTTPError as e: log("relay", code=e.code, body=e.read()[:200].decode("utf-8", "ignore")); return None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e: log("relay", error=str(e)[:120]); return None
    det, fees = d.get("details") or {}, d.get("fees") or {}
    co = det.get("currencyOut") or {}
    steps, spender, req_id = [], None, None
    for s in d.get("steps") or []:
        if s.get("kind") != "transaction": return None
        for it in s.get("items") or []:
            x = it.get("data") or {}
            if s.get("id") == "approve":   # we write our own approval (exact amount); only its spender is taken, and checked below
                if (x.get("to") or "").lower() != ca or not (x.get("data") or "").startswith("0x095ea7b3"): return None
                spender = "0x" + x["data"][34:74].lower(); continue
            req_id = req_id or s.get("requestId")
            steps.append({"chainId": int(x.get("chainId") or 4663), "to": x["to"], "data": x.get("data") or "0x",
                          "value": str(_hexint(x.get("value"))), "gas": str(_hexint(x["gas"])) if x.get("gas") else None,
                          "kind": "swap" if dst == "rh" else "bridge"})
    if len(steps) != 1 or not co.get("amount"): return None
    spender = spender or steps[0]["to"].lower()
    if spender != steps[0]["to"].lower(): return None   # the permission goes only to the contract that then takes the tokens
    imp = (det.get("swapImpact") or {}).get("percent")
    return {"provider": "relay", "out": int(co["amount"]), "outMin": int(co.get("minimumAmount") or co["amount"]),
            "outUsd": float(co.get("amountUsd") or 0), "inUsd": float((det.get("currencyIn") or {}).get("amountUsd") or 0),
            "relayerUsd": round(float((fees.get("relayer") or {}).get("amountUsd") or 0), 4) if dst != "rh" else None, "routeUsd": 0.0,
            "networkUsd": round(float((fees.get("gas") or {}).get("amountUsd") or 0), 4), "etaSec": int(det.get("timeEstimate") or 0),
            "spender": spender, "impactPct": abs(float(imp)) if imp not in (None, "") else None,
            "steps": steps, "track": {"provider": "relay", "requestId": req_id, "fromChain": 4663, "toChain": CHAINS[dst]["id"]}}


def sell(ca: str, dst: str, amount: str, account: str | None, slippage: str | None = None) -> dict:
    """A token on Robinhood Chain sold for the native coin of `dst`. The first sale of a token needs a one-time permission
    (ERC-20 approve) for exactly the amount sold, to the contract that takes the tokens: two signatures then, one after."""
    if dst not in CHAINS: raise Fail("bad_input")
    try: slip = min(max(float(slippage or 3), 0.1), 20) / 100
    except ValueError: raise Fail("bad_input")
    t = token_view(ca)
    dec = 18 if t.get("decimals") is None else int(t["decimals"])
    units = _units(amount, dec)
    user = account if account and re.fullmatch(r"0x[0-9a-fA-F]{40}", account) and account.lower() != QUOTE_FROM.lower() else QUOTE_FROM
    signable = user != QUOTE_FROM
    jobs = [POOL.submit(lifi_sell, t["ca"], dst, units, user, slip)]
    if t["kind"] != "stock": jobs.append(POOL.submit(relay_sell, t["ca"], dst, units, user, slip))
    got = [j.result() for j in jobs]
    # the sale is signed on Robinhood Chain and sends no ETH along: anything else is not what the page shows
    got = [g for g in got if g and all(st["chainId"] == 4663 and int(st["value"]) == 0 and st["to"].lower() != t["ca"] for st in g["steps"])]   # never a direct call to the token (a transfer)
    if not got: raise Fail("no_route", 404)
    best = max(got, key=lambda g: g["out"])
    steps = list(best["steps"])
    if signable:
        try: allowed = _allowance(t["ca"], user, best["spender"])
        except (OSError, ValueError, urllib.error.URLError): allowed = 0
        if allowed < units:
            steps.insert(0, {"chainId": 4663, "to": t["ca"], "data": "0x095ea7b3" + _w(int(best["spender"], 16)) + _w(units),
                             "value": "0", "gas": None, "kind": "approve"})
            if allowed > 0:   # some tokens (USDT-style) refuse to change a non-zero allowance: set it to zero first
                steps.insert(0, {"chainId": 4663, "to": t["ca"], "data": "0x095ea7b3" + _w(int(best["spender"], 16)) + _w(0),
                                 "value": "0", "gas": None, "kind": "approve"})
    tax_bps = ((t.get("facts") or {}).get("creatorTaxBps") or 0) if t["kind"] == "launch" else 0
    in_usd = best["inUsd"]
    fee_usd = (best["relayerUsd"] or 0) + best["routeUsd"] + in_usd * tax_bps / 1e4
    impact = best.get("impactPct")
    if impact is not None: impact = max(0.0, impact - tax_bps / 100)
    rough = impact is None   # Relay measures the impact; LI.FI's comes from its own input price (measured: 11.9% vs Relay's 1.07% on the same sale)
    if impact is None and in_usd > 0 and best["outUsd"] > 0: impact = max(0.0, 100 * (1 - best["outUsd"] / max(in_usd - fee_usd, 1e-9)))
    warnings = (["creator_tax"] if tax_bps else []) + (["high_impact"] if impact is not None and impact > 5 and not (rough and t["kind"] == "launch") else [])
    cost = round(100 * (1 - best["outUsd"] / in_usd), 2) if in_usd > 0 and best["outUsd"] > 0 else None
    if cost is not None and cost > 15: warnings.append("costly_route")
    if signable:
        try:
            r = multicall([(t["ca"], "0x70a08231" + _w(int(user, 16)))])[0]
            if r is not None and int.from_bytes(r[:32], "big") < units: warnings.append("over_balance")
        except (OSError, ValueError, urllib.error.URLError): pass
        try:   # a sale pays its gas in ETH on Robinhood Chain: someone who bought from another chain may hold the token and no ETH
            eth = int(_rpc("eth_getBalance", [user, "latest"]), 16) / 1e18
            need = max(0.00002, 1.5 * (best["networkUsd"] / SNAP["eth_usd"] if SNAP["eth_usd"] else 0)) * (2 if len(steps) > 1 else 1)
            if eth < need: warnings.append("no_gas")
        except (OSError, ValueError, urllib.error.URLError): pass
    coin = CHAINS[dst]["native"]
    return {"side": "sell", "amountIn": amount, "inSymbol": t["symbol"], "inUsd": round(in_usd, 2), "costPct": cost,
            "out": _fmt_units(best["out"], 18), "outMin": _fmt_units(best["outMin"], 18), "outSymbol": coin,
            "outUsd": round(best["outUsd"], 2) if best["outUsd"] else None,
            "route": {"from": "rh", "to": dst, "fromName": CHAINS["rh"]["name"], "toName": CHAINS[dst]["name"],
                      "label": "Sell on Robinhood Chain" if dst == "rh" else f"Sell and receive {coin} on {CHAINS[dst]['name']}",
                      "signatures": len(steps), "etaSec": best["etaSec"], "provider": best["provider"]},
            "fees": {"relayerUsd": best["relayerUsd"], "routeUsd": round(best["routeUsd"], 2) if best["routeUsd"] else 0,
                     "creatorTaxPct": tax_bps / 100, "creatorTaxUsd": round(in_usd * tax_bps / 1e4, 2),
                     "networkUsd": best["networkUsd"], "impactPct": None if impact is None else round(impact, 2)},
            "warnings": warnings, "slippagePct": round(slip * 100, 2), "expiresAt": int(time.time()) + 45, "signable": signable,
            "recipient": user if signable else None, "token": {"ca": t["ca"], "symbol": t["symbol"], "decimals": dec, "logo": t.get("logo")},
            "steps": steps if signable else [], "track": best["track"], "explorer": CHAINS["rh"]["explorer"]}


def status(provider: str, tx: str, request_id: str | None, from_chain: int, to_chain: int = 4663) -> dict:
    """Where a bridge-and-buy stands: pending / done / failed, and what arrived when the provider says."""
    try:
        if provider == "relay" and request_id:
            d = _get("https://api.relay.link/intents/status/v3?requestId=" + urllib.parse.quote(request_id))   # status: no key needed
            s = d.get("status")
            return {"status": "done" if s == "success" else "failed" if s in ("failure", "refund") else "pending",
                    "outTx": (d.get("txHashes") or [None])[-1]}
        d = _get("https://li.quest/v1/status?" + urllib.parse.urlencode({"txHash": tx, "fromChain": from_chain, "toChain": to_chain}))
        s = d.get("status")
        rec = d.get("receiving") or {}
        sub = d.get("substatus")
        if s == "DONE" and sub in ("PARTIAL", "REFUNDED"): s = "FAILED"   # an in-between token or the ETH back: not the buy
        return {"status": "done" if s == "DONE" else "failed" if s == "FAILED" else "pending", "outTx": rec.get("txHash"),
                "received": rec.get("amount"), "substatus": d.get("substatus")}
    except urllib.error.HTTPError as e:
        if e.code == 404: return {"status": "pending"}
        raise


_BAL: dict = {}


def balances(account: str, fresh: bool = False) -> dict:
    hit = _BAL.get(account)
    if hit and not fresh and time.time() - hit[0] < 5: return hit[1]
    def one(k):
        try: return k, _fmt_units(int(_rpc("eth_getBalance", [account, "latest"], k), 16), 18)
        except Exception as e: log("balance", chain=k, error=str(e)[:80]); return k, None   # noqa: BLE001
    out = dict(POOL.map(one, list(CHAINS)))
    _BAL[account] = (time.time(), out)
    if len(_BAL) > 2000: _BAL.clear()
    return out


# ---- the wallet: native money on every source chain, and everything held on Robinhood Chain ---------------------------------
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
_PRICE: dict = {}


_LIST: dict = {}


def lifi_list(chain_id: int) -> dict:
    """Every token LI.FI lists on a chain, with price and logo, in one call (about 330 on Robinhood Chain); cached five minutes."""
    hit = _LIST.get(chain_id)
    if hit and time.time() - hit[0] < 300: return hit[1]
    try:
        d = _get(f"https://li.quest/v1/tokens?chains={chain_id}", timeout=20)
        out = {t["address"].lower(): t for t in (d.get("tokens") or {}).get(str(chain_id)) or []}
    except Exception: out = hit[1] if hit else {}   # noqa: BLE001
    _LIST[chain_id] = (time.time(), out)
    return out


def lifi_token(chain_id: int, token: str) -> dict:
    """LI.FI's card for a token (it prices natives, stock tokens and the chain's memecoins alike, and has their logos); cached a minute."""
    k = (chain_id, token.lower()); hit = _PRICE.get(k)
    if hit and time.time() - hit[0] < (600 if hit[1] else 30): return hit[1]   # a miss is asked again soon, a card kept ten minutes
    listed = lifi_list(chain_id).get(token.lower()) if chain_id == 4663 else None   # other chains' lists are thousands long
    if listed: _PRICE[k] = (time.time(), listed); return listed
    try: d = _get(f"https://li.quest/v1/token?chain={chain_id}&token={token}", timeout=10)
    except Exception: d = hit[1] if hit else {}   # noqa: BLE001
    if len(_PRICE) > 5000: _PRICE.clear()
    _PRICE[k] = (time.time(), d)
    return d


def price_usd(chain_id: int, token: str) -> float | None:
    try: return float(lifi_token(chain_id, token).get("priceUSD") or 0) or None
    except (TypeError, ValueError): return None


def wallet(account: str) -> dict:
    """The native coin on each source chain, in dollars, biggest first: what the pay side can spend."""
    bal = balances(account)
    prices = {sym: (SNAP["eth_usd"] if sym == "ETH" else None) for sym in {c["native"] for c in CHAINS.values()}}
    for k, c in CHAINS.items():
        if prices[c["native"]] is None: prices[c["native"]] = price_usd(c["id"], NATIVE)
    rows = []
    for k, c in CHAINS.items():
        amt = bal.get(k)
        px = prices.get(c["native"])
        rows.append({"key": k, "chainId": c["id"], "name": c["name"], "symbol": c["native"], "amount": amt,
                     "usd": round(float(amt) * px, 2) if amt is not None and px else None})
    rows.sort(key=lambda r: -(r["usd"] or 0))
    return {"total": round(sum(r["usd"] or 0 for r in rows), 2), "rows": rows}


_PORT: dict = {}


def portfolio(account: str, extra: list) -> dict:
    """Everything the wallet holds on Robinhood Chain that we can name: ETH, USDG, the 64 stock tokens, the launches we track
    and any token this browser bought through Quoro (`extra`). Balances in Multicall batches; prices from LI.FI."""
    key = (account.lower(), tuple(sorted(extra)))
    hit = _PORT.get(key)
    if hit and time.time() - hit[0] < 15: return hit[1]
    meta = {}   # ca -> what we know about it
    for st in STOCKS: meta[st["token"].lower()] = {"kind": "stock", "symbol": st["ticker"], "name": st["name"], "logo": LOGO.format(st["ticker"])}
    meta[USDG] = {"kind": "other", "symbol": "USDG", "name": "Global Dollar", "logo": None}
    for lst in ("all", "recent"):
        for r in LAUNCHES[lst]: meta.setdefault(r["ca"], {"kind": "launch", "symbol": r["symbol"], "name": r["name"], "logo": r["logo"]})
    for ca in extra: meta.setdefault(ca, {"kind": "other", "symbol": None, "name": None, "logo": None})
    cas = list(meta)
    held = []
    if ALCHEMY_KEY:   # the whole wallet, not only the tokens we know: one call per 100 tokens
        page, seen_all = None, True
        for _ in range(10):
            params = [account, "erc20"] + ([{"pageKey": page}] if page else [])
            body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "alchemy_getTokenBalances", "params": params}).encode()
            try:
                req = urllib.request.Request(f"https://robinhood-mainnet.g.alchemy.com/v2/{ALCHEMY_KEY}", data=body, headers={**UA, "content-type": "application/json"})
                with urllib.request.urlopen(req, timeout=15) as r: j = json.load(r)
                if "error" in j or "result" not in j: raise ValueError("rpc error " + str((j.get("error") or {}).get("code")))
                res = j["result"] or {}
            except (OSError, ValueError, urllib.error.URLError, http.client.HTTPException) as e:
                log("alchemy", error=type(e).__name__); seen_all = False; break   # never the URL: it carries the key
            for tb in res.get("tokenBalances") or []:
                raw = int(tb.get("tokenBalance") or "0x0", 16)
                ca = (tb.get("contractAddress") or "").lower()
                if raw > 0 and ca:
                    meta.setdefault(ca, {"kind": "other", "symbol": None, "name": None, "logo": None}); held.append((ca, raw))
            page = res.get("pageKey")
            if not page: break
        if seen_all: cas = []   # Alchemy answered for the whole wallet: no need to probe the known list
    for i in range(0, len(cas), 150):   # no Alchemy (or it failed): probe the tokens we know. The official node resets a connection on a 400-call batch
        chunk = cas[i:i + 150]
        calls = [(ca, "0x70a08231" + _w(int(account, 16))) for ca in chunk]
        try: res = multicall(calls)
        except (OSError, ValueError, urllib.error.URLError, http.client.HTTPException): time.sleep(0.5); res = multicall(calls)
        held += [(ca, int.from_bytes(r[:32], "big")) for ca, r in zip(chunk, res) if r and int.from_bytes(r[:32], "big") > 0]
    def one(item):
        ca, raw = item
        m = meta[ca]
        t = None
        try:
            if m["kind"] == "launch" or (m["kind"] == "other" and ca != USDG):
                t = token_view(ca)   # a launch (known, or one outside today's lists): its card and score; else the contract's name
        except (Fail, OSError, ValueError, urllib.error.URLError, http.client.HTTPException):
            t = None
        if t: m = {**m, "kind": t["kind"], "symbol": t["symbol"] or m["symbol"], "name": t["name"] or m["name"], "logo": t["logo"] or m["logo"]}
        dec = (t or {}).get("decimals") or 18
        if ca == USDG: dec = 6
        amt = raw / 10 ** dec
        px = (SNAP["stocks"].get(m["symbol"]) or {}).get("priceUsd") if m["kind"] == "stock" else None
        if px is None and t and t.get("priceUsd"): px = t["priceUsd"]   # a launch priced from its own trades (ETH pairs)
        if px is None and ca == USDG: px = 1.0
        px = px or price_usd(4663, ca)
        live = SNAP["stocks"].get(m["symbol"]) if m["kind"] == "stock" else None
        logo = m["logo"] or _img(lifi_token(4663, ca).get("logoURI"))   # no picture of our own: LI.FI's, through /img
        return {"ca": ca, "kind": m["kind"], "symbol": m["symbol"], "name": m["name"], "logo": logo,
                "amount": _fmt_units(raw, dec), "priceUsd": px, "valueUsd": round(amt * px, 2) if px else None,
                "change24h": (live or {}).get("change24h"), "score": ((t or {}).get("score") or {}).get("value")}
    held = list(dict(held).items())   # one row per token, even when a paging retry repeated some
    held.sort(key=lambda h: 0 if meta[h[0]]["kind"] in ("stock", "launch") or h[0] == USDG else 1)   # ours first, then the rest
    items = list(POOL.map(one, held[:80]))
    beyond = max(0, len(held) - 80)   # never read: counted as hidden
    eth = balances(account).get("rh")
    if eth and float(eth) > 0:
        items.append({"ca": None, "kind": "native", "symbol": "ETH", "name": "Ether", "logo": "/assets/chains/eth-coin.svg", "amount": eth,
                      "priceUsd": SNAP["eth_usd"], "valueUsd": round(float(eth) * SNAP["eth_usd"], 2), "change24h": None, "score": None})
    # what we can't vouch for stays out of the list and the total: airdropped spam names itself "USDG" and carries a made-up price
    # (hundreds of thousands of dollars on a public whale address). Shown: ETH, the real USDG, stock tokens and launches; everything else is hidden.
    def shown(x): return x["kind"] in ("native", "stock", "launch") or x["ca"] == USDG
    dust = [x for x in items if not shown(x) or (x["valueUsd"] is not None and x["valueUsd"] < 0.01 and x["kind"] != "native")]
    items = [x for x in items if x not in dust]
    items.sort(key=lambda x: -(x["valueUsd"] or 0))
    out = {"account": account, "totalUsd": round(sum(x["valueUsd"] or 0 for x in items), 2), "items": items, "hidden": len(dust) + beyond, "t": int(time.time())}
    _PORT[key] = (time.time(), out)
    if len(_PORT) > 500: _PORT.clear()
    return out


def search(qtext: str) -> list:
    """The header search as you type: an address reads that token; words match tickers and names among the stock tokens and the
    launches we track (exact ticker first, then prefix, then name)."""
    qtext = (qtext or "").strip()
    if re.fullmatch(r"0x[0-9a-fA-F]{40}", qtext):
        t = token_view(qtext)
        return [{"ca": t["ca"], "kind": t["kind"], "symbol": t["symbol"], "name": t["name"], "logo": t["logo"],
                 "priceUsd": t.get("priceUsd"), "mcapUsd": t.get("mcapUsd"), "score": (t.get("score") or {}).get("value")}]
    k = qtext.lstrip("$").lower()
    if len(k) < 1: return []
    pool = [{"ca": st["token"].lower(), "kind": "stock", "symbol": st["ticker"], "name": st["name"], "logo": LOGO.format(st["ticker"]),
             "priceUsd": (SNAP["stocks"].get(st["ticker"]) or {}).get("priceUsd"), "mcapUsd": None, "score": None} for st in STOCKS]
    seen = {p["ca"] for p in pool}
    for lst in ("all", "recent"):
        for r in LAUNCHES[lst]:
            if r["ca"] in seen: continue
            seen.add(r["ca"])
            pool.append({"ca": r["ca"], "kind": "launch", "symbol": r["symbol"], "name": r["name"], "logo": r["logo"],
                         "priceUsd": None, "mcapUsd": r.get("mcapUsd"), "score": r.get("score")})
    def rank(p):
        sym, name = (p["symbol"] or "").lower(), (p["name"] or "").lower()
        return 0 if sym == k else 1 if sym.startswith(k) else 2 if name.startswith(k) else 3 if k in name or k in sym else 9
    hits = sorted((p for p in pool if rank(p) < 9), key=lambda p: (rank(p), -(p["mcapUsd"] or 0)))
    return hits[:8]


# ---- per-visitor limits ----------------------------------------------------------------------------------------------------
_HITS: dict = {}


def throttle(who: str, kind: str, per_min: int) -> None:
    now = time.time(); k = (who, kind)
    xs = [t for t in _HITS.get(k, []) if now - t < 60]
    if len(xs) >= per_min: raise Fail("rate_limited", 429)
    xs.append(now); _HITS[k] = xs
    if len(_HITS) > 20000:   # drop the idle ones, never everyone's limits at once
        for kk in [kk for kk, v in _HITS.items() if not v or now - v[-1] > 60]: _HITS.pop(kk, None)


# ---- token images (only ones a token answer named; https / ipfs, public hosts, image types, capped folder) -------------------
class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None


_OPENER = urllib.request.build_opener(_NoRedirect)
IMG_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/svg+xml"}
IMG_DIR_CAP = 200 * 1024 * 1024
# measured: filebase and 4everland answer in ~0.3 s; pinata is slow and rate-limits (429); ipfs.io / dweb refuse many (403)
IPFS_GATEWAYS = ["https://ipfs.filebase.io/ipfs/", "https://4everland.io/ipfs/", "https://gateway.pinata.cloud/ipfs/", "https://ipfs.io/ipfs/"]
IMG_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36"
IMGPOOL = cf.ThreadPoolExecutor(max_workers=12)   # gateway downloads
WARM = cf.ThreadPoolExecutor(max_workers=4)       # pictures fetched ahead of visitors


def _public_host(h: str) -> bool:
    try:
        return all(ipaddress.ip_address(ai[4][0]).is_global for ai in socket.getaddrinfo(h, 443))   # no private, shared (100.64/10) or reserved
    except (socket.gaierror, ValueError, OSError):
        return False


def _download(u: str) -> tuple[bytes, str] | None:
    """One image over https from a public host, redirects followed by hand (each hop checked); None on anything else."""
    try:
        for _hop in range(4):
            pu = urllib.parse.urlparse(u); host = pu.hostname or ""
            if pu.scheme not in ("https", "http") or not host or not _public_host(host): return None
            try:
                with _OPENER.open(urllib.request.Request(u, headers={"user-agent": IMG_UA, "accept": "image/*"}), timeout=8) as r:
                    ctype = r.headers.get("content-type", "").split(";")[0].strip().lower(); data = r.read(4_000_001)
                break
            except urllib.error.HTTPError as e:
                if e.code in (301, 302, 303, 307, 308) and e.headers.get("location"):
                    u = urllib.parse.urljoin(u, e.headers["location"]); continue
                return None
        else:
            return None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError, http.client.HTTPException):
        return None
    if ctype not in IMG_TYPES or len(data) > 4_000_000: return None
    return data, ctype


def _thumb(data: bytes, ctype: str) -> tuple[bytes, str]:
    """Token pictures arrive at up to 4 MB; the page shows them at 48 px. 128 px WebP (animated GIFs keep moving as they are)."""
    if not Image or ctype in ("image/gif", "image/svg+xml"): return data, ctype
    try:
        im = Image.open(io.BytesIO(data)); im.thumbnail((128, 128))
        buf = io.BytesIO(); im.convert("RGBA").save(buf, "WEBP", quality=85)
        return buf.getvalue(), "image/webp"
    except Exception as e:   # noqa: BLE001 - keep the original on any decode trouble
        log("img", error=str(e)[:80]); return data, ctype


_IMG_LOCK: dict = {}   # one download per picture, however many visitors ask at once


def fetch_image(src: str) -> tuple[bytes, str] | None:
    os.makedirs(IMG_DIR, exist_ok=True)
    path = os.path.join(IMG_DIR, hashlib.sha1(src.encode()).hexdigest())
    if os.path.exists(path):
        with open(path, "rb") as f: data = f.read()
        return data, open(path + ".type").read() if os.path.exists(path + ".type") else "image/png"
    if os.path.exists(path + ".miss") and time.time() - os.path.getmtime(path + ".miss") < 120: return None   # retried soon
    lock = _IMG_LOCK.setdefault(path, threading.Lock())
    with lock:
        if os.path.exists(path): return fetch_image(src)
        m = re.search(r"/ipfs/([A-Za-z0-9]{46,})", src)   # someone else's gateway link: fetch the same file from ours
        cid = src[7:].lstrip("/").split("?")[0] if src.startswith("ipfs://") else m.group(1) if m else None
        urls = [g + cid for g in IPFS_GATEWAYS] if cid else [src] if src.startswith(("https://", "http://")) else []
        got = None
        if urls:   # every gateway at once, the first good answer wins
            futs = [IMGPOOL.submit(_download, u) for u in urls]
            try:
                for f in cf.as_completed(futs, timeout=20):
                    got = f.result()
                    if got: break
            except cf.TimeoutError:
                got = None
        _IMG_LOCK.pop(path, None)
        if not got:
            open(path + ".miss", "w").close(); return None
        data, ctype = _thumb(*got)
        files = sorted((os.path.getmtime(os.path.join(IMG_DIR, f)), f) for f in os.listdir(IMG_DIR))
        total = sum(os.path.getsize(os.path.join(IMG_DIR, f)) for _, f in files)
        for _, f in files:
            if total <= IMG_DIR_CAP: break
            fp = os.path.join(IMG_DIR, f); total -= os.path.getsize(fp); os.remove(fp)
        with open(path, "wb") as f: f.write(data)
        with open(path + ".type", "w") as f: f.write(ctype)
        return data, ctype


def warm_images(srcs: list) -> None:
    """Fetch the lists' pictures before anyone asks, so /explore paints them from disk."""
    for src in srcs:
        if src and not os.path.exists(os.path.join(IMG_DIR, hashlib.sha1(src.encode()).hexdigest())): WARM.submit(fetch_image, src)


# ---- HTTP ------------------------------------------------------------------------------------------------------------------
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png",
         ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".ico": "image/x-icon",
         ".mp4": "video/mp4", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml"}
GZ_TYPES = {"text/html", "text/css", "text/javascript", "application/json", "image/svg+xml"}
_GZ: dict = {}
PAGES = {"/": "/index.html", "/app": "/app.html", "/explore": "/explore.html", "/docs": "/docs.html", "/portfolio": "/portfolio.html"}
SITE_URL = os.environ.get("SITE_URL", "").rstrip("/")   # the public address (https://domain): og:url and og:image must be absolute


_VER: dict = {}


def asset_version(rel: str) -> str:
    """A short hash of a file under the site: changes exactly when the file does."""
    full = os.path.join(SITE, rel.lstrip("/"))
    try: mt = os.path.getmtime(full)
    except OSError: return "0"
    hit = _VER.get(full)
    if hit and hit[0] == mt: return hit[1]
    with open(full, "rb") as f: v = hashlib.sha1(f.read()).hexdigest()[:10]
    _VER[full] = (mt, v)
    return v


def _versioned(html: bytes) -> bytes:
    return re.sub(rb'(src|href)="(/(?:js|css)/[^"?#]+\.(?:js|css))"',
                  lambda m: m.group(1) + b'="' + m.group(2) + b"?v=" + asset_version(m.group(2).decode()).encode() + b'"', html)


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"   # streamed answers end when the connection closes

    def log_message(self, *a): pass

    def who(self) -> str:
        """The visitor's address as our proxy saw it: the last X-Forwarded-For hop (the one the proxy appended; anything
        before it, and any X-Real-IP, is whatever the client wrote), else the socket."""
        hops = [h.strip() for h in (self.headers.get("x-forwarded-for") or "").split(",") if h.strip()]
        return hops[-1] if hops else self.client_address[0]

    def headers_common(self) -> None:
        self.send_header("x-content-type-options", "nosniff"); self.send_header("referrer-policy", "strict-origin-when-cross-origin")

    def send(self, code: int, body: bytes, ctype: str, cache: str = "no-store", gz_key: str | None = None) -> None:
        self.send_response(code); self.send_header("content-type", ctype); self.send_header("cache-control", cache); self.headers_common()
        if len(body) > 1400 and ctype.split(";")[0] in GZ_TYPES and "gzip" in (self.headers.get("accept-encoding") or ""):
            z = _GZ.get(gz_key) if gz_key else None
            if z is None:
                z = gzip.compress(body, 6)
                if gz_key: _GZ[gz_key] = z
            body = z; self.send_header("content-encoding", "gzip"); self.send_header("vary", "accept-encoding")
        self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def json(self, obj, code: int = 200) -> None: self.send(code, json.dumps(obj).encode(), "application/json")

    def body(self) -> dict:
        try: n = int(self.headers.get("content-length") or 0)
        except ValueError: raise Fail("bad_input")
        if n < 0 or n > 4_000: raise Fail("bad_input", 413)
        try: return json.loads(self.rfile.read(n) or b"{}")
        except ValueError: raise Fail("bad_input")

    def do_HEAD(self):
        # Privy probes the page's headers with HEAD before opening its window: pages answer, nothing else does
        page = urllib.parse.urlparse(self.path).path.rstrip("/") or "/"
        self.send_response(200 if page in PAGES else 404); self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", "0"); self.end_headers()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        origin = self.headers.get("origin", "")
        if origin and urllib.parse.urlparse(origin).netloc != self.headers.get("host", ""): return self.json({"error": "origin"}, 403)
        try:
            if path != "/api/explain": raise Fail("not_found", 404)
            throttle(self.who(), "explain", 6)   # first: nothing reaches the engine or the model past the limit
            b = self.body()
            t = token_view(str(b.get("ca") or ""))
            if t["kind"] != "launch": raise Fail("no_score")
            if not OR_KEY: raise Fail("offline", 503)
            who = hashlib.sha256(self.who().encode()).hexdigest()[:24]
            if q("select count(*) n from asks where who=? and t>?", (who, int(time.time()) - 86400))[0]["n"] >= EXPLAIN_DAILY: raise Fail("rate_limited", 429)
            ask_id = q("insert into asks values (?, ?) returning rowid", (who, int(time.time())))[0][0]   # counted before the model runs
        except Fail as f:
            return self.json({"error": f.code}, f.status)
        self.send_response(200); self.send_header("content-type", "text/event-stream"); self.send_header("cache-control", "no-store")
        self.send_header("x-accel-buffering", "no"); self.headers_common(); self.end_headers()
        def emit(obj): self.wfile.write(b"data: " + json.dumps(obj).encode() + b"\n\n"); self.wfile.flush()
        try:
            text = stream_explain(t, lambda piece: emit({"d": piece}))
            if text: emit({"done": True})
            else: q("delete from asks where rowid=?", (ask_id,)); emit({"error": "model"})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as e:
            log("llm", error=str(e)[:160]); q("delete from asks where rowid=?", (ask_id,))
            try: emit({"error": "model"})
            except OSError: pass
        return None

    def do_GET(self):
        u = urllib.parse.urlparse(self.path); path = u.path; qs = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        try:
            if path == "/api/config":
                return self.json({"privy": PRIVY_APP_ID or None, "privyV": asset_version("/js/privy.js"),
                                  "chains": [{"key": k, "id": c["id"], "name": c["name"], "native": c["native"], "explorer": c["explorer"],
                                              "reserve": c["reserve"], "logo": f"/assets/chains/{k}.svg",
                                              "nativeLogo": f"/assets/chains/{c['native'].lower()}-coin.svg"} for k, c in CHAINS.items()],
                                  "token": {"ticker": TOKEN_TICKER or None, "ca": TOKEN_CA or None}})
            if path == "/api/pulse":
                rows = LAUNCHES["all"]
                scored = [r for r in rows if r.get("score") is not None]
                warm = len(scored) >= 30   # right after a start only a handful is scored: no ratio until it means something
                return self.json({"scored": len(scored) if warm else None, "flagged": sum(1 for r in scored if r.get("flagged")) if warm else None,   # among the launches we track
                                  "block": SNAP["block"], "blockTs": round(SNAP["block_t"], 2), "blockMs": 100,
                                  "tokens": SNAP["launches_24h"], "stocks": len(STOCKS), "ethUsd": round(SNAP["eth_usd"], 2), "ts": int(time.time())})
            if path == "/api/examples": return self.json(SNAP["examples"])
            if path == "/api/launches":
                sort = qs.get("sort", "trending")
                if sort not in ("trending", "recent", "all"): raise Fail("bad_input")
                try: n = max(1, min(int(qs.get("limit", "50")), 300))
                except ValueError: raise Fail("bad_input")
                return self.json({"rows": LAUNCHES[sort][:n], "t": int(LAUNCHES["t"])})
            if path == "/api/stocks": return self.json(sorted(SNAP["stocks"].values(), key=lambda d: d["ticker"]))
            if path.startswith("/api/token/"):
                throttle(self.who(), "token", 60)
                return self.json(token_view(path.rsplit("/", 1)[1]))
            if path == "/api/quote":
                throttle(self.who(), "quote", 40)
                if qs.get("side") == "sell":
                    return self.json(sell(qs.get("ca", ""), qs.get("to", "rh"), qs.get("amount", ""), qs.get("account"), qs.get("slippage")))
                return self.json({"side": "buy", **quote(qs.get("ca", ""), qs.get("from", ""), qs.get("amount", ""), qs.get("account"), qs.get("slippage"))})
            if path == "/api/status":
                throttle(self.who(), "status", 60)
                tx = qs.get("tx", "")
                if not re.fullmatch(r"0x[0-9a-fA-F]{64}", tx): raise Fail("bad_input")
                return self.json(status(qs.get("provider", "lifi"), tx, qs.get("requestId"), int(qs["fromChain"]) if (qs.get("fromChain") or "").isdigit() else 4663,
                                        int(qs["toChain"]) if (qs.get("toChain") or "").isdigit() else 4663))
            if path.startswith("/api/brief/"):   # the AI's first line on a launch: cached per token for everyone, limited per visitor
                throttle(self.who(), "token", 60)   # reading the token reaches the engine: the same limit as /api/token
                t = token_view(path.rsplit("/", 1)[1])
                if t["kind"] != "launch": raise Fail("no_score")
                if not OR_KEY: raise Fail("offline", 503)
                key = (t["ca"], t["score"]["value"])
                hit = _BRIEF.get(key)
                if not (hit and time.time() - hit[0] < 600): throttle(self.who(), "brief", 20)   # a cached line costs nothing
                try: text = brief(t)
                except (urllib.error.URLError, TimeoutError, OSError, ValueError, http.client.HTTPException) as e:
                    log("brief", error=str(e)[:120]); raise Fail("offline", 503)
                if not text: raise Fail("offline", 503)
                return self.json({"ca": t["ca"], "score": t["score"]["value"], "text": text})
            if path == "/api/search":
                throttle(self.who(), "search", 120)
                if re.fullmatch(r"\s*0x[0-9a-fA-F]{40}\s*", qs.get("q", "")): throttle(self.who(), "token", 60)   # an address reads the engine
                return self.json({"results": search(qs.get("q", "")[:80])})
            if path in ("/api/wallet", "/api/portfolio"):
                a = qs.get("account", "")
                if not re.fullmatch(r"0x[0-9a-fA-F]{40}", a): raise Fail("bad_input")
                throttle(self.who(), path, 20)
                if path == "/api/wallet": return self.json(wallet(a))
                extra = [x.lower() for x in qs.get("extra", "").split(",") if re.fullmatch(r"0x[0-9a-fA-F]{40}", x)][:50]
                return self.json(portfolio(a, extra))
            if path == "/api/balances":
                a = qs.get("account", "")
                if not re.fullmatch(r"0x[0-9a-fA-F]{40}", a): raise Fail("bad_input")
                throttle(self.who(), "balances", 30)
                return self.json(balances(a, qs.get("fresh") == "1"))
            if path == "/api/holding":   # how much of a token a wallet holds on Robinhood Chain: before and after a buy
                a, ca = qs.get("account", ""), qs.get("ca", "").lower()
                if not re.fullmatch(r"0x[0-9a-fA-F]{40}", a) or not re.fullmatch(r"0x[0-9a-f]{40}", ca): raise Fail("bad_input")
                throttle(self.who(), "holding", 60)
                if ca == NATIVE:
                    raw = int(_rpc("eth_getBalance", [a, "latest"]), 16)
                    return self.json({"raw": str(raw), "amount": _fmt_units(raw, 18), "decimals": 18})
                r = multicall([(ca, "0x70a08231" + _w(int(a, 16))), (ca, "0x313ce567")])
                if not r[0]: raise Fail("not_found", 404)
                dec = int.from_bytes(r[1][:32], "big") if r[1] else 18
                raw = int.from_bytes(r[0][:32], "big")
                return self.json({"raw": str(raw), "amount": _fmt_units(raw, dec), "decimals": dec})
            if path == "/healthz":
                ok = time.time() - SNAP["block_t"] < 120
                return self.json({"ok": ok, "block": SNAP["block"], "stocks": len(SNAP["stocks"]), "ethUsd": SNAP["eth_usd"]}, 200 if ok else 503)
            if path == "/img":
                src = qs.get("u", "")
                got = fetch_image(src) if src in _KNOWN_IMAGES else None
                if got:
                    self.send_response(200); self.send_header("content-type", got[1]); self.send_header("cache-control", "public, max-age=86400")
                    self.send_header("content-security-policy", "default-src 'none'; sandbox"); self.headers_common()
                    self.send_header("content-length", str(len(got[0]))); self.end_headers(); self.wfile.write(got[0]); return None
                self.send_response(204); self.send_header("cache-control", "no-store"); self.end_headers(); return None   # may arrive a second later
            if path.startswith("/api/"): raise Fail("not_found", 404)
            return self.static(path)
        except Fail as f:
            return self.json({"error": f.code}, f.status)
        except (sqlite3.Error, ValueError, KeyError, OSError, urllib.error.URLError, http.client.HTTPException) as e:
            log("http", path=path, error=str(e)[:160])
            return self.json({"error": "server"}, 500)

    def static(self, path: str) -> None:
        clean = {v: k for k, v in PAGES.items()}
        if path in clean:   # one address per page
            qstr = urllib.parse.urlparse(self.path).query
            self.send_response(301); self.send_header("Location", clean[path] + ("?" + qstr if qstr else ""))
            self.send_header("content-length", "0"); self.end_headers(); return
        if len(path) > 1 and path.endswith("/") and path.rstrip("/") in PAGES:   # /app/ -> /app: one address per page
            qstr = urllib.parse.urlparse(self.path).query
            self.send_response(301); self.send_header("Location", path.rstrip("/") + ("?" + qstr if qstr else ""))
            self.send_header("content-length", "0"); self.end_headers(); return
        if path == "/favicon.ico": path = "/assets/brand/favicon.ico"
        if path == "/404.html": path = "/__missing__"   # the not-found page is only ever an answer, never an address
        if path == "/robots.txt" and not os.path.isfile(os.path.join(SITE, "robots.txt")):
            return self.send(200, b"User-agent: *\nAllow: /\n", "text/plain; charset=utf-8", "public, max-age=86400")
        path = PAGES.get(path, path)
        full = os.path.realpath(os.path.join(SITE, path.lstrip("/")))
        if not full.startswith(os.path.realpath(SITE) + os.sep) or not os.path.isfile(full) or "/js/mock.js" in path and not self.local():
            page404 = os.path.join(SITE, "404.html")
            if os.path.isfile(page404):
                with open(page404, "rb") as f: return self.send(404, _versioned(f.read()), TYPES[".html"])
            return self.send(404, b"not found", "text/plain")
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as f: body = f.read()
        if ext == ".html":
            body = _versioned(body)
            if SITE_URL: body = body.replace(b"http://127.0.0.1:8795", SITE_URL.encode())
        if ext == ".html": cache = "no-store"
        elif self.path.split("?", 1)[-1].startswith("v=") and ext in (".js", ".css"): cache = "public, max-age=31536000, immutable"
        elif path.endswith("/js/privy.js"): cache = "public, max-age=86400"
        elif "/assets/" in path: cache = "public, max-age=604800"
        else: cache = "public, max-age=300"
        # a page's bytes depend on the versions of the files it names, not only on its own mtime: key its gzip by its content
        gz_key = f"{full}:{hashlib.sha1(body).hexdigest()}" if ext == ".html" else f"{full}:{os.path.getmtime(full)}"
        self.send(200, body, TYPES.get(ext, "application/octet-stream"), cache, gz_key=gz_key)

    def local(self) -> bool:
        return self.client_address[0] in ("127.0.0.1", "::1") and not self.headers.get("x-forwarded-for")


def main() -> None:
    if not ENGINE: raise SystemExit("ENGINE_URL is required: the launch data engine (token checks, launch lists, candles)")
    threading.Thread(target=block_loop, daemon=True).start()
    threading.Thread(target=data_loop, daemon=True).start()
    print(f"quoro · model {LLM_MODEL if OR_KEY else 'off'} · privy {'on' if PRIVY_APP_ID else 'off'} · http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer((os.environ.get("HOST", "127.0.0.1"), PORT), H).serve_forever()


if __name__ == "__main__":
    main()
