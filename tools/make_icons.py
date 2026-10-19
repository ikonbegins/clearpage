"""Draws the ClearPage app icons with Pillow.

Run:  py -3.14 tools/make_icons.py
Writes icons/*.png and icons/icon.svg. The design: a white page with text lines,
framed by scanner corner brackets, on a blue gradient.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")
S = 1024  # draw big, then shrink for smooth edges

TOP = (70, 120, 255)
BOTTOM = (34, 70, 200)


def gradient(size):
    g = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(g)
    for y in range(size):
        t = y / (size - 1)
        d.line([(0, y), (size, y)], fill=tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)))
    return g


def draw_icon(scale=1.0):
    """scale < 1 shrinks the artwork toward the centre (for maskable icons with a safe zone)."""
    img = gradient(S).convert("RGBA")
    art = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(art)
    # Page
    pw, ph = 470, 600
    px, py = (S - pw) // 2, (S - ph) // 2 + 10
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([px + 10, py + 22, px + pw + 10, py + ph + 22], 36, fill=(10, 20, 80, 110))
    art = Image.alpha_composite(art, shadow.filter(ImageFilter.GaussianBlur(22)))
    d = ImageDraw.Draw(art)
    d.rounded_rectangle([px, py, px + pw, py + ph], 36, fill=(255, 255, 255, 255))
    # Text lines, like handwriting on the page
    ink = (47, 98, 240, 255)
    lines = [(0.16, 0.62), (0.16, 0.78), (0.16, 0.70), (0.16, 0.50)]
    for i, (x0, x1) in enumerate(lines):
        y = py + 120 + i * 92
        d.rounded_rectangle([px + pw * x0, y, px + pw * x1, y + 34], 17, fill=ink if i == 0 else (180, 196, 236, 255))
    # Check mark badge: "clean, done"
    cx, cy, r = px + pw - 70, py + ph - 80, 92
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(24, 178, 104, 255))
    d.line([(cx - 44, cy + 2), (cx - 12, cy + 36), (cx + 48, cy - 34)], fill=(255, 255, 255, 255), width=30, joint="curve")
    # Scanner corner brackets
    m, L, w = 150, 150, 34
    c = (255, 255, 255, 235)
    for (x, y, sx, sy) in [(m, m, 1, 1), (S - m, m, -1, 1), (S - m, S - m, -1, -1), (m, S - m, 1, -1)]:
        d.line([(x, y + sy * L), (x, y), (x + sx * L, y)], fill=c, width=w, joint="curve")
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=c)
        for ex, ey in [(x, y + sy * L), (x + sx * L, y)]:
            d.ellipse([ex - w / 2, ey - w / 2, ex + w / 2, ey + w / 2], fill=c)
    if scale != 1.0:
        n = int(S * scale)
        small = art.resize((n, n), Image.LANCZOS)
        art = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        art.paste(small, ((S - n) // 2, (S - n) // 2), small)
    return Image.alpha_composite(img, art).convert("RGB")


def main():
    os.makedirs(OUT, exist_ok=True)
    full = draw_icon()
    for name, size in [("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180), ("favicon-32.png", 32)]:
        full.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
    draw_icon(scale=0.8).resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "icon-maskable-512.png"), optimize=True)
    # Simple SVG version for browser tabs.
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4678ff"/><stop offset="1" stop-color="#2246c8"/></linearGradient></defs>
<rect width="64" height="64" rx="14" fill="url(#g)"/>
<rect x="18" y="14" width="28" height="37" rx="3" fill="#fff"/>
<rect x="22" y="21" width="15" height="3" rx="1.5" fill="#2f62f0"/>
<rect x="22" y="27" width="19" height="3" rx="1.5" fill="#b4c4ec"/>
<rect x="22" y="33" width="15" height="3" rx="1.5" fill="#b4c4ec"/>
<circle cx="41" cy="46" r="7" fill="#18b268"/>
<path d="M37.7 46.2l2.3 2.4 4.4-4.9" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"""
    with open(os.path.join(OUT, "icon.svg"), "w") as f:
        f.write(svg)
    print("icons written to", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
