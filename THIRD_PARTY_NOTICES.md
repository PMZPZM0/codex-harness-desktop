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
| 说明 | 输出风格：先给下一步动作、编号、末行给一个动作、限长。**原文带 `disable-model-invocation: true`**，即只有用户显式调用（`/i-have-adhd`）才生效 —— 引擎支持该字段（已在本机引擎二进制中确认），因此它不会自行改变默认输出风格。原文未做任何修改。 |

> **为什么内置这三个**：本应用把「写文档 / 改文案」作为常见用途之一，这三份技能是 MIT 许可的纯文本指令
> （零依赖、零可执行代码），内置成本极低（合计约 47 KB）且能直接提升改稿质量。用户可在「设置 → 技能」里单独停用。

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
| Playwright / playwright-cli | Apache-2.0 | 浏览器自动化（开发工具页按需下载浏览器内核） |
| ffmpeg | LGPL/GPL（视构建而定） | 媒体处理，见 `resources/tools/ffmpeg/LICENSE` |
| Git for Windows (MinGit) | GPL-2.0 | 随包或按需安装，见 `resources/tools/git/LICENSE.txt` |
| jq | MIT | JSON 处理 |
| CMake / Ninja | BSD-3-Clause / Apache-2.0 | 构建工具 |
| Node.js / Python | MIT / PSF-2.0 | 内置运行时 |
| Nuphus MCP | MIT | 桌面 / 浏览器自动化 MCP（`resources/tools/npm-global`） |

（本表只列「我们主动引入且有明确上游」的组件；上述工具各自的完整许可文本随其自身目录分发。）
