# 案屿 · 三个前端方向小样

这是方向初稿，不是最终视觉。三个文件使用同一份真实内容与同一组数据，只换视觉语言和页面结构，方便横向比较后再选一个继续。

**已选：B 的结构 × A 的配色。** 第一版合版在 `04-bxA.html`，但配色被反馈“过绿、用力过猛”；随后按相邻产品的中性化做法收了两版：

- `05-bxA-neutral.html`：暖中性纸 + 墨色主操作；苔绿只做进行中状态与品牌。推荐先看这版。
- `06-bxA-cool.html`：冷中性纸 + 墨色主操作；进行中改蓝灰，苔绿只留在品牌标记。

合版截图见 `screenshots/04-bxA-1440.png`、`screenshots/05-bxA-neutral-1440.png`、`screenshots/06-bxA-cool-1440.png`；为什么改和参考了谁，见 `benchmarks/README.md`。

**05 已落地生产前端。** 生产截图在 `screenshots/production-overview-1440.png`、`production-overview-390.png`、`production-detail-1440.png`、`production-detail-390.png`。

**2026-10-24 手感修整：** 详情页顶部改为项目身份区 + 工具条，“修改路径 / 建工作区 / 移出看板”从页底移到项目顶部；控件高度、hover/按下/焦点反馈、字号层级与数字排版统一。顶部截图见 `screenshots/production-detail-top-1440.png`，移出确认见 `screenshots/production-remove-dialog-1440.png`。

**2026-10-24 阅读与可点击修整：** 界面切到 `Noto Sans SC`，长文切到 `Noto Serif SC`（16.5px / 1.9 / 46em）；工具条、分区操作、面包屑、下一步、子工作区行都补了静止可见的边框、箭头或铅笔提示。截图见 `screenshots/production-detail-top-1440.png`、`production-overview-fold-1440.png`、`production-hover-utility-1440.png`、`production-focus-1440.png`、`production-reading-1440.png`。

**2026-10-24 字号设置与动效：** 默认基础字号提到 17.5px，新增 `Aa` 显示设置（标准 17.5 / 大 19 / 特大 20.5，localStorage 持久化）；按钮改为纸键硬边 + 上浮/按下，Tab 下划线、卡片入场、弹窗与 notice 补了短动效。截图见 `screenshots/production-settings-standard-1440.png`、`production-settings-large-1440.png`、`production-settings-390.png`、`production-xlarge-320.png`。

**2026-10-24 面包屑按钮：** 详情页「← 项目交接单」从小号文字链接改为纸键按钮，保留面包屑语义；截图见 `screenshots/production-detail-top-1440.png`。

**2026-10-24 工作留痕排序：** 界面按日期倒序显示留痕，原文保持追加顺序；原文非单调时提示已校准，不自动改写文件。截图见 `screenshots/production-history-1440.png`。

**2026-10-24 工具栏、卡片视图与折叠：** 「只看久未更新」移入 `···` 菜单；右侧新增列表/卡片图标切换（localStorage `isle.project-view`）；`···` 与刷新按钮统一为纸键；详情摘要/留痕/Git 默认收起，用 chevron 图标展开。截图见 `screenshots/production-view-cards-1440.png`、`production-more-menu-1440.png`、`production-collapsed-1440.png`。

**2026-10-24 主按钮立体感：** 墨色主按钮补顶部棱边、3px 硬边、软投影与按下内阴影；截图见 `screenshots/production-header-actions-1440.png`、`production-primary-actions-1440.png`。

**2026-10-24 Letterpress 全站压印纸：** 全站统一为「凸起 / 压凹 / 盖章 / 平面」四态；纸纤维、纸片硬边、输入内凹、品牌与状态盖章；正文和导航保持平面。规范见 `letterpress.md`，截图见 `screenshots/production-letterpress-overview-1440.png`、`production-letterpress-cards-1440.png`、`production-letterpress-detail-1440.png`、`production-letterpress-modal-1440.png`、`production-letterpress-mobile-390.png`。

**2026-10-25 下一步单句化：** `next` 只展示第一句、50 字内，去掉 Markdown；原文保留在 tooltip/编辑框，超长或含格式时详情给「建议精简」。`src/next.ts` 新增 5 项测试。

打开 `index.html` 看选择页，或直接打开下面三个单文件。每个文件都可以切换项目、打开“交接”弹窗；其余未接入的流程只给诚实提示。

## 三个方向

| | A · 海图 | B · 交接单 | C · 夜航 |
|---|---|---|---|
| 文件 | `01-chart.html` | `02-slip.html` | `03-nightwatch.html` |
| 隐喻 | 图上标记下一段航程 | 待签的纸质交接单 | 夜间值班的驾驶舱 |
| 结构 | 左侧索引 + 大号“下一步” + 其余项目行 | 横向单据列表，状态盖章，右侧动作 | 左侧项目流 + 右侧常驻当前项目 |
| 字体 | 宋体/SimSun 标题 + 雅黑正文 + 等宽元信息 | SimHei 标题 + 雅黑正文 + 等宽数据 | Bahnschrift/雅黑标题 + 等宽数据 |
| 底色 | 冷纸绿 `#eef1ea` | 表单纸 `#f1eee6` | 深墨 `#0b1416` |
| 主色 | 墨绿 `#17363b` / 青 `#2f6b60` / 陶土红 `#a3472f` | 钴蓝 `#1c3fd0` / 墨 `#14171a` / 琥珀 `#855000` | 琥珀 `#e2a65a` / 纸白 `#ece7d8` / 青绿 `#86b9a2` |
| 适合 | 想保留“安静、编辑感”，接受一个明显更大的标题 | 想把“交接”这件事做得像工作流程，信息密度高 | 想强调“当前项目”，接受深色与更强的空间分区 |

## 共同处理的旧问题

- 正文 14–15px，标签与元信息最小 12px；不再出现 10px 灰字。
- 三个方向的实测文字对比度均 ≥4.5:1（最小约 4.9:1）。
- 不再用同一种圆角卡片装所有内容：A 用索引与横线，B 用单据与虚线，C 用两侧分栏。
- “下一步”成为版面主角，而不是卡片里的一行小字。
- 只保留一个“交接”入口；弹窗里再分成“收工回写 / 开工交接”，不再同时出现开工词、短指令、交给新 Agent 四种叫法。
- 任务不再使用看起来能点的假复选框；C 里用状态点，A/B 里只显示未完成数量。
- 计数统一为“6 个项目 / 8 个工作区 / 1 个待检查”；术语统一为项目（仓库）与工作区（worktree）。
- 没有加入逐段入场动效；只保留必要的 hover/focus 过渡，并尊重 `prefers-reduced-motion`。

## 交互范围

- A：点击左侧索引或下方项目行，切换上方“下一步”；点击“交接”打开弹窗。
- B：状态筛选可用；每张单据的“交接”打开弹窗；组内子工作区可单独交接。
- C：点击左侧任意项目或子工作区，更新右侧当前项目；点击“交接”打开弹窗。
- 三个弹窗都可在“收工回写 / 开工交接”之间切换，并生成对应文字；“复制文字”会尝试写入剪贴板，失败时选中文本。
- “添加项目”“重新指向”“移出看板”只做提示，未接真实流程。

## 文件

- `index.html`：选择页
- `01-chart.html` / `02-slip.html` / `03-nightwatch.html`：三个单文件小样
- `04-bxA.html`：第一版合版（B 结构 × A 配色，偏绿）
- `05-bxA-neutral.html`：配色修订，暖中性纸
- `06-bxA-cool.html`：配色修订，冷灰
- `benchmarks/board.png`：四个相邻产品的参照板
- `benchmarks/README.md`：市场参照与结论
- `screenshots/compare-palettes.png`：04 / 05 / 06 并排
- `screenshots/compare.png`：三方向并排比较
- `screenshots/04-bxA-1440.png`：合版桌面截图
- `screenshots/*-1440.png`：桌面截图
- `screenshots/*-390.png`：手机截图
- `screenshots/report.json`：渲染检查数据
- `shoot.mjs`：截图脚本

## 检查结果

用 Edge headless 在 1440×900 与 390×844 下渲染：

- 六个文件都没有控制台错误、没有横向溢出；
- 最小文字 12px，正文 14–15px；
- 可点击元素没有小于 24px 的；
- 桌面首屏分别高 1105 / 1267 / 900 / 1267 / 1267 / 1267px，手机完整页高 1517 / 2076 / 1650 / 2076 / 2076 / 2076px；
- 合版与两版配色修订的文字对比度均 ≥4.6:1；
- 所有内容为静态示意数据，没有读取或修改真实 `TASKS.md`。

## 选定之后

结构已定为 B；配色在 05（暖中性纸）与 06（冷灰）中选一版，或继续微调。选定后进入正式实现：把它拆成 React 组件与 CSS 模块，补齐真实项目切换、添加/重新指向、Agent 名单、空态与错误态，并按现有测试与构建流程验收。配色未定前不改 `src/`。
