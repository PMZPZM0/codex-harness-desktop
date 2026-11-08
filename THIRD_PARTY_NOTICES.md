# 第三方内容声明（Third-Party Notices）

本文件记录 Codex Harness Desktop **内置分发**的第三方内容（技能 / 数据 / 代码片段）及其许可与来源。
本项目自身以 MIT 许可发布（见 `LICENSE`）。

> **维护约定**：内置内容一律**逐字**保留上游原文，不做本地改写 —— 这样既能按 sha256 判断「上游有没有更新」，
> 也不会把别人的话变成「我们说的」。任何本地适配都写在本文件或代码注释里，而不是就地改原文。
> 更新上游内容时：改常量 → 重跑 `npm run check`（预检【82】会比对 sha256 并给出差异提示）→ 同步本文件的 sha 与日期。

---

## 1. 内置技能（随应用写入 `codexHome/skills/`）

### humanizer

| | |
|---|---|
| 来源 | <https://github.com/blader/humanizer> |
| 作者 | blader 及贡献者 |
| 许可 | MIT |
| 文件 | `SKILL.md`（仓库根目录） |
| 内置位置 | `electron/builtin-skills.ts` 的 `HUMANIZER_SKILL` 常量 → 落盘为 `skills/humanizer/SKILL.md` |
| 内置字节数 | 29102 |
| 内置时 sha256 | `c39879e29a7fe8a9e4bcd0ef66339589ba0e85e3893521ecb0d96a277761467c` |
| 内置日期 | 2026-09-21 |
| 说明 | 去掉 AI 写作痕迹（按 Wikipedia「Signs of AI writing」整理的模式表）。原文未做任何修改。 |

### no-ai-slop

| | |
|---|---|
| 来源 | <https://github.com/petergyang/no-ai-slop> |
| 作者 | Peter Yang 及贡献者 |
| 许可 | MIT |
| 文件 | `skills/no-ai-slop/SKILL.md` |
| 内置位置 | `electron/builtin-skills.ts` 的 `NO_AI_SLOP_SKILL` 常量 → 落盘为 `skills/no-ai-slop/SKILL.md` |
| 内置字节数 | 10950 |
| 内置时 sha256 | `1c1abfa4e447e2e96f02832cc3d31d8b298184027aab1bb4cf5aa33179dc2f81` |
| 内置日期 | 2026-09-21 |
| 说明 | 编辑草稿去 AI 味 / 检测 AI 味（另一套口径，与 humanizer 互补）。原文未做任何修改。 |

### i-have-adhd

| | |
|---|---|
| 来源 | <https://github.com/ayghri/i-have-adhd> |
| 作者 | ayghri 及贡献者 |
| 许可 | MIT |
| 文件 | `skills/i-have-adhd/SKILL.md` |
| 内置位置 | `electron/builtin-skills.ts` 的 `I_HAVE_ADHD_SKILL` 常量 → 落盘为 `skills/i-have-adhd/SKILL.md` |
| 内置字节数 | 7349 |
| 内置时 sha256 | `37f3ff72c0514f0119bd43753030e9c916abf10ef0c358fe849c3b4ea3ff6c88` |
| 内置日期 | 2026-09-21 |
| 说明 | 输出风格：先给下一步动作、编号、末行给一个动作、限长。原文带 `disable-model-invocation: true`。⚠️ **该字段引擎不执行**（2026-10-06 二进制取证：全量扫 `codex.exe`，这个字段只出现在两处——① 给模型看的技能编写规范文本；② 校验**插件内**技能（`<plugin>/skills/*`）的 Python 脚本，而那条规则的内容是「必须是 false」。`$CODEX_HOME/skills/` 不走那个校验，运行时没有任何读取/过滤它的代码）⇒ 它既不阻止自动使用，也不带来自动使用。是否「常驻生效」由**本应用自己的开关**决定：设置 → 控制台 → 回复风格；开关状态经 `electron/output-styles.ts` 翻成 `developer_instructions` 的常驻段下发（10-06 用户报障「没有自动生效，要我点名才生效」后的定稿口径）。原文未做任何修改。 |

> **为什么内置这三个**：本应用把「写文档 / 改文案」作为常见用途之一，这三份技能是 MIT 许可的纯文本指令
> （零依赖、零可执行代码），内置成本极低（合计约 47 KB）且能直接提升改稿质量。用户可在「设置 → 技能」里单独停用。

### grill-me

| | |
|---|---|
| 来源 | <https://github.com/mattpocock/skills>（`skills/productivity/grill-me` + `skills/productivity/grilling`） |
| 作者 | Matt Pocock 及贡献者 |
| 许可 | MIT |
| 文件 | `skills/productivity/grill-me/SKILL.md`（3 行代理）+ `skills/productivity/grilling/SKILL.md`（方法论） |
| 内置位置 | `electron/builtin-skills/24-skill-grill-me.ts` 的 `GRILL_ME_SKILL` 常量 → 落盘为 `skills/grill-me/SKILL.md` |
| 内置日期 | 2026-10-26 |
| 说明 | **改编，非逐字**。上游分两层：`grill-me` 正文只有一句「Call the Skill tool with "grilling"」——本应用没有 Claude Code 的 `Skill` 工具，照抄即是一条指向不存在能力的死指针，故把两份合成一份同名技能。方法论（设计树 / 轮次 / 前沿 / 每题附推荐答案 / 事实归 agent、决策归用户 / 未确认不动手）逐条保留；改写部分只有两处：① 去掉对 `Skill` 工具的委托；② 「事实由子智能体查」按本应用的子智能体与工具面表述。⛔ 因是改编，不参与预检【82】的 sha256 上游比对。原文未内置 `disable-model-invocation: true` —— 该字段引擎不执行（见 `i-have-adhd` 条目），改用 description 明写「不要自动触发」。 |

---

## 2. Python 依赖（可选安装，装在内置 Python 运行时里）

### markitdown

| | |
|---|---|
| 来源 | <https://github.com/microsoft/markitdown> |
| 作者 | Microsoft 及贡献者 |
| 许可 | MIT |
| 引入方式 | **按需下载，不内置**：装有清华 PyPI 镜像（装一次约 4~5 分钟），没必要让每个用户默认付约 120 MB。两个入口：① 「设置 → 开发工具 → 文档转换（markitdown）」点一次安装；② Codex 自己用清华镜像 `pip install`（由内置技能 `document-convert` 给出命令）。库源码不随包分发。 |
| 安装的 extras | `markitdown[pdf,docx,pptx]` + 单独的 `openpyxl`。<br>**不含 `[xlsx]`**：它的 Excel 转换器硬 `import pandas`（+59 MB）—— 本应用改用已装的 openpyxl 直读 Excel（见内置技能 `document-convert`）。<br>**不用 `[all]`**：实测 273 MB+，含 Azure 云端文档智能 SDK、音频与 YouTube 依赖，与本地文件转换无关。 |
| 体积 | 约 120 MB（实测。其中 onnxruntime 35 MB + numpy 31 MB 是 markitdown 基础依赖 magika 的硬依赖，规避不掉；PPT 的 Pillow 约 18 MB） |
| 引入日期 | 2026-09-21 |
| 说明 | 把 PDF / Word / PowerPoint 等二进制文档转成 Markdown，使模型能读用户拖进来的附件；由内置技能 `document-convert` 教模型调用（含 Excel 的 openpyxl 路径）。**转换全程在本机完成，不上传任何文件。** |

---

## 3. 随包分发的其它第三方组件

| 组件 | 许可 | 说明 |
|---|---|---|
| Ego Lite（ego-browser） | MIT（开源仓库） | **外部安装、不随包**。官网 <https://lite.ego.app/zh-cn> · 源码 <https://github.com/citrolabs/ego-lite>；浏览器本体由 Citro Labs 分发，本应用只检测并调用其 CLI。更新由 Ego 官方更新器从官方 CDN 下载（暂无公开第三方镜像） |
| ffmpeg | LGPL/GPL（视构建而定） | 媒体处理，见 `resources/tools/ffmpeg/LICENSE` |
| Git for Windows (MinGit) | GPL-2.0 | 随包或按需安装，见 `resources/tools/git/LICENSE.txt` |
| jq | MIT | JSON 处理 |
| CMake / Ninja | BSD-3-Clause / Apache-2.0 | 构建工具 |
| Node.js / Python | MIT / PSF-2.0 | 内置运行时 |
| python-build-standalone（内置 Python 运行时本体，2026-10-01 起） | PSF-2.0（构建自 CPython；随附 Tcl/Tk 等组件，许可文本见包内 `LICENSE.txt`） | 「设置 → 开发工具 → Python + Tkinter + pip」按需下载（约 45 MB），一个包自带 pip 与 Tkinter；上游 <https://github.com/astral-sh/python-build-standalone>。**替代**了此前的官方 embeddable 包 + Tcl/Tk 安装器方案（后者在部分机器上静默失败，导致 pip 缺失） |
| Nuphus MCP | MIT | 桌面 / 浏览器自动化 MCP（`resources/tools/npm-global`） |
| zy-cinematic-realism（造梦师） | CC BY-NC 4.0 | 电影视觉 Prompt 工作流技能包（`resources/expert-skills/zy-cinematic-realism`，源自 <https://github.com/popopo-99/zy-cinematic-realism>，SKILL.md 与 references/ 逐字未改；中文导读为旁挂 README.zh-CN.md）。⛔ NC = 仅限非商业用途，署名见包内 NOTICE.md |
| dsh-550c-boot 的 550C 开机动画（2026-10-11 移植为「外观 → 开机动画」） | MIT | DSH 插件 `dsh-550c-boot@0.3.3` 的启动片头 —— 动画与 HTML 原稿 **Voidpoket**（<https://github.com/Voidpoket>），插件工程与移植 **Ziyang Song**（<https://github.com/yannicksong0106>）。本应用**逐字移植**其样式表 / 标记 / 驱动：`src/features/settings-appearance/boot550c/assets.ts`（CSS_550C / ENHANCE_CSS / BOOT_MARKUP / APP_MARKUP）与 `show.mjs`（动画驱动，仅加 `export`），零改写。上游 <https://github.com/yannicksong0106/dsh-550c-boot> |

（本表只列「我们主动引入且有明确上游」的组件；上述工具各自的完整许可文本随其自身目录分发。）

### Ego Lite（外部安装的浏览器自动化）

| | |
|---|---|
| 产品 | ego (lite) · 面向 AI Agent 的 Chromium 浏览器 |
| 官网 | <https://lite.ego.app/zh-cn> |
| 开源仓库 | <https://github.com/citrolabs/ego-lite> |
| 作者 / 分发方 | Citro Labs |
| 许可 | 仓库代码 MIT；浏览器本体与官方更新器由 Citro Labs 分发 |
| 本应用关系 | **不打包、不分发浏览器本体**。仅检测本机 `ego-browser` CLI、打开官方下载页、调用 `ego-browser nodejs` / `ego-browser upgrade`，并把官方 `ego-browser` 技能镜像到 Codex 技能目录。 |
| 更新源 | Ego 官方更新器（`ego-browser upgrade`）从官方 CDN 检查/下载；截至 2026-10-22 **没有公开的国内镜像或换源参数**，本应用不代理大文件。 |
| 数据 | 用户的浏览数据、Cookie 等由 Ego Lite 保存在本机；本应用不读取其浏览器数据。 |

---

## 附：依赖许可与字体盘点（2026-11-08 全量实测，守卫【293】【294】）

> 口径：`package.json` 的直接依赖读各自 `package.json` 的 `license` 字段；传递依赖递归
> `node_modules` 去重；捆绑运行时扫 `resources/tools/`（不进 npm）。命令与判据见
> `docs/ARCHITECTURE-RULES.md` §12.3–12.4。

### A. 字体

**本应用不分发任何字体文件**：`src/` 下 0 个 `.woff/.woff2/.ttf/.otf`，无 `@font-face`，
`index.html` 的 CSP 为 `font-src 'self' data:`。界面全部使用**系统字体栈**：

| 用途 | 字体栈 | 说明 |
|---|---|---|
| 正文 | `"Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif` | Windows 自带 / 系统通用族 |
| 等宽 | `"Cascadia Code", Consolas, ui-monospace, monospace` | Windows Terminal 自带 / 系统通用族 |

⇒ 不下载、不分发、不嵌入 ⇒ **无字体授权风险**，也不占包体。
（11-08 已删掉原先写的 `Inter`：未随包、无 `@font-face`、Windows 也没有 ⇒ 永远不会命中。）

### B. npm 依赖（直接 49 个 / 含传递 873 个包）

| 许可 | 直接依赖数 |
|---|---|
| MIT | 43 |
| Apache-2.0 | 5 |
| ISC | 1 |
| **GPL / AGPL / SSPL / CC-BY-NC** | **0** |

含传递依赖全量扫描：873 个去重包中 **copyleft 0 个**。无 `license` 字段但实际有许可文件的两个包
已逐个核对：`exif-parser@0.1.12`（MIT）、`khroma@2.1.0`（MIT）。

### C. 捆绑运行时（`resources/tools/`）

| 组件 | 许可 | 备注 |
|---|---|---|
| Node.js / Python | MIT / PSF-2.0 | 官方发行版 |
| `npm-global` 下 7 个包 | 均 MIT/Apache/ISC | copyleft 0 |
| `ponytail-plugin`（@dietrichgebert/ponytail 5.3.3） | MIT | 技能插件 |
| Python 站点包（545 个） | 绝大多数 MIT/BSD/Apache/PSF | 见下方 LGPL 说明 |
| `rope` 1.15.2 / `pytoolconfig` 1.3.1 / `docstring_to_markdown` 0.17 | **LGPL-3.0-or-later / LGPL-3.0 / LGPL-2.1-or-later** | 见下方 LGPL 说明 |
| 7-Zip（`sevenzip/`） | **LGPL-2.1-or-later**（含 unRAR 限制条款） | 见下方 LGPL 说明 |
| 其余命令行工具（ripgrep / yt-dlp / jq / cmake / ninja / uv / cloudflared / vscode-cli / platform-tools / 脚本运行时） | MIT / Unlicense / MIT / BSD-3 / Apache-2.0 / Apache-2.0 / Apache-2.0 / MIT / Apache-2.0 / MIT | 各自保留上游 LICENSE |

**LGPL 组件说明（可商业分发的前提，缺一不可）**：

1. **未修改源码**：本仓只做调用/打包，不改上述 LGPL 组件；
2. **随包保留许可证文本**：各组件目录内自带 LICENSE/COPYING，安装包原样携带；
3. **保持可替换**：它们都是**独立可执行文件或独立目录**（`resources/tools/<name>`），
   不静态链接进本仓产物，用户可用同版本文件替换 —— 符合 LGPL 的"可替换"要求。

### D. 漏洞扫描（2026-11-08）

`npm audit --omit=dev` 实测：修复前 36 条（high 30 / moderate 1 / low 5），修复后 **34 条**：
- ✅ 已用 `overrides` 收掉：`follow-redirects ^1.16.2`、`qs ^6.17.1`（都经飞书 SDK 传递进来）；
- ⚠️ 仍存在且**经评估可接受**：`jimp` 内嵌 `zod@3.25.76`（advisory 要求 zod ≥4.6.6，jimp 锁 ^3）。
  影响面 = 校验「超大受限集合」时内存耗尽；本应用的图片处理输入是**本机图片**（扩展名白名单 + ≤128MB），
  不接受网络输入，且 jimp 只在用户主动编辑图片时加载。等 jimp 升级 zod 4 后随之消失。
- ⚠️ `katex <0.18.2`（low，原型污染绕过 trust 限制）：修复需 mermaid 12.3.0 大版本，
  渲染的是**我们自己生成的 markdown**（不渲染用户提交的不可信 KaTeX），暂缓跟随。
