"""One-off: draws the home-screen icons (needs Pillow; the icons are committed, you never need to run this)."""
import os
from PIL import Image, ImageDraw, ImageFont
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
def icon(size, pad=0.0, maskable=False):
    im = Image.new("RGB", (size, size), (11, 79, 196))
    d = ImageDraw.Draw(im)
    s = size
    # gradient-ish second layer
    for i in range(s):
        c = (int(11 + 14 * i / s), int(79 + 40 * i / s), int(196 + 30 * i / s)); d.line([(0, i), (s, i)], fill=c)
    m = s * (0.22 if maskable else 0.16)
    # bars (a small odds chart) + a line
    bw = (s - 2 * m) / 7
    hs = [0.35, 0.55, 0.45, 0.8, 0.65]
    base = s - m
    for k, h in enumerate(hs):
        x0 = m + k * bw * 1.4; d.rounded_rectangle([x0, base - h * (s - 2 * m), x0 + bw, base], radius=bw * 0.2, fill=(255, 255, 255))
    d.line([(m, base - 0.2 * (s - 2 * m)), (s * 0.5, base - 0.62 * (s - 2 * m)), (s - m, base - 0.95 * (s - 2 * m))], fill=(255, 196, 61), width=max(2, int(s * 0.035)))
    return im
for name, size, mk in (("icon-192.png", 192, False), ("icon-512.png", 512, False), ("icon-maskable-512.png", 512, True), ("apple-touch-icon.png", 180, False)):
    icon(size, maskable=mk).save(os.path.join(out, name))
print("icons written")
