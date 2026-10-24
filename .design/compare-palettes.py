from PIL import Image, ImageDraw, ImageFont
import os

base = r'C:\Users\32485\Desktop\_项目\案屿\.design'
shots = os.path.join(base, 'screenshots')
out = os.path.join(shots, 'compare-palettes.png')

items = [
    ('04', '当前合版', '04-bxA-1440.png', '#2f6b60', '绿做了所有角色'),
    ('05', '中性纸', '05-bxA-neutral-1440.png', '#4f7667', '暖灰底 / 墨按钮 / 苔绿只做状态'),
    ('06', '冷灰', '06-bxA-cool-1440.png', '#4c6f86', '冷灰底 / 蓝灰状态 / 苔绿只在标识'),
]
W, H = 460, 288
margin, gap, label_h = 24, 20, 62
canvas_w = margin * 2 + W * 3 + gap * 2
canvas_h = margin * 2 + label_h + H
canvas = Image.new('RGB', (canvas_w, canvas_h), '#f4f4f1')
draw = ImageDraw.Draw(canvas)
font_title = ImageFont.truetype(r'C:\Windows\Fonts\msyhbd.ttc', 21)
font_sub = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', 13)

for i, (code, name, file, color, note) in enumerate(items):
    x = margin + i * (W + gap)
    y = margin
    draw.rectangle([x, y + 6, x + 5, y + 28], fill=color)
    draw.text((x + 15, y), f'{code} · {name}', font=font_title, fill='#111614')
    draw.text((x + 15, y + 33), note, font=font_sub, fill='#5b6064')
    img = Image.open(os.path.join(shots, file)).convert('RGB')
    img = img.resize((W, H), Image.LANCZOS)
    canvas.paste(img, (x, y + label_h - 8))
    draw.rectangle([x, y + label_h - 8, x + W, y + label_h - 8 + H], outline='#d2d2cc', width=1)

canvas.save(out)
print(out, canvas.size)
