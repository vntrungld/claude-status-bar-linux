#!/usr/bin/env python3
"""Fetch Claude usage for one or many accounts and print JSON.

When token-slayer (multi-account switcher) is present, refresh and list all
managed accounts into a multi-account result. Otherwise fall back to the
existing single-account fetch (usage-fetch.py). Output is a superset of
usage-fetch's shape so CompactView and the non-slayer UI are unchanged.

Also handles account switching: `token-slayer-usage-fetch.py switch <target>`
runs `token-slayer switch <target>` first, then prints the refreshed list —
so the widget can reuse the same result handler after a switch.
"""
import importlib.util, json, os, shutil, subprocess, sys, time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def find_slayer_binary():
    b = shutil.which("token-slayer")
    if b:
        return b
    cand = os.path.expanduser("~/.local/bin/token-slayer")  # Plasma's PATH can be minimal
    return cand if os.path.exists(cand) else None


def _epoch_to_iso(epoch):
    """token-slayer stores resets_at as epoch seconds; the UI (UsageBars) and
    the single-account path both speak ISO8601. Convert so the shape matches."""
    if epoch is None:
        return None
    try:
        return datetime.fromtimestamp(int(epoch), timezone.utc).isoformat()
    except (ValueError, OSError, OverflowError):
        return None


def _window(w):
    """Normalize one usage window to the widget's shape (ISO resets_at)."""
    if not isinstance(w, dict):
        return {}
    out = {}
    if w.get("utilization") is not None:
        out["utilization"] = w["utilization"]
    if w.get("resets_at") is not None:
        out["resets_at"] = _epoch_to_iso(w["resets_at"])
    return out


def build_multi(doc):
    """Transform `token-slayer list --json` into the multi-account result the
    popup renders. Preserves token-slayer's account ordering (by index)."""
    accounts = []
    for a in doc.get("accounts", []):
        usage = a.get("usage") or {}
        polled = usage.get("polled_at")
        has_data = polled is not None
        accounts.append({
            # `name` is the switch target (index/name/alias/email all work,
            # but name is stable); fall back to email if somehow unnamed.
            "name": a.get("name") or a.get("email") or "",
            "alias": a.get("alias") or "",
            "email": a.get("email") or "",
            "active": bool(a.get("active")),
            "status": "ok" if has_data else "loading",
            "has_data": has_data,
            "five_hour": _window(usage.get("five_hour")) if has_data else {},
            "seven_day": _window(usage.get("seven_day")) if has_data else {},
            "polled_at": polled,
        })

    # Top level mirrors the active account (fallback: first account with data)
    # so CompactView and the popup header stay consistent with one source.
    top = next((a for a in accounts if a["active"] and a["has_data"]), None) \
        or next((a for a in accounts if a["has_data"]), None)
    return {
        "multi": True,
        "accounts": accounts,
        "status": "ok" if any(a["has_data"] for a in accounts) else "loading",
        "fetched_at": top["polled_at"] if top else None,
        "five_hour": top["five_hour"] if top else {},
        "seven_day": top["seven_day"] if top else {},
    }


def load_accounts(slayer_bin):
    """`token-slayer list --json` → parsed doc, or None on any failure."""
    try:
        p = subprocess.run([slayer_bin, "list", "--json"],
                           capture_output=True, timeout=15, text=True)
    except Exception:
        return None
    if p.returncode != 0:
        return None
    try:
        return json.loads(p.stdout)
    except ValueError:
        return None


def run_refresh(slayer_bin):
    """Best-effort: re-poll every account. Never blocks the widget."""
    try:
        subprocess.run([slayer_bin, "usage", "refresh"],
                       capture_output=True, timeout=25)
    except Exception:
        pass  # stale cache still renders below


def run_switch(slayer_bin, target):
    """Best-effort: switch the active account. Errors are swallowed; the
    subsequent list reflects whatever actually happened."""
    try:
        subprocess.run([slayer_bin, "switch", target],
                       capture_output=True, timeout=25)
    except Exception:
        pass


def _load_usage_fetch():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "usage-fetch.py")
    spec = importlib.util.spec_from_file_location("usage_fetch", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def fallback_single():
    result = _load_usage_fetch().compute()
    result["multi"] = False
    return result


def main():
    args = sys.argv[1:]
    slayer = find_slayer_binary()

    # Optional switch request: `... switch <target>` flips the active account
    # before the usual refresh+list, so the printed result is already fresh.
    if slayer and len(args) >= 2 and args[0] == "switch":
        run_switch(slayer, args[1])

    doc = load_accounts(slayer) if slayer else None
    if doc and doc.get("accounts"):
        run_refresh(slayer)
        doc = load_accounts(slayer) or doc  # re-read fresh usage post-refresh
        result = build_multi(doc)
    else:
        result = fallback_single()
    print(json.dumps(result))


if __name__ == "__main__":
    main()
