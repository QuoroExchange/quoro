"""The reply text.

Rules, not a model: text written by a model needs X's approval before deployment, and the score already carries its
own words. Every line here comes from what the site shows (copy-v1.md §7.10), so a reply and the token's card never
disagree.

Three hard limits: 280 characters, at most one cashtag in the whole text, and no link (a post carrying a URL is
billed twenty times higher and reaches fewer people).
"""
from __future__ import annotations

LIMIT = 280

FLAG = {
    "bundle": "Wallets exempt from the opening tax",
    "snipers_heavy": "Snipers took over 15% in the first blocks",
    "snipers": "Snipers took over 5% in the first blocks",
    "serial_dev": "Deployer has 5+ launches, none moved to a pool",
    "mill": "Mass deployer, almost none move to a pool",
    "farm": "Same launch pattern from other wallets",
    "dev_sold_here": "Deployer sold on this token's curve",
    "dev_dumps": "Deployer sold on earlier launches",
    "dev_heavy": "Deployer bought over 12% at launch",
    "tax": "Creator tax above 3%",
    "fees_elsewhere": "Creator fees go to a third party",
    "no_socials": "No socials at launch",
}
# heaviest first: when the text does not fit, the weakest flag is the one dropped
ORDER = ["dev_sold_here", "bundle", "snipers_heavy", "dev_heavy", "mill", "farm", "serial_dev",
         "dev_dumps", "snipers", "fees_elsewhere", "tax", "no_socials"]

CAP = {"flag": "capped by a red flag", "dev": "capped: deployer holds over 10%", "dev25": "capped: deployer holds over 25%",
       "idle": "capped: no trades for a day", "age": "capped: under 10 minutes old", "partial": "capped: an incomplete read"}

TAIL = "Counted from on-chain data. Not advice."
UNKNOWN = "No such token on Robinhood Chain."
STOCK = "Stock token on Robinhood Chain. No Data score: the score describes a launch and how it trades."


def _ticker(sym: str) -> str:
    """One cashtag per post is a hard X rule, so the symbol is cleaned of any extra $ before it gets one."""
    return "$" + (sym or "token").replace("$", "").strip()[:20]


def reply_for(token: dict) -> str:
    """The answer for one token, or a line saying why there is no score."""
    if not token:
        return UNKNOWN
    sym = _ticker(token.get("symbol") or "")
    score = token.get("score")
    if not score:
        return f"{sym} · " + (STOCK if token.get("kind") == "stock" else
                              "No Data score yet: nothing to read on the launch so far.")

    val, hy, mk = score.get("value"), score.get("hygiene"), score.get("market")
    caps = [c["id"] for c in (score.get("caps") or []) if c.get("applied")]
    flags = [f.get("k") or f.get("id") for f in (score.get("flags") or [])]
    picked = [f for f in ORDER if f in flags][:3]

    head = f"{sym} · Data score {val}/10"
    sub = f"Launch {hy}/10 · Market {mk}/10"
    if caps:
        sub += " · " + CAP.get(caps[0], "capped")
    while True:
        body = "\n".join("- " + FLAG[f] for f in picked) if picked else "No flags on the launch."
        text = f"{head}\n{sub}\n\n{body}\n\n{TAIL}"
        if len(text) <= LIMIT or not picked:
            return text
        picked.pop()   # the weakest flag goes first; a reply without the heaviest one would mislead
