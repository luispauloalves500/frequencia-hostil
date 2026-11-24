# Junta capturas antes/depois lado a lado: python3 tools/side-by-side.py
from PIL import Image, ImageDraw, ImageFont
import os
D = os.path.join(os.path.dirname(__file__), "..", "release", "screenshots", "perf")
try: font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 36)
except Exception: font = ImageFont.load_default()
for s in ["menu", "bilheteria", "praca", "embarque"]:
    a = Image.open(f"{D}/antes-{s}.jpg").convert("RGB"); b = Image.open(f"{D}/depois-{s}.jpg").convert("RGB")
    w, h = a.size; out = Image.new("RGB", (w * 2 + 12, h), (20, 20, 20))
    out.paste(a, (0, 0)); out.paste(b, (w + 12, 0))
    d = ImageDraw.Draw(out)
    for x, t in ((20, f"ANTES — {s}"), (w + 32, f"DEPOIS — {s}")):
        d.rectangle([x - 8, 14, x + 420, 64], fill=(0, 0, 0)); d.text((x, 20), t, fill=(255, 220, 120), font=font)
    out = out.resize((out.width // 2, out.height // 2), Image.LANCZOS)
    out.save(f"{D}/comparativo-{s}.jpg", quality=90); print("ok", s)
