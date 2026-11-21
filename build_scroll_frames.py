"""Build the home-page hero frames: pumpjack downstroke, then a camera dive down the wellbore.

   python build_scroll_frames.py

Frames 1-40   one pumpjack downstroke from pumpjack.mp4 (beam highest = video frame 46,
              beam lowest = video frame 93).
Frames 41-95  a 16:9 window sliding from the top to the bottom of assets/extended_oilfield.jpg
              (surface -> soil -> shale -> sandstone -> reservoir), with ease-in-out.
              Frames 29-40 ease the video into the image's framing (it is the same scene,
              ~1.2x zoomed). The image's own pumpjack has its beam UP, so the last video
              frame (beam DOWN) is pasted over the image top and blended into the ground:
              the dive starts on exactly the picture the video ended on.

Output: app/static/frames/frame_0001.webp ... frame_0095.webp (1920x1080, WebP) and
        app/static/frames/manifest.json (frame counts + where each rock layer is),
        which the page reads to drive the depth gauge and layer labels.
Both sources are low resolution, so frames are upscaled (Lanczos) and lightly sharpened.
"""
import json
import shutil
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).parent
VIDEO = ROOT / "pumpjack.mp4"
SECTION = ROOT / "assets" / "extended_oilfield.jpg"
OUT = ROOT / "app" / "static" / "frames"

W, H, QUALITY = 1920, 1080, 88
SHARPEN, SHARPEN_SIGMA = 0.6, 1.4          # unsharp mask (0 = off)
V_START, V_END, V_COUNT = 46, 93, 40       # pumpjack: highest -> lowest beam position
PAN_COUNT, FADE = 55, 0                    # wellbore dive frames, extra cross-fade frames (0 = none needed)
ALIGN_OVER = 12                            # last video frames that ease into the image's framing
SEAM = (760, 1000)                         # rows (1920-wide image) where the video top blends into the rock
WATERMARK_TRIM = 0.0                       # fraction cut from the bottom (0.02 if a watermark shows)

# Rows in the ORIGINAL cross-section image (506 x 1024). Measured by eye on the picture.
SRC_H = 1024
WELLHEAD_Y, TD_Y = 215, 925                # ground surface at the well, bottom of the well
LAYERS = [                                 # key, top row, bottom row
    ("soil", 340, 520),
    ("shale", 520, 650),
    ("sand", 650, 785),
    ("res", 785, 1024),
]
WELL_X = 0.405                             # wellbore position across the picture (fraction of width)


def sharpen(img):
    img = img.astype(np.float32)
    if SHARPEN:
        img = img + SHARPEN * (img - cv2.GaussianBlur(img, (0, 0), SHARPEN_SIGMA))
    return np.clip(img, 0, 255).astype(np.uint8)


def ease(t):                               # smooth start and stop (cubic ease-in-out)
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def video_frames():
    cap = cv2.VideoCapture(str(VIDEO))
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    if not frames:
        raise SystemExit(f"Could not read {VIDEO}")
    picks = np.linspace(V_START, V_END, V_COUNT).round().astype(int)
    return [sharpen(cv2.resize(frames[i], (W, H), interpolation=cv2.INTER_LANCZOS4)) for i in picks]


def load_section():
    src = cv2.imread(str(SECTION))
    if src is None:
        raise SystemExit(f"Could not read {SECTION}")
    if WATERMARK_TRIM:
        src = src[: int(src.shape[0] * (1 - WATERMARK_TRIM))]
    big_h = round(src.shape[0] * W / src.shape[1])
    return sharpen(cv2.resize(src, (W, big_h), interpolation=cv2.INTER_LANCZOS4)), src.shape[0]


def paste_surface(big, last_video):
    """Put the (aligned) last pumpjack frame over the top of the cross-section and blend it into
    the ground, so the dive starts on exactly the picture the video ended on (beam down)."""
    a, b = SEAM
    mask = np.clip((b - np.arange(H, dtype=np.float32)) / (b - a), 0, 1)[:, None, None]
    top = big[:H].astype(np.float32)
    big = big.copy()
    big[:H] = np.clip(last_video.astype(np.float32) * mask + top * (1 - mask), 0, 255).astype(np.uint8)
    return big


def pan_frames(big):
    big_h = big.shape[0]
    travel = big_h - H
    frames, centers = [], []
    for k in range(PAN_COUNT):
        y = round(travel * ease(k / (PAN_COUNT - 1)))
        frames.append(big[y:y + H])
        centers.append((y + H / 2) / big_h)        # centre of the view, as a fraction of the picture height
    return frames, centers


def align(vid, first_pan):
    """The cross-section image shows the same scene, a little zoomed in. Find that zoom/shift
    (feature matching), then ease the last video frames into it so the dissolve has no ghosting."""
    g = lambda f: cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
    orb = cv2.ORB_create(4000)
    ka, da = orb.detectAndCompute(g(vid[-1]), None)
    kb, db = orb.detectAndCompute(g(first_pan), None)
    m = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(da, db)
    pa = np.float32([ka[x.queryIdx].pt for x in m]); pb = np.float32([kb[x.trainIdx].pt for x in m])
    M, inl = cv2.estimateAffinePartial2D(pa, pb, ransacReprojThreshold=4)
    if M is None or inl.sum() < 40:
        print("could not align the video to the image; plain cross-fade")
        return vid
    print(f"alignment: zoom {M[0, 0]:.3f}, shift ({M[0, 2]:.0f}, {M[1, 2]:.0f}) px from {int(inl.sum())} matches")
    I = np.float32([[1, 0, 0], [0, 1, 0]])
    out = list(vid)
    for j in range(ALIGN_OVER):
        i = len(vid) - ALIGN_OVER + j
        t = ease((j + 1) / ALIGN_OVER)
        out[i] = cv2.warpAffine(vid[i], I + t * (M - I), (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return out


def main():
    vid = video_frames()
    big, src_h = load_section()
    vid = align(vid, big[:H])
    pan, centers = pan_frames(paste_surface(big, vid[-1]))
    last = vid[-1].astype(np.float32)
    for k in range(FADE):                          # dissolve from the pumpjack into the cross-section
        a = (k + 1) / (FADE + 1)
        pan[k] = np.clip(last * (1 - a) + pan[k].astype(np.float32) * a, 0, 255).astype(np.uint8)

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    total = 0
    for n, f in enumerate(vid + pan, 1):
        path = OUT / f"frame_{n:04d}.webp"
        Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)).save(path, "WEBP", quality=QUALITY, method=6)
        total += path.stat().st_size

    # rows -> fractions of the picture actually used (a bottom trim keeps the top rows where they were)
    scale = SRC_H / cv2.imread(str(SECTION)).shape[0]          # in case a higher-res image replaces it
    frac = lambda y: round(min(1.0, y / scale / src_h), 4)
    manifest = {
        "count": len(vid) + len(pan), "video": len(vid), "fade": FADE,
        "centers": [round(c, 4) for c in centers],
        "wellhead": frac(WELLHEAD_Y), "td": frac(TD_Y), "td_m": 2950, "well_x": WELL_X,
        "layers": [{"key": k, "top": frac(a), "bottom": frac(b)} for k, a, b in LAYERS],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"wrote {len(vid)} pumpjack + {len(pan)} wellbore frames to {OUT} ({total / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
