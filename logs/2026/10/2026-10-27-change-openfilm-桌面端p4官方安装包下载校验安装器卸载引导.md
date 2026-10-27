---
id: 2026-10-27-change-openfilm-桌面端p4官方安装包下载校验安装器卸载引导
date: 2026-10-27
kind: change
area: openfilm
title: OpenFilm 桌面端（P4）：官方安装包下载/校验/安装器/卸载引导
tags: [openfilm, desktop, p4]
commits: [c6117173a]
files: [electron/openfilm/desktop.ts, src/features/openfilm/OpenfilmCard.tsx, electron/openfilm/runner.ts]
importance: high
---

# OpenFilm 桌面端（P4）：官方安装包下载/校验/安装器/卸载引导

# OpenFilm 桌面端（批次三 / P4）：只搬官方安装包，不做第二套壳

用户令：「有桌面端会更方便」。

## 结论

桌面端 = 上游自己的 Electron 壳（自带 ffmpeg + 渲染浏览器），与 CLI **共用同一个项目库**
（`~/.openfilm` + `libraryRoot()` 都是机器级）⇒ 我们的活是「把它弄到用户手上」，
不是重新做一个播放器/编辑器。

三条通道：`desktop-info` / `desktop-download` / `desktop-run`（action 白名单：
`install`/`silent`/`reveal`/`uninstall`）。

## 四个平台事实（实测 v0.2.6 release，13 个资产）

| 项 | 事实 | 我们的处理 |
|---|---|---|
| Windows 产物 | 只有 `OpenFilm-Setup-x64.exe`（265MB），**无 arm64** | 按 `/^OpenFilm-Setup-.*\.exe$/` 取；ARM 如实说"只能 CLI 形态" |
| macOS 产物 | `OpenFilm-arm64.dmg`(279MB) / `OpenFilm-x64.dmg`(294MB) + 两个 `-mac.zip` | 按 `process.arch` 选 dmg |
| 完整性 | GitHub API 的每个 asset 都带 **`digest: sha256:…`** | 直接用它校验，⛔ 不必去解析 `latest-*.yml` |
| 安装形态 | NSIS（Win）/ dmg（mac） | Win 默认**带界面**跑安装器（看得见，UAC 由系统弹），另给 `/S` 静默档；mac 走 `hdiutil attach` → `cp -R` → `xattr -dr com.apple.quarantine` |

## 四条边界（都写进守卫）

1. ⛔ 不重打包 / 不改名 / 不做自家 CDN —— 装的是上游原包，我们只搬与校验。
2. ⛔ 不代删 `/Applications` 或 `Program Files`（系统目录不在我们的权限面）：Win 启动它自带的
   `Uninstall*.exe`；mac 在 Finder 里选中 `.app` 让用户自己拖废纸篓。
3. ⛔ 不代跑它的 `electron-updater`（App 更新归 App）。
4. ⛔ 「卸载运行时」不带走已下载的安装包（运行时与安装包分属两个目录，别连坐）。

## 两处实现教训

- **不能 await 安装器**：NSIS 会一直开着等用户点"下一步" ⇒ 新增 `runner.launchDetached()`
  （`detached + 3 秒放手`；3 秒内非 0 退出才算失败）。⛔ 也别 `windowsHide` —— 藏起来用户会以为点了没反应。
- **复用而不重写下载**：`updates.downloadUpdate()` 已经做了镜像候选（gh-proxy→ghfast→直连）、
  跟随 302、强制 https、sha256 比对、校验失败删半截文件。再写一份必然漂移。

## 实测（本机 win32/x64）

- `desktop-info`：真实拉到 `v0.2.6` → `OpenFilm-Setup-x64.exe` 265MB，`supported:true`、`installed:false`。
- `desktop-run("reveal")` / `("install")` 未下载时被拦（不会空跑、不会误启动）。
- `desktop-run("rm -rf /")` → 「不支持的动作」（action 白名单在 IPC 边缘生效）。
- 卡片截图：桌面端区块「未安装」徽标 + 「下载桌面端（265MB）」+ 平台说明，无溢出。

## 并行线事故记录（值得记）

我在工作区执行 `register 脚本 + gen:ipc`（改 manifest/preload/vite-env/registry）后，
**另一条工作线的 `git add -A` 把这些改动一起提交了**（云助手仓 `7e7e9628`）。
内容本身正确（count=12、3 条 desktop 通道都在），只是提交归属被吞。
⇒ 教训：**多线并行时，跑生成器后要立刻提交自己的生成物**，否则会被别人的 `git add -A` 带走。
