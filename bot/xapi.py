"""The only place that talks to X.

Taken unchanged from a bot that ran before this one; the notes below are what that run measured.

OAuth 1.0a user context, signed here with the standard library — the bot posts as one fixed account, so a full OAuth
library would be four dependencies for forty lines of HMAC. Only the three calls the bot actually makes:

  mentions(since_id)  GET  /2/users/{id}/mentions   $0.001 per mention (an Owned Read: the app belongs to the same
                                                    account whose mentions it reads), free when nothing is new
  upload_png(bytes)   POST /2/media/upload          not on the published price list
  reply(...)          POST /2/tweets                $0.010 as a summoned reply

Two rules from X that are enforced in code, not left to discipline: a reply is only permitted to a post whose author
mentioned us (so `in_reply_to` is always the mention itself, never the launch post underneath it), and a post may
carry at most one cashtag.

Signing note: only the query string and the oauth_* parameters go into the signature base. A JSON or multipart body
is never signed, which is why the body can be built freely below.
"""
from __future__ import annotations
import hashlib, hmac, json, os, secrets, time, urllib.parse, urllib.request

API = "https://api.x.com"
BOT_ID = os.environ.get("X_BOT_USER_ID", "").strip()
KEY = os.environ.get("X_API_KEY", "")
SECRET = os.environ.get("X_API_SECRET", "")
TOKEN = os.environ.get("X_ACCESS_TOKEN", "")
TOKEN_SECRET = os.environ.get("X_ACCESS_SECRET", "")

# post.fields and expansions are different namespaces on this endpoint, and the general guides still document the
# old v1 names. author_id / referenced_posts / in_reply_to_user_id are EXPANSIONS: asking for them as fields is
# out of enum, which is either a 400 or a silent drop — and a silent drop would quietly break the case that matters
# most, where the contract address lives in the post the mention replies to. (X API v2.168 OpenAPI, 20.09.2026.)
POST_FIELDS = "created_at,conversation_id,text,note_post,entities,display_text_range"
USER_FIELDS = "username"
EXPANSIONS = "referenced_posts,author_id,in_reply_to_user_id"


class XError(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"x api {status}: {body[:300]}")
        self.status, self.body = status, body

    @property
    def retryable(self) -> bool:
        """429 and 5xx are worth waiting out. 400/401/403/404 are verdicts: a rejected reply stays rejected, and
        retrying it only spends rate limit — a mention deleted between the poll and the reply never comes back."""
        return self.status == 429 or self.status >= 500


def configured() -> bool:
    return all((KEY, SECRET, TOKEN, TOKEN_SECRET))


def typed_text(post: dict) -> str:
    """Only what the person actually typed.

    X prepends the thread's mentions to a reply as metadata, and `text` carries them. `display_text_range` marks
    where the human's own words begin — everything before it is machinery. This matters because the mentions
    timeline does not distinguish "someone summoned the bot" from "someone replied in a thread where the bot was
    once summoned", and without this the bot answers every passer-by in any thread it has ever been named in
    (seen in the wild, 20.09.2026: a stranger wrote two unrelated words and got a report)."""
    txt = (post.get("note_post") or {}).get("text") or post.get("text") or ""
    r = post.get("display_text_range")
    if isinstance(r, list) and len(r) == 2:
        try: return txt[int(r[0]):int(r[1])]
        except Exception: return txt
    return txt


def whoami() -> str:
    """The id whose mentions we read, asked of X rather than configured by hand.

    This exists because of a real hour lost: the developer console's URL carries the DEVELOPER ACCOUNT id, which
    looks exactly like a user id and is not one. Polling it succeeded, returned an empty list forever, and logged
    nothing wrong. Asking X who the token belongs to cannot be got wrong."""
    global BOT_ID
    d = me()
    uid = str((d.get("data") or {}).get("id") or "")
    if uid: BOT_ID = uid
    return BOT_ID


def _quote(s: str) -> str:
    return urllib.parse.quote(str(s), safe="~")


def _auth_header(method: str, url: str, query: dict) -> str:
    oauth = {
        "oauth_consumer_key": KEY, "oauth_nonce": secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1", "oauth_timestamp": str(int(time.time())),
        "oauth_token": TOKEN, "oauth_version": "1.0",
    }
    params = {**{k: str(v) for k, v in query.items()}, **oauth}
    base_params = "&".join(f"{_quote(k)}={_quote(params[k])}" for k in sorted(params))
    base = "&".join((method.upper(), _quote(url), _quote(base_params)))
    signing_key = f"{_quote(SECRET)}&{_quote(TOKEN_SECRET)}".encode()
    import base64
    oauth["oauth_signature"] = base64.b64encode(hmac.new(signing_key, base.encode(), hashlib.sha1).digest()).decode()
    return "OAuth " + ", ".join(f'{_quote(k)}="{_quote(v)}"' for k, v in sorted(oauth.items()))


def _call(method: str, path: str, query: dict | None = None, body: bytes | None = None,
          content_type: str | None = None, timeout: float = 30.0) -> dict:
    query = query or {}
    url = API + path
    full = url + ("?" + urllib.parse.urlencode(query) if query else "")
    headers = {"Authorization": _auth_header(method, url, query)}
    if content_type: headers["Content-Type"] = content_type
    req = urllib.request.Request(full, data=body, method=method.upper(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise XError(e.code, e.read().decode("utf-8", "replace")) from None


def mentions(since_id: str | None = None, limit: int = 100, max_pages: int = 5) -> tuple[list[dict], dict, str | None]:
    """Every mention since `since_id`, oldest first. Returns (posts, included_posts_by_id, newest_id).

    Paged to the end before the cursor moves: `since_id` does not backfill, so a burst larger than one page would
    leave the older half unanswered forever. `newest_id` is optional and absent on an empty result, so the cursor
    only advances when something actually came back. A 200 can also carry `errors` beside `data` — those are
    surfaced, not swallowed."""
    out: list[dict] = []
    inc: dict = {}
    newest: str | None = None
    token: str | None = None
    for _ in range(max_pages):
        q = {"max_results": max(5, min(limit, 100)), "post.fields": POST_FIELDS, "expansions": EXPANSIONS,
             "user.fields": USER_FIELDS}
        if since_id: q["since_id"] = since_id
        if token: q["pagination_token"] = token
        d = _call("GET", f"/2/users/{BOT_ID}/mentions", q)
        for e in d.get("errors") or []:
            print(f"  mentions partial error: {str(e)[:200]}")
        meta = d.get("meta") or {}
        out += d.get("data") or []
        for p in ((d.get("includes") or {}).get("posts") or []): inc[p["id"]] = p
        for u in ((d.get("includes") or {}).get("users") or []):   # usernames live here, keyed by the same ids
            if u.get("id") and u.get("username"): inc["user:" + str(u["id"])] = u
        newest = newest or meta.get("newest_id")
        if not int(meta.get("result_count") or 0): break
        token = meta.get("next_token")
        if not token: break
    out.sort(key=lambda p: int(p["id"]))
    return out, inc, newest


def one_post(pid: str) -> dict:
    """One post by id, for the case the mentions call did not carry the parent's text.

    This is a paid read ($0.005, not an Owned Read: the post is someone else's), so it is only ever called when the
    address is nowhere in the free data. The resource is named `posts` in v2 and `tweets` in everything written
    before the rename, so a 404 on the first falls through to the second rather than losing the answer."""
    q = {"post.fields": POST_FIELDS}
    for path in (f"/2/posts/{pid}", f"/2/tweets/{pid}"):
        try:
            d = _call("GET", path, q)
        except XError as e:
            if e.status == 404 and path.startswith("/2/posts/"): continue
            raise
        return d.get("data") or {}
    return {}


def upload_png(data: bytes, filename: str = "report.png") -> str:
    """One-shot upload. The chunked INIT/APPEND/FINALIZE flow buys nothing under 5 MB, and a report card is ~100 KB."""
    boundary = "----gg" + secrets.token_hex(12)
    parts = []
    for name, value in (("media_category", "tweet_image"),):
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"media\"; filename=\"{filename}\"\r\n"
                 f"Content-Type: image/png\r\n\r\n".encode())
    parts.append(data)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)
    d = _call("POST", "/2/media/upload", body=body,
              content_type=f"multipart/form-data; boundary={boundary}", timeout=60.0)
    media = d.get("data") or d
    mid = media.get("id") or media.get("media_id_string") or media.get("media_key")
    if not mid: raise XError(200, json.dumps(d))
    return str(mid)


def _tweet(text: str, reply_to: str | None, media_ids: list[str] | None) -> str:
    if text.count("$") > 1:
        raise ValueError("a post may carry at most one cashtag")
    payload: dict = {"text": text}
    if reply_to: payload["reply"] = {"in_reply_to_tweet_id": str(reply_to)}
    if media_ids: payload["media"] = {"media_ids": [str(m) for m in media_ids]}
    d = _call("POST", "/2/tweets", body=json.dumps(payload).encode(), content_type="application/json")
    for e in d.get("errors") or []:                      # a 201 can carry an error beside the data it returns
        print(f"  partial error: {str(e)[:200]}")
    return str((d.get("data") or {}).get("id") or "")


def reply(text: str, in_reply_to: str, media_ids: list[str] | None = None) -> str:
    """`in_reply_to` MUST be the post that mentioned us — X rejects a reply to anyone who did not summon us."""
    return _tweet(text, in_reply_to, media_ids)


def post(text: str, media_ids: list[str] | None = None) -> str:
    """A post of our own, addressed to nobody. Billed as Post: Create ($0.015) — a URL in the text would make it
    Post with URL ($0.200), so the hourly post carries none and the site lives in the profile instead."""
    return _tweet(text, None, media_ids)


def me() -> dict:
    """A cheap credential check at start-up: wrong keys or read-only permissions should fail loudly, not silently."""
    return _call("GET", "/2/users/me", {"user.fields": "username"})
