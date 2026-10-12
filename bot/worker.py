"""Quoro's reply bot: someone tags @QuoroAI with a Robinhood Chain address, the bot posts that token's Data score.

  poll mentions -> addressed to us? -> already answered? -> opted out? -> find the address -> read it -> reply -> mark

Two rules from X are enforced here rather than left to discipline: a reply is only permitted to the post that
mentioned us, and a mention in the timeline is not the same as being asked (X prepends a thread's handles to every
reply, so without reading only what the person typed the bot would answer every passer-by).

The bot cannot go and comment under launches on its own. The API refuses it, and working around that is a
permanent-suspension offence.

Environment: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET, X_HANDLE, QUORO_API, BOT_STATE,
DRY_RUN (1 = do everything except the three X calls), POLL_SEC, MAX_PER_HOUR, MAX_PER_AUTHOR_DAY.
"""
from __future__ import annotations
import json, os, re, time, urllib.parse, urllib.request

import render
import xapi

HANDLE = os.environ.get("X_HANDLE", "QuoroAI").lstrip("@").lower()
QUORO = os.environ.get("QUORO_API", "https://quoro.exchange").rstrip("/")
STATE = os.environ.get("BOT_STATE", "bot-state.json")
DRY = os.environ.get("DRY_RUN", "") == "1"
POLL = max(10, int(os.environ.get("POLL_SEC", "20")))
MAX_HOUR = int(os.environ.get("MAX_PER_HOUR", "30"))
MAX_AUTHOR_DAY = int(os.environ.get("MAX_PER_AUTHOR_DAY", "5"))

ADDR = re.compile(r"\b(0x[0-9a-fA-F]{40})\b")
QUORO_LINK = re.compile(r"quoro\.exchange/app\?ca=(0x[0-9a-fA-F]{40})", re.I)
STOP = re.compile(r"\b(stop|unsubscribe|don'?t reply|leave me alone)\b", re.I)


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


# ---- state: a small JSON file, on the volume in production ----------------------------------------------------
class Store:
    def __init__(self) -> None:
        self.mem = {"seen": {}, "optout": [], "since_id": None, "sent": []}
        if os.path.exists(STATE):
            try: self.mem.update(json.load(open(STATE, encoding="utf-8")))
            except Exception as e: log(f"state unreadable, starting fresh: {e}")

    def save(self) -> None:
        tmp = STATE + ".tmp"
        json.dump(self.mem, open(tmp, "w", encoding="utf-8"))
        os.replace(tmp, STATE)

    def seen(self, mid: str) -> bool: return mid in self.mem["seen"]

    def mark(self, mid: str, author: str, ca: str | None) -> None:
        """Written before the reply goes out: an answer lost to a crash is cheap, a second answer breaks a rule."""
        self.mem["seen"][mid] = {"author": author, "ca": ca, "at": int(time.time())}
        if len(self.mem["seen"]) > 5000:
            for k in sorted(self.mem["seen"], key=lambda k: self.mem["seen"][k]["at"])[:1000]: self.mem["seen"].pop(k)
        self.save()

    def opted_out(self, author: str) -> bool: return author in self.mem["optout"]

    def opt_out(self, author: str) -> None:
        if author not in self.mem["optout"]: self.mem["optout"].append(author); self.save()

    def count_sent(self, author: str | None = None, within: int = 3600) -> int:
        now = time.time()
        return sum(1 for s in self.mem["sent"] if now - s["at"] < within and (author is None or s["author"] == author))

    def sent(self, author: str) -> None:
        self.mem["sent"] = [s for s in self.mem["sent"] if time.time() - s["at"] < 86400]
        self.mem["sent"].append({"author": author, "at": int(time.time())}); self.save()


# ---- what is being asked --------------------------------------------------------------------------------------
def address_in(text: str) -> str | None:
    for rx in (QUORO_LINK, ADDR):
        m = rx.search(text or "")
        if m: return m.group(1).lower()
    return None


def parent_of(post: dict, included: dict) -> tuple[str, str]:
    """The post this mention answers: its text when X already sent it, and its id when it did not."""
    for ref in post.get("referenced_posts") or post.get("referenced_tweets") or []:
        if ref.get("type") == "replied_to":
            pid = str(ref.get("id") or "")
            p = included.get(pid) or {}
            return (p.get("note_post") or {}).get("text") or p.get("text") or "", pid
    return "", ""


def token_view(ca: str) -> dict | None:
    url = f"{QUORO}/api/token/{urllib.parse.quote(ca)}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "quoro-bot/1"})
        with urllib.request.urlopen(req, timeout=45) as r: return json.loads(r.read())
    except Exception as e:
        log(f"  token read failed: {str(e)[:120]}")
        return None


# ---- one mention ----------------------------------------------------------------------------------------------
def handle(post: dict, included: dict, store: Store) -> str:
    mid, author = str(post.get("id")), str(post.get("author_id") or "")
    text = xapi.typed_text(post)

    # Being in the mentions timeline is not being asked: X bolts the thread's handles onto every reply, so without
    # this the bot would answer every passer-by in any thread it was ever named in. Two things count as a summons:
    # the person typed the handle, or they replied straight to one of our own posts (there the handle is metadata,
    # and the words are only the address).
    direct = str(post.get("in_reply_to_user_id") or "") == str(xapi.BOT_ID)
    if "@" + HANDLE not in text.lower() and not direct:
        store.mark(mid, author, None)
        return f"{mid} skipped: not addressed to us"
    if STOP.search(text):
        store.mark(mid, author, None); store.opt_out(author)
        return f"{mid} opt-out by {author}"
    if store.opted_out(author):
        store.mark(mid, author, None)
        return f"{mid} skipped: opted out"
    if store.count_sent() >= MAX_HOUR:
        return f"{mid} held: {MAX_HOUR} replies this hour"
    if store.count_sent(author, 86400) >= MAX_AUTHOR_DAY:
        store.mark(mid, author, None)
        return f"{mid} skipped: {author} is at the daily limit"

    ca, source = address_in(text), "mention"
    if not ca:
        ptext, pid = parent_of(post, included)
        ca, source = address_in(ptext), "parent"
        if not ca and pid:
            # the address is usually in the post being answered, and the free copy of it arrives truncated when
            # that post is long: the tail, where people put the address, is exactly what gets cut. So the read is
            # bought whenever the free data did not yield an address, not only when it carried no text at all.
            try:
                ca, source = address_in(xapi.typed_text(xapi.one_post(pid))), "parent (paid)"
            except xapi.XError as e:
                log(f"  parent fetch failed: {e}")
        if not ca: source = "-"
    store.mark(mid, author, ca)                       # before anything is sent

    if not ca:                       # nothing to score: silence, never a reply asking for an address
        return f"{mid} skipped: no address"
    body = render.reply_for(token_view(ca))
    if DRY:
        log(f"  [dry] would reply to {mid} ({source}):\n{body}")
        store.sent(author)
        return f"{mid} dry-run, {len(body)} chars"
    try:
        rid = xapi.reply(body, mid)
    except xapi.XError as e:
        return f"{mid} reply failed: {e}"
    store.sent(author)
    return f"{mid} replied {rid} ({source}, {len(body)} chars)"


def main() -> None:
    if not xapi.configured(): raise SystemExit("X keys missing")
    who = xapi.whoami()
    me = xapi.me().get("data") or {}
    log(f"quoro bot · posting as @{me.get('username')} (id {who}) · dry_run={int(DRY)} · api={QUORO}")
    store = Store()
    while True:
        try:
            posts, included, newest = xapi.mentions(store.mem.get("since_id"))
            log(f"poll: {len(posts)} new")
            for p in posts:
                if store.seen(str(p.get("id"))): continue
                try: log("  " + handle(p, included, store))
                except Exception as e: log(f"  {p.get('id')} error: {str(e)[:160]}")
            if newest:                                  # only when something came back: it does not backfill
                store.mem["since_id"] = newest; store.save()
        except xapi.XError as e:
            log(f"poll failed: {e}")
            if not e.retryable: time.sleep(60)
        except Exception as e:
            log(f"loop error: {str(e)[:200]}")
        time.sleep(POLL)


if __name__ == "__main__":
    main()
