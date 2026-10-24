from PIL import Image, ImageOps, ImageDraw, ImageFont
import os

base = r'C:\Users\32485\Desktop\_项目\案屿\.design\benchmarks'
out = os.path.join(base, 'board.png')
items = [
    ('Conductor', 'conductor-workspace.png', '深色中性底；颜色只留给状态与代码差异', '#eae7e1'),
    ('Crystal', 'crystal-diff.png', '深蓝灰界面 + 一个蓝色主按钮；绿红只做 diff', '#eae7e1'),
    ('Vibe Kanban', 'vibe-workspaces-fixed.png', '白/浅灰中性界面；颜色只出现在代码与状态', '#eae7e1'),
    ('Linear · 2026 刷新', 'linear-borders.png', '更暖、更灰、更少边框；侧栏主动后退', '#eae7e1'),
]
W, H = 680, 400
gap = 24
label_h = 74
margin = 28
canvas_w = margin * 2 + W * 2 + gap
canvas_h = margin * 2 + (label_h + H) * 2 + gap
canvas = Image.new('RGB', (canvas_w, canvas_h), '#f6f5f2')
draw = ImageDraw.Draw(canvas)
f_title = ImageFont.truetype(r'C:\Windows\Fonts\msyhbd.ttc', 22)
f_sub = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', 14)
f_note = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', 12)

for i, (title, file, note, bg) in enumerate(items):
    col, row = i % 2, i // 2
    x = margin + col * (W + gap)
    y = margin + row * (H + label_h + gap)
    im = Image.open(os.path.join(base, file)).convert('RGB')
    im = ImageOps.fit(im, (W, H), method=Image.LANCZOS, centering=(0.5, 0.5))
    canvas.paste(im, (x, y))
    draw.rectangle([x, y, x + W, y + H], outline='#d7d4cc', width=1)
    draw.text((x + 2, y + H + 13), title, font=f_title, fill='#1b201e')
    draw.text((x + 2, y + H + 43), note, font=f_sub, fill='#5e6662')

footer = '参考：conductor.build/docs · github.com/cicero-im/crystal · vibekanban.com/docs · linear.app/now/behind-the-latest-design-refresh'
draw.text((margin, canvas_h - 22), footer, font=f_note, fill='#7a827e')
canvas.save(out)
print(out, canvas.size)
