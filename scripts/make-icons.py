#!/usr/bin/env python3
"""Generates the PWA icon set into web/public/icons/.

Run after changing the mark:  python3 scripts/make-icons.py
Requires Pillow.
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "web", "public", "icons")

BG_TOP = (11, 18, 32)
BG_BOTTOM = (26, 37, 64)
CYAN = (56, 189, 248)
TEAL = (94, 234, 212)
VIOLET = (167, 139, 250)

# Wind streaks as fractions of the canvas: (y, x_start, x_end, width, colour)
STREAKS = [
    (0.34, 0.20, 0.74, 0.075, CYAN),
    (0.50, 0.20, 0.86, 0.075, TEAL),
    (0.66, 0.20, 0.62, 0.075, VIOLET),
]

SS = 4  # supersampling factor for smooth edges


def capsule(draw, x0, y0, x1, y1, fill):
    """Rounded-end horizontal bar."""
    r = (y1 - y0) / 2
    draw.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=fill)


def render(size, *, bg=True, mono=False, inset=0.0):
    """inset shrinks the mark toward the centre (used for maskable safe zone)."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if bg:
        grad = Image.new("RGB", (1, s))
        gd = ImageDraw.Draw(grad)
        for y in range(s):
            t = y / max(1, s - 1)
            gd.point(
                (0, y),
                fill=tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)),
            )
        grad = grad.resize((s, s))

        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255
        )
        img.paste(grad, (0, 0), mask)

    scale = 1.0 - inset
    off = s * inset / 2

    for y, x0, x1, w, colour in STREAKS:
        fill = (255, 255, 255, 255) if mono else colour + (255,)
        capsule(
            d,
            off + x0 * s * scale,
            off + (y - w / 2) * s * scale,
            off + x1 * s * scale,
            off + (y + w / 2) * s * scale,
            fill,
        )

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ("icon-192.png", render(192)),
        ("icon-512.png", render(512)),
        # Maskable: content pulled into the central safe zone so Android can
        # crop it to a circle/squircle without clipping the mark.
        ("icon-512-maskable.png", render(512, inset=0.22)),
        # Badge: monochrome silhouette on transparent, per the Notifications spec.
        ("badge-72.png", render(72, bg=False, mono=True)),
    ]
    for name, img in jobs:
        path = os.path.join(OUT, name)
        img.save(path, "PNG", optimize=True)
        print(f"wrote {name} ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
