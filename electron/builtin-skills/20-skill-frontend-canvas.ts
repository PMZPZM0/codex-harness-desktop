/**
 * builtin-skills 的「frontend-canvas」部分（10-05 夜，用户：「UI里面的组件，你可以根据（现有的）
 * 再丰富一些」）——「前端开发」画布（嵌 m3e-canvas）的组件手册。
 *
 * 为什么要做成技能而不是塞进工具描述：36 种组件每种都有自己的字段与默认尺寸，全塞进
 * `frontend_apply_doc` 的 description = **每一轮请求都背着几 KB**（本仓纪律：细节渐进披露，
 * 见第 12/13 条指令与 harness-api 的同款理由）。工具描述只列全 36 个**名字**（让模型知道
 * 有这些可用），字段级说明放这里，真要拼界面时按需读。
 *
 * 内容出处：上游 m3e-canvas 的 agent.md（MIT，随包在 public/sketch/ 里）+ 本仓实测的
 * 写回校验口径（validateSketchDoc 的 kind/variant 枚举与上游 bundle 逐字对账，守卫【283】）。
 * ⛔ 别在正文里教模型直接碰画布存储（写回只走 frontend_apply_doc → 上游分享哈希导入，
 *    桥从不 setItem —— 见 scripts/sketch-bridge.js 头部）。
 * ⛔ 工具名与指令第 13 条（FRONTEND_CANVAS_INSTRUCTIONS）同源，改名要一起改（守卫【283】钉）。
 */
export const FRONTEND_CANVAS_SKILL = `---
name: frontend-canvas
description: 「前端开发」画布的操作手册。当用户要手机 App 界面 / 电脑（桌面）界面 / 网页原型 / 前端页面设计稿，或让你「拼界面 / 继续摆 UI / 加一屏 / 改一下这个稿」时使用。含 36 种 Material 组件的字段速查、手机 / 电脑 / 网页三种形态、导航动作、主题与坐标规则，以及 frontend_get_doc / frontend_apply_doc 的用法。
---
# 前端开发画布手册（m3e-canvas）

应用里内置一块「前端开发」画布（侧栏「···更多」可打开）：**手机 App 界面、电脑（桌面）界面、
网页**都能在它上面拼 —— 摆好的界面可一键**预览**（手机样机交互演示：点按跳转 / 滑动返回，
屏幕切换带 M3 动效），也能直接交给 Codex 变成前端任务。
你可以用两个工具直接在画布上读和写：

| 工具 | 干什么 |
|---|---|
| \`frontend_get_doc\` | 读回整份设计文档（JSON）+ 一句摘要 —— **动手前先调它** |
| \`frontend_apply_doc\` | 把改完的**完整**文档写回画布 —— 用户实时看到、可继续手改、可 Ctrl+Z 撤销 |

⛔ 三条铁律：

1. **在 get 返回的文档基础上改**，别凭记忆重写（会把用户的稿整个覆盖）；
2. 每次传**整份**文档（不是补丁、不是片段）；
3. 别编造没用过的字段 —— 写侧有前置校验，不合规会回中文原因且**不打开画布**；改对再来。

画布没开时工具会自动打开并等就绪（≤15s），用户看到的就是你写进去的最终稿。

## 一、文档结构（顶层）

\`\`\`jsonc
{
  "title": "菜谱",                // 应用名
  "brief": "存菜谱、搜菜谱",       // 一两句用途（可选）
  "frame": "phone",              // "phone"（默认）或 "desktop" —— 决定预览板式
  "platform": "android",         // "android"（默认，原生应用）或 "web"（浏览器应用）
  "paletteKey": "purple",        // purple | blue | green | coral | amber | teal | mono
  "dynamicColor": false,         // 可选：动态配色（Android 12+ 壁纸取色 / web 用系统强调色）
  "theme": { /* 可选，见 §六 */ },
  "frames": [ /* 屏，见 §二 */ ],
  "groups": [ /* 部件组，见 §三；图层序：靠后的画在上层 */ ]
}
\`\`\`

⛔ **用户侧的字段原样带回去**：get 返回的文档里如果还有 \`promptEdit\` / \`promptOptions\` /
\`customPalette\` / \`dynamicColor\` / \`theme\` 这些（提示词自定义、调色板、动态配色 —— 用户在
画布设置里的选择），apply 时原样带上，**别删、别改**，除非用户明确让你改。

## 二、屏（frames）

\`\`\`json
{ "id": "home",   "name": "首页", "x": 0,   "y": 0, "note": "列出全部菜谱" }
{ "id": "detail", "name": "详情", "x": 492, "y": 0 }
{ "id": "settings", "name": "设置", "x": 984, "y": 0, "swipe": { "left": "home" } }
\`\`\`

- \`id\` 唯一；\`name\` 是提示词里的屏名；\`x/y\` 是画布坐标。
- **手机屏 412×892**（默认）；**电脑屏 1280×800**（显式给 \`"w": 1280, "h": 800\`）。屏与屏之间**留 80**。
- 可选项：
  - \`note\`：这屏是干嘛的 —— **原样进提示词**，值得写；
  - \`bg\`：背景令牌 \`surface | surfaceContainerLow | surfaceContainer | surfaceContainerHigh | surfaceContainerHighest | primaryContainer | secondaryContainer | tertiaryContainer | primary | inverseSurface\`；
  - \`swipe\`：滑到哪屏（\`left | right | up | down\`），预览里真的能滑；
  - \`place\`：整理（Tidy）后部件怎么落：\`top\`（默认）| \`center\` | \`bottom\` | \`spread\`。

## 三、部件组（groups）

每个部件住在**组**里。组 = 一个部件，或一族部件连成的一段：按钮并排 \`"axis": "x"\`、
列表项竖排 \`"axis": "y"\`。坐标是**画布坐标**（记得加上屏的 x/y）。

\`\`\`json
{ "id": "g1", "x": 0, "y": 0, "axis": "x", "items": [
  { "id": "bar", "kind": "topAppBar", "label": "菜谱", "icon": "menu", "icon2": "search", "variant": "filled" } ] }
\`\`\`

- 能连成一组的族：\`button\`+\`button\`、\`iconButton\`+\`iconButton\`、\`chip\`+\`chip\`（axis 用 x）；
  \`listItem\`+\`listItem\`（axis 用 y）。其他一律**一组一个**（axis 照样必填，填 \`"x"\`）。
- \`items\` 不能空。

## 四、部件（items）公共字段

- 必填：\`id\`、\`kind\`、\`label\`（可以空串）、\`icon\`（Material Symbols 图标名，或 \`null\`）、\`variant\`。
- \`variant\`：\`filled\`（默认外观）| \`tonal\` | \`elevated\` | \`outlined\` | \`text\`。
- \`note\`：这个部件干什么用的 —— **原样进提示词**。写"点了发生什么、存什么、校验什么"。
- \`action\`：点击打开哪屏：\`{ "to": "<屏id>" | "back", "transition": "slide" | "slideLeft" | "slideUp" | "slideDown" | "fade" | "expand" | "none" }\`。
- \`toggle\`（按钮）：点一下之后换成 \`{ "icon": "favorite", "variant": "filled", "label": "已收藏" }\`。

## 五、36 种组件速查

尺寸单位是 dp；\`size\` 是宽（除非另注）。内容宽度（手机屏边距内）是 **380**。下表"默认尺寸"是画布替你补的值。

| kind | 是什么 | 常用字段 | 默认尺寸 |
|---|---|---|---|
| \`topAppBar\` | 顶部应用栏 | \`label\` 标题、\`icon\` 前导、\`icon2\` 尾部、\`actions\`（键 \`icon\` / \`icon2\`） | 412 × 88，贴屏顶 |
| \`bottomNav\` | 底部导航栏 | \`tabs\`（3–5 个 \`{icon,label}\`）、\`selected\`（第几个）、\`actions\`（键 \`tab:0\`…） | 412 × 104，贴屏底 |
| \`navRail\` | 侧边导航栏（桌面） | \`tabs\`、\`selected\`、\`railExpanded\`（吸顶/展开态）、\`railModal\`（展开时盖一层遮罩）、\`size2\` 高 | 收起 96 / 展开 220 |
| \`tabs\` | 标签页行 | \`tabs\`（任意个数，≥6 个横向滚动）、\`selected\` | 412 × 48 |
| \`searchBar\` | 搜索栏 | \`label\` 占位文案、\`icon2\` 尾部图标 | 380 × 56 |
| \`button\` | 按钮 | \`label\`、\`icon\`、\`action\`、\`toggle\`、\`size\` 宽（省略=随文字；380=整行；182=并排半宽） | 随文字 × 56 |
| \`iconButton\` | 图标按钮 | \`icon\`、\`action\` | 48 × 48 |
| \`fab\` | 浮动按钮 | \`icon\`、\`size\` 40 / 56 / 96 | 56 × 56，右下 |
| \`extendedFab\` | 带字浮动按钮 | \`label\`、\`icon\` | 随文字 × 56 |
| \`splitButton\` | 拆分按钮 | \`label\`、\`icon\` | 随文字 × 56 |
| \`fabMenu\` | 展开的浮动按钮菜单 | \`tabs\` 当条目 | 宽 220 |
| \`toolbar\` | 浮动工具栏（桌面） | \`tabs\` 当图标按钮、\`variant\` tonal（标准）/ filled（醒目） | 高 64 |
| \`chip\` | 标签片 | \`label\`、\`icon\`、\`checked\` | 随文字 × 32 |
| \`card\` | 卡片（图区+标题+正文） | \`label\`、\`supporting\`、\`icon\`、\`fill\` 背景令牌、\`size\` 宽、\`size2\` 高、\`noImage\` 去掉图区、\`src\` https 图、\`action\` | 380 × 223 |
| \`listItem\` | 列表项 | \`label\`、\`supporting\`、\`icon\` 前导、\`icon2\` 尾部、\`switch\`+\`checked\` 尾部开关、\`action\` | 380 × 72 |
| \`box\` | 素容器 | \`size\` 宽、\`size2\` 高、\`fill\` 令牌、\`radiusTop\`、\`radiusBottom\` | 412 × 220 |
| \`bottomSheet\` | 底部抽屉（贴底的弹层） | \`size\` 宽、\`size2\` 高、\`fill\` 令牌、\`radiusTop\` | 412 × 320 |
| \`dialog\` | 对话框 | \`label\` 标题、\`supporting\` 正文、\`icon\` | 312 × 220，居中 |
| \`snackbar\` | 底部提示条 | \`label\`、\`supporting\` 动作字 | 344 × 48 |
| \`textField\` | 输入框 | \`label\`、\`supporting\` 帮助字、\`icon\`、\`variant\` outlined / filled | 380 × 56 |
| \`select\` | 下拉选择 | \`label\`、\`tabs\` 当选项 \`{ "label" }\`、\`selected\` 初始项、\`supporting\`、\`icon\`、\`variant\` | 380 × 56 |
| \`switch\` | 开关（带标签） | \`label\`、\`checked\`、\`size\` 宽（380 = 标签左、开关右） | 随文字 × 48 |
| \`checkbox\` | 复选框 | \`label\`、\`checked\` | 高 40 |
| \`radio\` | 单选 | \`label\`、\`checked\` | 高 40 |
| \`slider\` | 滑杆 | \`value\` 0–100 | 380 × 44 |
| \`datePicker\` | 日期选择器 | \`layout\`：modal（默认）/ docked / input | 328 × 484，居中 |
| \`timePicker\` | 时间选择器 | \`layout\`：dial（默认）/ input | 328 × 420，居中 |
| \`text\` | 一行文字 | \`label\`、\`size\` 字号（默认 28）、\`bold\` | — |
| \`image\` | 图片 | \`size\` 边长、\`src\` https 链接（可省） | 200 × 200 |
| \`carousel\` | 轮播 | \`layout\`：multiBrowse（默认）/ uncontained / hero / fullScreen、\`count\` 2–8（默认 4）、\`size2\` 高、\`tabs\` 当条目（\`actions\` 键 \`tab:0\`…） | 412 × 180 |
| \`camera\` | 相机预览位 | \`size\` 宽、\`size2\` 高 | 380 × 507 |
| \`map\` | 地图位 | \`size\` 宽、\`size2\` 高 | 380 × 285 |
| \`divider\` | 分隔线 | — | 380 × 16 |
| \`loadingIndicator\` | M3 加载指示器 | \`contained\` | 48 × 48 |
| \`linearProgress\` | 线性进度 | \`value\`（省略 = 不定态）、\`wavy\`、\`trackThickness\` 2–16 | 380 × 24 |
| \`circularProgress\` | 环形进度 | \`value\`（省略 = 不定态）、\`wavy\`、\`trackThickness\`、上限 = size 的 1/6 | 48 × 48 |

⛔ 枚举之外没有别的 kind（旧文档里的 \`badge\` 已被上游移除，写了会被拒）。\`icon\` 用
Material Symbols 图标名（\`home\` / \`search\` / \`add\` / \`favorite\` / \`settings\` / \`arrow_back\` /
\`more_vert\` / \`edit\` / \`delete\` / \`share\` / \`restaurant\` / \`photo_camera\` …）。

## 六、手机 / 电脑 / 网页，主题与动效

- **三种形态（同一份稿可以混搭）**：
  - **手机**：默认 412×892（竖屏）。
  - **电脑**：显式给 \`"w": 1280, "h": 800\` —— 配 \`platform: "web"\` 是**桌面浏览器视口**，配 \`"android"\` 是**横屏平板**。
  - **网页**：\`platform: "web"\` = 实现目标是"在浏览器里运行的应用"；\`"android"\`（默认）= 原生应用。
  - 混放时，**同名屏**当作"同一屏的两种宽度"，按响应式实现（提示词会这么写）。
- **导航**：预览里点按走 \`action\`，滑动走 \`swipe\`；返回用 \`"to": "back"\`。
  过渡：slide（从右进）/ slideLeft / slideUp / slideDown / fade / expand / none。
- **主题**（可选）：\`"theme": { "dark": false, "bothModes": true, "contrast": "standard|medium|high", "shape": "square|rounded|full", "font": "roboto|robotoFlex|robotoSerif|system", "emphasized": false, "motion": "standard|expressive" }\`。
  \`motion: "expressive"\` 是弹性弹簧 —— **预览里的屏幕切换动画**和提示词都跟着它走。

## 七、摆得好看的四条（上游原话的提炼）

1. **一屏一个主意**；3~5 屏足够；主屏配 \`topAppBar\` + \`bottomNav\`（tab 各屏一致、\`selected\` 对得上）。
2. **真文案**（用户的语言），别 lorem ipsum；\`note\` 只写在"标签没说清"的地方；不用为了填满堆部件。
3. **导航闭环**：列表进详情、详情能返回（\`back\`）、FAB 打开表单。
4. 主操作给整行宽（\`size: 380\`）；两个按钮并排各 182 放**同一组**；同类行用 \`listItem\` 串、别堆一列卡片；卡片高度保持一致。

## 八、提交前自查

- 每个 \`id\` 唯一；每个 \`action.to\` 指向真实屏 id 或 \`back\`；
- 每个部件都有 \`id / kind / label / icon / variant\`；
- 组坐标已经加上屏的偏移；图片只放 https 外链（别内嵌 base64）；
- 交回去的永远是**完整文档**，不是对它的描述。
`;
