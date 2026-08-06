#!/usr/bin/env python3
"""Print every per-session status file as a JSON array on stdout.

Deliberately logic-free. Merging, staleness, and state precedence live in
shared/aggregate.mjs so the Plasma widget and the GNOME extension apply
identical rules; this script exists only because QML cannot list a directory.
Documents are passed through untouched — in particular started_at keeps its
sub-second precision.
"""
import glob, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def load_docs():
    import statusbar_paths as p
    docs = []
    for f in sorted(glob.glob(os.path.join(p.sessions_dir(), "*.json"))):
        try:
            with open(f) as fh:
                docs.append(json.load(fh))
        except (OSError, ValueError):
            continue  # a half-written or corrupt file must not break the widget
    return docs


if __name__ == "__main__":
    print(json.dumps(load_docs()))
