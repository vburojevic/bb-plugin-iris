#!/bin/sh
# Encodes the frames scripts/record-demo.mjs wrote (lossless PNG, 60 fps, 2x) into the demo media:
#   docs/demo.mp4 and docs/demo-poster.webp  the website: full resolution, 60 fps H.264
#   docs/demo.webp                           the README: GitHub shows images inline but not
#                                            repo videos, so an animated WebP at 30 fps, near
#                                            lossless (no blocks or ghosting in dark areas)
#   scripts/encode-demo.sh <framesDir>
set -e
F="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ffmpeg -y -loglevel error -framerate 60 -i "$F/f%05d.png" -c:v libx264 -preset slow -crf 16 -tune animation \
  -pix_fmt yuv420p -movflags +faststart "$ROOT/docs/demo.mp4"
cwebp -quiet -q 90 "$F/f00000.png" -o "$ROOT/docs/demo-poster.webp"
W="$(mktemp -d)"
# Every other frame, 1152 px wide; a frame identical to the one before adds its time to that one.
python3 - "$F" "$W" <<'PY'
import sys, glob, os
from PIL import Image, ImageChops
src, dst = sys.argv[1], sys.argv[2]
kept, prev, step = [], None, 1000 / 30
for f in sorted(glob.glob(os.path.join(src, "f*.png")))[::2]:
    im = Image.open(f).convert("RGB")
    if prev is not None and ImageChops.difference(im, prev).getbbox() is None:
        kept[-1][1] += step
        continue
    prev = im
    out = os.path.join(dst, os.path.basename(f))
    im.resize((1152, round(im.height * 1152 / im.width)), Image.LANCZOS).save(out)
    kept.append([out, step])
with open(os.path.join(dst, "list.txt"), "w") as fh:
    for p, ms in kept:
        fh.write(f"-d {round(ms)} {p}\n")
PY
# shellcheck disable=SC2046
img2webp -loop 0 -near_lossless 40 -lossless -m 4 -exact $(tr '\n' ' ' < "$W/list.txt") -o "$ROOT/docs/demo.webp"
rm -rf "$W"
ls -la "$ROOT/docs/demo.mp4" "$ROOT/docs/demo-poster.webp" "$ROOT/docs/demo.webp"
