# 方向确认

- 日期：2026-10-24
- 产品：案屿
- 状态：05 · 中性纸已确认；开始生产实现（B 结构 + 05 色板）

## 用户选择（原话）

> 喜欢方案B的结构，倾向于A的配色。

随后配色反馈：

> 目前的这套色板还是有些过于单一了，过绿了，我只是需要有这个意思，现在有点用力过猛。

最终选择：

> 05 · 中性纸 确实不错

## 依据

三版初稿：

- A · 海图：`.design/01-chart.html`，截图 `screenshots/01-chart-1440.png`
- B · 交接单：`.design/02-slip.html`，截图 `screenshots/02-slip-1440.png`
- C · 夜航：`.design/03-nightwatch.html`，截图 `screenshots/03-nightwatch-1440.png`
- 并排比较：`screenshots/compare.png`

## 收敛决定

- 采用 B 的页面结构：横向交接单、左侧状态盖章、中间下一步、右侧交接动作、虚线分区、状态筛选、组内子工作区。
- 采用 A 的色板：冷纸绿 `#eef1ea`、纸面 `#f7f8f3`、墨绿 `#17363b`、青绿 `#2f6b60`、陶土红 `#a3472f`；暂停用橄榄 `#8a6b32`，离线用灰 `#7e837f`。
- 字体仍沿用 B：SimHei 标题、雅黑正文、等宽元信息。未擅自把 A 的宋体叠进来；用户只是选了配色。
- 交互沿用 B：状态筛选、每张单据独立交接、收工回写 / 开工交接弹窗、复制文字。
- 合版文件：`.design/04-bxA.html`
- 合版截图：`screenshots/04-bxA-1440.png`、`screenshots/04-bxA-390.png`、`screenshots/04-bxA-dialog-1440.png`

## 配色修订（2026-10-24）

参考了四个相邻产品（见 `benchmarks/README.md`，图 `benchmarks/board.png`）：

- Conductor：深炭黑，颜色只给状态与 diff。
- Crystal：深蓝灰，蓝色只做一个主按钮，绿/红只做 diff。
- Vibe Kanban：白/浅灰应用界面，颜色只给代码差异与状态。
- Linear 2026 刷新：默认主题改暖灰、降饱和，侧栏后退、边框变软。

共同点：界面本身接近无色；一个强调色；状态色与注意力色分开。当前 04 的问题不是“绿不对”，而是绿同时做了纸、字、按钮、印章、边线五种角色。

修订方案：

- `05-bxA-neutral.html`：暖中性纸 + 墨色主操作；苔绿只做进行中印章/左线与品牌；陶土红只做待检查/久未更新。
- `06-bxA-cool.html`：冷中性纸 + 墨色主操作；进行中改蓝灰；苔绿只留在品牌标记。
- 比较图：`screenshots/compare-palettes.png`
- 市场参照板：`benchmarks/board.png`

## 生产落地结果（2026-10-24）

已完成：

- `src/main.tsx`：去掉左侧栏与顶部日期条，改为顶部品牌/标题/操作 + 状态筛选条 + 横向交接单列表；多工作区显示为主单 + 子行；离线单独立状态；任务清单用状态标记替代假复选框。
- `src/App.module.css`：追加 05 色板与 B 结构样式，覆盖总览、详情、弹窗；主操作改为墨色，苔绿只做进行中/品牌，陶土红只做提醒。
- `index.html` / `public/favicon.svg`：主题色与站点图标同步为中性纸版本。
- 计数口径修正：标签页统计项目组数（全部 6 / 进行中 4 / 暂停 1 / 离线 1），顶部统计 6 个项目 / 8 个工作区 / 1 个待检查；已完成单独折叠。
- Skill 就绪时按钮改为“重新检查”，修复“已就绪。就绪后……”重复文案；Agent 名单提示从“侧栏”改为“页头”。

验证：

- `npm run check` 通过；
- `npm test` 38 项通过；
- `npm run build` 通过；
- 生产构建（非 dev）在 1440 / 390 检查：无控制台错误、无横向溢出、可见文字最小 12px、可点击目标无小于 24px；
- 截图：`screenshots/production-overview-1440.png`、`production-overview-390.png`、`production-detail-1440.png`、`production-detail-390.png`。

仍未做：

- 详情页的摘要/留痕/Git 默认折叠与粘性“下一步”栏；
- 50 个项目下的搜索与更强筛选；
- 任务勾选回写（当前仍保持只读，使用状态标记而不是可点击复选框）；
- 真实用户验收与跨 Agent 交接复测。

## 手感修整（2026-10-24 第二轮）

用户反馈：

> 修改路径 / 建工作区 / 移出看板 这些在页面最下面的按钮我建议挪到项目的最上方一块。然后页面的按钮，字体什么的手感观感还是一般般。作为一个看板。这些体验一定要做好

处理：

- 详情页顶部改为项目身份区：状态章 + 相对时间 + 项目名 + 路径；右侧只留“交给新 Agent / 收工回写”两个主操作。
- 紧接一条项目工具条：左侧“添加已有工作区 / 刷新记录”，右侧“修改路径 / 建工作区 / 移出看板”；底部旧按钮删除。
- “移出看板”改为确认弹窗，明确不删除项目目录与 `TASKS.md`；顶部误触不会直接移除。
- 控件统一：主/次按钮 38px，小按钮 30px，文字按钮 28px；统一 hover、按下位移与 disabled 颜色；图标按 15 / 14 / 18px 三档；焦点环 2px。
- 字体层级：页面、项目、单据标题保留 SimHei（第三轮已改为 Noto Sans SC）；分区标题改用雅黑粗体，正文 15px/1.68，任务 15.5px，详情“下一步”23px；数字统一等宽。
- 看板整卡可点进入详情，按钮与链接不触发；卡片 hover 加轻投影。
- 页头与内容左缘在 1440 下对齐（均为 170px）；详情页用面包屑替代重复的大标题。
- 截图：`screenshots/production-overview-fold-1440.png`、`production-detail-top-1440.png`、`production-remove-dialog-1440.png`、`production-detail-390.png`。

验证：

- `npm run check`、`npm test`（38 项）、`npm run build` 通过；
- 生产构建在 1440 / 390：无控制台错误、无横向溢出、可见文字最小 12px、可点击目标无小于 24px；
- “修改路径 / 建工作区 / 移出看板”均在顶部工具条打开对应弹窗；
- 整卡点击可进入项目详情，交接按钮仍独立打开交接弹窗。

## 阅读与可点击修整（2026-10-24 第三轮）

用户反馈：

> 按钮的触感不太对，很多地方能点击的地方没有体现出可以点击的意思。此外字体依旧不是适合阅读的样子。

判断：

- 静止状态无边框/底色/下划线的文字动作太多：工具条、分区操作、面包屑、Agent 名单、下一步、子工作区行都靠 hover 才暴露。
- 字体栈是 SimHei 标题 + 雅黑 15px；SimHei 没有真正粗体，长文满宽一行六七十个汉字。
- 本机已安装 `Noto Sans SC` / `Noto Serif SC`，可直接用系统字体，不联网、不打包。

处理：

- 字体：界面切到 `Noto Sans SC`，长文（交接摘要、工作留痕、Markdown）切到 `Noto Serif SC` 16.5px / 1.9，栏宽 46em（实测 759px）；正文/任务 15.5–16px；不再使用 SimHei。
- 控件：新增 `quietButton`（1px 边框、纸面底色、30px 高），工具条五个动作全部带图标；主/次按钮统一 2px 控件圆角、hover 底色、按下位移 + 内阴影；文字动作改为虚线下划线。
- 可点击信号：面包屑加 `←` + 下划线；Agent 名单改描边按钮 + 人员图标；交接单标题加常驻 `→`；下一步加铅笔“编辑”提示；子工作区行加 chevron + hover 底色；详情“下一步”改为静态大字 + 右上“编辑”描边按钮。
- 深链：`修改路径` 打开“重新指向”，`建工作区` 打开“创建工作区”，`移出看板` 打开确认弹窗；整卡点击仍可进详情。
- 可访问性：焦点环 2px；移动端工具条 2×2 + 移出看板独占一行；320px 无溢出；可见文字最小 12px。

验证：

- `npm run check`、`npm test`（38 项）、`npm run build` 通过；
- 生产构建 1440 / 1024 / 390 / 320：无控制台错误、无横向溢出、可点击目标无小于 24px；
- `document.fonts.check` 命中 `Noto Sans SC` / `Noto Serif SC`；Markdown 计算宽度 759px、字号 16.5px、行高 31.35px；
- 静止可点击审计返回空数组；Tab 焦点落在“刷新记录”时 outline 为 `solid 2px`；
- 截图：`screenshots/production-overview-fold-1440.png`、`production-detail-top-1440.png`、`production-hover-utility-1440.png`、`production-focus-1440.png`、`production-reading-1440.png`、`production-detail-390.png`、`production-detail-320.png`。

## 字号设置与动效（2026-10-24 第四轮）

用户反馈：

> 目前可以进行一次git存档。然后呢，目前还有的问题是字体比较的小，希望可以调整大一些，甚至说提供一个设置来调整。其次就是界面的按钮 风格很朴素，感觉挺normal。最好就是可以看看能不能适当添加一些动效。让前端更生动一点点。

先存档：

- 提交 `e3690cb feat(web): 05 中性纸看板与阅读、可点击修整`，包含当时的 `src/`、`public/favicon.svg` 与 `.design/` 设计记录；`.dsh-ops/` 未入库。
- 本轮新改动默认未提交，保留工作区 diff 供确认。

字号：

- 默认基础字号从 15.5px 提到 17.5px；三档 `标准 17.5 / 大 19 / 特大 20.5`。
- 页头新增 `Aa` 按钮，打开「显示设置」；三张选项卡带 `Aa / 标签 / px`，选中即时生效。
- 选择写入 `localStorage` key `isle.text-size`；刷新保持，非法值回退标准；隐私模式不可用时不报错。
- 字号体系改为 `--app-font` + `calc()` token；正文 17.5、阅读 18.0、交接单下一步 19.1、详情下一步 25.0、分区标题 22.0，全部随设置缩放。
- 阅读栏宽改为 `min(46em, 900px)`；移动端取消上限。

按钮与触感：

- 纸键：1px 边框 + 3px 硬边 + 纸面渐变 + 内高光；hover 上浮 1px、硬边加高；active 下压并压掉硬边；主按钮墨色渐变 + 2px 深边。
- 危险按钮用陶土红描边/渐变；禁用时保留形状、去掉硬边。
- Tab 下划线改为 `::after` 从中心展开；刷新图标 hover 旋转 180°；卡片 hover 上浮 2px。
- 动效：看板卡片逐张 rise、详情区块依次 rise、Tab 下划线、弹窗淡入上移、notice 滑入；只动 transform/opacity，`prefers-reduced-motion` 下全部关闭。

验证：

- `npm run check`、`npm test`（38 项）、`npm run build` 通过；
- 字号：`standard` 计算 17.5px；切 `large` 19px 且 localStorage 写入；切 `xlarge` 20.5px；刷新后仍为 `xlarge`；
- 1440 / 1024 / 390 / 320：三档均无横向溢出；xlarge 320 无裁切、无可点目标 <24px；
- 动效：正常状态 slip `animationName` 为 rise、0.28s；模拟 reduced-motion 后为 `none` / `0s`；
- 可点击审计仍为空；无控制台错误；
- 截图：`screenshots/production-settings-standard-1440.png`、`production-settings-large-1440.png`、`production-settings-390.png`、`production-xlarge-320.png`、`production-overview-320.png`、`production-detail-top-1440.png`。

## 面包屑返回按钮（2026-10-24）

用户截图指出详情页顶部的「← 项目交接单」看起来像普通文字，不明显。

处理：

- 把面包屑返回从“带下划线的文字链接”改成纸键按钮：1px 边框、纸面渐变、3px 硬边、hover 上浮、active 下压。
- 保留 `← 项目交接单 / 当前项目` 的面包屑语义；按钮有 `title="返回项目交接单"`。
- 品牌区补 `title="返回项目总览"`，hover 时品牌名下划线，提示也可点。
- 移动端面包屑隐藏，仍保留 `← 返回总览`，不额外占用页头宽度。

验证：

- `npm run check`、`npm test`（38 项）、`npm run build` 通过；生产构建无控制台错误；
- 可点击审计仍为空；详情页 1440/390 无横向溢出；
- 截图：`screenshots/production-detail-top-1440.png`。
