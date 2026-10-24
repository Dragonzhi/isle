from PIL import Image, ImageDraw, ImageFont
import os

base = r'C:\Users\32485\Desktop\_项目\案屿\.design'
shots = os.path.join(base, 'screenshots')
out = os.path.join(shots, 'compare.png')

items = [
    ('A', '海图', '01-chart-1440.png', '#17363b'),
    ('B', '交接单', '02-slip-1440.png', '#1c3fd0'),
    ('C', '夜航', '03-nightwatch-1440.png', '#e2a65a'),
]
W, H = 460, 288
margin, gap, label_h = 24, 20, 52
canvas_w = margin * 2 + W * 3 + gap * 2
canvas_h = margin * 2 + label_h + H
canvas = Image.new('RGB', (canvas_w, canvas_h), '#f4f4f1')
draw = ImageDraw.Draw(canvas)
font_title = ImageFont.truetype(r'C:\Windows\Fonts\msyhbd.ttc', 22)
font_sub = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', 13)

for i, (code, name, file, color) in enumerate(items):
    x = margin + i * (W + gap)
    y = margin
    # color tick + code + name
    draw.rectangle([x, y + 7, x + 5, y + 29], fill=color)
    draw.text((x + 15, y + 2), f'{code} · {name}', font=font_title, fill='#111614')
    subtitle = {'A': '索引 + 衬线大标题', 'B': '横向交接单 + 盖章', 'C': '双栏值班台'}[code]
    draw.text((x + 15, y + 32), subtitle, font=font_sub, fill='#5b6064')
    img = Image.open(os.path.join(shots, file)).convert('RGB')
    img = img.resize((W, H), Image.LANCZOS)
    canvas.paste(img, (x, y + label_h - 8))
    draw.rectangle([x, y + label_h - 8, x + W, y + label_h - 8 + H], outline='#d2d2cc', width=1)

canvas.save(out)
print(out, canvas.size)
