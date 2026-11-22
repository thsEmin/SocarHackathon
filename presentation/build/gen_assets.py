"""Generate the image assets for the PetroNova pitch deck.

    python presentation/build/gen_assets.py

Inputs : presentation/deck_assets/source/USGS_Pumpjack_Farmington_NM_2019.jpg (public domain, USGS)
Outputs: presentation/deck_assets/*.jpg|png

Slide geometry (inches): 13.333 x 7.5. The pipeline lane (buried pipe cutaway) sits at y = 6.45 .. 7.5
on every slide; the long pipeline image is shifted left by one slide width per slide so Morph pans
along it like a tracking camera.
"""
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "deck_assets" / "source" / "USGS_Pumpjack_Farmington_NM_2019.jpg"
OUT = ROOT / "deck_assets"
W_IN, H_IN = 13.333, 7.5
LANE_TOP = 6.45
PPI = 180                               # scene resolution: 2400 x 1350
SW, SH = int(W_IN * PPI), int(H_IN * PPI)
rng = np.random.default_rng(7)


# ------------------------------------------------------------------ helpers
def noise(h, w, scales=(4, 8, 16, 32, 64), weights=None, seed=0):
    r = np.random.default_rng(seed)
    weights = weights or [1 / (i + 1) for i in range(len(scales))]
    acc = np.zeros((h, w), np.float32)
    for s, wt in zip(scales, weights):
        g = r.random((max(2, h // s), max(2, w // s))).astype(np.float32)
        acc += wt * cv2.resize(g, (w, h), interpolation=cv2.INTER_CUBIC)
    acc -= acc.min()
    return acc / max(acc.max(), 1e-6)


def vgrad(h, w, top, bot):
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    return (np.array(top, np.float32) * (1 - t) + np.array(bot, np.float32) * t) * np.ones((1, w, 1), np.float32)


def to_img(a):
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def vignette(a, strength=0.35):
    h, w = a.shape[:2]
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2) / 1.42
    return a * (1 - strength * d[..., None] ** 2)


def left_scrim(a, x_end_frac=0.58, alpha=0.62, power=1.6):
    h, w = a.shape[:2]
    x = np.linspace(0, 1, w, dtype=np.float32)
    k = np.clip(1 - x / x_end_frac, 0, 1) ** power * alpha
    return a * (1 - k[None, :, None]) + np.array([8, 12, 18], np.float32) * k[None, :, None]


def grade(img, warm=1.04, sat=1.10, contrast=1.04):
    img = ImageEnhance.Color(img).enhance(sat)
    img = ImageEnhance.Contrast(img).enhance(contrast)
    a = np.asarray(img).astype(np.float32)
    a[..., 0] *= warm
    a[..., 2] /= warm
    return a


# ------------------------------------------------------------------ scene 1: spring oilfield (real photo)
def scene1(photo):
    W, H = photo.size                                   # 4032 x 3024
    ch = int(W * 9 / 16)
    y0 = 600
    crop = photo.crop((0, y0, W, y0 + ch)).resize((SW, SH), Image.LANCZOS)
    a = grade(crop)
    a = left_scrim(a, 0.66, 0.78, 1.3)
    a = vignette(a, 0.30)
    to_img(a).save(OUT / "scene1_oilfield.jpg", quality=90)


# ------------------------------------------------------------------ scene 2: production data (dark)
def scene2():
    a = vgrad(SH, SW, (13, 19, 27), (9, 13, 19))
    n = noise(SH, SW, (64, 128, 256), seed=2)[..., None]
    a += (n - 0.5) * 6
    img = to_img(vignette(a, 0.35))
    d = ImageDraw.Draw(img, "RGBA")
    step = int(0.5 * PPI)
    for x in range(0, SW, step):
        d.line([(x, 0), (x, SH)], fill=(140, 170, 200, 9), width=1)
    for y in range(0, SH, step):
        d.line([(0, y), (SW, y)], fill=(140, 170, 200, 9), width=1)
    glow = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(glow).ellipse([int(1.0 * PPI), int(1.4 * PPI), int(9.5 * PPI), int(6.6 * PPI)], fill=60)
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    img = Image.composite(Image.new("RGB", (SW, SH), (28, 44, 60)), img, glow)
    img.save(OUT / "scene2_data.jpg", quality=90)


# ------------------------------------------------------------------ scene 3: well cutaway (procedural strata)
STRATA = [  # (top_in, colour, texture_strength, name)
    (0.00, (104, 86, 62), 26, "topsoil"),
    (0.55, (86, 88, 94), 18, "shale"),
    (1.75, (150, 124, 86), 22, "sandstone"),
    (2.70, (108, 106, 100), 16, "siltstone"),
    (3.55, (78, 80, 88), 18, "shale"),
    (4.35, (126, 96, 58), 30, "reservoir"),
    (5.55, (70, 70, 76), 14, "base"),
]
RES_TOP, RES_BOT = 4.35, 5.55
WELL_X = 10.55
PANEL_X = 8.2


def strata_rgb(h, w, x_off_in=0.0, seed=3):
    """Rock cross-section, h x w pixels at PPI, layer tops wobble slightly."""
    a = np.zeros((h, w, 3), np.float32)
    xs = (np.arange(w) / PPI + x_off_in)
    tex = noise(h, w, (3, 6, 12, 24, 48), seed=seed)
    grain = rng.random((h, w)).astype(np.float32)
    y_in = np.arange(h)[:, None] / PPI
    layer_idx = np.zeros((h, w), np.int32)
    for i, (top, *_r) in enumerate(STRATA[1:], start=1):
        r1 = np.random.default_rng(100 + i).random(40)
        jit = np.interp(xs, np.linspace(xs.min(), xs.max(), 40), r1) - 0.5
        wob = 0.022 * np.sin(xs * 0.9 + i) + 0.05 * jit + 0.03 * (xs - 10.5) / 3 * (1 if i % 2 else -0.6)
        layer_idx = np.where(y_in >= top + wob[None, :], i, layer_idx)
    for i, (_t, col, ts, name) in enumerate(STRATA):
        m = layer_idx == i
        base = np.array(col, np.float32)
        val = base[None, :] + ((tex[m] - 0.5) * ts * 2)[:, None] + ((grain[m] - 0.5) * 10)[:, None]
        if name == "reservoir":          # dark oil staining in the pores
            stain = (noise(h, w, (2, 4, 8), seed=11)[m] > 0.55).astype(np.float32)
            val = val * (1 - 0.45 * stain[:, None]) + np.array([40, 24, 10]) * 0.45 * stain[:, None]
        if name in ("shale", "base"):    # fine laminations
            lam = np.sin(y_in.repeat(w, 1)[m] * 70) * 5
            val = val + lam[:, None]
        a[m] = val
    # darken edges of each layer slightly
    edges = cv2.Laplacian(layer_idx.astype(np.float32), cv2.CV_32F) != 0
    edges = cv2.dilate(edges.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    a[edges] *= 0.75
    return a


def scene3():
    a = vgrad(SH, SW, (14, 19, 26), (10, 13, 18))
    a = vignette(a, 0.25)
    px = int(PANEL_X * PPI)
    ph = int(LANE_TOP * PPI)
    rock = strata_rgb(ph, SW - px, PANEL_X)
    # light falloff: cutaway lit from upper left
    gx = np.linspace(1.08, 0.82, SW - px, dtype=np.float32)[None, :, None]
    gy = np.linspace(1.0, 0.78, ph, dtype=np.float32)[:, None, None]
    a[:ph, px:] = rock * gx * gy
    img = to_img(a)
    d = ImageDraw.Draw(img, "RGBA")
    # cut face edge highlight + soft shadow onto the dark side
    sh = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(sh).rectangle([px - 40, 0, px, ph], fill=120)
    sh = sh.filter(ImageFilter.GaussianBlur(30))
    img = Image.composite(Image.new("RGB", (SW, SH), (4, 6, 9)), img, sh.point(lambda v: v if True else 0))
    img.paste(to_img(a[:ph, px:]), (px, 0))
    d = ImageDraw.Draw(img, "RGBA")
    d.line([(px, 0), (px, ph)], fill=(230, 220, 200, 90), width=3)
    # wellbore: cement sheath, casing, tubing
    wx = int(WELL_X * PPI)
    bot = int((RES_BOT - 0.15) * PPI)
    d.rectangle([wx - 30, 0, wx + 30, bot], fill=(150, 146, 138, 255))          # cement
    d.rectangle([wx - 22, 0, wx + 22, bot], fill=(70, 76, 84, 255))             # casing wall
    d.rectangle([wx - 17, 0, wx + 17, bot], fill=(18, 22, 28, 255))             # annulus
    d.rectangle([wx - 7, 0, wx + 7, bot - 10], fill=(160, 168, 178, 255))       # tubing
    d.rectangle([wx - 4, 0, wx - 1, bot - 10], fill=(225, 230, 236, 255))       # tubing highlight
    for k in range(int(0.1 * PPI) // 1, ph, int(0.42 * PPI)):                   # casing collars
        d.rectangle([wx - 25, k, wx + 25, k + 6], fill=(95, 100, 108, 255))
    # perforations into the reservoir
    for yy in np.linspace((RES_TOP + 0.25) * PPI, (RES_BOT - 0.3) * PPI, 7):
        for side in (-1, 1):
            L = rng.integers(60, 110)
            x0 = wx + side * 30
            d.line([(x0, yy), (x0 + side * L, yy + rng.integers(-6, 6))], fill=(20, 12, 6, 230), width=7)
            d.line([(x0, yy), (x0 + side * L * 0.6, yy)], fill=(200, 140, 60, 120), width=2)
    # packer + gauge carrier
    d.rectangle([wx - 20, int((RES_TOP - 0.25) * PPI), wx + 20, int((RES_TOP - 0.12) * PPI)], fill=(60, 64, 70, 255))
    img.save(OUT / "scene3_well.jpg", quality=90)


# ------------------------------------------------------------------ scene 4 / 5: quiet + operations
def scene4():
    a = vgrad(SH, SW, (17, 24, 33), (11, 15, 21))
    n = noise(SH, SW, (128, 256), seed=4)[..., None]
    a += (n - 0.5) * 5
    img = to_img(vignette(a, 0.3))
    glow = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(glow).ellipse([int(0.5 * PPI), int(2.0 * PPI), int(9.0 * PPI), int(6.0 * PPI)], fill=55)
    glow = glow.filter(ImageFilter.GaussianBlur(180))
    img = Image.composite(Image.new("RGB", (SW, SH), (30, 46, 58)), img, glow)
    img.save(OUT / "scene4_validation.jpg", quality=90)


def scene5():
    a = vgrad(SH, SW, (20, 20, 24), (11, 12, 16))
    img = to_img(vignette(a, 0.3))
    glow = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(glow).ellipse([int(6.0 * PPI), int(-2.5 * PPI), int(15.5 * PPI), int(3.5 * PPI)], fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(200))
    img = Image.composite(Image.new("RGB", (SW, SH), (92, 58, 22)), img, glow)
    # faint contour lines (field map feel)
    d = ImageDraw.Draw(img, "RGBA")
    n = noise(SH // 4, SW // 4, (16, 32, 64), seed=9)
    lv = (n * 14).astype(np.int32)
    edges = (cv2.Laplacian(lv.astype(np.float32), cv2.CV_32F) != 0).astype(np.uint8) * 255
    edges = cv2.resize(edges, (SW, SH), interpolation=cv2.INTER_LINEAR)
    lines = Image.fromarray((edges > 90).astype(np.uint8) * 14)
    img = Image.composite(Image.new("RGB", (SW, SH), (210, 170, 120)), img, lines)
    img.save(OUT / "scene5_decision.jpg", quality=90)


# ------------------------------------------------------------------ scene 6: loading terminal backdrop
def scene6(photo):
    W, H = photo.size
    crop = photo.crop((0, 1000, 2300, 1000 + int(2300 * 9 / 16))).transpose(Image.FLIP_LEFT_RIGHT)
    crop = crop.resize((SW, SH), Image.LANCZOS)
    a = grade(crop, warm=1.05)
    a = left_scrim(a, 0.66, 0.86, 0.9)
    a = vignette(a, 0.28)
    img = to_img(a)
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(OUT / "scene6_terminal.jpg", quality=90)


# ------------------------------------------------------------------ pipeline strip (long, for Morph)
P_PPI = 120
LANE_H = 7.5 - LANE_TOP
PIPE_CY = 0.52          # inside the lane
PIPE_D = 0.34
RISER_X = 8.0           # slide-1 x where the wellhead riser drops into the lane
END_X = 5 * W_IN + 8.69  # slide-6 x where the pipe rises into the loading gantry
CUT_X0, CUT_X1 = 8.55, 12.9   # slide-1 cutaway window


def steel_column(n, base=(150, 158, 168)):
    t = np.linspace(0, 1, n, dtype=np.float32)
    prof = 0.42 + 0.75 * np.exp(-((t - 0.3) / 0.16) ** 2) + 0.25 * np.exp(-((t - 0.8) / 0.12) ** 2)
    prof *= 0.55 + 0.45 * np.clip(np.sin(np.pi * t), 0, 1) ** 0.5
    return np.clip(np.array(base, np.float32)[None, :] * prof[:, None], 0, 255)


def pipeline():
    L = 6 * W_IN
    w, h = int(L * P_PPI), int(LANE_H * P_PPI)
    # soil lane
    n = noise(h, w, (3, 6, 12, 24), seed=21)
    a = np.zeros((h, w, 3), np.float32)
    base = np.array([58, 46, 36], np.float32)
    depth = np.linspace(1.0, 0.62, h, dtype=np.float32)[:, None, None]
    a[:] = base * (0.75 + 0.5 * n[..., None]) * depth
    specks = rng.random((h, w)) > 0.985
    a[specks] = a[specks] * 1.6 + 20
    alpha = np.full((h, w), 255, np.float32)
    ramp = int(0.10 * P_PPI)
    alpha[:ramp] *= np.linspace(0, 1, ramp)[:, None] ** 0.7
    img = Image.fromarray(np.dstack([np.clip(a, 0, 255), alpha]).astype(np.uint8), "RGBA")
    d = ImageDraw.Draw(img, "RGBA")
    d.line([(0, ramp), (w, ramp)], fill=(160, 140, 110, 90), width=2)        # ground line
    cy, pr = int(PIPE_CY * P_PPI), int(PIPE_D * P_PPI / 2)
    x0, x1 = int(RISER_X * P_PPI), int(END_X * P_PPI)
    # trench shadow
    sh = Image.new("L", (w, h), 0)
    ImageDraw.Draw(sh).rectangle([x0 - 10, cy - pr - 4, x1 + 10, cy + pr + 14], fill=150)
    sh = sh.filter(ImageFilter.GaussianBlur(8))
    img.paste((0, 0, 0, 255), (0, 0), sh.point(lambda v: v // 2))
    d = ImageDraw.Draw(img, "RGBA")
    col = steel_column(2 * pr)
    seg = np.repeat(col[:, None, :], x1 - x0, axis=1)
    img.paste(to_img(seg), (x0, cy - pr))
    # risers (wellhead side and terminal side): vertical steel from ground to pipe
    for rx in (x0, x1):
        rc = steel_column(2 * pr).transpose()
        rows = cy - ramp + pr
        vert = np.repeat(np.array(rc.T)[None, :, :], rows, axis=0)
        img.paste(to_img(vert), (rx - pr, ramp))
        fit = steel_column(2 * pr + 8, (176, 182, 190))            # elbow fitting
        img.paste(to_img(np.repeat(fit[:, None, :], 2 * pr + 8, axis=1)), (rx - pr - 4, cy - pr - 4))
        d.rectangle([rx - pr - 4, cy - pr - 4, rx + pr + 4, cy + pr + 4], outline=(70, 76, 84, 255), width=2)
    # flanges
    step = int(1.7 * P_PPI)
    for fx in range(x0 + step, x1 - 20, step):
        fl = steel_column(2 * pr + 10, (170, 176, 184))
        img.paste(to_img(np.repeat(fl[:, None, :], 9, axis=1)), (fx, cy - pr - 5))
        for by in (cy - pr - 2, cy + pr + 1):
            d.ellipse([fx + 2, by - 2, fx + 6, by + 2], fill=(60, 64, 70, 255))
    # slide-1 cutaway window: open the top half of the pipe to show the inside
    c0, c1 = int(CUT_X0 * P_PPI), int(CUT_X1 * P_PPI)
    d.rectangle([c0, cy - pr + 4, c1, cy + pr - 4], fill=(16, 18, 22, 255))
    d.line([(c0, cy - pr + 4), (c1, cy - pr + 4)], fill=(215, 222, 230, 255), width=3)  # cut edge
    d.line([(c0, cy - pr + 4), (c0, cy + pr - 4)], fill=(200, 206, 214, 255), width=3)
    d.line([(c1, cy - pr + 4), (c1, cy + pr - 4)], fill=(200, 206, 214, 255), width=3)
    img.save(OUT / "pipeline_strip.png", optimize=True)
    return dict(length_in=L, pipe_cy_in=LANE_TOP + PIPE_CY, pipe_d_in=PIPE_D,
                cut=(CUT_X0, CUT_X1), riser_x=RISER_X, end_x=END_X)


# ------------------------------------------------------------------ small elements
def oil_flow():
    """Liquid crude inside the cutaway window (animated with a wipe from the left)."""
    w = int((CUT_X1 - CUT_X0 - 0.06) * P_PPI * 2)
    h = int((PIPE_D - 0.10) * P_PPI * 2)
    t = np.linspace(0, 1, h)[:, None]
    body = np.array([24, 14, 6], np.float32) * (1 - t) + np.array([60, 34, 10], np.float32) * t
    a = np.repeat(body[:, None, :] if body.ndim == 2 else body, w, axis=1).astype(np.float32)
    a = a.reshape(h, w, 3)
    n = noise(h, w, (4, 8, 16), seed=31)[..., None]
    a = a * (0.8 + 0.5 * n)
    top = int(h * 0.12)
    a[top:top + 3] = [235, 170, 80]                       # meniscus highlight
    streak = noise(h, w, (2, 4), seed=32)
    a += (streak > 0.78)[..., None] * np.array([90, 55, 15])
    alpha = np.full((h, w), 255, np.float32)
    alpha[:top] = 0
    Image.fromarray(np.dstack([np.clip(a, 0, 255), alpha]).astype(np.uint8), "RGBA").save(OUT / "oil_flow.png")


def droplet():
    S = 4
    w, h = 120 * S, 170 * S
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    m = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(m)
    cx, cy, r = w // 2, int(h * 0.66), int(w * 0.40)
    md.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    md.polygon([(cx, int(h * 0.04)), (cx - int(r * 0.86), cy - int(r * 0.45)), (cx + int(r * 0.86), cy - int(r * 0.45))], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(3 * S))
    m = m.point(lambda v: 255 if v > 128 else int(v * 2) if v > 64 else 0).filter(ImageFilter.GaussianBlur(1.2 * S))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # body: very dark brown, transmits amber light near the bottom-right
    tr = np.exp(-(((xx - cx * 1.12) / (r * 0.7)) ** 2 + ((yy - cy * 1.12) / (r * 0.55)) ** 2))
    col = np.dstack([18 + 170 * tr, 10 + 92 * tr, 4 + 22 * tr])
    rim = np.clip(1 - np.asarray(m.filter(ImageFilter.GaussianBlur(6 * S)), np.float32) / 255, 0, 1) * 2
    col = col * (1 - 0.3 * rim[..., None])
    base = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8))
    img.paste(base, (0, 0), m)
    d = ImageDraw.Draw(img, "RGBA")
    hl = Image.new("L", (w, h), 0)
    ImageDraw.Draw(hl).ellipse([cx - int(r * 0.62), cy - int(r * 0.62), cx - int(r * 0.12), cy - int(r * 0.05)], fill=200)
    hl = hl.filter(ImageFilter.GaussianBlur(5 * S))
    img = Image.composite(Image.new("RGBA", (w, h), (255, 250, 240, 255)), img, Image.fromarray(np.minimum(np.asarray(hl), np.asarray(m))))
    d = ImageDraw.Draw(img, "RGBA")
    d.ellipse([cx - int(r * 0.42), cy - int(r * 0.5), cx - int(r * 0.25), cy - int(r * 0.3)], fill=(255, 255, 255, 230))
    img = img.resize((w // S, h // S), Image.LANCZOS)
    img.save(OUT / "droplet.png")


def ripple():
    S = 3
    w, h = 420 * S, 110 * S
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for k, (a, wd) in enumerate([(200, 5), (120, 4), (60, 3)]):
        inset = k * 28 * S
        lay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(lay).ellipse([inset, inset * 0.26, w - inset, h - inset * 0.26], outline=(30, 18, 8, min(255, a + 40)), width=(wd + 2) * S)
        ImageDraw.Draw(lay).ellipse([inset + 3 * S, inset * 0.26 + 2 * S, w - inset - 3 * S, h - inset * 0.26 - 2 * S], outline=(240, 190, 120, a // 2), width=max(1, (wd - 2)) * S)
        img = Image.alpha_composite(img, lay.filter(ImageFilter.GaussianBlur(1.5 * S)))
    img.resize((w // S, h // S), Image.LANCZOS).save(OUT / "ripple.png")


def tanker():
    """Side view road tanker (cab facing right) with a cutaway window in the tank."""
    S = 2
    PI = 160 * S                              # px per inch at 2x
    w, h = int(6.2 * PI), int(2.45 * PI)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")
    ground = h - 2
    # shadow
    sh = Image.new("L", (w, h), 0)
    ImageDraw.Draw(sh).ellipse([int(0.1 * PI), ground - int(0.16 * PI), w - int(0.05 * PI), ground + int(0.10 * PI)], fill=150)
    img.paste((0, 0, 0, 130), (0, 0), sh.filter(ImageFilter.GaussianBlur(18)))
    # tank barrel
    tx0, tx1 = int(0.15 * PI), int(4.55 * PI)
    ty0, ty1 = int(0.35 * PI), int(1.55 * PI)
    col = steel_column(ty1 - ty0, (214, 220, 226))
    barrel = np.repeat(col[:, None, :], tx1 - tx0, axis=1)
    bimg = to_img(barrel).convert("RGBA")
    m = Image.new("L", bimg.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, bimg.size[0] - 1, bimg.size[1] - 1], radius=int(0.55 * PI), fill=255)
    img.paste(bimg, (tx0, ty0), m)
    for rx in np.linspace(tx0 + 0.6 * PI, tx1 - 0.6 * PI, 4):           # tank bands
        d.line([(rx, ty0 + 6), (rx, ty1 - 6)], fill=(150, 156, 164, 255), width=5)
    # hatches + walkway rail
    for hx in np.linspace(tx0 + 0.75 * PI, tx1 - 0.75 * PI, 4):
        d.rounded_rectangle([hx - 0.16 * PI, ty0 - 0.10 * PI, hx + 0.16 * PI, ty0 + 0.04 * PI], radius=8, fill=(120, 126, 134, 255))
    d.line([(tx0 + 0.4 * PI, ty0 - 0.22 * PI), (tx1 - 0.4 * PI, ty0 - 0.22 * PI)], fill=(178, 184, 190, 255), width=5)
    for px_ in np.linspace(tx0 + 0.4 * PI, tx1 - 0.4 * PI, 7):
        d.line([(px_, ty0 - 0.22 * PI), (px_, ty0 + 2)], fill=(178, 184, 190, 255), width=4)
    # cutaway window (oil fill animates inside it)
    cw0, cw1 = int(1.05 * PI), int(3.65 * PI)
    cy0, cy1 = int(0.55 * PI), int(1.35 * PI)
    d.rounded_rectangle([cw0 - 6, cy0 - 6, cw1 + 6, cy1 + 6], radius=26, fill=(235, 238, 242, 255))
    d.rounded_rectangle([cw0, cy0, cw1, cy1], radius=22, fill=(14, 17, 22, 255))
    # chassis, cab, wheels
    d.rectangle([tx0 + 0.1 * PI, ty1 - 4, int(5.95 * PI), ty1 + int(0.16 * PI)], fill=(36, 38, 42, 255))
    cab_x0 = int(4.72 * PI)
    cab = [(cab_x0, int(1.70 * PI)), (cab_x0, int(0.55 * PI)), (int(5.55 * PI), int(0.50 * PI)),
           (int(6.02 * PI), int(1.05 * PI)), (int(6.05 * PI), int(1.70 * PI))]
    d.polygon(cab, fill=(196, 38, 46, 255))
    d.polygon([(cab_x0 + 0.1 * PI, int(0.70 * PI)), (int(5.5 * PI), int(0.66 * PI)), (int(5.85 * PI), int(1.06 * PI)), (cab_x0 + 0.1 * PI, int(1.06 * PI))], fill=(40, 56, 72, 255))
    d.line([(cab_x0 + 0.1 * PI, int(0.72 * PI)), (int(5.5 * PI), int(0.68 * PI))], fill=(150, 190, 220, 200), width=4)
    d.rectangle([cab_x0, int(1.25 * PI), int(6.05 * PI), int(1.32 * PI)], fill=(150, 26, 32, 255))
    d.rectangle([int(5.92 * PI), int(1.40 * PI), int(6.10 * PI), int(1.62 * PI)], fill=(60, 62, 66, 255))
    for wx in (0.75, 1.25, 3.55, 4.05, 5.45):
        cx, cy, r = int(wx * PI), ground - int(0.24 * PI), int(0.24 * PI)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(22, 22, 24, 255))
        d.ellipse([cx - r * 0.55, cy - r * 0.55, cx + r * 0.55, cy + r * 0.55], fill=(150, 154, 160, 255))
        d.ellipse([cx - r * 0.2, cy - r * 0.2, cx + r * 0.2, cy + r * 0.2], fill=(70, 72, 78, 255))
    img = img.resize((w // S, h // S), Image.LANCZOS)
    img.save(OUT / "tanker.png")
    return dict(w_in=6.2, h_in=2.45, window=(1.05, 0.55, 3.65, 1.35))


def gantry():
    """Loading gantry: steel posts, platform and an articulated loading arm, pipe rising from the lane."""
    S = 2
    PI = 160 * S
    w, h = int(2.6 * PI), int(4.2 * PI)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")
    steel, dark = (168, 174, 182, 255), (92, 98, 108, 255)
    for x in (0.25, 2.25):
        d.rectangle([x * PI - 9, 0.35 * PI, x * PI + 9, h], fill=steel)
        d.rectangle([x * PI - 9, 0.35 * PI, x * PI - 3, h], fill=(220, 225, 230, 255))
    d.rectangle([0.1 * PI, 0.30 * PI, 2.45 * PI, 0.42 * PI], fill=steel)          # roof beam
    d.rectangle([0.1 * PI, 1.30 * PI, 2.45 * PI, 1.38 * PI], fill=dark)           # platform
    for x in np.linspace(0.15, 2.4, 10):
        d.line([(x * PI, 1.02 * PI), (x * PI, 1.30 * PI)], fill=steel, width=5)
    d.line([(0.1 * PI, 1.02 * PI), (2.45 * PI, 1.02 * PI)], fill=steel, width=6)
    # vertical product pipe (from lane) up the left post, then across to the arm
    px = int(0.55 * PI)
    col = steel_column(int(0.26 * PI)).transpose(1, 0, 2) if False else None
    d.rectangle([px - 20, 0.85 * PI, px + 20, h], fill=(150, 158, 168, 255))
    d.rectangle([px - 20, 0.85 * PI, px - 8, h], fill=(214, 220, 226, 255))
    d.rectangle([px - 20, 0.70 * PI, 1.45 * PI, 0.95 * PI], fill=(150, 158, 168, 255))
    d.rectangle([px - 20, 0.70 * PI, 1.45 * PI, 0.76 * PI], fill=(214, 220, 226, 255))
    # loading arm: swivel, upper arm, drop pipe down to tank hatch
    d.ellipse([1.33 * PI, 0.66 * PI, 1.6 * PI, 0.98 * PI], fill=dark)
    d.polygon([(1.42 * PI, 0.80 * PI), (1.52 * PI, 0.76 * PI), (2.0 * PI, 1.55 * PI), (1.9 * PI, 1.6 * PI)], fill=(214, 172, 40, 255))
    d.ellipse([1.86 * PI, 1.50 * PI, 2.06 * PI, 1.68 * PI], fill=dark)
    d.rectangle([1.92 * PI, 1.6 * PI, 2.0 * PI, 2.55 * PI], fill=(214, 172, 40, 255))
    d.rectangle([1.89 * PI, 2.45 * PI, 2.03 * PI, 2.6 * PI], fill=dark)
    img = img.resize((w // S, h // S), Image.LANCZOS)
    img.save(OUT / "gantry.png")
    return dict(w_in=2.6, h_in=4.2)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    photo = Image.open(SRC).convert("RGB")
    scene1(photo); scene2(); scene3(); scene4(); scene5(); scene6(photo)
    info = pipeline()
    oil_flow(); droplet(); ripple()
    info["tanker"] = tanker(); info["gantry"] = gantry()
    print(info)
