"""Remove the two static light-blue eyes from the Nova avatar, so the animated eyes drawn by the
web page (app/static/js/nova.js) do not sit on top of "ghost eyes".

    python clean_nova_avatar.py                      # cleans app/static/nova_avatar.png in place
    python clean_nova_avatar.py in.png out.png       # or choose the files

- The original is kept once as nova_avatar_original.png next to it (never overwritten).
- Eyes are found automatically: bright light-blue pixels in the middle of the picture, plus their glow.
  They are filled in (OpenCV inpainting) from the dark core around them.
- If the picture has no real transparency (a "fake" grey/white checkerboard painted in), everything
  outside the round logo is made transparent.
- The result is saved at 256 x 256 px (plenty for an 84 px button on sharp screens, small to load).
"""
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
DEFAULT = ROOT / "app" / "static" / "nova_avatar.png"
OUT_SIZE = 256


def eye_mask(bgr):
    """Light-blue eye pixels in the centre of the picture, grown to cover their glow."""
    h, w = bgr.shape[:2]
    b, g, r = [bgr[..., i].astype(int) for i in range(3)]
    blue = (b > 150) & (g > 120) & (b - r > 40)
    box = np.zeros_like(blue)
    box[int(h * .38):int(h * .64), int(w * .30):int(w * .70)] = True   # eyes are near the centre only
    m = (blue & box).astype(np.uint8) * 255
    # the inner "door" of each eye is dark: fill the holes so the whole eye is covered
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cnts = [c for c in cnts if cv2.contourArea(c) > (w * h) * 0.0004]      # drop single stray pixels
    m = np.zeros_like(m)
    for c in cnts:
        x, y, cw, ch = cv2.boundingRect(c)
        cv2.rectangle(m, (x, y), (x + cw, y + ch), 255, -1)
    glow = max(3, int(w * 0.03))
    return cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * glow + 1, 2 * glow + 1))), len(cnts)


def round_alpha(h, w):
    """Soft round mask for pictures that have no real transparency."""
    yy, xx = np.mgrid[:h, :w]
    d = np.hypot(xx - w / 2, yy - h / 2) / (min(h, w) / 2)
    return (np.clip((0.90 - d) / 0.04, 0, 1) * 255).astype(np.uint8)


def main(src, dst):
    src, dst = Path(src), Path(dst)
    img = cv2.imread(str(src), cv2.IMREAD_UNCHANGED)
    if img is None:
        sys.exit(f"could not read {src}")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGRA)
    bgr = img[..., :3].copy()
    alpha = img[..., 3] if img.shape[2] == 4 else None
    if alpha is None or alpha.min() > 250:          # no real transparency: cut the round logo out
        h, w = bgr.shape[:2]
        alpha = round_alpha(h, w)
        # painted checkerboard between the outer wave rings: grey/white, no colour -> transparent
        hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
        yy, xx = np.mgrid[:h, :w]
        outer = np.hypot(xx - w / 2, yy - h / 2) > min(h, w) * 0.36
        grey = (hsv[..., 1] < 30) & (hsv[..., 2] > 150) & outer
        alpha[grey] = 0
        alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
        print("no transparency found: made the background around the round logo transparent")

    m, n = eye_mask(bgr)
    print(f"found {n} eye shape(s)")
    if n == 0:
        print("nothing to remove (already clean?)")
    else:
        bgr = cv2.inpaint(bgr, m, max(5, int(bgr.shape[1] * 0.02)), cv2.INPAINT_TELEA)
        # inpainting can leave a faint blue haze: pull the filled area towards the dark core colour
        ring = cv2.dilate(m, np.ones((9, 9), np.uint8)) & ~m
        core = np.median(bgr[ring > 0], axis=0) if ring.any() else np.array([60, 35, 15])
        k = cv2.GaussianBlur(m.astype(np.float32) / 255, (0, 0), bgr.shape[1] * 0.01)[..., None]
        bgr = (bgr * (1 - 0.6 * k) + core * 0.6 * k).astype(np.uint8)

    out = cv2.merge([*cv2.split(bgr), alpha])
    out = cv2.resize(out, (OUT_SIZE, OUT_SIZE), interpolation=cv2.INTER_AREA)
    if src.resolve() == dst.resolve():
        backup = src.with_name(src.stem + "_original" + src.suffix)
        if not backup.exists():
            shutil.copy2(src, backup)
            print(f"original kept as {backup.name}")
    cv2.imwrite(str(dst), out)
    print(f"saved {dst} ({OUT_SIZE}x{OUT_SIZE})")


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0] if a else DEFAULT, a[1] if len(a) > 1 else (a[0] if a else DEFAULT))
