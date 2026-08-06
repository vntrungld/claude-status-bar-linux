#!/usr/bin/env python3
"""Convert the animated Clawd WebPs into horizontal PNG sprite sheets.

Maintainer tool — NOT installed, and the only script allowed to need Pillow.
Its output is committed, so installing needs no image libraries.

GNOME cannot decode animated WebP without the non-default webp-pixbuf-loader
package, and the source files carry no per-frame duration metadata (QML's
AnimatedImage has been falling back to its own default). Sheets fix both: one
asset format both toolkits read, and an explicit, identical frame rate.

Usage: python3 scripts/build-clawd-sprites.py
"""
import os, sys

try:
    from PIL import Image
except ImportError:
    sys.exit("error: Pillow is required (pip install --user Pillow)")

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "assets", "clawd-src")
OUT = os.path.join(HERE, "..", "shared", "clawd")

# The source art has no frame durations. 12fps matches the original clawd-tank
# SVG animations and reads correctly at panel size; change here to retune both
# frontends at once.
INTERVAL_MS = 83


def build(name, path):
    im = Image.open(path)
    n = getattr(im, "n_frames", 1)
    w, h = im.size
    sheet = Image.new("RGBA", (w * n, h), (0, 0, 0, 0))
    for i in range(n):
        im.seek(i)
        sheet.paste(im.convert("RGBA"), (i * w, 0))
    sheet.save(os.path.join(OUT, name + ".png"), optimize=True)
    return {"frames": n, "width": w, "height": h, "interval_ms": INTERVAL_MS}


def write_frames_mjs(meta, path):
    """Emit shared/clawd/frames.mjs deterministically: sorted animation
    names, stable per-entry key order, so re-running this script is
    byte-identical. Consumed via `import ... from "frames.mjs"` — an ES
    module import, unlike a file:// XMLHttpRequest, needs no special Qt
    QML engine permission and works identically under plasmashell.
    """
    lines = ["export const FRAMES = {"]
    for name in sorted(meta):
        m = meta[name]
        lines.append(
            '  "%s": { "frames": %d, "width": %d, "height": %d, '
            '"interval_ms": %d },'
            % (name, m["frames"], m["width"], m["height"], m["interval_ms"])
        )
    lines.append("};")
    with open(path, "w") as fh:
        fh.write("\n".join(lines) + "\n")


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for f in sorted(os.listdir(SRC)):
        if not f.endswith(".webp"):
            continue
        name = f[:-len(".webp")]
        meta[name] = build(name, os.path.join(SRC, f))
        print(f"{name}: {meta[name]['frames']} frames "
              f"{meta[name]['width']}x{meta[name]['height']}")
    write_frames_mjs(meta, os.path.join(OUT, "frames.mjs"))
    print(f"wrote {len(meta)} sheets + frames.mjs to {OUT}")


if __name__ == "__main__":
    main()
