/**
 * 内置技能 design-md-library（11-15）：84 份品牌 DESIGN.md 参考库的用法。
 * ⛔ 与工具 `design_md`、设置页「设计参考」、随包 resources/design-md/library.json 同源；
 *    数据由 scripts/sync-design-md.mjs 从 VoltAgent/awesome-design-md（MIT）生成，别在这里抄规范正文。
 * ⛔ 合规边界（参考 ≠ 复刻）：不复制品牌 logo / 商标 / 图片 / 专有字体，生成界面不冒充官方。
 */
export const DESIGN_MD_SKILL = `---
name: design-md-library
description: 品牌设计语言参考库（84 份真实网站的 DESIGN.md，MIT）：用户点名「做成 Linear / Vercel / Apple 那种风格」时，用 design_md 工具取整份规范（颜色 / 字体 / 圆角 / 组件 / Do&Don't / 响应式）再按它实现界面。
---

# 设计参考库（brand DESIGN.md）

## 它是什么
- 随包 84 份 **DESIGN.md**，来自 VoltAgent/awesome-design-md（MIT），按 10 类：AI 与模型平台 / 开发者工具 / 后端与数据平台 / 效率与 SaaS / 设计与创意 / 金融与加密 / 电商与零售 / 媒体与消费科技 / 汽车 / 复古网页。
- 每份是 Google Stitch 的 DESIGN.md 格式：
  - 顶部 **YAML tokens**：颜色（canvas / surface / ink / primary / semantic）、字体层级、圆角、组件定义；
  - 正文：Visual Theme、布局与间距、组件规则、Do's / Don'ts、响应式、迭代指南、已知缺口。
- 代表 slug：\`linear.app\`（极简紫）、\`vercel\`（黑白精密）、\`apple\`（留白 + SF）、\`stripe\`（紫色渐变）、\`notion\`（暖色极简）、\`raycast\`（深色渐变）、\`claude\`（暖陶土）、\`spotify\`（黑绿）、\`nike\`（大字摄影）、\`binance\`（黄黑交易感）。
- 设置 → 能力与内容 →「设计参考」可以浏览、搜索、预览、复制、导出到当前项目。

## 怎么用（工具 \`design_md\`）
1. 先定「像谁」：\`action="search"\` 传风格关键词（如 minimal dark / fintech / editorial）或品牌名；已知品牌直接用 \`action="list"\` 按分类看。
2. 拿到 slug 后 \`action="get"\` 取整份规范（单份 4–43KB，一次读完）。
3. 按规范落地：
   - 颜色 / 字体 / 圆角 / 间距**映射到用户项目自己的 CSS 变量或主题 token**，⛔ 不新造第二套调色板；
   - 组件逐一对照它的 buttons / cards / inputs / navigation 规则（含 hover / focus / disabled）；
   - 遵守 Do's / Don'ts 与响应式断点、触控尺寸。
4. 与内置技能 \`frontend-design\`（设计方法）和项目自己的 \`DESIGN.md\`（具体色值）配合：**方法看技能，取值看项目 DESIGN.md，风格参考看本库**。
5. 需要把规范留在项目里：设置页「设计参考 → 导出到项目」会写到 \`design-references/<slug>.md\`；⛔ 不覆盖项目根目录的 DESIGN.md。

## 合规边界（必须遵守）
- 这是**风格参考**，不是品牌授权：⛔ 不复制 logo、商标、产品截图、专有字体；字体用文档里给出的开源替代（如 SF Pro → 系统字体栈）。
- ⛔ 生成的界面不要出现该品牌名字冒充官方；文档出处可在代码注释里注明（VoltAgent/awesome-design-md，MIT）。
- 文档里的色值来自公开网站的 CSS 提取，可直接用于自建界面；品牌名称本身不要写到用户可见标题里。

## 什么时候用
- 用户说「做成 XX 那种风格 / 像 XX 官网 / 参考这个网站的设计」。
- 用户贴了一张网站截图或链接，要复刻其设计语言（先搜库，库里没有再自己分析截图）。
- 需要一整套成熟的设计 tokens 起点（比从零定色板快，且带 Do/Don't 约束）。

## 什么时候别用
- 用户只要通用界面、没有指定风格：直接用 \`frontend-design\` 方法 + 项目 DESIGN.md，不必引入外部品牌语言。
- 用户要的是**品牌资产本身**（logo、官方字体、品牌规范手册）——本库没有，如实说明，不要伪造。
- 复古网页类（\`dell-1996\` / \`nintendo-2001\`）是有意做旧风格：只在用户明确要复古时才用。
`;
