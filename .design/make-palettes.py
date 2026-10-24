import re

base = open('04-bxA.html', encoding='utf-8').read()

common = base
# Neutral chrome: primary actions are ink, not the status color.
common = common.replace(
    '  .add{border:1px solid var(--blue);background:var(--blue);color:#fff;padding:11px 18px;font-size:14px;cursor:pointer;}\n  .add:hover{background:var(--blue-dark);border-color:var(--blue-dark);}',
    '  .add{border:1px solid var(--action);background:var(--action);color:var(--sheet);padding:11px 18px;font-size:14px;cursor:pointer;}\n  .add:hover{background:var(--action-2);border-color:var(--action-2);}'
)
common = common.replace(
    '  .tabs button[aria-pressed="true"]{color:var(--ink);border-bottom-color:var(--blue);font-weight:600;}',
    '  .tabs button[aria-pressed="true"]{color:var(--ink);border-bottom-color:var(--ink);font-weight:600;}'
)
common = common.replace(
    '  .handoff{border:1px solid var(--blue);background:var(--blue);color:#fff;padding:8px 16px;font-size:14px;cursor:pointer;}\n  .handoff:hover{background:var(--blue-dark);border-color:var(--blue-dark);}',
    '  .handoff{border:1px solid var(--action);background:var(--action);color:var(--sheet);padding:8px 16px;font-size:14px;cursor:pointer;}\n  .handoff:hover{background:var(--action-2);border-color:var(--action-2);}'
)
common = common.replace(
    '  .phase button[aria-pressed="true"]{color:var(--ink);border-bottom-color:var(--blue);font-weight:600;}',
    '  .phase button[aria-pressed="true"]{color:var(--ink);border-bottom-color:var(--ink);font-weight:600;}'
)
common = common.replace('  .mini:hover{border-color:var(--blue);color:var(--blue);}', '  .mini:hover{border-color:var(--ink);color:var(--ink);}')

# Variant 1: warm neutral, sage only for state, ink actions.
warm = common
warm = warm.replace('--paper:#eef1ea;', '--paper:#f3f2ed;')
warm = warm.replace('--sheet:#f7f8f3;', '--sheet:#fbfaf6;')
warm = warm.replace('--ink:#17363b;', '--ink:#1d2522;')
warm = warm.replace('--ink-2:#2b4a4e;', '--ink-2:#39423e;')
warm = warm.replace('--muted:#5b6b69;', '--muted:#646b67;')
warm = warm.replace('--line:#c8d1c6;', '--line:#dcdad2;')
warm = warm.replace('--line-dark:#aab6a9;', '--line-dark:#c5c2b7;')
warm = warm.replace('--blue:#2f6b60;', '--blue:#4f7667;')
warm = warm.replace('--blue-dark:#245349;', '--blue-dark:#3e5e52;')
warm = warm.replace('--blue-soft:#e4ebe1;', '--blue-soft:#e5eae3;')
warm = warm.replace('--amber:#8a6b32;', '--amber:#8a6b32;')
warm = warm.replace('--red:#a3472f;', '--red:#a94a2f;')
warm = warm.replace('  --sans:', '  --action:#1d2522;\n  --action-2:#2e3a34;\n  --sans:')
warm = warm.replace('  .brand svg{width:30px;height:30px;flex:none;}', '  .brand svg{width:30px;height:30px;flex:none;color:var(--blue);}')
warm = warm.replace('<title>案屿 · 方向 B×A · 交接单 / 海图配色</title>', '<title>案屿 · 方向 B×A · 中性纸 / 苔绿只做状态</title>')
warm = warm.replace('方向 B×A · 交接单 × 海图', '方向 B×A · 中性纸 / 苔绿只做状态')

# Variant 2: cool neutral, blue-grey state, sage only the mark.
cool = common
cool = cool.replace('--paper:#eef1ea;', '--paper:#f2f4f3;')
cool = cool.replace('--sheet:#f7f8f3;', '--sheet:#fbfcfb;')
cool = cool.replace('--ink:#17363b;', '--ink:#1b2321;')
cool = cool.replace('--ink-2:#2b4a4e;', '--ink-2:#38423f;')
cool = cool.replace('--muted:#5b6b69;', '--muted:#5f6966;')
cool = cool.replace('--line:#c8d1c6;', '--line:#d9ddda;')
cool = cool.replace('--line-dark:#aab6a9;', '--line-dark:#c2c8c4;')
cool = cool.replace('--blue:#2f6b60;', '--blue:#4c6f86;')
cool = cool.replace('--blue-dark:#245349;', '--blue-dark:#3b5a6e;')
cool = cool.replace('--blue-soft:#e4ebe1;', '--blue-soft:#e6ecef;')
cool = cool.replace('--amber:#8a6b32;', '--amber:#8a6b32;')
cool = cool.replace('--red:#a3472f;', '--red:#a94a2f;')
cool = cool.replace('  --sans:', '  --action:#1b2321;\n  --action-2:#2c3733;\n  --sage:#4f7667;\n  --sans:')
cool = cool.replace('  .brand svg{width:30px;height:30px;flex:none;}', '  .brand svg{width:30px;height:30px;flex:none;color:var(--sage);}')
cool = cool.replace('<title>案屿 · 方向 B×A · 交接单 / 海图配色</title>', '<title>案屿 · 方向 B×A · 冷灰 / 苔绿只留在标识</title>')
cool = cool.replace('方向 B×A · 交接单 × 海图', '方向 B×A · 冷灰 / 苔绿只留在标识')

open('05-bxA-neutral.html', 'w', encoding='utf-8').write(warm)
open('06-bxA-cool.html', 'w', encoding='utf-8').write(cool)
print('written')
