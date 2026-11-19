"""Turn a player photo into a Pantheon pixel portrait (face card art).

    python scripts/pixelPortrait.py in.png out.png [--size 40] [--colors 14] [--scale 8]
                                     [--eyes auto|off|X1,Y1,X2,Y2] [--bg "#1D428A"]

The look (2026-11-19, chosen against five other variants): square head-and-shoulders crop,
light contrast and sharpening, median-cut palette without dithering, a dark one-pixel outline
around the silhouette, and "soft eyes" drawn back in, because at 40 px plain downscaling
loses them: per eye one pupil (the face's own skin pushed 80% toward near-black) between two
muted ivory pixels, both eyes on one row and mirrored around the face centre so they never
look cross-eyed. OpenCV's Haar cascades find the face and eye row; `--eyes X1,Y1,X2,Y2`
(pixel coordinates in the OUTPUT grid) overrides them for photos the detector misreads.

Use photos you may publish (Wikimedia Commons CC BY / CC BY-SA, public domain) and credit the
author and licence; the NBA headshots in public/headshots are for local tests only.
Needs Pillow, numpy and opencv-python-headless<5 (OpenCV 5 dropped the Haar cascades).
"""
import argparse

import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

OUTLINE = (15, 10, 18, 255)
IVORY = (226, 218, 204)
INK = (30, 20, 16)


def mix(c, t, f):
    return tuple(int(c[i] + (t[i] - c[i]) * f) for i in range(3)) + (255,)


def detect_eyes(crop: Image.Image):
    """Two (x, y) eye centres in crop pixels, mirrored around the face centre, or None."""
    up = 4
    big = np.array(crop.convert('RGB').resize((crop.width * up, crop.height * up), Image.LANCZOS))[:, :, ::-1]
    gray = cv2.equalizeHist(cv2.cvtColor(big, cv2.COLOR_BGR2GRAY))
    faces = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    found = faces.detectMultiScale(gray, 1.1, 4, minSize=(60, 60))
    if len(found) == 0:
        return None
    x, y, w, h = max(found, key=lambda r: r[2] * r[3])
    eyes = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')
    e = eyes.detectMultiScale(gray[y:y + h // 2 + h // 8, x:x + w], 1.1, 3, minSize=(w // 10, w // 10))
    e = sorted(e, key=lambda r: -r[2] * r[3])[:2]
    cx, ey, half = x + w / 2, y + h * 0.42, w * 0.18
    if len(e) >= 1:
        ey = float(np.mean([y + r[1] + r[3] / 2 for r in e]))
    if len(e) == 2:
        half = abs((e[0][0] + e[0][2] / 2) - (e[1][0] + e[1][2] / 2)) / 2
        half = min(max(half, w * 0.14), w * 0.22)
    return [((cx - half) / up, ey / up), ((cx + half) / up, ey / up)]


def portrait(path: str, size: int = 40, colors: int = 14, eyes: str = 'auto') -> Image.Image:
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    side = min(w, int(h * 0.95))
    x0 = (w - side) // 2
    im = im.crop((x0, 0, x0 + side, side))

    rgb = ImageEnhance.Contrast(im.convert('RGB')).enhance(1.12).filter(ImageFilter.UnsharpMask(1.5, 90, 2))
    small = rgb.resize((size, size), Image.LANCZOS)
    alpha = im.getchannel('A').resize((size, size), Image.BOX).point(lambda v: 255 if v > 120 else 0)
    flat = small.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB')
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(flat, (0, 0), alpha)

    if eyes == 'auto':
        found = detect_eyes(im)
        pts = [(int(ex * size / side), int(ey * size / side)) for ex, ey in found] if found else None
    elif eyes == 'off':
        pts = None
    else:
        v = [int(n) for n in eyes.split(',')]
        pts = [(v[0], v[1]), (v[2], v[3])]
    if pts:
        px = out.load()
        skin = px[(pts[0][0] + pts[1][0]) // 2, min(size - 1, pts[0][1] + 3)][:3]
        g = sum(skin) // 3
        white, pupil = mix((g, g, g), IVORY, 0.72), mix(skin, INK, 0.8)
        for cx, cy in pts:
            if 1 <= cx < size - 1 and 0 <= cy < size:
                px[cx - 1, cy], px[cx, cy], px[cx + 1, cy] = white, pupil, white

    a = alpha.load()
    framed = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    f = framed.load()
    for yy in range(size):
        for xx in range(size):
            if a[xx, yy] == 0 and any(
                0 <= xx + dx < size and 0 <= yy + dy < size and a[xx + dx, yy + dy]
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            ):
                f[xx, yy] = OUTLINE
    framed.alpha_composite(out)
    return framed


def main():
    ap = argparse.ArgumentParser(description='Photo -> Pantheon pixel portrait')
    ap.add_argument('input')
    ap.add_argument('output')
    ap.add_argument('--size', type=int, default=40)
    ap.add_argument('--colors', type=int, default=14)
    ap.add_argument('--scale', type=int, default=8, help='nearest-neighbour upscale of the saved PNG')
    ap.add_argument('--eyes', default='auto', help='auto | off | X1,Y1,X2,Y2 in output-grid pixels')
    ap.add_argument('--bg', default=None, help='fill colour behind the portrait, e.g. "#1D428A"')
    args = ap.parse_args()
    img = portrait(args.input, args.size, args.colors, args.eyes)
    if args.bg:
        back = Image.new('RGBA', img.size, args.bg)
        back.alpha_composite(img)
        img = back
    img.resize((args.size * args.scale, args.size * args.scale), Image.NEAREST).save(args.output)


if __name__ == '__main__':
    main()
