"""Makes synthetic "phone photos" of pages with a known answer key.

Each photo is a page (lined homework, printed handout, receipt) pasted into a scene
with perspective, lighting, shadows, noise and blur. The true corners go to answers.json
so the detector can be graded automatically.

Run:  py -3.14 tests/make_photos.py   (needs only Pillow)
"""
import json
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("PHOTOS_DIR") or os.path.join(HERE, "photos")
FONTS = "C:/Windows/Fonts/"
HAND_FONTS = ["Inkfree.ttf", "segoesc.ttf", "BRADHITC.TTF", "comic.ttf"]
PRINT_FONTS = ["arial.ttf", "times.ttf", "consola.ttf"]

WORDS = (
    "solve the equation for x then check your answer using substitution find the derivative "
    "of f at the point show all work homework problem set chapter integral limit velocity "
    "graph the function and label both axes the answer is because therefore let assume prove"
).split()


def font(name, size):
    try:
        return ImageFont.truetype(FONTS + name, size)
    except OSError:
        return ImageFont.load_default()


def solve(A, b):
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                for k in range(c, n + 1):
                    M[r][k] -= f * M[c][k]
    return [M[i][n] / M[i][i] for i in range(n)]


def persp_coeffs(src, dst):
    """Coefficients for Image.transform: maps output (dst) points back to input (src) points."""
    A, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return solve(A, b)


def make_page(kind, rnd):
    if kind == "receipt":
        W, H = 420, 1100
    elif rnd.random() < 0.5:
        W, H = 850, 1100  # US Letter
    else:
        W, H = 840, 1188  # A4
    tint = rnd.randint(-8, 4)
    paper = (246 + tint, 244 + tint, 238 + tint)
    page = Image.new("RGB", (W, H), paper)
    d = ImageDraw.Draw(page)
    if kind == "homework":
        for y in range(120, H - 40, 34):
            d.line([(0, y), (W, y)], fill=(160, 190, 225), width=2)
        d.line([(95, 0), (95, H)], fill=(230, 150, 150), width=2)
        ink = rnd.choice([(80, 80, 88), (25, 40, 130), (30, 30, 35)])
        f = font(rnd.choice(HAND_FONTS), 26)
        d.text((110, 70), "Name: Student   HW " + str(rnd.randint(1, 12)), fill=ink, font=f)
        y = 125
        while y < H - 80:
            if rnd.random() < 0.15:
                y += 34
                continue
            line = " ".join(rnd.choice(WORDS) for _ in range(rnd.randint(3, 8)))
            if rnd.random() < 0.3:
                line = f"{rnd.randint(2, 9)}x + {rnd.randint(1, 20)} = {rnd.randint(10, 60)}"
            d.text((110 + rnd.randint(0, 20), y - 26), line, fill=ink, font=f)
            y += 34
    elif kind == "printed":
        f = font(rnd.choice(PRINT_FONTS), 22)
        fb = font("arial.ttf", 40)
        d.text((80, 70), "Worksheet " + str(rnd.randint(1, 30)), fill=(20, 20, 20), font=fb)
        y = 150
        while y < H - 80:
            line = " ".join(rnd.choice(WORDS) for _ in range(rnd.randint(6, 11)))
            d.text((80, y), line, fill=(25, 25, 25), font=f)
            y += 32
            if rnd.random() < 0.08:
                d.rectangle([80, y, W - 80, y + 120], outline=(40, 40, 40), width=3)
                y += 140
    else:  # receipt
        f = font("consola.ttf", 22)
        y = 60
        d.text((120, y), "CAMPUS STORE", fill=(30, 30, 30), font=font("consola.ttf", 30))
        y += 70
        while y < H - 80:
            d.text((40, y), f"{rnd.choice(WORDS)[:10]:<12}{rnd.randint(1, 40)}.{rnd.randint(10, 99)}", fill=(40, 40, 40), font=f)
            y += 34
    return page


def background(kind, size, rnd):
    W, H = size
    if kind == "dark":
        base = rnd.randint(35, 85)
        bg = Image.new("RGB", size, (base, base - 3, base - 8))
    elif kind == "wood":
        bg = Image.new("RGB", size)
        d = ImageDraw.Draw(bg)
        r0, g0, b0 = rnd.choice([(150, 100, 60), (120, 80, 50), (180, 135, 90)])
        phase = rnd.random() * 10
        for y in range(H):
            v = math.sin(y * 0.05 + phase + math.sin(y * 0.011) * 3) * 18 + math.sin(y * 0.4) * 5
            d.line([(0, y), (W, y)], fill=(int(r0 + v), int(g0 + v * 0.7), int(b0 + v * 0.4)))
        bg = bg.rotate(rnd.uniform(-20, 20), resample=Image.BICUBIC, expand=False, fillcolor=(r0, g0, b0))
    elif kind == "white":
        base = rnd.randint(205, 228)
        bg = Image.new("RGB", size, (base, base, base - 4))
    elif kind == "pattern":
        bg = Image.new("RGB", size, (70, 90, 120))
        d = ImageDraw.Draw(bg)
        step = rnd.randint(30, 70)
        for x in range(0, W, step):
            d.rectangle([x, 0, x + step // 3, H], fill=(150, 60, 60))
        for y in range(0, H, step):
            d.rectangle([0, y, W, y + step // 4], fill=(200, 200, 170))
    else:  # carpet / gray noisy
        base = rnd.randint(90, 140)
        bg = Image.new("RGB", size, (base, base, base))
    # Surface texture: zero-mean noise with a random strength.
    noise = Image.effect_noise(size, rnd.uniform(8, 25)).convert("RGB")
    return ImageChops.add(bg, noise, scale=1.0, offset=-128)


def place_quad(frame, page_size, rnd, steep=False, rot45=False, partial=False):
    FW, FH = frame
    PW, PH = page_size
    fill = rnd.uniform(0.55, 0.85)
    scale = min(FW * fill / PW, FH * fill / PH)
    w, h = PW * scale, PH * scale
    cx = FW / 2 + rnd.uniform(-0.08, 0.08) * FW
    cy = FH / 2 + rnd.uniform(-0.08, 0.08) * FH
    ang = math.radians(rnd.uniform(40, 50) if rot45 else rnd.uniform(-14, 14))
    pts = []
    for sx, sy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
        x, y = sx * w / 2, sy * h / 2
        pts.append([cx + x * math.cos(ang) - y * math.sin(ang), cy + x * math.sin(ang) + y * math.cos(ang)])
    j = 0.16 if steep else 0.05
    for p in pts:
        p[0] += rnd.uniform(-j, j) * w
        p[1] += rnd.uniform(-j, j) * h
    if steep:
        # Keystone: top edge narrower, like a phone held at a low angle.
        k = rnd.uniform(0.12, 0.22) * w
        pts[0][0] += k; pts[1][0] -= k
    # Keep the whole page in view (people frame the page with a little margin).
    m = 0.015 * max(FW, FH)
    while any(p[0] < m or p[1] < m or p[0] > FW - m or p[1] > FH - m for p in pts):
        for p in pts:
            p[0] = cx + (p[0] - cx) * 0.96
            p[1] = cy + (p[1] - cy) * 0.96
    if partial:
        pts[1][0] = FW + rnd.uniform(20, 80)
        pts[1][1] = -rnd.uniform(10, 60)
    return pts


def lighting(img, rnd, shadow=False, low=False, deep=False):
    W, H = img.size
    grad = Image.linear_gradient("L").resize((W, H)).rotate(rnd.uniform(0, 360), expand=False, fillcolor=128)
    lo, hi = (90, 170) if low else (185, 255)
    grad = grad.point(lambda v: int(lo + (hi - lo) * v / 255))
    out = ImageChops.multiply(img, Image.merge("RGB", [grad, grad, grad]))
    if shadow:
        m = Image.new("L", (W, H), 255)
        d = ImageDraw.Draw(m)
        x0 = rnd.uniform(0.1, 0.5) * W
        y0 = rnd.uniform(-0.2, 0.3) * H
        # Deep shadows are like a phone or arm blocking a desk lamp: 3 to 4 times darker, sharp edge.
        level = rnd.randint(55, 95) if deep else rnd.randint(120, 170)
        d.polygon([(x0, y0), (x0 + W * 0.7, y0 + H * 0.1), (x0 + W * 0.5, y0 + H * 0.8), (x0 - W * 0.2, y0 + H * 0.6)], fill=level)
        m = m.filter(ImageFilter.GaussianBlur(rnd.uniform(4, 14) if deep else rnd.uniform(15, 50)))
        out = ImageChops.multiply(out, Image.merge("RGB", [m, m, m]))
    return out


def finger(img, quad, rnd):
    d = ImageDraw.Draw(img)
    a, b = quad[3], quad[2]  # bottom edge
    t = rnd.uniform(0.3, 0.7)
    x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
    d.ellipse([x - 45, y - 70, x + 45, y + 200], fill=(205, 150, 120))


def make(index, category, rnd):
    portrait = rnd.random() < 0.8
    frame = (1200, 1600) if portrait else (1600, 1200)
    bg_kind = {"dark_desk": "dark", "wood": "wood", "white_on_white": "white", "pattern": "pattern",
               "shadow": rnd.choice(["dark", "wood", "carpet"]), "finger": rnd.choice(["dark", "wood"]),
               "steep": rnd.choice(["dark", "wood", "carpet"]), "low_light": rnd.choice(["dark", "carpet"]),
               "rotated": rnd.choice(["dark", "wood"]), "partial": "dark",
               "deep_shadow": rnd.choice(["dark", "wood", "carpet"])}[category]
    kind = rnd.choices(["homework", "printed", "receipt"], [0.6, 0.3, 0.1])[0]
    page = make_page(kind, rnd)
    if category == "deep_shadow":
        # Writing on the back of thin paper shows through faintly, mirrored.
        back = make_page("homework", rnd).resize(page.size).transpose(Image.FLIP_LEFT_RIGHT)
        page = ImageChops.multiply(page, back.point(lambda v: int(255 - (255 - v) * 0.12)))
    scene = background(bg_kind, frame, rnd)
    quad = place_quad(frame, page.size, rnd, steep=category == "steep", rot45=category == "rotated", partial=category == "partial")
    src = [(0, 0), (page.width, 0), (page.width, page.height), (0, page.height)]
    coeffs = persp_coeffs(src, quad)
    warped = page.transform(frame, Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    mask = Image.new("L", page.size, 255).transform(frame, Image.PERSPECTIVE, coeffs, Image.BILINEAR)
    scene.paste(warped, (0, 0), mask)
    if category == "finger":
        finger(scene, quad, rnd)
    scene = lighting(scene, rnd, shadow=category in ("shadow", "deep_shadow"), low=category == "low_light", deep=category == "deep_shadow")
    noise = Image.effect_noise(frame, 12 if category == "low_light" else 6).convert("RGB")
    # effect_noise is centred on 128, so subtract that to add zero-mean sensor noise.
    scene = ImageChops.add(scene, noise, scale=1.0, offset=-128 - (6 if category == "low_light" else 2))
    scene = scene.filter(ImageFilter.GaussianBlur(rnd.uniform(0.4, 1.1)))
    name = f"{index:03d}_{category}.jpg"
    scene.save(os.path.join(OUT, name), quality=rnd.randint(78, 92))
    return {"file": name, "category": category, "corners": [[round(x, 2), round(y, 2)] for x, y in quad],
            "expect": category != "partial"}


def main():
    os.makedirs(OUT, exist_ok=True)
    rnd = random.Random(int(sys.argv[1]) if len(sys.argv) > 1 else 7)
    plan = [("dark_desk", 14), ("wood", 14), ("white_on_white", 10), ("pattern", 8), ("shadow", 12),
            ("finger", 8), ("steep", 10), ("low_light", 8), ("rotated", 6), ("partial", 4), ("deep_shadow", 10)]
    answers = []
    i = 0
    for cat, n in plan:
        for _ in range(n):
            answers.append(make(i, cat, rnd))
            i += 1
    with open(os.path.join(OUT, "answers.json"), "w") as f:
        json.dump(answers, f, indent=1)
    print(f"wrote {len(answers)} photos to {OUT}")


if __name__ == "__main__":
    main()
