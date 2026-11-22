"""Daylight scenery, the crude-oil pipeline strip and the industrial set pieces for the pitch deck.

    python presentation/build/gen_scenery.py        (run after gen_assets.py)

Geometry (inches, slide = 13.333 x 7.5)
  * ground surface      y = 6.60   (below it: a geological cross-section on every slide)
  * pipeline            above ground on concrete sleepers, centre y = 6.15, diameter 0.30
  * pipeline_strip.png  spans 8 slide widths (slides 1-8) and y = 5.00 .. 7.50; it is shifted left by
                        one slide width per slide so Morph pans along the same pipe.
Each slide-width segment of the strip carries its own scenery (see SEGMENTS below).
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from gen_assets import noise, vgrad, to_img, OUT, W_IN, H_IN, rng

PPI = 150                      # strip resolution
STRIP_TOP, GROUND, PIPE_CY, PIPE_D = 5.0, 6.60, 6.15, 0.30
N_SLIDES = 8
L_IN = N_SLIDES * W_IN
FONT_B = "C:/Windows/Fonts/segoeuib.ttf"
FONT_R = "C:/Windows/Fonts/segoeui.ttf"

STEEL = (122, 130, 138)
STEEL_HI = (186, 192, 198)
CRUDE = (26, 17, 9)
HAZ_Y = (242, 182, 30)
RED = (196, 40, 44)


def font(sz_in, bold=True):
    return ImageFont.truetype(FONT_B if bold else FONT_R, max(6, int(sz_in * PPI)))


# ------------------------------------------------------------------ canvas helpers (inches -> pixels)
class Canvas:
    def __init__(self, w_in, h_in, top_in=0.0, ppi=PPI):
        self.ppi, self.top = ppi, top_in
        self.img = Image.new("RGBA", (int(w_in * ppi), int(h_in * ppi)), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img, "RGBA")

    def X(self, x):
        return int(round(x * self.ppi))

    def Y(self, y):
        return int(round((y - self.top) * self.ppi))

    def paste(self, arr_rgba, x, y):
        im = Image.fromarray(np.clip(arr_rgba, 0, 255).astype(np.uint8), "RGBA")
        self.img.alpha_composite(im, (self.X(x), self.Y(y)))

    def cyl_h(self, x0, x1, yc, dia, base=STEEL, weather=0.0):
        """Horizontal shaded cylinder."""
        h = max(2, self.X(dia))
        w = max(1, self.X(x1) - self.X(x0))
        t = np.linspace(0, 1, h)
        prof = 0.55 + 0.75 * np.exp(-((t - 0.28) / 0.17) ** 2) - 0.35 * t ** 3
        col = np.clip(np.array(base, np.float32)[None, :] * prof[:, None], 0, 255)
        a = np.repeat(col[:, None, :], w, axis=1)
        if weather:
            n = noise(h, w, (2, 6, 18), seed=int(x0 * 10) % 97)[..., None]
            a = a * (1 - weather * 0.35 * (n > 0.62)) + weather * 14 * (n - 0.5)
            a[..., 0] += weather * 10 * (n[..., 0] > 0.7)            # rust tint
        rgba = np.dstack([a, np.full((h, w), 255)])
        self.paste(rgba, x0, yc - dia / 2)

    def cyl_v(self, xc, y0, y1, dia, base=STEEL):
        w = max(2, self.X(dia))
        h = max(1, self.Y(y1) - self.Y(y0))
        t = np.linspace(0, 1, w)
        prof = 0.55 + 0.75 * np.exp(-((t - 0.3) / 0.17) ** 2) - 0.3 * t ** 3
        col = np.clip(np.array(base, np.float32)[None, :] * prof[:, None], 0, 255)
        a = np.repeat(col[None, :, :], h, axis=0)
        self.paste(np.dstack([a, np.full((h, w), 255)]), xc - dia / 2, y0)

    def rect(self, x0, y0, x1, y1, fill, outline=None, width=1, r=0):
        box = [self.X(x0), self.Y(y0), self.X(x1), self.Y(y1)]
        if r:
            self.d.rounded_rectangle(box, radius=self.X(r), fill=fill, outline=outline, width=width)
        else:
            self.d.rectangle(box, fill=fill, outline=outline, width=width)

    def ell(self, xc, yc, rx, ry, fill=None, outline=None, width=1):
        self.d.ellipse([self.X(xc - rx), self.Y(yc - ry), self.X(xc + rx), self.Y(yc + ry)],
                       fill=fill, outline=outline, width=width)

    def line(self, pts, fill, width):
        self.d.line([(self.X(x), self.Y(y)) for x, y in pts], fill=fill, width=max(1, int(width * self.ppi)))

    def text(self, x, y, s, sz, fill, bold=True, anchor="mm"):
        self.d.text((self.X(x), self.Y(y)), s, font=font(sz, bold), fill=fill, anchor=anchor)

    def stain(self, xc, yc, rx, ry, alpha=150, seed=0):
        """Dark crude smudge: soft irregular blot."""
        w, h = self.X(rx * 2) + 8, self.Y(self.top + ry * 2) + 8
        n = noise(h, w, (3, 6, 12), seed=seed)
        yy, xx = np.mgrid[0:h, 0:w]
        dd = ((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2
        m = np.clip((1 - dd) * 1.6 - (n - 0.5) * 1.2, 0, 1) ** 1.4
        rgba = np.dstack([np.full((h, w), CRUDE[0]), np.full((h, w), CRUDE[1]), np.full((h, w), CRUDE[2]), m * alpha])
        self.paste(rgba, xc - rx, yc - ry)


# ------------------------------------------------------------------ pipeline parts
def flange(c, x, stain=False, seed=0):
    c.cyl_v(x, PIPE_CY - PIPE_D / 2 - 0.06, PIPE_CY + PIPE_D / 2 + 0.06, 0.11, (150, 156, 162))
    for k in range(3):
        by = PIPE_CY - PIPE_D / 2 - 0.035 + k * (PIPE_D + 0.07) / 2
        c.ell(x - 0.075, by, 0.022, 0.016, fill=(70, 72, 76, 255))
        c.ell(x + 0.075, by, 0.022, 0.016, fill=(70, 72, 76, 255))
    if stain:
        c.stain(x + 0.02, PIPE_CY + 0.09, 0.12, 0.07, 170, seed)
        c.stain(x + 0.05, GROUND - 0.015, 0.28, 0.035, 150, seed + 1)


def hazard_band(c, x0, w=0.34):
    y0, y1 = PIPE_CY - PIPE_D / 2, PIPE_CY + PIPE_D / 2
    band = Image.new("RGBA", (c.X(w), c.X(PIPE_D)), HAZ_Y + (255,))
    bd = ImageDraw.Draw(band)
    step = c.X(0.08)
    for k in range(-band.size[1], band.size[0] + band.size[1], step * 2):
        bd.polygon([(k, band.size[1]), (k + step, band.size[1]), (k + step + band.size[1], 0), (k + band.size[1], 0)],
                   fill=(25, 25, 25, 255))
    shade = np.asarray(band, np.float32).copy()
    t = np.linspace(0, 1, shade.shape[0])
    prof = 0.65 + 0.5 * np.exp(-((t - 0.28) / 0.2) ** 2) - 0.3 * t ** 3
    shade[..., :3] *= prof[:, None, None]
    c.paste(shade, x0, y0)


def sleeper(c, x):
    c.rect(x - 0.16, PIPE_CY + PIPE_D / 2, x + 0.16, GROUND, (176, 172, 164, 255))
    c.rect(x - 0.16, PIPE_CY + PIPE_D / 2, x + 0.16, PIPE_CY + PIPE_D / 2 + 0.03, (200, 196, 188, 255))
    c.line([(x - 0.17, PIPE_CY - 0.02), (x - 0.17, PIPE_CY + PIPE_D / 2 + 0.02)], (80, 82, 86, 255), 0.012)
    c.line([(x + 0.17, PIPE_CY - 0.02), (x + 0.17, PIPE_CY + PIPE_D / 2 + 0.02)], (80, 82, 86, 255), 0.012)


def gate_valve(c, x, wheel=RED, tall=0.55, stain=False, seed=0):
    c.rect(x - 0.17, PIPE_CY - 0.21, x + 0.17, PIPE_CY + 0.21, (92, 98, 106, 255), r=0.04)
    c.rect(x - 0.15, PIPE_CY - 0.19, x - 0.08, PIPE_CY + 0.19, (130, 136, 144, 255), r=0.03)
    c.cyl_v(x, PIPE_CY - 0.21 - tall * 0.45, PIPE_CY - 0.21, 0.14, (118, 124, 132))    # bonnet
    c.line([(x, PIPE_CY - 0.21 - tall * 0.45), (x, PIPE_CY - 0.21 - tall)], (60, 62, 66, 255), 0.022)  # stem
    yw = PIPE_CY - 0.21 - tall
    c.ell(x, yw, 0.2, 0.045, outline=wheel + (255,), width=c.X(0.035))
    c.line([(x - 0.2, yw), (x + 0.2, yw)], wheel + (255,), 0.02)
    if stain:
        c.stain(x + 0.04, PIPE_CY + 0.16, 0.13, 0.06, 180, seed)


def gauge(c, x, h=0.38):
    c.line([(x, PIPE_CY - PIPE_D / 2), (x, PIPE_CY - PIPE_D / 2 - h)], (90, 94, 100, 255), 0.03)
    yc = PIPE_CY - PIPE_D / 2 - h - 0.1
    c.ell(x, yc, 0.11, 0.11, fill=(40, 42, 46, 255))
    c.ell(x, yc, 0.088, 0.088, fill=(246, 246, 242, 255))
    for a in np.linspace(-2.4, 0.8, 7):
        c.line([(x + 0.07 * np.cos(a), yc + 0.07 * np.sin(a)), (x + 0.085 * np.cos(a), yc + 0.085 * np.sin(a))],
               (30, 30, 30, 255), 0.008)
    c.d.arc([c.X(x - 0.075), c.Y(yc - 0.075), c.X(x + 0.075), c.Y(yc + 0.075)], start=20, end=45,
            fill=(200, 40, 40, 255), width=c.X(0.012))
    c.line([(x, yc), (x + 0.06, yc - 0.035)], (190, 30, 30, 255), 0.01)


def sight_glass(c, x0, w=1.0):
    """Bolted flow-sight window; the moving crude highlight is animated on top in PowerPoint."""
    y0, y1 = PIPE_CY - PIPE_D / 2 + 0.035, PIPE_CY + PIPE_D / 2 - 0.035
    c.rect(x0 - 0.06, y0 - 0.05, x0 + w + 0.06, y1 + 0.05, (98, 104, 112, 255), r=0.03)
    hgt = c.Y(y1) - c.Y(y0)
    wid = c.X(w)
    t = np.linspace(0, 1, hgt)[:, None]
    base = np.array([20, 13, 7], np.float32) * (1 - t) + np.array([58, 32, 10], np.float32) * t
    a = np.repeat(base[:, None, :], wid, axis=1).reshape(hgt, wid, 3)
    n = noise(hgt, wid, (3, 7), seed=int(x0) % 50)[..., None]
    a = a * (0.8 + 0.45 * n)
    a[: max(1, hgt // 7)] = a[: max(1, hgt // 7)] * 0.4 + np.array([200, 215, 225]) * 0.6   # glass glare
    c.paste(np.dstack([a, np.full((hgt, wid), 255)]), x0, y0)
    for bx in np.linspace(x0 - 0.02, x0 + w + 0.02, 6):
        for by in (y0 - 0.025, y1 + 0.025):
            c.ell(bx, by, 0.016, 0.016, fill=(60, 62, 66, 255))


def drip_pan(c, x, w=0.5):
    c.stain(x, GROUND - 0.035, w * 0.42, 0.03, 200, seed=int(x * 7) % 40)
    c.rect(x - w / 2, GROUND - 0.07, x + w / 2, GROUND - 0.005, (96, 100, 106, 255))
    c.rect(x - w / 2 + 0.03, GROUND - 0.065, x + w / 2 - 0.03, GROUND - 0.04, (24, 16, 9, 255))


def plate(c, x, y, txt, w=1.2, h=0.17, fill=(246, 246, 240, 255), fg=(40, 44, 52, 255), sz=0.085):
    c.rect(x - w / 2, y - h / 2, x + w / 2, y + h / 2, fill, outline=(70, 74, 80, 255), width=2, r=0.02)
    c.text(x, y, txt, sz, fg)


def danger_sign(c, x):
    c.line([(x, GROUND), (x, 5.62)], (110, 112, 116, 255), 0.035)
    x0, y0, x1, y1 = x - 0.36, 5.08, x + 0.36, 5.6
    c.rect(x0, y0, x1, y1, (250, 250, 248, 255), outline=(30, 30, 30, 255), width=2)
    c.rect(x0 + 0.02, y0 + 0.02, x1 - 0.02, y0 + 0.2, (20, 20, 20, 255))
    c.ell(x, y0 + 0.11, 0.27, 0.075, fill=(214, 30, 36, 255), outline=(255, 255, 255, 255), width=2)
    c.text(x, y0 + 0.11, "DANGER", 0.085, (255, 255, 255, 255))
    c.text(x, y0 + 0.30, "HIGH-PRESSURE", 0.06, (20, 20, 20, 255))
    c.text(x, y0 + 0.41, "CRUDE OIL", 0.065, (20, 20, 20, 255))


def christmas_tree(c, x):
    """Wellhead on the surface: master valves, cross, wing valve to the flowline, swab valve, cap gauge."""
    c.rect(x - 0.3, GROUND - 0.08, x + 0.3, GROUND, (120, 124, 130, 255))              # wellhead flange
    c.cyl_v(x, 5.35, GROUND - 0.08, 0.2, (150, 40, 36))                                   # red tree body
    for yv in (6.42, 5.86, 5.55):                                                         # valve blocks
        c.rect(x - 0.17, yv - 0.09, x + 0.17, yv + 0.09, (170, 46, 40, 255), r=0.03)
        c.ell(x - 0.27, yv, 0.035, 0.1, outline=(230, 190, 40, 255), width=c.X(0.025))   # handwheels
    c.rect(x - 0.2, PIPE_CY - 0.13, x + 0.2, PIPE_CY + 0.13, (140, 40, 36, 255), r=0.03)  # cross
    c.cyl_h(x + 0.18, x + 0.55, PIPE_CY, 0.2, (150, 40, 36))                              # wing
    c.rect(x + 0.32, PIPE_CY - 0.14, x + 0.46, PIPE_CY + 0.14, (170, 46, 40, 255), r=0.02)
    c.line([(x + 0.39, PIPE_CY - 0.14), (x + 0.39, PIPE_CY - 0.3)], (60, 60, 64, 255), 0.02)
    c.ell(x + 0.39, PIPE_CY - 0.3, 0.12, 0.03, outline=(230, 190, 40, 255), width=c.X(0.025))
    c.line([(x, 5.35), (x, 5.22)], (80, 82, 86, 255), 0.03)
    c.ell(x, 5.15, 0.075, 0.075, fill=(40, 42, 46, 255)); c.ell(x, 5.15, 0.058, 0.058, fill=(246, 246, 242, 255))
    c.line([(x, 5.15), (x + 0.04, 5.12)], (190, 30, 30, 255), 0.008)


def mini_wellhead(c, x, label, hi=False):
    c.rect(x - 0.17, GROUND - 0.05, x + 0.17, GROUND, (120, 124, 130, 255))
    c.cyl_v(x, 5.62, GROUND - 0.05, 0.12, (150, 40, 36) if not hi else (190, 110, 30))
    for yv in (6.3, 5.95):
        c.rect(x - 0.11, yv - 0.055, x + 0.11, yv + 0.055, (170, 46, 40, 255) if not hi else (220, 140, 40, 255), r=0.02)
    c.cyl_h(x + 0.05, x + 0.32, 5.95, 0.08, (140, 146, 152))                  # flowline to the header
    c.cyl_v(x + 0.32, 5.95, PIPE_CY - PIPE_D / 2 + 0.02, 0.08, (140, 146, 152))
    plate(c, x, 5.45, label, w=0.5, h=0.17, sz=0.09,
          fill=((242, 163, 58, 255) if hi else (246, 246, 240, 255)), fg=(20, 24, 30, 255))


def compressor(c, x0):
    """Gas-lift compressor skid."""
    c.rect(x0, GROUND - 0.08, x0 + 2.1, GROUND, (90, 94, 100, 255))
    c.rect(x0 + 0.1, 5.55, x0 + 1.35, GROUND - 0.08, (214, 220, 226, 255), outline=(150, 156, 164, 255), width=2, r=0.03)
    for k in range(9):
        c.line([(x0 + 0.22 + k * 0.12, 5.7), (x0 + 0.22 + k * 0.12, 6.3)], (170, 176, 184, 255), 0.012)
    c.text(x0 + 0.72, 6.4, "GAS-LIFT COMPRESSOR", 0.065, (60, 66, 74, 255))
    c.rect(x0 + 1.42, 5.75, x0 + 2.0, GROUND - 0.08, (60, 110, 160, 255), r=0.03)       # cooler
    c.ell(x0 + 1.71, 6.02, 0.2, 0.2, fill=(40, 74, 110, 255))
    for a in np.linspace(0, np.pi, 4, endpoint=False):
        c.line([(x0 + 1.71 - 0.18 * np.cos(a), 6.02 - 0.18 * np.sin(a)),
                (x0 + 1.71 + 0.18 * np.cos(a), 6.02 + 0.18 * np.sin(a))], (150, 180, 210, 255), 0.02)
    c.cyl_v(x0 + 0.3, 5.25, 5.56, 0.08, (90, 94, 100))                                  # exhaust stack
    c.cyl_h(x0 + 2.0, x0 + 2.35, 5.95, 0.07, (140, 146, 152))                           # lift-gas line
    c.cyl_v(x0 + 2.35, 5.95, PIPE_CY - PIPE_D / 2 + 0.01, 0.07, (140, 146, 152))


def telemetry(c, x):
    c.line([(x, GROUND), (x, 5.05)], (130, 134, 140, 255), 0.04)
    for y in np.arange(5.15, 6.5, 0.18):
        c.line([(x - 0.05, y), (x + 0.05, y + 0.09)], (150, 154, 160, 255), 0.01)
    c.ell(x, 5.05, 0.05, 0.05, fill=(220, 60, 50, 255))
    c.d.polygon([(c.X(x + 0.04), c.Y(5.32)), (c.X(x + 0.5), c.Y(5.18)), (c.X(x + 0.5), c.Y(5.42)),
                 (c.X(x + 0.04), c.Y(5.5))], fill=(28, 52, 90, 255), outline=(170, 176, 184, 255))   # solar panel
    c.rect(x - 0.16, 6.05, x + 0.16, 6.5, (226, 230, 234, 255), outline=(120, 126, 134, 255), width=2)
    c.text(x, 6.28, "RTU", 0.07, (60, 66, 74, 255))


def choke_skid(c, x0):
    c.rect(x0, GROUND - 0.06, x0 + 3.6, GROUND, (90, 94, 100, 255))
    for xx in (x0 + 0.1, x0 + 3.5):
        c.rect(xx - 0.04, 5.55, xx + 0.04, GROUND, (210, 170, 40, 255))
    c.line([(x0 + 0.1, 5.55), (x0 + 3.5, 5.55)], (210, 170, 40, 255), 0.05)
    # choke valve (angle body + bonnet)
    c.rect(x0 + 0.6, PIPE_CY - 0.24, x0 + 1.05, PIPE_CY + 0.24, (70, 90, 120, 255), r=0.05)
    c.cyl_v(x0 + 0.83, 5.62, PIPE_CY - 0.24, 0.16, (80, 104, 140))
    c.ell(x0 + 0.83, 5.62, 0.16, 0.04, outline=(230, 190, 40, 255), width=c.X(0.03))
    plate(c, x0 + 0.83, 6.42, "CHOKE", w=0.5, h=0.13, sz=0.065)
    # shut-in (ESD) valve with red actuator
    c.rect(x0 + 1.55, PIPE_CY - 0.21, x0 + 1.9, PIPE_CY + 0.21, (92, 98, 106, 255), r=0.04)
    c.cyl_v(x0 + 1.72, 5.7, PIPE_CY - 0.21, 0.1, (118, 124, 132))
    c.rect(x0 + 1.5, 5.5, x0 + 1.95, 5.72, RED + (255,), r=0.05)
    plate(c, x0 + 1.72, 6.42, "SHUT-IN", w=0.55, h=0.13, sz=0.065)
    # pressure transmitters
    for xx in (x0 + 2.4, x0 + 2.9):
        c.line([(xx, PIPE_CY - PIPE_D / 2), (xx, 5.78)], (90, 94, 100, 255), 0.025)
        c.rect(xx - 0.09, 5.6, xx + 0.09, 5.8, (40, 100, 170, 255), r=0.03)
        c.ell(xx, 5.66, 0.05, 0.035, fill=(200, 230, 240, 255))
    plate(c, x0 + 2.65, 6.42, "PRESSURE MONITORING", w=1.15, h=0.13, sz=0.06)


def gathering_manifold(c, x0):
    """Ageing gathering manifold: upper header with three valved drops into the main line."""
    c.cyl_h(x0, x0 + 2.7, 5.62, 0.2, (120, 112, 100), weather=1.0)
    for k, xx in enumerate((x0 + 0.45, x0 + 1.35, x0 + 2.25)):
        c.cyl_v(xx, 5.62, PIPE_CY - PIPE_D / 2 + 0.01, 0.13, (118, 110, 98))
        c.rect(xx - 0.12, 5.78, xx + 0.12, 5.98, (100, 92, 82, 255), r=0.03)
        c.ell(xx + 0.2, 5.88, 0.03, 0.08, outline=RED + (255,), width=c.X(0.025))
        c.stain(xx + 0.02, 5.98, 0.08, 0.05, 190, 60 + k)
    c.cyl_v(x0 + 2.7, 5.4, 5.75, 0.24, (110, 104, 94))                                   # header end cap
    plate(c, x0 + 1.35, 5.3, "GATHERING MANIFOLD", w=1.3, h=0.15, sz=0.07)


def export_station(c, x0):
    c.rect(x0, GROUND - 0.06, x0 + 3.8, GROUND, (90, 94, 100, 255))
    for xx in (x0 + 0.6, x0 + 1.6):
        gate_valve(c, xx, wheel=(40, 120, 70), tall=0.75)
    c.cyl_h(x0 + 2.2, x0 + 3.75, PIPE_CY - 0.04, 0.44, (150, 156, 164))                 # pig launcher barrel
    c.rect(x0 + 3.62, PIPE_CY - 0.3, x0 + 3.78, PIPE_CY + 0.22, (110, 116, 124, 255), r=0.03)
    hazard_band(c, x0 + 2.4, 0.3)
    plate(c, x0 + 2.95, 5.55, "EXPORT TERMINAL", w=1.2, h=0.17, sz=0.08)


# ------------------------------------------------------------------ strata under the whole strip
def strata(w_px, h_px, seed=5):
    a = np.zeros((h_px, w_px, 3), np.float32)
    layers = [(0.00, (128, 104, 74)), (0.16, (150, 128, 92)), (0.36, (112, 100, 86)),
              (0.56, (168, 140, 98)), (0.74, (96, 94, 98))]
    y = np.arange(h_px)[:, None] / h_px
    xs = np.arange(w_px) / PPI
    idx = np.zeros((h_px, w_px), np.int32)
    for i, (top, _) in enumerate(layers[1:], start=1):
        r1 = np.random.default_rng(seed + i).random(int(L_IN) + 2)
        wob = (np.interp(xs, np.arange(len(r1)), r1) - 0.5) * 0.06
        idx = np.where(y >= top + wob[None, :], i, idx)
    tex = noise(h_px, w_px, (2, 5, 11), seed=seed)
    for i, (_, col) in enumerate(layers):
        m = idx == i
        a[m] = np.array(col, np.float32) * (0.82 + 0.36 * tex[m])[:, None]
    pebbles = rng.random((h_px, w_px)) > 0.992
    a[pebbles] *= 0.7
    shade = np.linspace(1.0, 0.72, h_px)[:, None, None]
    return a * shade


SEG = lambda k, x: (k - 1) * W_IN + x      # slide k, local x -> strip x


def build_strip():
    c = Canvas(L_IN, H_IN - STRIP_TOP, top_in=STRIP_TOP)
    gy = c.Y(GROUND)
    st = strata(c.img.size[0], c.img.size[1] - gy)
    c.paste(np.dstack([st, np.full(st.shape[:2], 255)]), 0, GROUND)
    c.line([(0, GROUND), (L_IN, GROUND)], (200, 180, 140, 255), 0.012)
    # slide 1: the well rises through the rock into the Christmas tree
    TREE_X = 6.6
    c.cyl_v(TREE_X, GROUND, H_IN, 0.34, (150, 146, 138))      # cement sheath
    c.cyl_v(TREE_X, GROUND, H_IN, 0.24, (110, 116, 124))      # casing
    c.cyl_v(TREE_X, GROUND, H_IN, 0.1, (40, 28, 16))          # crude-filled tubing
    c.text(TREE_X + 0.75, 7.05, "well · oil rising from the reservoir", 0.075, (250, 244, 230, 230), bold=False, anchor="lm")
    pipe_x0, pipe_x1 = TREE_X + 0.5, L_IN - 0.4
    for x in np.arange(pipe_x0 + 0.5, pipe_x1, 1.45):
        sleeper(c, x)
    c.cyl_h(pipe_x0, pipe_x1, PIPE_CY, PIPE_D, STEEL, weather=0.8)
    christmas_tree(c, TREE_X)
    # flanges every 2.6 in, every third one stained
    for i, x in enumerate(np.arange(pipe_x0 + 1.2, pipe_x1, 2.6)):
        flange(c, x, stain=(i % 3 == 1), seed=i)
    # per-slide dressing (local x)
    dress = {
        1: lambda: (hazard_band(c, SEG(1, 7.75)), sight_glass(c, SEG(1, 9.0)), gate_valve(c, SEG(1, 11.3), stain=True, seed=3),
                    drip_pan(c, SEG(1, 11.3)), gauge(c, SEG(1, 12.5))),
        2: lambda: (sight_glass(c, SEG(2, 2.2)), hazard_band(c, SEG(2, 4.0)),
                    gathering_manifold(c, SEG(2, 10.15)), drip_pan(c, SEG(2, 5.37)), danger_sign(c, SEG(2, 9.62)),
                    c.stain(SEG(2, 11.3), GROUND - 0.02, 0.6, 0.04, 160, 77)),
        3: lambda: (compressor(c, SEG(3, 0.55)), telemetry(c, SEG(3, 7.75)), sight_glass(c, SEG(3, 4.0)),
                    gate_valve(c, SEG(3, 5.8)), hazard_band(c, SEG(3, 9.6))),
        4: lambda: [mini_wellhead(c, SEG(4, 0.75 + i * 1.3), f"GL-{i + 1:02d}", hi=(i == 0)) for i in range(10)]
                   + [sight_glass(c, SEG(4, 6.25), 0.6)],
        5: lambda: (sight_glass(c, SEG(5, 1.0)), gate_valve(c, SEG(5, 5.4), stain=True, seed=9),
                    drip_pan(c, SEG(5, 5.4)), hazard_band(c, SEG(5, 7.6)), choke_skid(c, SEG(5, 9.1))),
        6: lambda: (sight_glass(c, SEG(6, 1.4)), hazard_band(c, SEG(6, 3.4)), hazard_band(c, SEG(6, 6.3))),
        7: lambda: (sight_glass(c, SEG(7, 1.2)), hazard_band(c, SEG(7, 5.0)), export_station(c, SEG(7, 8.9))),
        8: lambda: (),
    }
    for k in range(1, N_SLIDES + 1):
        dress[k]()
    c.img.save(OUT / "pipeline_strip.png", optimize=True)
    print("strip", c.img.size)


# ------------------------------------------------------------------ animated overlays
def glint():
    """Bright crude pulse for the sight glasses (wiped left->right on a loop)."""
    w, h = 400, 60
    x = np.linspace(0, 1, w)
    k = np.exp(-((x[None, :] - 0.8) / 0.09) ** 2) + 0.6 * np.exp(-((x[None, :] - 0.45) / 0.07) ** 2) \
        + 0.35 * np.exp(-((x[None, :] - 0.15) / 0.06) ** 2)
    t = np.linspace(0, 1, h)[:, None]
    k = k * (0.5 + 0.5 * np.sin(np.pi * t))
    rgba = np.dstack([np.full((h, w), 214), np.full((h, w), 128), np.full((h, w), 40), np.clip(k * 210, 0, 255)])
    Image.fromarray(rgba.astype(np.uint8), "RGBA").save(OUT / "crude_pulse.png")


def drip():
    S = 4
    w, h = 40 * S, 58 * S
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([4 * S, 20 * S, 36 * S, 54 * S], fill=CRUDE + (255,))
    d.polygon([(20 * S, 0), (6 * S, 30 * S), (34 * S, 30 * S)], fill=CRUDE + (255,))
    d.ellipse([10 * S, 28 * S, 17 * S, 36 * S], fill=(255, 240, 220, 200))
    img.resize((w // S, h // S), Image.LANCZOS).save(OUT / "drip.png")


# ------------------------------------------------------------------ daylight backdrops (slides 2-5, 7, 8)
def daylight(name, hills_seed=1, haze=0.0):
    SP = 180
    w, h = int(W_IN * SP), int(H_IN * SP)
    a = vgrad(h, w, (178, 212, 238), (236, 243, 248))
    yy = np.arange(h)[:, None] / SP
    # distant mesas, sunlit ground
    xs = np.arange(w) / SP
    r = np.random.default_rng(hills_seed).random(30)
    ridge = 5.05 + 0.35 * (np.interp(xs, np.linspace(0, W_IN, 30), r) - 0.5) + 0.08 * np.sin(xs * 1.7 + hills_seed)
    hill = (yy >= ridge[None, :]) & (yy < 5.75)
    tex = noise(h, w, (3, 8, 20), seed=hills_seed)
    hc = np.array([196, 178, 150], np.float32)
    a[hill] = a[hill] * 0.35 + (hc * (0.9 + 0.2 * tex[hill])[:, None]) * 0.65
    gnd = np.repeat(yy >= 5.75, w, axis=1)
    gc = np.array([224, 202, 160], np.float32)
    a[gnd] = gc * (0.88 + 0.22 * tex[gnd])[:, None]
    # shrubs along the horizon
    img = to_img(a)
    d = ImageDraw.Draw(img, "RGBA")
    rr = np.random.default_rng(hills_seed + 20)
    for _ in range(70):
        x = rr.uniform(0, w); y = rr.uniform(5.72, 5.82) * SP; s = rr.uniform(4, 11)
        d.ellipse([x - s * 1.6, y - s, x + s * 1.6, y + s * 0.4], fill=(108, 128, 82, 170))
    # sun glow
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse([int(9.5 * SP), int(-3 * SP), int(16 * SP), int(2.5 * SP)], fill=120)
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    img = Image.composite(Image.new("RGB", (w, h), (255, 248, 226)), img, glow)
    img.save(OUT / name, quality=90)


# ------------------------------------------------------------------ slide 3 well cutaway card
def cutaway_card():
    from gen_assets import strata_rgb, STRATA
    CW, CH, SP = 4.6, 4.25, 180
    w, h = int(CW * SP), int(CH * SP)
    sky_h = int(0.45 * SP)
    a = np.zeros((h, w, 3), np.float32)
    a[:sky_h] = vgrad(sky_h, w, (170, 206, 236), (226, 238, 246))
    rock = strata_rgb(h - sky_h, w, 8.2, seed=3)
    a[sky_h:] = rock
    img = to_img(a)
    d = ImageDraw.Draw(img, "RGBA")
    d.line([(0, sky_h), (w, sky_h)], fill=(230, 210, 170, 255), width=3)
    wx = int(2.3 * SP)
    # reservoir layer position in the card: STRATA tops are in inches from the top of the rock
    res_top = sky_h + int(4.35 / 6.45 * (h - sky_h))
    res_bot = sky_h + int(5.55 / 6.45 * (h - sky_h))
    d.rectangle([wx - 22, sky_h - 30, wx + 22, res_bot - 20], fill=(150, 146, 138, 255))
    d.rectangle([wx - 15, sky_h - 30, wx + 15, res_bot - 20], fill=(70, 76, 84, 255))
    d.rectangle([wx - 11, sky_h - 30, wx + 11, res_bot - 20], fill=(18, 22, 28, 255))
    d.rectangle([wx - 5, sky_h - 30, wx + 5, res_bot - 26], fill=(160, 168, 178, 255))
    d.rectangle([wx - 26, sky_h - 70, wx + 26, sky_h - 28], fill=(170, 46, 40, 255))      # wellhead
    for yy in np.linspace(res_top + 20, res_bot - 40, 6):
        for s in (-1, 1):
            L = rng.integers(45, 80)
            d.line([(wx + s * 22, yy), (wx + s * (22 + L), yy + rng.integers(-5, 5))], fill=(20, 12, 6, 235), width=6)
    d.rectangle([wx - 16, res_top - 30, wx + 16, res_top - 16], fill=(60, 64, 70, 255))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=int(0.16 * SP), fill=255)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    out.save(OUT / "well_cutaway.png")
    print("cutaway reservoir y (in, card-local):", res_top / SP, res_bot / SP, "well x", 2.3)


# ------------------------------------------------------------------ slide 6: custody-transfer metering hub
def metering_station():
    """Right-hand visual of slide 6 (5.9 x 4.2 in, ground at the bottom edge):
    storage tanks + distillation towers behind, metering skid + export manifold in front, windsock."""
    CW, CH = 5.9, 4.2
    c = Canvas(CW, CH, top_in=0, ppi=180)
    G = CH                         # ground line (local y)
    py = CH - (GROUND - PIPE_CY)   # pipeline height in local coords
    haze = (232, 236, 240)
    # distillation towers (back, hazy)
    for xc, top, dia in ((0.75, 0.35, 0.34), (1.35, 0.9, 0.26), (5.3, 0.6, 0.3)):
        c.cyl_v(xc, top, G - 0.6, dia, (200, 204, 210))
        for yy in np.arange(top + 0.35, G - 0.7, 0.45):
            c.line([(xc - dia, yy), (xc + dia, yy)], (150, 156, 164, 255), 0.02)
        c.rect(xc - 0.02, top - 0.25, xc + 0.02, top, (150, 156, 164, 255))
    # storage tanks
    for x0, x1, top in ((1.8, 3.3, 1.75), (3.45, 4.85, 2.05)):
        hgt = G - 0.55 - top
        tank = np.zeros((c.Y(G - 0.55) - c.Y(top), c.X(x1) - c.X(x0), 3), np.float32)
        tank[:] = np.array([236, 236, 232]) * np.linspace(0.8, 1.02, tank.shape[1])[None, :, None]
        c.paste(np.dstack([tank, np.full(tank.shape[:2], 255)]), x0, top)
        c.ell((x0 + x1) / 2, top, (x1 - x0) / 2, 0.07, fill=(246, 246, 244, 255), outline=(190, 192, 194, 255), width=2)
        for k in range(6):
            yy = top + 0.15 + k * hgt / 6
            c.line([(x0 + 0.1 + k * 0.16, yy), (x0 + 0.26 + k * 0.16, yy + hgt / 6)], (150, 154, 160, 255), 0.02)
        c.text((x0 + x1) / 2, top + hgt * 0.55, "CRUDE", 0.12, (120, 126, 134, 255))
    # ground pad
    c.rect(0, G - 0.55, CW, G, (205, 196, 176, 255))
    c.line([(0, G - 0.55), (CW, G - 0.55)], (180, 170, 150, 255), 0.015)
    # metering skid frame
    sx0, sx1 = 0.25, 4.6
    c.rect(sx0, G - 0.12, sx1, G, (90, 94, 100, 255))
    for xx in (sx0 + 0.05, sx1 - 0.05):
        c.rect(xx - 0.04, G - 1.55, xx + 0.04, G, (210, 170, 40, 255))
    c.line([(sx0, G - 1.55), (sx1, G - 1.55)], (210, 170, 40, 255), 0.05)
    # inlet header (from the pipeline) and outlet header
    c.cyl_v(0.45, py - 0.95, py + 0.12, 0.2, STEEL)
    c.cyl_v(4.35, py - 0.95, py + 0.12, 0.2, STEEL)
    for k, yy in enumerate((py - 0.85, py - 0.4)):             # two meter runs
        c.cyl_h(0.45, 4.35, yy, 0.17, (150, 158, 168))
        c.rect(1.0, yy - 0.16, 1.4, yy + 0.16, (40, 100, 170, 255), r=0.06)        # ultrasonic/Coriolis meter body
        c.rect(1.05, yy - 0.3, 1.35, yy - 0.16, (220, 226, 232, 255), outline=(40, 100, 170, 255), width=2, r=0.03)
        c.rect(2.25, yy - 0.12, 2.55, yy + 0.12, (92, 98, 106, 255), r=0.03)        # control valve body
        c.ell(2.4, yy - 0.3, 0.17, 0.1, fill=(40, 100, 170, 255))                  # actuator dome
        c.line([(2.4, yy - 0.2), (2.4, yy - 0.12)], (60, 62, 66, 255), 0.02)
        for xx in (1.8, 3.1):                                                      # pressure transmitters
            c.line([(xx, yy - 0.08), (xx, yy - 0.22)], (90, 94, 100, 255), 0.02)
            c.rect(xx - 0.07, yy - 0.36, xx + 0.07, yy - 0.21, (40, 100, 170, 255), r=0.02)
        c.rect(3.55, yy - 0.13, 3.75, yy + 0.13, (92, 98, 106, 255), r=0.03)       # isolation valve
        c.ell(3.65, yy - 0.2, 0.12, 0.03, outline=(40, 140, 80, 255), width=c.X(0.022))
    # control cabinet
    c.rect(4.75, G - 1.1, 5.25, G - 0.12, (232, 236, 240, 255), outline=(120, 126, 134, 255), width=2, r=0.03)
    c.rect(4.82, G - 1.0, 5.18, G - 0.75, (30, 60, 90, 255))
    c.ell(4.9, G - 0.6, 0.03, 0.03, fill=(60, 190, 110, 255))
    plate_c = Canvas(1, 1)  # noqa: F841 (keeps helper signatures uniform)
    c.rect(1.1, G - 1.85, 3.6, G - 1.62, (246, 246, 240, 255), outline=(70, 74, 80, 255), width=2, r=0.02)
    c.text(2.35, G - 1.735, "CUSTODY-TRANSFER METERING", 0.1, (40, 44, 52, 255))
    # windsock
    c.line([(5.6, G), (5.6, 0.9)], (150, 154, 160, 255), 0.03)
    for k in range(5):
        x0 = 5.6 - 0.05 + 0.0 + k * -0.14
        col = (240, 110, 40, 255) if k % 2 == 0 else (250, 250, 250, 255)
        c.d.polygon([(c.X(5.6 - k * 0.14), c.Y(0.92 + k * 0.012)), (c.X(5.6 - (k + 1) * 0.14), c.Y(0.93 + (k + 1) * 0.014)),
                     (c.X(5.6 - (k + 1) * 0.14), c.Y(1.1 - (k + 1) * 0.008)), (c.X(5.6 - k * 0.14), c.Y(1.12 - k * 0.006))],
                    fill=col)
    # soft contact shadow
    c.img.save(OUT / "metering_station.png")
    print("metering station pipeline y (local):", py)


if __name__ == "__main__":
    build_strip()
    glint(); drip()
    daylight("scene2_day.jpg", 1); daylight("scene3_day.jpg", 2); daylight("scene4_day.jpg", 3)
    daylight("scene5_day.jpg", 4); daylight("scene7_day.jpg", 5)
    cutaway_card()
    metering_station()
