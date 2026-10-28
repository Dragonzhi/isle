# Letterpress 压印纸 — 视觉风格提取

来源：`src/App.module.css`（2338 行，全文读完）+ `.design/letterpress.md` + 5 张 `production-letterpress-*.png`。数值逐字复制，「≈」为换算值。

**层叠读法**：文件是迭代追加的，后段覆盖前段。复刻只需 322–1027 的结构 + 1490–1525 的字号系统 + **1905–2338 的表面定义**。

| 行区间 | 内容 | 生效 |
| --- | --- | --- |
| 1–320 | 早期侧栏/项目卡/圆角布局（`.sidebar` `.projectGrid` `.projectCard`） | **已废弃**，生产不渲染 |
| 322–1027 | 「B × A / 05 中性纸」：纸色令牌、页头、交接单、详情 | 生效（局部被覆盖） |
| 1028–1489 | 手感修整：控件高度、按压反馈、衬线阅读栏 | 生效（局部被覆盖） |
| 1490–1780 | 字号三档 `--app-font`、纸键渐变、tab 下划线、动效 | 生效 |
| 1781–1904 | 视图切换、更多菜单、详情折叠 | 生效 |
| **1905–2338** | **Letterpress 最终层** | **最高优先级** |

---

## 1. 颜色令牌

`:root`（行 327–339）为全站唯一色源。

| Token | 值 | 角色 / 用在哪 |
| --- | --- | --- |
| `--paper` | `#f3f2ed` | 页面纸底：`.app` `.siteHeader` `.toolbar` |
| `--sheet` | `#fbfaf6` | 纸面：`.slip` `.contextCard` `.taskGroup` `.summaryCard` `.gitCard` `.notice` `.dialog` `.moreMenu` `.toast` `.emptyIsland` `kbd`，纸键渐变终点 |
| `--ink` | `#1d2522` | 主墨：标题、主按钮底、checkbox 选中、tab 下划线、`:selection` 底、页头/浮层边框、focus outline |
| `--ink-2` | `#39423e` | 次墨：`.markdown` 正文、纸键文字、`.notice`、`.gitMessage` |
| `--muted` | `#646b67` | 弱墨：全部 12px mono 元信息、未选中 tab、`--fs-meta` 组 |
| `--line` | `#dcdad2` | 细墨线 1px：`.slip` 边框、`.task` 下缘、`.tag` 边框、`kbd` 外框、表头格 |
| `--line-dark` | `#c5c2b7` | 深墨线：纸键 1px 边框、虚线分隔、`.crumb` 点线下划线、未完成章边框 |
| `--sage` | `#4f7667` | **苔绿（限三用）**：进行中章、品牌印、`.slip`/`.contextCard`/`.activeGroup` 左侧 3px 墨条、正文链接 |
| `--sage-dark` | `#3e5e52` | 品牌印 1px 描边 |
| `--rust` | `#a94a2f` | **陶土红（限危险）**：`.dangerButton` `.errorCard` `.formError` `.nextWarning` `.taskDelete` `.moreDot`、逾期 `.stale` |
| `--olive` | `#8a6b32` | 橄榄（暂停/提醒）：暂停章与左条、`.warnings` 文字、`.historyAdjusted` |
| `--offline` | `#7a817d` | 离线灰：离线章边框与左条 |

未建 token 但必须照抄的光学色：

| 值 | 用途 |
| --- | --- |
| `#f5f4ef` | `.slipDone` 底（比 paper 深半档） |
| `#e6e4db` | `.tag` `.focusBadge` `.taskGroup h3 small` 旧底（1905 层已改 `--lp-well`） |
| `#eae8e0` / `#ebe9e1` | **全站纸张 hover 底**（`.secondary` `.utilityButton` `.iconButton` `.quietButton` `.moreItem` `.doneToggle` / `.viewButton` `.sizeOptionActive`） |
| `#e9e8df` | `.emptyIsland` 旧底，1905 层改 `--sheet` |
| `#fbf5f1` / `#f4e6e0` | 警示纸常态 / hover：`.quietDanger` `.utilityDanger` `.nextWarning` `.taskDelete` |
| `#d8b9ad` | 红系 1px 边 + 2px 硬边：`.errorCard` `.noticeError` `.quietDanger` `.utilityDanger` `.nextWarning` |
| `#f7ede8` | 错误纸片底：`.errorCard` `.noticeError` |
| `#9d9789` | 输入类 hover 边框 |
| `#fdfcf8` → `#f3f2ec` | 纸键渐变两端（`linear-gradient(180deg,…)`） |
| `#3b4a41` / `#25312b` / `#161f1b` | 主墨键渐变三停（hover：`#45544b` / `#2b3831` / `#1a241f`） |
| `#c15c3f` / `#a94a2f` / `#8f3b24` | 危险键渐变三停（hover：`#c96648` / `#ae4d31` / `#933d26`） |
| `#0b110e` / `#0a0f0c` | 主键边框 / 3px 硬边（近黑，非纯黑） |
| `#5b2618` | 危险键边框与 3px 硬边 |
| `#c8c5bb` / `#61645f` | 主键 disabled 底 / 字 |
| `#93978f` | 次级类 disabled 文字 |
| `#73776f` | `::placeholder`（`opacity` 必须为 1） |
| `#efede5`（=`--lp-well`） | 压凹纸面：输入、代码、工具槽、空态、已完成组、表头 |

---

## 2. Letterpress 令牌（行 1911–1927，逐字）

```css
.app {
  --lp-edge: #b7b2a5;
  --lp-edge-strong: #a7a194;
  --lp-highlight: rgba(255, 255, 255, .78);
  --lp-well: #efede5;
  --lp-well-strong: #e8e5db;      /* 已定义，全文无引用 */
  --lp-raise-1: 0 2px 0 var(--lp-edge), 0 4px 10px rgba(29, 37, 34, .07), inset 0 1px 0 var(--lp-highlight);
  --lp-raise-2: 0 2px 0 var(--lp-edge), 0 8px 20px rgba(29, 37, 34, .06), inset 0 1px 0 rgba(255, 255, 255, .72);
  --lp-raise-3: 0 4px 0 var(--lp-edge), 0 26px 70px rgba(29, 37, 34, .24), inset 0 1px 0 var(--lp-highlight);
  --lp-press-1: inset 0 2px 4px rgba(29, 37, 34, .11), inset 0 -1px 0 var(--lp-highlight);
  --lp-press-2: inset 0 1px 2px rgba(29, 37, 34, .12), inset 0 -1px 0 rgba(255, 255, 255, .72);
  --lp-grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.035'/%3E%3C/svg%3E");
  background-color: var(--paper);
  background-image: var(--lp-grain);
  background-size: 180px 180px;
  background-blend-mode: multiply;
}
```

| 令牌 | 语义 | 使用者 |
| --- | --- | --- |
| `raise-1` | 纸片上的小浮件 | `.emptyIsland`、`.sizeOption`（`.editHint` 另有 1px 自写变体，非此 token） |
| `raise-2` | 纸片本体 | `.slip` `.contextCard` `.taskGroup` `.summaryCard` `.gitCard` `.notice` `.toast` |
| `raise-3` | 浮层 | `.dialog` `.moreMenu` |
| `press-1` | 大面积压凹 | 全部 input/textarea/select、`.markdown pre`、`.projectUtilities` `.empty` `.completedGroup` `.doneToggle` `.subList` `.warnings` `.sizePreview` `.taskDeleteTitle` |
| `press-2` | 小件压凹 | checkbox、`.moreCheck`、`.tag` `.focusBadge` `.focusTaskChip`、`.gitHash` `code`、`.markdown th` |

`--lp-grain` 解码：180×180 平铺 SVG，`fractalNoise` + `baseFrequency=.8` + `numOctaves=2` + `stitchTiles=stitch` + `feColorMatrix saturate 0`（去色），整层 `opacity=.035`。**只铺三处**：`.app`、`.siteHeader`/`.siteHeaderCompact`、`.toolbar`。

---

## 3. 排印

### 3.1 字族

| Token | 值 |
| --- | --- |
| `--sans` | `"Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", sans-serif` |
| `--serif` | `"Noto Serif SC", "Songti SC", "SimSun", serif` |
| `--mono` | `"Cascadia Mono", "Consolas", "SFMono-Regular", monospace` |
| `--head` | `var(--sans)`（标题并入无衬线；早期 `SimHei` 版被行 1282 覆盖） |

全局：`-webkit-font-smoothing: antialiased`、`text-rendering: optimizeLegibility`、`font-synthesis: none`、`-webkit-text-size-adjust: 100%`、`font-optical-sizing: auto`。

### 3.2 字号系统（行 1495–1525）

```css
.app {
  --app-font: 17.5px;   --fs-body: var(--app-font);
  --fs-meta: calc(var(--app-font) * .69);      --fs-label: calc(var(--app-font) * .74);
  --fs-small: calc(var(--app-font) * .75);     --fs-ui: calc(var(--app-font) * .82);
  --fs-button: calc(var(--app-font) * .84);    --fs-button-sm: calc(var(--app-font) * .78);
  --fs-reading: calc(var(--app-font) * 1.03);  --fs-next: calc(var(--app-font) * 1.09);
  --fs-context: calc(var(--app-font) * 1.43);  --fs-section: calc(var(--app-font) * 1.26);
  --fs-task-group: calc(var(--app-font) * .89);--fs-slip-title: calc(var(--app-font) * 1.43);
  --fs-project: calc(var(--app-font) * 2.29);  --fs-page: calc(var(--app-font) * 2.06);
  --fs-dialog: calc(var(--app-font) * 1.54);   --fs-brand: calc(var(--app-font) * 1.31);
  --fs-handoff: calc(var(--app-font) * .8);    --fs-input: calc(var(--app-font) * .86);
  --fs-textarea: calc(var(--app-font) * .94);
  font-size: var(--app-font); line-height: 1.7;
}
.app[data-text-size="large"]  { --app-font: 19px; }
.app[data-text-size="xlarge"] { --app-font: 20.5px; }
```

| Token | 倍率 | 17.5px ≈ | 使用选择器 |
| --- | --- | --- | --- |
| `--fs-body` | 1.00 | 17.50 | `.taskTitle` |
| `--fs-meta` | .69 | 12.08 | `.headerMeta .projectPath .statusChip .projectFresh .projectFlag .tab span .filter .slipCount .slipPath .slipUpdate .stamp span/small .subMeta .subMuted .gitDate .gitHint .historyHint .doneLabel .fieldLabel .contextHint .projectFooter .listFooter .doneToggle .tag .focusBadge .focusTaskChip .taskWarning .taskGroup h3 small .editHint .authorHint .summaryPreview .transferNote .comparison .conflict .nextWarning .skillFiles code` |
| `--fs-label` | .74 | 12.95 | `.crumb .textLink .projectForm label .workspaceName .formError .moreItem .settingsHint` |
| `--fs-small` | .75 | 13.13 | `.gitHash .skillFiles .warnings .handoff .transferTabs>button .projectForm .skillDescription` |
| `--fs-ui` | .82 | 14.35 | `.errorCard .emptyText .sizeOptionLabel .taskDeleteTitle` |
| `--fs-button` | .84 | 14.70 | `.primary .secondary .primaryButton .projectPage .primary/.secondary` |
| `--fs-button-sm` | .78 | 13.65 | `.quietButton .smallButton .miniButton .textButton` |
| `--fs-reading` | 1.03 | 18.03 | `.markdown` |
| `--fs-next` | 1.09 | 19.08 | `.slipNext .nextButton` |
| `--fs-task-group` | .89 | 15.58 | `.tab .emptyText .taskGroup h3` |
| `--fs-context` | 1.43 | 25.03 | `.contextCard .nextButton` |
| `--fs-section` | 1.26 | 22.05 | `.sectionHeading h2 .summaryHeading h2` |
| `--fs-slip-title` | 1.43 | 25.03 | `.slipTitle h2` |
| `--fs-dialog` | 1.54 | 26.95 | `.dialogHeading h2` |
| `--fs-brand` | 1.31 | 22.93 | `.brandName` |
| `--fs-project` | 2.29 | 40.08 | `.projectTitle` |
| `--fs-page` | 2.06 | 36.05 | `.headerTitle h1` |
| `--fs-handoff` | .80 | 14.00 | `.handoffButton` |
| `--fs-input` | .86 | 15.05 | `.projectForm input/select/.agentInput` |
| `--fs-textarea` | .94 | 16.45 | `.summaryInput` |

非 token 直接倍率：`.markdown h1–h6` `*1.09`（19.08）｜`.markdown code` `*.74`｜`.gitMessage` `*.83`｜`.skillDescription` `*.86`｜`.subName`/`.subNext` `*.86`｜`.summaryEmpty` `*.86`｜`.notice` `*.78`｜`.empty h2` `*1.37`（23.98）｜`.empty > p` `*.86`｜`.projectForm > p` `*.77`｜`.workspaceCheck` `*.9`｜`.textSizeButton` `*.9`｜`.sizePreview > span` `*1.7`。

### 3.3 行高 / 字距 / 字重

| 选择器 | 字号 | 行高 | 字距 | 字重 |
| --- | --- | --- | --- | --- |
| `.app` | `--app-font` | 1.7 | `.006em` | — |
| `.projectTitle` | `--fs-project` | 1.12 | `.01em` | 700 |
| `.headerTitle h1` | `--fs-page` | 1.08 | `.01em` | 700 |
| `.brandName` | `--fs-brand` | 1 | `.06em` | 700 |
| `.brandName small` | `--fs-meta` | 1 | `.18em` | — |
| `.slipTitle h2` | `--fs-slip-title` | 1.3 | `.015em` | 700 |
| `.dialogHeading h2` | `--fs-dialog` | 1.25 | `.01em` | 700 |
| `.sectionHeading h2` / `.summaryHeading h2` | `--fs-section` | 1.35 | `.01em` | 700 |
| `.slipNext .nextButton` | `--fs-next` | 1.65 | `.005em` | — |
| `.contextCard .nextButton` | `--fs-context` | 1.55 | `.005em` | 500 |
| `.markdown` | `--fs-reading` | 1.9 | `.01em` | — |
| `.markdown h1–h6` | `*1.09` | 1.5 | — | 600 |
| `.stamp span` | `--fs-meta` | 1 | `.08em` | 600 |
| `.statusChip` | `--fs-meta` | 1.2 | `.05em` | 600 |
| `.fieldLabel` | `--fs-meta` | — | `.12em` | 500 |
| `.primary/.primaryButton` | `--fs-button` | 1.2 | `.01em` | 600 |
| `.secondary` | `--fs-button` | 1.2 | `.01em` | 500 |

**标题墨压（唯一允许的 text-shadow 家族）**：

```css
.headerTitle h1, .projectTitle, .slipTitle h2, .dialogHeading h2, .empty h2,
.sectionHeading h2, .summaryHeading h2,
.tab[aria-pressed="true"], .stamp span, .statusChip, .projectFlag {
  text-shadow: 0 1px 0 rgba(255, 255, 255, .55);
}
.stamp small, .slipUpdate, .subMeta, .projectFresh, .gitDate {
  text-shadow: 0 1px 0 rgba(255, 255, 255, .45);
}
```

正文 / 表格 / 任务行 / 页脚**无** text-shadow。

### 3.4 阅读栏与段落

```css
.markdown, .projectPage .markdown {
  max-width: min(46em, 900px);
  font-family: var(--serif); font-size: var(--fs-reading);
  line-height: 1.9; letter-spacing: .01em; color: var(--ink-2); text-wrap: pretty;
}
.markdown p { margin: 14px 0; }
.markdown ul, .markdown ol { margin: 12px 0; padding-left: 22px; }
.markdown li + li { margin-top: 6px; }
```

46em 基于自身 18.03px ≈ **829px**；`900px` 上限只在 large/xlarge 触发（xlarge：21.12×46 ≈ 971 → 封顶 900）。≤760px 时 `max-width: none`。`.summaryInput`/`.summaryEmpty` 同宽。

### 3.5 字号设置机制

三档由 `data-text-size` 挂在 `.app`，`html/body` 字号不变，全部尺寸经 `--app-font` 派生 → 改一个变量全站等比缩放。设置弹窗：`.sizeOptions { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px }`；`.sizeOption` 为 `raise-1` 纸片，`.sizeOptionActive` 转 `press-1` + `translateY(1px)`；`.sizePreview` 虚线压凹预览。≤520px 单列并转行向。

---

## 4. 布局与间距

| 项 | 值 |
| --- | --- |
| 内容宽 | `.main { max-width:1180px; margin:0 auto; padding:22px 40px 44px }`；`.projectPage` 同宽 |
| 页头 | `.siteHeader { display:grid; grid-template-columns:106px minmax(0,1fr) auto; gap:24px; align-items:end; padding:24px 40px 18px; border-bottom:2px solid var(--ink) }` |
| 紧凑页头 | `.siteHeaderCompact { align-items:center; padding:16px 40px 14px; border-bottom:1px solid var(--line) }` |
| 工具条 | `.toolbar { position:sticky; top:0; z-index:3; display:flex; gap:24px; min-height:50px; margin:0 0 22px; border-bottom:1px solid var(--line) }` |
| 身份区 | `.projectHead { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:end; gap:32px; padding:30px 0 22px; border-bottom:2px solid var(--ink) }` |
| 工具槽 | `.projectUtilities { display:flex; flex-wrap:wrap; gap:6px; padding:4px 5px; min-height:50px; margin-bottom:24px }` |
| 列表 | `.slipList { display:flex; flex-direction:column; gap:12px }` |
| 卡片 | `.cardList { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; align-items:stretch }`（≤1100 单列） |
| 交接单栅格 | `.slip { grid-template-columns:112px minmax(0,1fr) 156px }`（≤980：`100px … 142px`） |
| 子行栅格 | `.subRow { grid-template-columns:8px minmax(140px,170px) minmax(0,1fr) 80px auto; gap:14px; padding:10px 0 }`；卡片视图首两列 `8px minmax(120px,150px)` |
| 内距 | `.stamp 20px 0 0 20px`／`.slipBody 18px 26px 20px 0`／`.slipSide 18px 20px`／`.contextCard 24px 28px 26px`／`.taskGroup 18px 22px`／`.summaryCard`+`.gitCard 24px 28px` |
| 任务行 | `.task { gap:12px; min-height:56px; padding:14px 0; border-bottom:1px solid var(--line) }` |
| 分隔线 | 实线 1px `--line`（行分隔）｜实线 1px `--line-dark`（结构）｜虚线 `1px dashed var(--line-dark)`（`.slipSide` 左、`.subRow` 下、`.empty` 外框、移动端 `.utilityDanger` 上缘） |
| 边框宽 | **1px 常规**；1.5px 仅状态章/`statusChip`；2px 仅页头、身份区、对话框标题下缘；3px 仅左墨条（slip/contextCard/taskGroup） |
| 圆角 | `--radius-control:2px`（全部纸键）；其余一律 `0`；`.moreCheck` 为 `1px` |
| 控件高 | `--control:38px`（主/次）、`--control-sm:30px`（小/迷你/图标/工具键/`taskAction`）、28px（`.textButton` `.filter`）、34px（`.handoffButton` `.transferTabs>button`）、44px（`.doneToggle`）、32×28（`.viewButton`）、22px 最小（`.statusChip`） |
| 图标 | 15px（`.primary/.secondary/.primaryButton/.handoffButton/.smallButton/.miniButton/.utilityButton svg`）｜14px（`.textButton` `.quietButton`）｜16px（`.viewButton` `.sectionToggle`）｜18px（`.iconButton`）｜24px（`.brandMark`）｜38px（`.emptyIsland`） |
| 动效 | `--motion-fast:120ms` `--motion:180ms` `--motion-slow:280ms`；`--ease-out`=`--ease`=`cubic-bezier(.2,.7,.3,1)` |

**断点（实际存在：1100 / 980 / 760 / 640 / 520 / 360）**

| 断点 | 变化 |
| --- | --- |
| ≤1100 | `.cardList` 单列 |
| ≤980 | 页头 `padding:14px 28px 12px`、`gap:20px`；`.main { padding:20px 28px 38px }`；`.slip` 三栏收窄 |
| **≤760** | 页头转 `display:flex; flex-wrap:wrap`（`.headerTitle` 换整行；详情页 `.siteHeaderCompact .headerTitle{display:none}`）；`.headerMeta` 分隔斜杠 `::before` 取消；`.projectHead` 单栏、`padding:22px 0 18px`；`.projectActions` 转 `1fr 1fr`、按钮 `min-height:40px`；`.projectUtilities` 转两列、`.utilitySpacer` 隐藏、`.utilityButton` 撑满 `min-height:34px`；`.slip` 单栏、`.slipSide` 横排 + 上缘虚线；`.subRow` 转 `8px minmax(0,1fr) auto`；`.contextCard { padding:18px 16px 20px }`；阅读栏 `max-width:none`；`.dialog` 全宽；字号改倍率（`--fs-page *1.6`、`--fs-project *1.72`、`--fs-slip-title *1.26`、`--fs-context *1.15`、`--fs-section *1.15`） |
| ≤640 | `.toastRegion { top:12px; right:12px; width:calc(100vw - 24px) }` |
| ≤520 | `.siteHeaderCompact` 可换行；`.toolbar` 换行、`.tabs`/`.toolbarRight` 各占整行（后者 `space-between`）；`.editHint > span` 隐藏；`.sizeOptions` 单列；xlarge 下 `.projectActions`/`.projectUtilities` 单列 |
| ≤360 | `.projectActions` 强制单列 |

**390 / 320 无专属断点**：390px 落在 ≤520（叠加 ≤760、≤640），320px 额外命中 ≤360。验收的「320 无横向溢出」靠 360 单列 + 全局 `overflow-wrap: anywhere` 兜底。

---

## 5. 表面语法

判据：**可点的凸起，可输入的压凹，可盖章的盖章，可读的保持平面。**

```css
/* ① 凸起·墨色主键（primary / primaryButton / handoffButton / dangerButton 同构） */
.primary, .primaryButton, .handoffButton {
  background-image: linear-gradient(180deg, #3b4a41 0%, #25312b 48%, #161f1b 100%);
  border-color: #0b110e;
  border-top-color: #46554c;                       /* 顶面受光 */
  border-radius: var(--radius-control);
  box-shadow:
    0 3px 0 #0a0f0c,                               /* 3px 硬边，零模糊 */
    0 6px 12px rgba(16, 23, 20, .22),              /* 暖墨外投影 */
    inset 0 1px 0 rgba(255, 255, 255, .22),
    inset 0 -1px 0 rgba(0, 0, 0, .45);             /* 底部内暗 = 纸厚 */
}
/* ① 凸起·纸色小键（secondary / quietButton / smallButton / miniButton / transferTabs>button / iconButtonBordered） */
.secondary, .quietButton, .smallButton, .miniButton, .transferTabs > button, .iconButtonBordered {
  background-image: linear-gradient(180deg, #fdfcf8, #f3f2ec);
  border: 1px solid var(--line-dark); border-radius: var(--radius-control);
  box-shadow: 0 3px 0 var(--lp-edge), 0 4px 10px rgba(29, 37, 34, .06), inset 0 1px 0 #fff;
}
/* ② 压凹（大面） */
input, select, textarea, .agentInput, .summaryInput, .handoff, .editForm > input {
  border: 1px solid var(--lp-edge-strong); border-radius: 0;
  background-color: var(--lp-well); box-shadow: var(--lp-press-1);
}
:focus { box-shadow: var(--lp-press-1), 0 0 0 2px rgba(79, 118, 103, .16); }
:global(input:focus), :global(textarea:focus), :global(select:focus) { outline: 2px solid var(--ink); outline-offset: 1px; }
/* ② 压凹（小件：checkbox / .moreCheck / .tag / code / .gitHash / th） */
{ border: 1px solid var(--line); background: var(--lp-well); box-shadow: var(--lp-press-2); }
/* ③ 盖章 */
.stamp span, .statusChip, .projectFlag {
  background: rgba(251, 250, 246, .62);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .78), 0 1px 0 rgba(29, 37, 34, .06);
  text-shadow: 0 1px 0 rgba(255, 255, 255, .55);
}
/* ④ 平面：正文 / .markdown / .task / .tab / .crumb / 页脚 / 表格内容 → 零 shadow、零 text-shadow、零填充 */
```

**「2/3/4px 硬边」是 `box-shadow` 的零模糊首层，不是 `border-width`**：纸键 3px、纸片 2px、浮层 4px。

**纸面与纸纤维**：页面底 = `--paper` + `--lp-grain`（180×180 平铺）+ `background-blend-mode: multiply`；实测渲染像素 `#f2f1ec`（比 token 深约 1 级，因乘算）。只铺 `.app` / `.siteHeader` / `.siteHeaderCompact` / `.toolbar`（后两者为 sticky 不露缝）。纸片**不铺纹理**，靠 `--sheet` 纯色 + `inset 0 1px 0 rgba(255,255,255,.72)` 顶部高光。
**双墨线** = `border-bottom: 2px solid var(--ink)` + `box-shadow: 0 1px 0 rgba(255,255,255,.62)`（墨线下补一道纸高光），用于 `.projectHead` 与 `.dialogHeading`；`.siteHeader` 用 `inset 0 -1px 0 rgba(255,255,255,.55)`。
**浮层 backdrop** 实测：`rgba(29,37,34,.45)` 叠在 `#f2f1ec` 上得 `rgb(146,149,144)`（已像素校验），`backdrop-filter: none`。

---

## 6. 组件配方

### 6.1 外壳 / 页头 / 品牌印 / 项目页头

```css
:global(:root) { font-family: var(--sans); color: var(--ink); background: var(--paper); }
:global(*) { box-sizing: border-box; }
:global(body) { margin: 0; background: var(--paper); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
:global(::selection) { background: var(--ink); color: var(--sheet); }
:global(input::placeholder), :global(textarea::placeholder) { color: #73776f; opacity: 1; }
:global(button), :global(input), :global(textarea), :global(select) { font: inherit; font-family: var(--sans); }
:global(button) { cursor: pointer; }
:global(button:disabled) { opacity: 1; cursor: not-allowed; }
:global(a) { color: inherit; text-decoration: none; }
:global(button:focus-visible), :global(a:focus-visible), :global(summary:focus-visible), :global([tabindex]:focus-visible) {
  outline: 2px solid var(--ink); outline-offset: 2px;
}

.siteHeader {
  display: grid; grid-template-columns: 106px minmax(0, 1fr) auto;
  gap: 24px; align-items: end; padding: 24px 40px 18px;
  border-bottom: 2px solid var(--ink);
  background-color: var(--paper); background-image: var(--lp-grain); background-size: 180px 180px;
  box-shadow: inset 0 -1px 0 rgba(255, 255, 255, .55);
}
.brand { display: flex; align-items: center; gap: 11px; color: var(--ink); text-decoration: none; }
.brandMark {
  display: grid; place-items: center; width: 32px; height: 32px; flex: none; border-radius: 0;
  border: 1px solid var(--sage-dark); background: var(--sage); color: var(--sheet);
  box-shadow: inset 0 0 0 1px rgba(251, 250, 246, .42), inset 0 -2px 0 rgba(0, 0, 0, .16), 0 2px 0 rgba(62, 94, 82, .35);
}
.brandMark svg { width: 24px; height: 24px; }
.brandName { font: 700 var(--fs-brand)/1 var(--head); letter-spacing: .06em; }
.brandName small { display: block; margin-top: 4px; font: var(--fs-meta)/1 var(--mono); letter-spacing: .18em; color: var(--muted); }
.brand:hover .brandName { text-decoration: underline; text-underline-offset: 4px; }
.headerTitle h1 { margin: 0; font: 700 var(--fs-page)/1.08 var(--head); letter-spacing: .01em; text-wrap: balance; overflow-wrap: anywhere; }
.headerMeta { display: flex; flex-wrap: wrap; gap: 3px 14px; margin: 8px 0 0; font: var(--fs-meta)/1.5 var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.headerMeta span + span::before { content: '/'; margin-right: 10px; color: var(--line-dark); }
.headerActions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }

.projectHead { border-bottom: 2px solid var(--ink); box-shadow: 0 1px 0 rgba(255, 255, 255, .62); }
.projectKicker { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 12px; }
.projectTitle { margin: 0; font: 700 var(--fs-project)/1.12 var(--head); letter-spacing: .01em; overflow-wrap: anywhere; text-wrap: balance; }
.projectPath { margin: 10px 0 0; font: var(--fs-meta)/1.5 var(--mono); color: var(--muted); overflow-wrap: anywhere; }
.projectActions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding-bottom: 2px; }
.crumb { display: flex; align-items: center; gap: 9px; font-size: var(--fs-label); color: var(--muted); }
.crumb a { color: var(--muted); text-decoration: underline; text-decoration-color: var(--line-dark); text-underline-offset: 3px; }
.crumb a:hover { color: var(--ink); text-decoration-color: var(--ink); }
.crumb .crumbBack { padding: 0 10px; color: var(--ink); text-decoration: none; }
```

### 6.2 Tabs / 纸键族 / 主墨键状态

```css
.tabs { display: flex; align-items: center; gap: 24px; min-width: 0; overflow-x: auto; }
.tab { position: relative; border: 0; border-bottom: 0; background: none; padding: 15px 0 13px;
       color: var(--muted); font-size: var(--fs-task-group); font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; }
.tab::after { content: ''; position: absolute; inset: auto 0 0 0; height: 2px; background: var(--ink);
       transform: scaleX(0); transform-origin: center; transition: transform var(--motion) var(--ease-out); pointer-events: none; }
.tab:hover { color: var(--ink); }
.tab:hover::after { transform: scaleX(.45); }
.tab[aria-pressed="true"] { color: var(--ink); font-weight: 600; }
.tab[aria-pressed="true"]::after { transform: scaleX(1); }

.primary, .secondary, .primaryButton {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  min-height: var(--control); padding: 0 16px; border-radius: var(--radius-control);
  font-size: var(--fs-button); font-weight: 500; letter-spacing: .01em; line-height: 1.2; white-space: nowrap;
}
.primary, .primaryButton { font-weight: 600; }
.secondary { border: 1px solid var(--line-dark); background: var(--sheet); color: var(--ink); }
.smallButton, .miniButton { min-height: var(--control-sm); padding: 0 11px; border-radius: var(--radius-control); font-size: var(--fs-button-sm); font-weight: 500; }
.textButton { display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 0 3px; border: 0; background: none;
  color: var(--ink-2); font-size: var(--fs-button-sm); font-weight: 500;
  text-decoration: underline; text-decoration-style: dotted; text-decoration-color: var(--line-dark); text-underline-offset: 3px; }
.textButton:hover:not(:disabled) { color: var(--ink); text-decoration-style: solid; text-decoration-color: var(--ink); }
.iconButton { width: 30px; height: 30px; padding: 0; border: 0; background: none; color: var(--muted); border-radius: var(--radius-control); }
.iconButtonBordered { border: 1px solid var(--line-dark); background: var(--sheet); color: var(--ink-2); }
.iconButtonBordered:hover:not(:disabled) { border-color: var(--ink); background: #eae8e0; color: var(--ink); transform: translateY(-1px); }

.primary:hover:not(:disabled), .primaryButton:hover:not(:disabled), .handoffButton:hover:not(:disabled) {
  background-image: linear-gradient(180deg, #45544b 0%, #2b3831 48%, #1a241f 100%);
  border-color: #0b110e; border-top-color: #53645a; transform: translateY(-1px);
  box-shadow: 0 4px 0 #0a0f0c, 0 10px 20px rgba(16, 23, 20, .28),
              inset 0 1px 0 rgba(255, 255, 255, .24), inset 0 -1px 0 rgba(0, 0, 0, .45);
}
.primary:active:not(:disabled), .primaryButton:active:not(:disabled), .handoffButton:active:not(:disabled) {
  transform: translateY(1px);
  box-shadow: 0 1px 0 #0a0f0c, 0 2px 4px rgba(16, 23, 20, .18),
              inset 0 2px 5px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .08);
}
.dangerButton { background-image: linear-gradient(180deg, #c15c3f, #a94a2f 55%, #8f3b24);
  border-color: #5b2618; border-top-color: #d0785e; border-radius: var(--radius-control);
  box-shadow: 0 3px 0 #5b2618, 0 6px 12px rgba(169, 74, 47, .22),
              inset 0 1px 0 rgba(255, 255, 255, .20), inset 0 -1px 0 rgba(0, 0, 0, .35); }
.dangerButton:hover:not(:disabled) { background-image: linear-gradient(180deg, #c96648, #ae4d31 55%, #933d26); border-top-color: #d9856c; }
/* 禁用：换色 + 去渐变去阴影，不降透明 */
.primary:disabled, .primaryButton:disabled, .handoffButton:disabled { border-color: #c8c5bb; background: #c8c5bb; color: #61645f; background-image: none; box-shadow: none; transform: none; }
.secondary:disabled, .quietButton:disabled, .smallButton:disabled, .miniButton:disabled, .textButton:disabled,
.navButton:disabled, .iconButton:disabled { border-color: var(--line); background: none; color: #93978f; background-image: none; box-shadow: none; }
```

### 6.3 输入 / checkbox / 状态章 / 标签

```css
.projectForm input:not([type="checkbox"]), .projectForm select, .agentInput,
.summaryInput, .handoff, .editForm > input, .projectForm textarea {
  display: block; width: 100%; margin-top: 7px; padding: 10px 11px;
  border: 1px solid var(--lp-edge-strong); border-radius: 0;
  background-color: var(--lp-well); background-image: none;
  color: var(--ink); font-size: var(--fs-input); box-shadow: var(--lp-press-1);
  transition: border-color var(--motion) var(--ease-out), background-color var(--motion) var(--ease-out);
}
…:hover:not(:focus) { border-color: #9d9789; }          /* hover 只加深切边，不位移不改底 */
.agentInput { min-height: 170px; resize: vertical; line-height: 1.8; }
.summaryInput { min-height: 260px; resize: vertical; max-width: min(46em, 900px); font-size: var(--fs-textarea); line-height: 1.85; }

.app input[type="checkbox"] {
  -webkit-appearance: none; appearance: none; display: inline-grid; place-content: center;
  width: 18px; height: 18px; min-width: 18px; margin: 0;
  border: 1px solid var(--lp-edge-strong); border-radius: 0;
  background-color: var(--lp-well); background-image: none; box-shadow: var(--lp-press-2); cursor: pointer;
}
.app input[type="checkbox"]:checked {
  border-color: var(--ink); background-color: var(--ink);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3 8.5 6.5 12 13 4.5' fill='none' stroke='%23fbfaf6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: center; background-size: 12px 12px;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, .3);
}
.app input[type="checkbox"]:disabled { opacity: .55; cursor: not-allowed; }
.filter input { width: 18px; height: 18px; accent-color: var(--ink); }

.statusChip { display: inline-flex; align-items: center; gap: 6px; min-height: 22px; padding: 2px 8px;
  border: 1.5px solid var(--sage); color: var(--sage);
  font-size: var(--fs-meta); font-weight: 600; letter-spacing: .05em; line-height: 1.2; }
.statusChip::before { content: ''; width: 4px; height: 4px; border-radius: 50%; background: currentColor; }
.statusPaused  { border-color: var(--olive);     color: var(--olive); }
.statusOffline { border-color: var(--offline);   color: var(--muted); }
.statusDone    { border-color: var(--line-dark); color: var(--muted); }
.projectFlag { padding: 1px 6px; border: 1px solid var(--rust); color: var(--rust); font-size: var(--fs-meta); line-height: 1.4; }
.stamp span { display: inline-block; border: 1.5px solid var(--sage); padding: 4px 7px; background: transparent; }
.stamp small { display: block; margin-top: 8px; font: var(--fs-meta)/1.4 var(--mono); color: var(--muted); }
.slipPaused .stamp span { border-color: var(--olive); color: var(--olive); }
.slipDone .stamp span   { border-color: var(--line-dark); color: var(--muted); }

.tag { padding: 2px 6px; border: 1px solid var(--line); border-radius: 0; background: var(--lp-well);
       color: var(--muted); font-size: var(--fs-meta); letter-spacing: .01em; box-shadow: var(--lp-press-2); }
.focusBadge { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 0; background: var(--lp-well);
       color: var(--ink-2); font-size: var(--fs-meta); font-weight: 500; flex: none; }
.listFooter kbd { padding: 1px 5px; border: 1px solid var(--lp-edge); border-radius: 0; background: var(--sheet);
       font: inherit; box-shadow: 0 2px 0 var(--lp-edge), inset 0 1px 0 #fff; }   /* 2px 键帽 */
.nextWarning { display: inline-flex; align-items: center; min-height: 20px; margin-left: 8px; padding: 0 6px;
       border: 1px solid #d8b9ad; background: #fbf5f1; color: var(--rust);
       font-size: var(--fs-meta); font-weight: 500; line-height: 1.2; vertical-align: 1px; box-shadow: 0 1px 0 #d8b9ad; }
```

### 6.4 纸片 / 交接单 / 子列表槽 / 折叠段

```css
.slip { display: grid; grid-template-columns: 112px minmax(0, 1fr) 156px; min-width: 0;
  border: 1px solid var(--line); border-left: 3px solid var(--sage);
  background: var(--sheet); cursor: pointer; box-shadow: var(--lp-raise-2);
  transition: border-color .16s var(--ease), box-shadow .16s var(--ease), background-color .16s var(--ease); }
.slip:hover { transform: translateY(-2px);
  border-top-color: var(--line-dark); border-right-color: var(--line-dark); border-bottom-color: var(--line-dark);
  box-shadow: 0 3px 0 var(--lp-edge), 0 16px 32px rgba(29, 37, 34, .10), inset 0 1px 0 rgba(255, 255, 255, .82); }
.slipPaused  { border-left-color: var(--olive); }
.slipOffline { border-left-color: var(--offline); background: #efeee9; }
.slipDone    { border-left-color: var(--line-dark); background: #f5f4ef; }
.slipSelected { outline: 2px solid var(--ink); outline-offset: -2px; }
.slipTitle h2 { margin: 0; font: 700 var(--fs-slip-title)/1.3 var(--head); letter-spacing: .015em; overflow-wrap: anywhere; }
.slipPath { margin: 8px 0 0; font: var(--fs-meta)/1.5 var(--mono); color: var(--muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.slipSide { display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; gap: 14px;
  padding: 18px 20px; border-left: 1px dashed var(--line-dark); }
.cardList > .slip { display: flex; flex-direction: column; }
.cardList > .slip .slipSide { flex-direction: row; align-items: center; justify-content: space-between;
  padding: 10px 18px; border-left: 0; border-top: 1px dashed var(--line-dark); }
/* 同 raise-2 的其它纸片 */
.contextCard { border-left: 3px solid var(--sage); }
.taskGroup { border-left: 3px solid var(--line-dark); }
.activeGroup { border-left-color: var(--sage); background: #f6f5ef; }
.errorCard { border: 1px solid #d8b9ad; background: #f7ede8; color: var(--rust); border-radius: 0;
  box-shadow: 0 2px 0 #d8b9ad, 0 8px 20px rgba(169, 74, 47, .08), inset 0 1px 0 rgba(255, 255, 255, .62); }

.subList { padding: 0 12px; border-top: 1px solid var(--line-dark); background: var(--lp-well); box-shadow: var(--lp-press-1); }
.subRow { display: grid; grid-template-columns: 8px minmax(140px, 170px) minmax(0, 1fr) 80px auto;
  gap: 14px; align-items: center; min-width: 0; padding: 10px 0;
  border-bottom: 1px dashed var(--line-dark); cursor: pointer; transition: background-color .14s var(--ease); }
.subRow:last-child { padding-bottom: 0; border-bottom: 0; }
.subRow:hover { background: #f0efe8; }
.subDot { width: 6px; height: 6px; border-radius: 50%; background: var(--sage); flex: none; }
.subName { display: block; position: relative; padding: 2px 20px 2px 0; color: var(--ink); font-size: calc(var(--app-font) * .86); font-weight: 600; }
.subOpen { position: absolute; top: 50%; right: 0; color: var(--muted); font-size: 14px; transform: translateY(-50%);
  transition: color .14s var(--ease), transform .14s var(--ease); }
.subRow:hover .subOpen { color: var(--ink); transform: translate(2px, -50%); }
.subMeta { color: var(--muted); font: var(--fs-meta)/1.4 var(--mono); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

.completedGroup { background: var(--lp-well); box-shadow: var(--lp-press-1); }
.completedGroup > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  min-height: 32px; cursor: pointer; list-style: none; }
.completedGroup > summary::-webkit-details-marker { display: none; }
.completedGroup > summary::after { content: '展开'; color: var(--muted); font-size: var(--fs-meta); }
.completedGroup[open] > summary::after { content: '收起'; }
.sectionToggle { width: 30px; height: 30px; padding: 0; flex: none; }
.sectionToggle svg { width: 16px; height: 16px; transform: rotate(90deg); transition: transform var(--motion) var(--ease-out); }
.sectionToggle[aria-expanded="true"] svg { transform: rotate(-90deg); }
.collapsedSection { padding-top: 16px; padding-bottom: 16px; }
.collapsedSection .summaryHeading { margin-bottom: 0; }
.sectionBody { animation: isle-fade var(--motion) var(--ease-out); }
.skillFiles summary, .summaryPreview summary { display: flex; align-items: center; gap: 6px; min-height: 30px; cursor: pointer; }
.skillFiles summary::before, .summaryPreview summary::before { content: '▸'; color: var(--muted); font-size: 12px; line-height: 1; }
.skillFiles[open] summary::before, .summaryPreview[open] summary::before { content: '▾'; }
```

### 6.5 对话框 / 菜单 / 视图切换 / toast / 空态

```css
.dialog { width: min(680px, calc(100vw - 32px)); max-height: 90vh; overflow: auto;
  padding: 22px 26px 24px; border: 1px solid var(--ink); border-radius: 0;
  background: var(--sheet); color: var(--ink); box-shadow: var(--lp-raise-3); }
.dialog::backdrop { background: rgba(29, 37, 34, .45); backdrop-filter: none; animation: isle-fade var(--motion) var(--ease-out); }
.dialog[open] { animation: isle-dialog var(--motion) var(--ease-out); }
.dialogHeading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px;
  padding-bottom: 14px; border-bottom: 2px solid var(--ink); box-shadow: 0 1px 0 rgba(255, 255, 255, .62); }
.dialogHeading h2 { margin: 0; font: 700 var(--fs-dialog)/1.25 var(--head); letter-spacing: .01em; }
.dialog .iconButton { width: 30px; height: 30px; border: 1px solid var(--line-dark); border-radius: var(--radius-control);
  background: linear-gradient(180deg, #fdfcf8, #f3f2ec); color: var(--ink);
  box-shadow: 0 2px 0 var(--lp-edge), inset 0 1px 0 #fff; }
.dialog .iconButton:hover:not(:disabled) { border-color: var(--ink); background: #eae8e0; transform: translateY(-1px);
  box-shadow: 0 3px 0 var(--lp-edge), 0 5px 12px rgba(29, 37, 34, .10), inset 0 1px 0 #fff; }
.dialog .iconButton:active:not(:disabled) { transform: translateY(1px); box-shadow: 0 0 0 var(--lp-edge); }
.dialogActions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 20px; flex-wrap: wrap; }

.moreWrap { position: relative; display: inline-flex; flex: none; }
.moreMenu { position: absolute; top: calc(100% + 8px); right: 0; z-index: 20;
  width: min(220px, calc(100vw - 32px)); padding: 6px;
  border: 1px solid var(--line-dark); border-radius: 0; background: var(--sheet);
  box-shadow: var(--lp-raise-3); animation: isle-menu var(--motion) var(--ease-out); }
.moreItem { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 0 10px;
  border: 0; background: none; color: var(--ink-2); font-size: var(--fs-label); text-align: left; cursor: pointer; }
.moreItem:hover { background: #eae8e0; color: var(--ink); box-shadow: inset 0 1px 2px rgba(29, 37, 34, .10); }
.moreItem[aria-checked="true"] { color: var(--ink); font-weight: 600; }
.moreCheck { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex: none;
  border: 1px solid var(--lp-edge-strong); border-radius: 1px; background: var(--lp-well); box-shadow: var(--lp-press-2); }
.moreItem[aria-checked="true"] .moreCheck { border-color: var(--ink); background: var(--ink); color: var(--sheet);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, .32); }
.moreDot { position: absolute; top: 4px; right: 4px; width: 6px; height: 6px;
  border: 1px solid var(--paper); border-radius: 50%; background: var(--rust); }
.viewToggle { display: inline-flex; align-items: center; overflow: hidden;
  border: 1px solid var(--line-dark); border-radius: var(--radius-control);
  background-image: linear-gradient(180deg, #fdfcf8, #f3f2ec);
  box-shadow: 0 3px 0 var(--lp-edge), inset 0 1px 0 #fff; }
.viewButton { width: 32px; height: 28px; border: 0; border-right: 1px solid var(--line); background: transparent; color: var(--muted); }
.viewButton:last-child { border-right: 0; }
.viewButton[aria-pressed="true"] { background: var(--ink); color: var(--sheet); }
.viewButton svg { width: 16px; height: 16px; }

.toastRegion { position: fixed; top: 18px; right: 20px; z-index: 80; display: flex; flex-direction: column;
  gap: 10px; width: min(380px, calc(100vw - 32px)); pointer-events: none; }
.toast { margin: 0; pointer-events: auto; background: var(--sheet); box-shadow: var(--lp-raise-2);
  animation: isle-notice var(--motion) var(--ease-out); }
.notice { display: flex; align-items: center; justify-content: space-between; gap: 20px;
  margin: 0 0 18px; padding: 10px 14px; border: 1px solid var(--line); background: var(--sheet);
  color: var(--ink-2); font-size: calc(var(--app-font) * .78); line-height: 1.7;
  box-shadow: var(--lp-raise-2); animation: isle-notice var(--motion) var(--ease-out); }
.noticeError { border-color: #d8b9ad; color: var(--rust); background: #f7ede8; }
.warnings { margin: 14px 0; padding: 12px 15px; border: 1px solid var(--line-dark);
  background: var(--lp-well); color: var(--olive); font-size: var(--fs-small); line-height: 1.8;
  box-shadow: var(--lp-press-1); }

.empty { min-height: 380px; margin-top: 26px; padding: 34px 20px; text-align: center;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  border: 1px dashed var(--lp-edge-strong); border-radius: 0;
  background: var(--lp-well); box-shadow: var(--lp-press-1); }
.emptyIsland { width: 64px; height: 64px; margin-bottom: 20px; display: grid; place-items: center;
  border: 1px solid var(--lp-edge); border-radius: 0; background: var(--sheet);
  color: var(--sage); box-shadow: var(--lp-raise-1); }
.emptyIsland svg { width: 38px; height: 38px; stroke-width: 1; }
.empty h2 { margin: 0 0 10px; color: var(--ink); font: 700 calc(var(--app-font) * 1.37)/1.3 var(--head); }
.empty > p { margin: 0 0 22px; color: var(--muted); font-size: calc(var(--app-font) * .86); line-height: 1.9; }
```

### 6.6 代码 / 表格 / 页脚 / 任务行 / 行内编辑

```css
.markdown code, .gitHash { padding: 2px 4px; border: 1px solid var(--line); border-radius: 0;
  background: var(--lp-well); color: var(--ink-2); font-family: var(--mono);
  font-size: calc(var(--app-font) * .74); box-shadow: var(--lp-press-2); }
.markdown pre { padding: 12px; border: 1px solid var(--line); border-radius: 0;
  background: var(--lp-well); overflow: auto; max-width: 100%; box-shadow: var(--lp-press-1); }
.markdown pre code { padding: 0; border: 0; background: none; box-shadow: none; }
.markdown table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse;
  font-family: var(--sans); font-size: 14px; }
.markdown th, .markdown td { padding: 6px 9px; border: 1px solid var(--line); text-align: left; }
.markdown th { background: var(--lp-well); font-weight: 600; box-shadow: var(--lp-press-2); }
.markdown a { color: var(--sage); text-decoration: underline; text-underline-offset: 3px; }
.markdown blockquote { margin-left: 0; padding-left: 13px; border-left: 3px solid var(--line-dark); color: var(--muted); }
.gitList li { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 12px;
  align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--line); }

.projectFooter { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  margin-top: 30px; padding: 20px 0 0; border-top: 1px solid var(--line);
  color: var(--muted); font: var(--fs-meta)/1.8 var(--mono); }
.listFooter { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  margin-top: 20px; padding: 16px 0 0; border-top: 1px solid var(--line);
  color: var(--muted); font: var(--fs-meta)/1.7 var(--mono); }

.taskGroup { padding: 18px 22px; border: 1px solid var(--line); border-radius: 0;
  background: var(--sheet); box-shadow: var(--lp-raise-2); }
.taskGroup h3 { display: flex; align-items: center; gap: 9px; margin: 0; color: var(--ink-2);
  font: 700 var(--fs-task-group)/1.3 var(--sans); }
.taskGroup h3 small { padding: 2px 7px; border: 1px solid var(--line); background: var(--lp-well);
  color: var(--muted); font: var(--fs-meta)/1.4 var(--mono); box-shadow: var(--lp-press-2); }
.task { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 12px; min-height: 56px;
  padding: 14px 0; border-bottom: 1px solid var(--line); color: var(--ink); }
.task:last-child { padding-bottom: 2px; border-bottom: 0; }
.taskMark { display: inline-block; width: 6px; height: 6px; margin-top: 9px; flex: none;
  border-radius: 50%; background: var(--line-dark); }
.taskMark[data-done="true"] { background: var(--muted); }
.taskTitle { display: block; color: var(--ink); font-size: var(--fs-body); line-height: 1.7; overflow-wrap: anywhere; }
.doneTask .taskTitle { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--line-dark); }
.taskAction { width: var(--control-sm); min-width: var(--control-sm); min-height: var(--control-sm); padding: 0; color: var(--muted); }
.taskDelete:hover:not(:disabled) { color: var(--rust); border-color: var(--rust); background: #fbf5f1; }

.nextButton { display: flex; align-items: flex-start; gap: 12px; width: 100%; padding: 2px 0; border: 0;
  background: none; color: var(--ink); text-align: left; white-space: normal; cursor: pointer; }
.nextText { flex: 1; min-width: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.editHint { display: inline-flex; align-items: center; gap: 4px; flex: none; margin-top: 3px; padding: 2px 6px;
  border: 1px solid var(--line); background: var(--sheet); color: var(--muted);
  font-size: var(--fs-meta); line-height: 1.2; white-space: nowrap;
  box-shadow: 0 1px 0 var(--lp-edge), inset 0 1px 0 #fff; }
.nextButton:hover:not(:disabled) .editHint { border-color: var(--ink); background: #eae8e0; color: var(--ink); }
.openMark { display: inline-flex; align-items: center; flex: none; color: var(--muted);
  transition: color .16s var(--ease), transform .16s var(--ease); }
.slip:hover .openMark { color: var(--ink); transform: translateX(3px); }
```

---

## 7. 交互与动效

| 元件族 | hover | active | focus-visible | disabled |
| --- | --- | --- | --- | --- |
| 主墨键 | 渐变整体提亮、`translateY(-1px)`、硬边 3→4px、投影 6/12→10/20 | `translateY(1px)`、硬边 1px、`inset 0 2px 5px rgba(0,0,0,.45)` | `outline:2px solid var(--ink); outline-offset:2px` | 无渐变无阴影，`#c8c5bb` 底 / `#61645f` 字，`opacity:1` |
| 纸色小键 | `translateY(-1px)`、硬边 3→4px、`0 8px 18px rgba(29,37,34,.10)` | `translateY(1px)`、`box-shadow: 0 0 0 var(--lp-edge)`（硬边归零=压平） | 同上 | `border-color:var(--line)`、无底无影、`#93978f` |
| 描边图标键 | 上浮 + 图标 `rotate(180deg)`（280ms） | 下压 1px、硬边归零 | 同上 | 同上 |
| 输入类 | 仅 `border-color:#9d9789`，不位移不改底 | — | `outline 2px ink/offset 1px` + `press-1, 0 0 0 2px rgba(79,118,103,.16)` | — |
| 纸片 | `translateY(-2px)` + `0 3px 0 lp-edge, 0 16px 32px rgba(29,37,34,.10)` | — | `.slipSelected` 用 `outline 2px ink; offset:-2px` | — |
| tab | 文字转 ink，下划线 `scaleX(.45)` | — | `outline-offset:2px` | — |
| checkbox | 不变形 | — | 原生 outline | `opacity:.55` |
| `.textButton` | 点线转实线、色转 ink | — | 同上 | `#93978f` |

```css
/* 过渡：180ms 变色，120ms 位移 */
.primary, .secondary, .primaryButton, .handoffButton, .quietButton, .smallButton, .miniButton,
.transferTabs > button, .iconButtonBordered, .textButton {
  transition: background-color var(--motion) var(--ease-out), border-color var(--motion) var(--ease-out),
    color var(--motion) var(--ease-out), transform var(--motion-fast) var(--ease-out),
    box-shadow var(--motion) var(--ease-out);
}
/* 纸片 .16s、子行 .14s、tab 下划线 180ms，缓动统一 cubic-bezier(.2,.7,.3,1) */

@keyframes isle-rise   { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes isle-fade   { from { opacity: 0; } to { opacity: 1; } }
@keyframes isle-dialog { from { opacity: .65; transform: translateY(5px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes isle-notice { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: none; } }
@keyframes isle-menu   { from { opacity: .6; transform: translateY(-3px) scale(.985); } to { opacity: 1; transform: none; } }

.slipList > .slip { animation: isle-rise var(--motion-slow) var(--ease-out) backwards; }
.slipList > .slip:nth-child(2) { animation-delay: 30ms; }   /* 30/60/90/120/150ms，至第 6 条 */
.main > .projectHead, .main > .contextCard, .main > .tasksPanel,
.main > .summaryCard, .main > .gitCard { animation: isle-rise var(--motion-slow) var(--ease-out) backwards; }
.main > .contextCard { animation-delay: 30ms; }
.main > .tasksPanel  { animation-delay: 60ms; }
.main > .summaryCard, .main > .gitCard { animation-delay: 80ms; }
```

```css
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
@media (prefers-reduced-motion: reduce) {
  .slip:hover, .utilityButton:hover, .secondary:hover, .quietButton:hover, .smallButton:hover,
  .miniButton:hover, .transferTabs > button:hover, .iconButtonBordered:hover, .dialog .iconButton:hover { transform: none; }
}
@media (forced-colors: active) {
  .slip, .contextCard, .taskGroup, .summaryCard, .gitCard, .notice, .errorCard,
  .dialog, .moreMenu, .empty, .emptyIsland { box-shadow: none; border: 1px solid ButtonText; }
  /* 输入类 → border 1px ButtonText + background Canvas；章/标签类 → 清影 + 1px ButtonText */
  .app input[type="checkbox"] { box-shadow: none; border: 1px solid ButtonText; background: Canvas;
    -webkit-appearance: auto; appearance: auto; }
  .app input[type="checkbox"]:checked { background: Highlight; }
}
```

---

## 8. 陷阱

1. **「2/3/4px 硬边」是 `box-shadow: 0 Npx 0 <色>`，不是 border**。写成 `border-width:3px` 会让纸片变胖、比例全错。真实 border 只有 1px（1.5px 仅章，2px 仅下缘双墨线，3px 仅左墨条）。
2. **禁用不降透明度**：`button:disabled { opacity: 1 }`，只换色 + 去渐变去阴影。用 `.55` 会立刻变塑料（checkbox 例外仍用 `.55`）。
3. **不用纯黑、不用冷灰阴影**：深端 `#1d2522`/`#0b110e`/`#0a0f0c`；所有投影是暖墨 `rgba(29,37,34,…)`、`rgba(16,23,20,…)`、`rgba(169,74,47,…)`。抄 `rgba(0,0,0,.1)` 会发灰发脏。
4. **阴影只表达四件事**：凸起（raise 1/2/3）、压凹（press 1/2）、盖章（薄 inset + 1px 落地）、平面（无）。层高固定：控件最低 → 纸片 → 浮层最高。给正文/表格/任务行/tab/面包屑/页脚加 elevation 是致命错误。
5. **正文必须平面**：`.markdown` 无阴影无底纹无背景，只有衬线 + 46em 窄栏。加 grain 或 text-shadow 会让长文立刻变噪。
6. **纸纤维只铺三处**（`.app` / 页头 / 工具条），`opacity` 写在 SVG 内部（`.035`），且必须 `background-blend-mode: multiply`。漏 `multiply` → 噪声浮在纸面像脏点；铺到卡片上 → 失去哑光层次。
7. **绿色限量**：sage 只做「进行中 + 品牌 + 左墨条」。完成态一律转灰（`--muted` + `--line-dark`），红色只做危险/逾期/警示纸。
8. **标题的墨压是 1px 白色下高光**（`0 1px 0 rgba(255,255,255,.55)`），不是深色阴影；方向反了就是塑料浮雕。
9. **上浮 1px 必须配套硬边加高（3→4px），回压 1px 必须配套硬边归零（`0 0 0 …`）**。只动 translateY 会显得「飘」。
10. **`.slip` 的 transition 列表不含 `transform`**（行 1225），那 2px 抬升是瞬时的，只有边框与投影在渐变。另：1960 行重新声明了不带 `(hover:hover)` 的 `.slip:hover`，所以触屏上也会浮起来。
11. **输入 hover 只动边框颜色**，位移与内压只留给 `:focus`。两者混用会失去「压凹 = 可输入」的语义。
12. **文字动作要用点线下划线**（`dotted` + `--line-dark`），hover 转实线。静止态必须有至少一个可见信号（边框/底色/下划线/图标），不允许只变颜色。
13. **数字一律 `font-variant-numeric: tabular-nums` + mono**：`.slipCount .slipPath .slipUpdate .stamp small .subMeta .projectFresh .gitDate .headerMeta`。
14. **字号必须走 `--app-font` 派生**，硬写 px 会让三档设置失效。且 ≤760px 用倍率而非 `--fs-*`，说明窄屏需要更小的视觉比——直接复用桌面 token 会溢出。
15. **tab 靠 `::after` 的 `scaleX` 画线**，别改回 `border-bottom`（会挤动基线 2px）。
16. **`.app` 同时有 `background-color` 与 `background-image`（grain）**；写 `background` 简写会把 grain 覆盖掉，纸纹消失。

---

## 9. 未确认 / 缺口

| 项 | 情况 |
| --- | --- |
| 品牌 `svg` 图形路径 | **未确认**。CSS 只给尺寸（`.brandMark svg{24px}`）与颜色，图形在 React 组件内，`.design/` 无对应资源；复刻需自备岛形图标。 |
| 字体加载方式 | **未确认**。CSS 无 `@font-face`，只有字族栈；Noto Sans SC / Noto Serif SC 视为系统已装或外部引入，本仓未覆盖。 |
| 图标集来源 | **未确认**。全部内联 `svg` 组件，CSS 仅声明尺寸；`▸ ▾ ✕ ⟳ ◂` 等为字符。 |
| 390 / 320 专属规则 | 不存在，只能靠 ≤520 / ≤360 组合覆盖。 |
| 行 1–320 旧布局 | 代码仍在但生产不渲染（`.sidebar` `.projectCard` `.projectGrid`），未逐条提取。 |
| 移动端长列表底部间距 | **未确认**。`production-letterpress-mobile-390.png` 只到 844px 高，未见页尾。 |
| `--lp-well-strong: #e8e5db` | 已定义但**全文无引用**（死 token）。 |
| `.stateDot` / `.green` / `.paused` | 旧版项目卡遗留，已由 `.statusChip` 取代，无渲染实例。 |
