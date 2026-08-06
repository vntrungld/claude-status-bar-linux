import json, os, subprocess, sys

SESSIONS = os.path.join(os.path.dirname(__file__), "..", "scripts",
                        "claude-status-sessions.py")


def _run(data_home):
    env = dict(os.environ)
    env["XDG_DATA_HOME"] = str(data_home)
    r = subprocess.run([sys.executable, SESSIONS],
                       capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def d(sid, state, started=None, updated=1000, tool=None):
    return {"session_id": sid, "state": state, "tool": tool,
            "started_at": started, "updated_at": updated, "cwd": "/w/" + sid}


def test_empty_dir_prints_empty_array(data_home):
    assert _run(data_home) == []


def test_reads_all_session_files(data_home):
    import statusbar_paths as p
    p.atomic_write_json(p.session_file("s1"), d("s1", "waiting"))
    p.atomic_write_json(p.session_file("s2"), d("s2", "thinking", started=5))
    out = _run(data_home)
    assert sorted(x["session_id"] for x in out) == ["s1", "s2"]


def test_documents_are_passed_through_unmodified(data_home):
    import statusbar_paths as p
    doc = d("s1", "thinking", started=1000.98, updated=1234, tool=None)
    p.atomic_write_json(p.session_file("s1"), doc)
    out = _run(data_home)
    assert out == [doc], "the script must not transform documents"


def test_float_started_at_precision_is_preserved(data_home):
    import statusbar_paths as p
    p.atomic_write_json(p.session_file("s1"), d("s1", "thinking", started=1000.98))
    assert _run(data_home)[0]["started_at"] == 1000.98


def test_malformed_file_is_skipped_not_fatal(data_home):
    import statusbar_paths as p
    p.atomic_write_json(p.session_file("good"), d("good", "waiting"))
    with open(p.session_file("bad"), "w") as fh:
        fh.write("{not json")
    out = _run(data_home)
    assert [x["session_id"] for x in out] == ["good"]


def test_missing_sessions_dir_prints_empty_array(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "nonexistent"))
    env = dict(os.environ)
    env["XDG_DATA_HOME"] = str(tmp_path / "nonexistent")
    r = subprocess.run([sys.executable, SESSIONS],
                       capture_output=True, text=True, env=env)
    assert r.returncode == 0
    assert json.loads(r.stdout) == []
