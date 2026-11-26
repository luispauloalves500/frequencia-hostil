# Junta dois prints lado a lado com rótulos: python3 tools/sbs.py antes.png depois.png saida.jpg [rótulo-antes] [rótulo-depois]
import sys
from PIL import Image, ImageDraw
a, b, out = sys.argv[1:4]
la = sys.argv[4] if len(sys.argv) > 4 else "antes"; lb = sys.argv[5] if len(sys.argv) > 5 else "depois"
A = Image.open(a).convert("RGB"); B = Image.open(b).convert("RGB")
W, H = A.size; C = Image.new("RGB", (W * 2 + 8, H)); C.paste(A, (0, 0)); C.paste(B.resize((W, H)), (W + 8, 0))
d = ImageDraw.Draw(C)
for x, t in ((0, la), (W + 8, lb)): d.rectangle([x, H - 34, x + 180, H], fill=(0, 0, 0)); d.text((x + 10, H - 24), t, fill=(255, 255, 255))
C.save(out, quality=85)
