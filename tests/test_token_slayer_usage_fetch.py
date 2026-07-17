import importlib.util, json, os
from datetime import datetime, timezone

CF = os.path.join(os.path.dirname(__file__), "..", "scripts", "token-slayer-usage-fetch.py")


def _mod():
    spec = importlib.util.spec_from_file_location("tsf", CF)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def _iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


# `token-slayer list --json` document, active on slot 1, slot 3 never polled.
def _doc():
    return {
        "schema": "accounts@1",
        "namespace": "token_slayer",
        "active": "oe@x.com",
        "accounts": [
            {"index": 1, "name": "oe@x.com", "alias": "oe", "email": "oe@x.com",
             "active": True, "usage": {
                 "five_hour": {"utilization": 10.0, "resets_at": 1784269799},
                 "seven_day": {"utilization": 72.0, "resets_at": 1784847599},
                 "polled_at": 1784257201, "token_expired": False}},
            {"index": 2, "name": "me@x.com", "alias": None, "email": "me@x.com",
             "active": False, "usage": {
                 "five_hour": {"utilization": 41.0, "resets_at": None},
                 "seven_day": {"utilization": 14.0, "resets_at": 1784656799},
                 "polled_at": 1784199030, "token_expired": False}},
            {"index": 3, "name": "gone@x.com", "alias": "g", "email": "gone@x.com",
             "active": False, "usage": {}},  # never polled
        ],
    }


def test_find_slayer_binary_prefers_path(monkeypatch):
    m = _mod()
    monkeypatch.setattr(m.shutil, "which", lambda name: "/usr/bin/token-slayer")
    assert m.find_slayer_binary() == "/usr/bin/token-slayer"


def test_find_slayer_binary_falls_back_to_local_bin(monkeypatch, tmp_path):
    m = _mod()
    monkeypatch.setattr(m.shutil, "which", lambda name: None)
    cand = tmp_path / "token-slayer"; cand.write_text("x")
    monkeypatch.setattr(m.os.path, "expanduser", lambda p: str(cand))
    assert m.find_slayer_binary() == str(cand)


def test_epoch_to_iso_roundtrips():
    m = _mod()
    assert m._epoch_to_iso(1784269799) == _iso(1784269799)
    assert m._epoch_to_iso(None) is None


def test_window_converts_resets_at_to_iso():
    m = _mod()
    w = m._window({"utilization": 10.0, "resets_at": 1784269799})
    assert w["utilization"] == 10.0
    assert w["resets_at"] == _iso(1784269799)


def test_window_drops_null_resets_at():
    m = _mod()
    w = m._window({"utilization": 41.0, "resets_at": None})
    assert w == {"utilization": 41.0}


def test_build_multi_preserves_order_and_flags_active():
    m = _mod()
    r = m.build_multi(_doc())
    assert r["multi"] is True
    assert [a["email"] for a in r["accounts"]] == ["oe@x.com", "me@x.com", "gone@x.com"]
    active = [a for a in r["accounts"] if a["active"]]
    assert len(active) == 1 and active[0]["email"] == "oe@x.com"


def test_build_multi_exposes_switch_target_name():
    m = _mod()
    r = m.build_multi(_doc())
    assert [a["name"] for a in r["accounts"]] == ["oe@x.com", "me@x.com", "gone@x.com"]


def test_build_multi_top_level_is_active_account():
    m = _mod()
    r = m.build_multi(_doc())
    assert r["five_hour"]["utilization"] == 10.0   # active (slot 1)
    assert r["seven_day"]["utilization"] == 72.0
    assert r["status"] == "ok"
    assert r["fetched_at"] == 1784257201


def test_build_multi_missing_usage_marked_no_data():
    m = _mod()
    r = m.build_multi(_doc())
    g = [a for a in r["accounts"] if a["email"] == "gone@x.com"][0]
    assert g["has_data"] is False
    assert g["five_hour"] == {} and g["seven_day"] == {}
    assert g["polled_at"] is None


def test_build_multi_empty_accounts_status_loading():
    m = _mod()
    r = m.build_multi({"accounts": [{"index": 1, "name": "a", "email": "a", "usage": {}}]})
    assert r["status"] == "loading"
    assert r["five_hour"] == {}


def test_main_no_slayer_falls_back_to_single(monkeypatch, tmp_path, data_home, capsys):
    m = _mod()
    monkeypatch.setattr(m, "find_slayer_binary", lambda: None)
    uf = m._load_usage_fetch()
    monkeypatch.setattr(uf, "CRED", str(tmp_path / "nope.json"))
    monkeypatch.setattr(m, "_load_usage_fetch", lambda: uf)
    m.main()
    out = json.loads(capsys.readouterr().out.strip())
    assert out["multi"] is False
    assert out["status"] == "reauth"
    assert "accounts" not in out


def test_main_with_slayer_builds_multi(monkeypatch, capsys):
    m = _mod()
    monkeypatch.setattr(m, "find_slayer_binary", lambda: "/usr/bin/token-slayer")
    monkeypatch.setattr(m, "run_refresh", lambda b: None)  # no real subprocess
    monkeypatch.setattr(m, "load_accounts", lambda b: _doc())
    m.main()
    out = json.loads(capsys.readouterr().out.strip())
    assert out["multi"] is True
    assert len(out["accounts"]) == 3
    assert out["five_hour"]["utilization"] == 10.0  # active


def test_main_slayer_present_but_no_accounts_falls_back(monkeypatch, tmp_path, data_home, capsys):
    m = _mod()
    monkeypatch.setattr(m, "find_slayer_binary", lambda: "/usr/bin/token-slayer")
    monkeypatch.setattr(m, "load_accounts", lambda b: {"accounts": []})
    uf = m._load_usage_fetch()
    monkeypatch.setattr(uf, "CRED", str(tmp_path / "nope.json"))
    monkeypatch.setattr(m, "_load_usage_fetch", lambda: uf)
    m.main()
    out = json.loads(capsys.readouterr().out.strip())
    assert out["multi"] is False


def test_main_switch_invokes_switch_then_lists(monkeypatch, capsys):
    m = _mod()
    calls = {}
    monkeypatch.setattr(m, "find_slayer_binary", lambda: "/usr/bin/token-slayer")
    monkeypatch.setattr(m, "run_refresh", lambda b: None)
    monkeypatch.setattr(m, "load_accounts", lambda b: _doc())
    monkeypatch.setattr(m, "run_switch", lambda b, t: calls.setdefault("switch", (b, t)))
    monkeypatch.setattr(m.sys, "argv", ["prog", "switch", "me@x.com"])
    m.main()
    assert calls["switch"] == ("/usr/bin/token-slayer", "me@x.com")
    out = json.loads(capsys.readouterr().out.strip())
    assert out["multi"] is True


def test_run_refresh_swallows_subprocess_errors(monkeypatch):
    m = _mod()
    def boom(*a, **k):
        raise OSError("no such binary")
    monkeypatch.setattr(m.subprocess, "run", boom)
    m.run_refresh("/usr/bin/token-slayer")  # must not raise


def test_run_switch_swallows_subprocess_errors(monkeypatch):
    m = _mod()
    def boom(*a, **k):
        raise OSError("no such binary")
    monkeypatch.setattr(m.subprocess, "run", boom)
    m.run_switch("/usr/bin/token-slayer", "me@x.com")  # must not raise


def test_load_accounts_returns_none_on_bad_json(monkeypatch):
    m = _mod()
    class P:
        returncode = 0
        stdout = "not json"
    monkeypatch.setattr(m.subprocess, "run", lambda *a, **k: P())
    assert m.load_accounts("/usr/bin/token-slayer") is None


def test_load_accounts_returns_none_on_nonzero_exit(monkeypatch):
    m = _mod()
    class P:
        returncode = 1
        stdout = "{}"
    monkeypatch.setattr(m.subprocess, "run", lambda *a, **k: P())
    assert m.load_accounts("/usr/bin/token-slayer") is None
