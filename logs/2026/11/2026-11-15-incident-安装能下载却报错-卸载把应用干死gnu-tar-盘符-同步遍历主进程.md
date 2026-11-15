---
id: 2026-11-15-incident-安装能下载却报错-卸载把应用干死gnu-tar-盘符-同步遍历主进程
date: 2026-11-15
kind: incident
area: devtools
title: 安装能下载却报错 / 卸载把应用干死（GNU tar 盘符 + 同步遍历主进程）
tags: [install, uninstall, openmaic, laya, tar, freeze]
commits: [fda96c288, e36ad585, 728be93f]
files: [electron/openmaic-install.ts, electron/toolchain.ts, electron/features/runtime-ipc.ts, electron/features/laya-service.ts]
importance: high
---

# 安装能下载却报错 / 卸载把应用干死（GNU tar 盘符 + 同步遍历主进程）

## 现象（用户 11-15 实录）

- 截图：OpenMAIC 安装进行中，点「卸载」后 Windows 弹「Electron 未响应 / 关闭程序 / 等待程序响应」。
- 用户连报：「安装也是报错，laya 和这个都是安装报错」「都是能下载，安装不行」。

## 根因（完整安装链探针逐层复现，不是读代码猜的）

1. **下载完死在解压（主因）**：`runOpenMaicStep(id, "tar", ["-xzf", ...])` 用裸名 tar，
   本机 PATH 第一个是 `D:\workbuddy\resources\vendor\PortableGit\usr\bin\tar.exe`（GNU tar），
   它把 Windows 绝对路径的盘符 `C:` 按 `host:path` 语法当远程主机 ⇒
   `tar (child): Cannot connect to C: resolve failed` + `gzip: stdin: unexpected end of file`，
   退出码 2。97MB 源码包已下载完（codeload 200、gzip magic 正常、Windows 自带 bsdtar 手动解压成功）。
2. **修完 tar 后暴露第二层**：staging 里同时有归档 `OpenMAIC-1.4.2.tar.gz` 与解压目录
   `OpenMAIC-1.4.2/`，两者都 `startsWith("OpenMAIC-")`；旧写法 `readdir(staging).find(...)`
   命中归档文件 ⇒ 把 `.tar.gz` 当目录读 `package.json` ⇒ ENOENT。又一处「下载完就报安装失败」。
3. **失败时误删已装版本**：catch 无条件 `fs.rm(paths.app)`，而 `backup` 到「换目录」之后才赋值。
   下载/解压阶段一失败 ⇒ 用户已经装好的 5GB 版本被删光且无法恢复。
4. **卸载把主进程堵死**：`removeTargetsWithProgress` 用同步 `readdirSync/statSync` **递归遍历**
   OpenMAIC 的几十万个小文件；pip 卸载还用 `spawnSync` 在主进程同步等最多 180 秒 ⇒
   事件循环整段阻塞，Windows 判「未响应」。安装中还能同时点卸载，两边互踩同一个 5GB 目录。
5. **Laya 假失败**：pip `exit 0` 之后还要再跑一次**同步** `pip show` 作二次判定，pip 一抖就把
   已装成的包报成「安装失败」（本机实测 laya 0.4.32 包目录与 dist-info 都在）；
   `installing` 标志无 finally，异常后每次点安装都只回「已有安装任务在进行中」。

排除项（实测，不是根因）：随包 Python/pip 正常（pip install -U laya[serve] exit 0）、
node/npm-cli 正常、D 盘可用 331GB、清华 pip 索引 200、npmmirror 的 pnpm@10.28.0 与
`@embedded-postgres/windows-x64@16.15.0-beta.19` 元数据/tarball 全 200、
回环代理（curl 403 但 pip 带/不带代理都能正常读清华源，对照组证伪）。

## 修法

- 新增 `toolchain.tarExecutable()` 作 **tar 路径单一真相源**：win32 用 `%SystemRoot%\System32\tar.exe`
  （bsdtar，能识别 `C:\...`）、darwin 用 `/usr/bin/tar`；`engine-updater.ts` /
  `openmaic-install.ts` / `runtime-ipc.ts` 三处解压共用，删掉 engine-updater 里的副本。
- 解压后按 `Dirent.isDirectory()` 只认目录，排除 `.tar.gz`。
- 安装失败只在 `backup` 真实存在时删 app 并恢复；第一次安装失败保持现状、只清 staging。
- 卸载遍历改 `await fs.readdir` / `await fs.stat`，每 200 项 `setImmediate` 让出事件循环；
  pip uninstall 改异步 `spawn` + 超时 kill。
- `runtime:uninstall` 检查 `runtimeInstalls.has(id)` 拒绝在装时卸载；OpenMaicCard 同步禁按钮。
- Laya 成功判据只认 `exit 0`（落盘复核交给 `assertInstallVerified`，与卡片同源）；
  `installing` 在 finally 复位。
- 安装失败把完整 stack 写 `userData/logs/install-errors.log`（界面只有一行截断文案，重启即丢）。

## 判据

- 主仓 `npm run check` **预检通过（exit 0，5 条既有告警）**；`npm run build` 通过。
- 探针（stub userData 指向临时目录，用户真实安装零改动）：
  - 修复前：20 秒内分别死在 `Cannot connect to C:` 与 `ENOENT ... .tar.gz/package.json`；
  - 修复后：越过下载、解压、`package.json` 版本校验（1.4.2）、换目录、运行时组件安装、
    PG 初始化并启动，**进入 pnpm 依赖安装阶段**；该探针在 stub 环境里未跑完完整构建，
    已停止并清理临时目录（含临时 PG），用户真实 `BUILD_ID` / `version.txt` 复核未动。
- 守卫：`12s` 35/35、`12bp` 67/67、`12h` 43/43、`07-turn-fold`【32】改读新真相源后全绿；
  `09-structural` 棘轮按实测 1246→1277。
  ⛔ 两条假红来自守卫自身：`12h` 固定 6000 字符窗口（卸载链变长后把 `recordToolRemoved` 挤出）、
  `07` 仍去 engine-updater 切 `function tarExecutable`（函数已搬走）⇒ 已分别改成按 handler 边界
  与新真相源定位。
- 三仓各自 `npm run build` 通过，产物 CSS mtime ≥ 源码 mtime；云助手已 `deploy-cloud-ui`
  并核对服务器哈希一致。

## 遗留 / 下一步

- 完整安装链在真机上是否还有第三层问题，需**重启应用后再点一次安装**确认；
  若仍报错，直接看 `%APPDATA%/Codex Harness Desktop/logs/install-errors.log`（本轮新增落盘）。
- 卸载「不卡死」由代码结构（同步→异步）+ 守卫钉死验证，**未做真机 5GB 卸载实测**
  （真跑会删掉用户已装好的 OpenMAIC，不能拿用户数据做实验）。
- 本轮未发版；改动在主进程 + 渲染层，用户本地需重启应用生效。
