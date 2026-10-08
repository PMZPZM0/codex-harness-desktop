---
id: 2026-10-08-incident-开发工具安装完不更新卸载留孤儿-dist-info-让-pip-永久空转markitdown-实
date: 2026-10-08
kind: incident
area: devtools
title: 开发工具安装完不更新：卸载留孤儿 dist-info 让 pip 永久空转（markitdown 实测）
tags: [devtools, pip, 判定同源, 安装假成功, mac]
commits: [40e617b]
files: [electron/features/dev-runtimes.ts, electron/features/runtime-ipc.ts, scripts/install-runtimes.cjs, scripts/guards/06-app-behavior.mjs]
importance: high
---

# 开发工具安装完不更新：卸载留孤儿 dist-info 让 pip 永久空转（markitdown 实测）

## 现象

用户报「开发工具安装完不更新」：点「下载」→ 顶部绿条「开发工具安装成功，Codex 引擎已刷新」→ 卡片
仍显示「下载」。截图现场 = 文档转换（markitdown）。用户原话「已经犯了很多次这种愚蠢的错误了」。
这是 **10-07 夜三【285】**（知识库语义检索 / CloakBrowser 卸载不更新）的**同族复发**，只是这次在
安装方向、在 pip 包上。

## 现场取证（不是推测）

```
resources/tools/python/Lib/site-packages/
  markitdown-0.1.8.dist-info/     ← 在（RECORD 里登记了 83 个 markitdown/ 文件）
  markitdown/                     ← 不在（磁盘上一个文件都没有）
```
- `python -c "import markitdown"` → **ModuleNotFoundError**（真的没装）
- `python -m pip show markitdown` → **说装着**（Location 指向 site-packages，读的是 dist-info）
- `python -m pip install --dry-run markitdown[pdf,docx,pptx]` → **Requirement already satisfied**
  ⇒ pip 会 **exit 0 且什么都不做**
- 对照：openpyxl（有包体）import 正常

## 根因 = 三个口径各自为政

| 环节 | 依据 |
|---|---|
| 判定 `runtimeInstalled`（卡片） | site-packages 里的**包目录** |
| 安装动作 `pip install` | **dist-info 元数据** |
| 卸载 `runtimeUninstallTargets` | 只删**包目录**（留 dist-info） |

⇒ 只要卸载过一次（或历史上任何一种「包目录消失、元数据留下」），就进入**不可恢复**状态：
判定说「没装」→ 点下载 → pip 说「already satisfied」退出 0 → 界面报「安装成功」→ 判定仍是「没装」。
**点多少次都一样**。三个 pip 包（markitdown / laya / phone-harness）共用这条链。

## 修法（三处同源，缺一处都还会复发）

1. **`scripts/install-runtimes.cjs`**：装前清孤儿元数据（`stalePipMetadata`）——不清理则 pip 空转；
   装完**复核包目录**，不在就抛错（**不许只信 pip 的 exit 0**）。
2. **`electron/features/dev-runtimes.ts`**：新增 `pipMetadataDirs(site, pkg)`（`<name>[-_]*.dist-info`
   / `*.egg-info` 的单一真相源）。
3. **`electron/features/runtime-ipc.ts`**：卸载 pip 包连元数据一起删；`runtime:install` 三条真实
   安装路径（kb-embedding / laya+phone / 通用）装完一律 `assertInstallVerified` 回读
   `runtimeInstalled` ——**「安装成功」必须与卡片同源**。

第 3 条是关键：它是**整类的拦网**——任何「命令退出码 0 但东西没落盘」的假成功都会被当场拦成
「复核未通过」，而不是演成「绿条 + 卡片未安装」的自相矛盾。

## 顺带：mac 半边补齐（用户要求「mac 也要检查好」）

- ⛔ `python` 的「装没装」原判据写成 `&& !IS_MAC` ⇒ darwin 只查 `python/bin/python3` **一个文件**，
  Windows 侧 10-01 修掉的「坏安装显示已安装（有 exe 无 pip）」在 mac 上**原样存在**且 mac 的
  ensurepip 失败被 try/catch 吞成 optional。现两平台共用「pip 模块必须在」，路径经 `pythonSiteDir`
  （Windows=Lib/site-packages，mac=lib/pythonX.Y/site-packages，版本号不写死）。
- DARWIN_MARKERS 16 项与 `install-runtimes.cjs` 的 `mainMac()` 安装面**逐条对得上**（node/pwsh/python/
  vscode-cli/ninja/sevenzip/rg/uv/cmake/conda/ffmpeg/jq/yt-dlp/platform-tools…）；未覆盖的 12 项
  都另有专用分支覆盖：npm 双落位（nuphus/playwright-cli/cloakbrowser）、无分隔符标记
  （pw-browsers / cloak-cache，与 `PLAYWRIGHT_BROWSERS_PATH` `CLOAKBROWSER_CACHE_DIR` 同源）、
  pip 的 lib/pythonX.Y（markitdown/laya/phone-harness）、guide（docker/openssl）、DARWIN_HIDDEN（mingw）、
  ponytail（codexHome 显式分支）。
- `augmentedPath()` 两平台清单已比对：mac 侧 ffmpeg/bin、yt-dlp、sevenzip、cmake 的 CMake.app 布局、
  miniconda/bin、jq、ninja 都在；无缺口。
- `install()` 解压后**不复核 marker**（只 log "extracted"）—— 新增的主进程复核正好把这层补上。

## 验证

- 真机跑修复后的安装脚本：日志出现 `Installing collected packages: markitdown` →
  `Successfully installed markitdown-0.1.8` → 包目录回来、`import markitdown` **OK**。
  （修复前同样的命令只回 already satisfied 空转。）
- `tsc -b` / `tsc -p electron` 0 错；预检 20 项硬失败**全为环境类**（改前也是 20，无新增）；
  `check-bag-types` / `check-dead-imports` / `check-require-paths` 全绿。
- 守卫：06 新增【286】5 条（元数据单一真相源 / 卸载连删 / 装前清残留 / 装完复核 / 三条路径回读），
  【241】锚点随平台无关化更新；`EXPECTED_CHECKS` 3230 → 3235。

## 教训（可迁移）

- ⛔⛔ **「命令 exit 0」不是「事情做成了」**：pip / npm / 安装器都可能在「已经（自认为）装过」时
  空转并返回 0。凡是「安装」类动作，成功后必须**回读判定**，而判定的依据必须与**卡片同源**。
- ⛔ **卸载要连带删掉「元数据」**：只删一半（删包体留元数据）会造出**比没装更糟**的状态 ——
  外部工具链据此认为已安装，导致重装永久失效。
- ⛔ **同一个能力有多个判定口径时，它们迟早会分叉**（本仓已第三次栽在这上面：10-01 卸载按 marker
  推导、10-07 判定认双落位、10-08 判定 vs pip 元数据）⇒ 新写判定先问「和谁同源、谁读它」。
