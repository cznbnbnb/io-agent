"""Render the owned iO mark. Pillow is needed only when regenerating these assets."""
from pathlib import Path

from PIL import Image, ImageDraw


def main():
    output = Path(__file__).resolve().parents[2] / 'rebuild/android-app/branding'
    output.mkdir(parents=True, exist_ok=True)
    # The 66px-wide mark fits the centre of the existing 108px launcher canvas.
    # Use geometry rather than a font so every build uses the same letterforms.
    (output / 'launcher.svg').write_text('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">
  <title>iO Agent</title>
  <rect width="108" height="108" rx="24" fill="#008B72"/>
  <circle cx="26" cy="34" r="5" fill="#B4F8E4"/>
  <rect x="22" y="48" width="8" height="30" rx="4" fill="#FFFFFF"/>
  <circle cx="62" cy="56" r="21" fill="none" stroke="#FFFFFF" stroke-width="8"/>
</svg>
''', encoding='utf-8')
    scale = 16
    canvas = Image.new('RGBA', (108 * scale, 108 * scale))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((0, 0, 108 * scale - 1, 108 * scale - 1),
                           radius=24 * scale, fill='#008B72')
    draw.ellipse((21 * scale, 29 * scale, 31 * scale, 39 * scale), fill='#B4F8E4')
    draw.rounded_rectangle((22 * scale, 48 * scale, 30 * scale, 78 * scale),
                           radius=4 * scale, fill='#FFFFFF')
    draw.ellipse((37 * scale, 31 * scale, 87 * scale, 81 * scale), fill='#FFFFFF')
    draw.ellipse((45 * scale, 39 * scale, 79 * scale, 73 * scale), fill='#008B72')
    for size in (48, 72, 96, 144, 192):
        canvas.resize((size, size), Image.Resampling.LANCZOS).save(
            output / f'launcher-{size}.png', optimize=True)


if __name__ == '__main__':
    main()
