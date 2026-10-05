# Codex Harness Desktop 便携化（U 盘即插即用）方案

> 立稿：2026-10-05 · 基于当前仓库实测（v0.0.31 / Electron 44.2.0 / electron-builder 26.15.3 / 引擎 0.153.4）
> ⛔ 本文所有体积、路径、行为均来自**代码实测**，文末附取证命令。凡属"需实测确认"的，已显式标注。

---

## 0 先纠正一个前提（这条最重要）

你的原话是：**「不在本机留下任何残留」**。

**这个目标做不到 100%。** 不是实现难度问题，而是 Windows 的操作系统行为决定的 ——
进程一运行，系统自己就会记录痕迹，这些记录**不归应用管**：

| 本机残留物 | 位置 | 应用能否控制 |
|---|---|---|
| Prefetch（程序执行记录） | `C:\Windows\Prefetch\CODEX*.pf` | ❌ 系统行为，删除需管理员权限 |
| 最近使用程序 | 注册表 `HKCU\...\Explorer\RecentDocs` | ❌ 系统行为 |
| 程序路径缓存（MuiCache） | 注册表 `HKCU\...\MuiCache` | ❌ 系统行为 |
| 用户活动记录（UserAssist） | 注册表 `HKCU\...\UserAssist` | ❌ 系统行为（含运行次数/时间） |
| 跳转列表 | `%APPDATA%\Microsoft\Windows\Recent\AutomaticDestinations\` | ❌ 系统行为 |
| DNS / 网络缓存 | 系统级 | ❌ 系统行为 |

**能做到的是**：应用自身产生的**全部数据**（配置 / 缓存 / 会话 / 用户文件 / 引擎状态 / 密钥）
100% 落在 U 盘内，**一个字节都不写本机用户目录**。

⇒ 所以本文的交付标准修正为：
**「应用层零残留（可完全验证）+ 系统层痕迹可一键清理（需管理员，可选）」**。

如果你要的其实是「换电脑后看不见我的对话和 API Key」——那是另一个更强也更简单的目标（见 §5.1）。

---

## 1 可行性结论

**技术上可行，而且这个项目的基础比自己重新搭要好得多** —— 因为架构上已经做了
**「userData 单点收口」**：

- `electron/main.ts:168` → `app.setPath("userData", resolveStartupUserData())`
- `electron/runtime-paths.ts:36-50` → **所有**数据路径（含 `codex-home`）都是
  `path.join(userData, ...)`

⇒ 只要把 `userData` 这一个点指到 U 盘，**配置、会话、引擎 rollout、技能、记忆、凭据、
缓存就全部跟着走**。不需要逐个功能去改。

**三档结论**：

| 场景 | 可行性 | 代价 |
|---|---|---|
| **A. 单机便携**（U 盘固定一台电脑用，只为"不装机器上"） | ✅ 完全可行，改动约 30 行 | 几乎无 |
| **B. 跨机便携**（U 盘插不同电脑用） | ✅ 可行（**用户已选：每台重填供应商**） | 每台新机器重填 1–2 个凭据（约 1 分钟） |
| **C. 零系统痕迹** | ❌ 不可达 100% | 见 §0 |

**最关键的一件事先说（跨机场景）—— 凭据**：

> **`safeStorage`（Windows 用 DPAPI / macOS 用 Keychain）加密的密钥换机器解不开。**
> 实测加密点 **20+ 处**（不是一处）：API Key（`custom-model-ipc.ts:87`）、连接器密钥
> （`connectors-ipc.ts:151`）、机器人密钥（`channel-bot-ipc.ts:66`）、Memory Gateway Key
> （`memory-ipc.ts:66`）、知识库 key（`knowledge-base-ipc.ts:31`）、
> **中转账号密码（`relay-ipc.ts:263`）**、提示词润色（`prompt-polish.ts:34`）等。
>
> DPAPI/Keychain 的密钥**绑定"当前账户 + 本机"**（macOS 还绑定登录钥匙串）⇒ 换机器后
> `isEncryptionAvailable()` 仍为真，但 `decryptString()` 抛错，表现是"密钥莫名其妙失效"。
>
> ⚠️ **但这不是死结**（此处修正本文档早期版本的判断）：
> 项目已把 `safeStorage` **收口成一个接缝** ——
> `electron/runtime/seams/index.ts:65-67` 只暴露 3 个方法
> （`isEncryptionAvailable` / `encryptString` / `decryptString`），
> 全部 20+ 处调用点都走它。
> ⇒ **只要替换这一个接缝的实现**，就能换成"U 盘内密钥库 + 主密码派生密钥"，
> 做到真正跨机可用，**且不降低安全等级**（详见 §8）。
>
> ⛔ 唯一不做的是"把密钥明文写 U 盘"—— 那才是真正的安全降级。
>
> 📌 **用户 10-05 决策**：接受"换电脑重新配置一下供应商"⇒ **§8 的可移植改造不做**。
> 方案因此大幅简化（砍掉 `vault` 板块 + 主密码 UX + 恢复码机制），零代码风险。

---

## 2 现状盘点：数据到底落在哪（实测）

### 2.1 已收口在 `userData` 下的（占绝大多数）

`electron/runtime-paths.ts` 实测清单，全部 `path.join(userData, ...)`：

```
codex-home/            ← 引擎 CODEX_HOME（rollout / sessions / 技能 / AGENTS.md / config.toml）
custom-model.json      ← 自定义模型
custom-models.json
channel-bot.json       ← 机器人绑定
bot-stream.json
memory-gateway.json
pasted-text/           ← 粘贴的临时文本
memory-workspaces.json
memory-mode.json
mcp-server-overrides.json
connectors.json        ← 连接器
builtin-plugins.json
sub-agents.json
```

`electron/main.ts` 另有：`memory.json` / `scheduled-tasks.json` / `expert-teams.json` /
`delegate-threads.json` / `thread-runtime.json` / `remote-sessions.json` / `rpa-recipes.json` /
`task-list.json` / `channel-bindings.json` / `voice-models/` / `weixin-accounts/` /
`scratch/`（`main.ts:998` 注释确认）、`data-dir.json`（仅当改过数据目录）

`electron/data-dir.ts:32`：
```ts
export function defaultUserDataDir(): string {
  return path.join(app.getPath("appData"), "Codex Harness Desktop");
}
```
⇒ Windows 上即 `%APPDATA%\Codex Harness Desktop`（**默认值，可被覆盖**）。

### 2.2 ⛔ 不受 `setPath("userData")` 控制的落点

| 落点 | 触发条件 | 代码位置 |
|---|---|---|
| `%TEMP%\codex-engine-update-*` | 引擎在线更新时 | `electron/engine-updater.ts:310` |
| `%TEMP%\codex-harness-official-*` | 打开官方插件市场时 | `electron/codex-official-market.ts:413` |
| `%TEMP%\codex-harness-skill-*` | 技能市场安装时 | `electron/skills-market.ts:240` |
| `%TEMP%\feishu-voice-*.ogg` | 飞书语音消息时 | `electron/feishu-gateway.ts:118` |

这四处在代码里用的是 `os.tmpdir()` ⇒ 走 `%TEMP%`。
**规避**：启动器把 `TEMP` / `TMP` 重定向到 U 盘（`set TEMP=%ROOT%Temp`）。
⚠️ 注意：这四个都是**功能触发时**才写，不是启动就写（`engine-updater` 需用户点更新）。
**已核实没有** `crashReporter` 调用 ⇒ 无崩溃转储残留（少一个坑）。

### 2.3 打包内容与体积（实测，用于估算 U 盘容量）

| 组成 | 实测体积 |
|---|---|
| Electron 运行时（`node_modules/electron/dist`） | **368 MB** |
| 引擎原生二进制（`codex-win32-x64/vendor`，`asarUnpack` 出包） | **803 MB** |
| `extraResources`（node / python / cmake / uv / npm-global / vscode-cli / expert-skills …） | **1,045 MB**（去重后） |
| app.asar（`dist` 17.7 + `dist-electron` 3.1 + 其余 node_modules） | **约 300 MB** |
| **合计（安装后展开）** | **约 2.5 GB** |
| **本机现有 userData 实测** | **1,642 MB / 20,410 文件** |

`extraResources` 明细（实测，仅列 >1 MB）：

```
python 527 · node 101 · expert-skills 81.5 · cmake 68.9 · npm-global 64.1
uv 58.1 · cloudflared 52.4 · vscode-cli 28.4 · automation-tools.zip 17.4
yt-dlp 17.0 · platform-tools 16.7 · rg 5.5 · sevenzip 2.5 · ponytail-plugin 1.6 · koffi 1.6 · jq 1.0
```

⛔ **这些不打包**（在 `resources/tools` 里但 `extraResources` 未收录）：
`python.fat-laya 1074 MB` · `miniconda 731 MB` · `pw-browsers 701 MB` ·
`cloak-cache 536 MB` · `ffmpeg 307 MB` · `pwsh 282 MB` · `git 90 MB`

⇒ **U 盘容量建议**：

| 用途 | 建议容量 |
|---|---|
| 最小可用（仅应用+数据） | 8 GB（会很紧，数据一长就满） |
| **推荐** | **32 GB** |
| 宽裕（含后续数据增长、引擎更新缓存） | 64 GB |

---

## 3 关键实现思路

### 3.1 现有钩子（不用新造轮子）

`electron/data-dir.ts:157` 已有 `resolveStartupUserData()`，当前优先级：

```
① CODEX_HARNESS_USER_DATA 环境变量   ← 最高优先
② 默认目录 %APPDATA%\Codex Harness Desktop
③ data-dir.json 里的 dir 字段（用户改过数据目录时）
```

⇒ **路线 1（零改代码）**：启动器设 `CODEX_HARNESS_USER_DATA` 即可。
但这条路有个问题：环境变量**对所有子进程可见**，且用户双击 exe 直接启动时会失效。
所以更稳的是路线 2。

### 3.2 ✅ 推荐方案：加「便携标记」为最高优先级

**判据**：exe 同目录存在 `portable.dat`（或 `Data` 目录）⇒ 进入便携模式。

在 `resolveStartupUserData()` **最前面**插入：

```ts
/** 便携模式判据：⛔ 只认 exe 同目录的标记（不认环境变量/注册表，避免误判）。 */
export function portableRoot(): string | null {
  if (process.env.CODEX_HARNESS_PORTABLE === "0") return null;  // 显式关闭口
  const exeDir = path.dirname(app.getPath("exe"));              // 打包后是 exe 所在目录
  // 开发态 app.getPath("exe") 指向 electron.exe，不可作判据 ⇒ 仅打包态生效
  if (!app.isPackaged) return null;
  for (const marker of ["portable.dat", "Data"]) {
    if (fs.existsSync(path.join(exeDir, marker))) return exeDir;
  }
  return null;
}

export function resolveStartupUserData(): string {
  // ① 便携模式（最高优先 —— U 盘插到任何机器都该走自己这份）
  const portable = portableRoot();
  if (portable) return path.join(portable, "Data");

  const envOverride = process.env.CODEX_HARNESS_USER_DATA;
  if (envOverride) return envOverride;
  /* …以下保持原样… */
}
```

**为什么"便携"要比环境变量还优先**：U 盘里的应用如果读到宿主机残留的
`CODEX_HARNESS_USER_DATA`（比如用户自己设过），会把数据写到宿主机去 ——
这与便携的意图相反。⇒ 标记文件是**更强的意图表达**。

**改动量**：`electron/data-dir.ts` 约 20 行 + 打包配置若干。**不动任何业务逻辑**。

### 3.3 打包：用 `dir` target，不用 `portable` target

⛔ **不要直接开 electron-builder 的 `portable` target** ——
它的实现是「运行时自解压到 `%TEMP%` 再运行」，这与"零残留"**直接冲突**
（每次启动都在 `%TEMP%` 落一份几百 MB）。

✅ 正确做法（`package.json` 的 `build` 字段）：

```jsonc
"win": {
  "target": [
    { "target": "nsis", "arch": ["x64"] },      // 保留现有安装包
    { "target": "dir",  "arch": ["x64"] }       // 新增：免安装目录版（U 盘用这个）
  ]
},
"portable": {                                    // ⛔ 不要加，见上
  "artifactName": "..."
}
```

打完得到 `release/win-unpacked/` —— 整个目录拷进 U 盘，再在根放 `portable.dat`。

### 3.4 启动器（可选但推荐）

如果要让用户"双击就能用"，在 U 盘根放一个 `启动.bat`：

```bat
@echo off
setlocal
set "ROOT=%~dp0"
set "TEMP=%ROOT%Temp"
set "TMP=%ROOT%Temp"
if not exist "%ROOT%Temp" mkdir "%ROOT%Temp"
if not exist "%ROOT%Data" mkdir "%ROOT%Data"
start "" "%ROOT%win-unpacked\Codex Harness Desktop.exe" %*
```

它做两件事：把 `%TEMP%` 重定向到 U 盘（堵住 §2.2 的四个口子）、确保目录存在。
⛔ 如果嫌 .bat 闪窗，可用同名 exe 放在 U 盘根（或用 `wscript` 包一层）——
但 **.bat 是最透明、用户最可审查的**，建议先用它。

### 3.5 首启必须处理的三件事

1. **禁用引擎自动更新**（或改为写入 U 盘）：
   `engine-updater.ts` 的工作目录在 `%TEMP%`（已被 §3.4 兜住），
   但**新引擎版本会落到 U 盘的 `codex-home`** ⇒ 换机器时架构必须一致（win32-x64）。建议在 UI 上把"自动更新"关掉，改为手动。
2. **单实例锁**：`main.ts:646` 有 `app.requestSingleInstanceLock()`。
   ⚠️ 同一台机器同时插两个本应用 U 盘、或本机已装同版本，**可能**互相顶掉
   （Electron 的锁范围与 userData 相关，但**未实测**）。
   ⇒ **建议实测确认**；若真冲突，便携模式下加 `app.releaseSingleInstanceLock()` 或跳过锁。
3. **首次运行建目录**：`Data/` 为空时全部走默认值，不会崩（已核实 `resolveStartupUserData` 有 fallback）。

---

## 4 常见问题与规避

| # | 问题 | 成因 | 规避 |
|---|---|---|---|
| 1 | **换电脑后 API Key 失效** | DPAPI 绑定用户+机器（§1） | 无解，只能重填；或让用户接受"每台机器填一次"。⛔ 不要改成明文存 U 盘 |
| 2 | **U 盘插别的 USB 口后找不到数据** | 盘符漂移（E: → F:） | 一律用 `%~dp0` / `app.getPath("exe")` **相对定位**，⛔ 绝不硬编码盘符 |
| 3 | U 盘是 **exFAT**，报符号链接错误 | exFAT 不支持 symlink | ⛔⛔ **⚠️ 本条已修订**：Windows 产物确实无签名链接（已扫），**但 macOS 的 `.app` 必然含 symlink**（Framework 结构）⇒ **mac 盘绝不能用 exFAT，必须 APFS**（详见 §9.2）。⛔ 源码目录（含 `node_modules`）在任何平台都不能直接放 exFAT |
| 4 | 单文件 > 4 GB 写入失败（FAT32） | FAT32 上限 | 用 exFAT 或 NTFS；实测最大单文件未超限，但引擎更新可能超大 |
| 5 | **运行很卡** | U 盘随机 IOPS 极低；引擎要读 803 MB + SQLite 频繁写 | 用 **USB 3.2 Gen2 + 固态 U 盘**（普通 U 盘顺序~30 MB/s、随机几 KB 级，会非常卡） |
| 6 | 拔盘/松动导致数据损坏 | SQLite / JSONL 半写 | 先"安全弹出"再拔；⛔ 别在生成中拔；重要数据定期备份 `Data/` |
| 7 | U 盘写保护 | 物理开关或介质损坏 | 启动前确认可写；应用会因写入失败大量报错 |
| 8 | 引擎更新后换机器跑不起来 | 引擎二进制是平台专用 | 只用同架构（win32-x64）；跨架构需重新装引擎 |
| 9 | 装 U 盘后本机 `%APPDATA%` 仍有空目录 | 某模块在 `setPath` 前读了路径（守卫【91】的老坑） | 用 §6 的校验脚本实测；若出现说明有漏网模块，需按【91】改成惰性求值 |
| 10 | 备份 U 盘后换新盘，会话打不开 | 会话里记录的 `cwd` 是**绝对路径** | 项目会话需目标机存在同路径；记忆/配置不受影响（在 `Data/` 内相对） |
| 11 | 同一台机器上本机版和 U 盘版打架 | 单实例锁 / 共享 codex-home | 见 §3.5-2；实测后决定是否在便携模式跳过锁 |
| 12 | `TEMP` 重定向后其他软件报错 | 启动器只影响本进程树 | ✅ 本来就是 `setlocal` 局部生效；确认用 `setlocal` 而非 `setx` |

---

## 5 部署与使用步骤

### 5.1 先决定场景（关键分歧点）

- **只在一台电脑用**（"我就是不想装到系统里"）⇒ 走 **A 路线**，无硬伤。
- **要插不同电脑用** ⇒ 走 **B 路线**，先接受"每台机器重填 API Key"。

### 5.2 制作（开发侧，一次性）

```bash
# 1. 打免安装目录版
unset NODE_OPTIONS                     # ⛔ 项目硬规矩
CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build
npx electron-builder --win dir --x64   # 产出 release/win-unpacked/

# 2. 拷进 U 盘（⛔ 用打包产物，不要拷源码目录）
#    U 盘布局：
#    └─ CodexHarness/
#       ├─ win-unpacked/        ← 整个目录
#       ├─ Data/                ← 空目录（首启自动填充）
#       ├─ Temp/                ← 空目录
#       ├─ portable.dat         ← 空文件（便携标记，§3.2）
#       └─ 启动.bat             ← §3.4
```

### 5.3 首次使用（用户侧）

1. 插入 U 盘 → 双击 `启动.bat`
2. 应用在 `U盘:\CodexHarness\Data\` 建立全部数据（等价于 `%APPDATA%\Codex Harness Desktop`）
3. **填入 API Key**（每台电脑首次都要填，见 §1）
4. 在设置里**关掉引擎自动更新**（若不需要跨机一致性）
5. 正常使用 —— 所有配置/会话/记忆都在 U 盘

### 5.4 验证「应用层零残留」（可机器执行，这是硬判据）

```bash
# Windows PowerShell（管理员不需要）
# ① 启动前快照
$before = Get-ChildItem "$env:APPDATA" -Directory | Select-Object -Expand Name

# ② 用 U 盘版跑一轮完整操作（问答 / 建会话 / 改设置）

# ③ 启动后对比
$after = Get-ChildItem "$env:APPDATA" -Directory | Select-Object -Expand Name
Compare-Object $before $after            # 期望：无差异

# ④ 重点确认这几个目录不存在（或存在但是旧的、时间戳未变）
Test-Path "$env:APPDATA\Codex Harness Desktop"
Test-Path "$env:LOCALAPPDATA\Codex Harness Desktop"
```

**通过标准**：③ 无差异 + ④ 的 `data-dir.json` 未被创建/未更新。

### 5.5 清理系统层痕迹（可选，需管理员）

```powershell
# ⚠️ 只清本应用的痕迹，不影响其他程序
Remove-Item "$env:APPDATA\Microsoft\Windows\Recent\AutomaticDestinations\*" -Force -EA 0
Remove-Item "C:\Windows\Prefetch\CODEX*" -Force -EA 0        # 需管理员
# 注册表痕迹（RecentDocs / MuiCache / UserAssist）建议用专用工具，
# 手工删有风险 —— 这几项本来就是系统行为，不是本应用造成的
```

---

## 6 取证命令（本方案数字的来源，可复现）

```bash
# 体积核算
node -e "/* 见 §2.3 —— 遍历 extraResources / asarUnpack / electron dist */"

# 数据落点核查（确认没有漏网的 appData 写入）
grep -rn 'getPath("appData")\|getPath("userData")' electron/

# 临时目录使用点
grep -rn 'os.tmpdir()' electron/

# 便携钩子现状
sed -n '150,190p' electron/data-dir.ts

# 打包配置
node -e "console.log(JSON.stringify(require('./package.json').build.win,null,1))"
```

---

## 7 macOS 版：CI 已经能出，你不需要有 Mac

> ⚠️ **此处修正本文档早期版本的一个错误判断。** 早期版本说"项目完全不能打 macOS 包"——
> 那是只看了 `package.json` 的 `build.mac`（确实不存在）就下的结论。**实际核查后发现：
> macOS 的构建实现是完整的，只是放在独立配置 + CI 里，不走 `package.json`。**

**实测现状（都是文件实证）**：

| 项 | 位置 / 内容 |
|---|---|
| CI 工作流 | `.github/workflows/build-mac.yml` |
| 构建矩阵 | `macos-14`(**arm64**) + `macos-15-intel`(**x64**) |
| 打包配置 | `build/electron-builder.mac.cjs`（`target: "zip"`） |
| 工具链准备 | `scripts/prepare-mac-tools.cjs`（打包后 `copy-mac-tools.cjs` 拷入） |
| 产物 | `release-mac/*.zip` → artifact 名 `mac-arm64` / `mac-x64` |
| 触发方式 | `workflow_dispatch`（手动）或 `release.yml` 复用 |
| 签名 | ⛔ **不签名**（`CSC_IDENTITY_AUTO_DISCOVERY: false`，定位是"本地自用包"） |

**工具链也已跨平台就绪**（这点比预期好很多）：

- `codex-server.ts:31-36` 引擎平台映射表**已含** `darwin-x64` / `darwin-arm64` / `linux-*`
- `scripts/install-runtimes.cjs:886` 有完整的 `mainMac()`（09-16 就做了）：
  node(darwin) / PowerShell 7(osx) / python(python-build-standalone darwin) /
  platform-tools(darwin) / git(用系统 Xcode CLT)
- 大量 `process.platform === "win32"` 的三元分支（`memory-backend.ts:78`、
  `terminal.ts:30`、`toolchain.ts:97`、`codex-server.ts:46` 等）⇒ 代码本来就是跨平台写的

⇒ **所以 Mac 版 U 盘不需要你买 Mac**：推 tag 或手动触发 workflow，从 Actions 下载
`mac-arm64.zip` / `mac-x64.zip` 即可。

### 7.1 便携化在 macOS 上的额外改动点

⚠️ `portableRoot()` 的实现要**分平台**——macOS 的应用可执行文件藏在 `.app` 内部：

```ts
function appBaseDir(): string {
  const exe = app.getPath("exe");
  // macOS: xxx.app/Contents/MacOS/xxx ⇒ 必须退三级才是 .app 所在目录（= U 盘根）
  return process.platform === "darwin"
    ? path.resolve(path.dirname(exe), "..", "..", "..")
    : path.dirname(exe);
}
```

⛔ 如果不做这个处理，Mac 上会把 `Data/` 建到 `.app/Contents/MacOS/` 里面 —— 应用签名一旦
校验就会失败，且用户根本找不到数据。

### 7.2 ⛔ macOS 特有的两个坑

1. **未签名 ⇒ Gatekeeper 拦截**。从 zip 解压出来的 `.app` 带着 quarantine 属性，双击会提示
   "已损坏 / 无法验证开发者"。放行方式（二选一）：
   ```bash
   # 方式 A：命令行去隔离属性（推荐，一次性）
   xattr -dr com.apple.quarantine "/Volumes/U盘/CodexHarness/Codex Harness Desktop.app"
   # 方式 B：右键 → 打开 → 在弹窗里点「打开」（每个新机器首次一次）
   ```
   ⛔ 注意：Apple Silicon (arm64) 上**未签名的二进制连"右键打开"都可能被拒**，
   通常需要走方式 A，或者去「系统设置 → 隐私与安全性」点「仍要打开」。

2. **架构必须匹配**：arm64 包只能在 Apple Silicon 上跑，x64 包在 Intel Mac 上跑
   （x64 包在 Apple Silicon 上会经 Rosetta 转译，能跑但慢且可能踩坑）。
   ⇒ 两个 zip 都放 U 盘，按机器选，或者只带对应那台机器的。

---

## 8 凭据可移植：改一处接缝，换真正跨机

**核心洞察**：20+ 处加密调用点**全都走同一个接缝**，所以改动面是 1 而不是 20。

```ts
// electron/runtime/seams/index.ts:65-67 —— secure 接缝的全部接口
isEncryptionAvailable: () => boolean;
encryptString: (plain: string) => Buffer;
decryptString: (buf: Buffer) => string;
```

### 8.1 实现思路：U 盘内密钥库 + 主密码派生

```
首次（在任意一台机器上）：
  用户设一个主密码
  → scrypt(主密码, 随机 salt, N=2^15) 派生 KEK（32 字节）
  → 生成随机主密钥 MK（32 字节）
  → AES-256-GCM(KEK, MK) → 存 <U盘>/Data/.vault/master.key
  → 主密码本身**不落盘**（只留 salt + 校验位）

之后每次启动：
  提示输一次主密码 → 派生 KEK → 解出 MK（缓存内存）
  → encryptString/decryptString 全部用 MK 做 AES-256-GCM

换电脑：
  同样的主密码 ⇒ 同样的 KEK ⇒ 同样解出 MK ⇒ **旧密钥全部可读** ✅
```

**为什么用 scrypt 而不是 Argon2id**：`node:crypto` **内置 `scryptSync`**，
⛔ 而 Argon2id 需要第三方 native 模块 ⇒ 会引入 ABI 不匹配风险
（本项目在 `better-sqlite3` 上已经踩过 `NODE_MODULE_VERSION` 的坑，不该再引一个）。
scrypt 是内存硬的、被广泛认可的 KDF，够用。

### 8.2 ⛔ 必须同时说清的代价与风险

| 项 | 说明 |
|---|---|
| 每次启动输一次主密码 | 可加"本机记住 N 小时"降低骚扰（但记住 = 落回本机，跨机无影响） |
| **主密码忘了 = 所有密钥永久丢失** | 必须在设置里提供"导出恢复码"，并明确警告 |
| U 盘丢失 + 弱主密码 = 泄露 | 主密码强度要求必须硬性校验（长度 + 字符类） |
| 新增一个板块 | 按项目规矩（`ARCHITECTURE-RULES.md` §2.2）应做独立域 `vault`，不塞进既有域 |
| 便携模式才启用 | 非便携模式仍走系统 `safeStorage` —— ⛔ 不许把桌面版也拖下水 |

### 8.3 更省事的替代方案（如果不想改代码）

**接受"每台新机器重填一次"**。对开发场景来说，常用凭据通常只有 1–2 个
（主力 API Key + 中转账号密码），填一次约 1 分钟。
⇒ 如果你的开发机就 2–3 台，**§8.1 的改造收益有限**，可以先不做。

---

## 9 双 U 盘方案 · 运行特性（性能 / 权限）

你提的"一个系统一个 U 盘"是**正确且必要**的 —— 因为应用产物内含**平台专用二进制**：
Windows 包含 `codex.exe` + `node.exe` + `python.exe`…，macOS 包含 `codex`(Mach-O) +
`node` + `python3`…。**互不通用**。

### 9.1 两个盘的布局

```
【Windows 盘】(NTFS —— 见 §9.2)
└─ CodexHarness-Win/
   ├─ win-unpacked/                 ← electron-builder --win dir 的产物
   ├─ Data/                         ← 全部数据（userData）
   ├─ Temp/                         ← 接住 4 处 os.tmpdir()
   ├─ portable.dat                  ← 便携标记
   └─ 启动.bat                      ← §3.4 的启动器

【macOS 盘】(APFS —— ⛔ 不能是 exFAT，见 §9.2)
└─ CodexHarness-Mac/
   ├─ Codex Harness Desktop.app/    ← 从 mac-arm64.zip 解压
   ├─ Data/
   ├─ Temp/
   └─ portable.dat                  ← 与 .app 同级（§7.1 的 appBaseDir 会找到它）
```

### 9.2 ⛔ 文件系统选择（两个盘完全不同，且 mac 盘不能用 exFAT）

| 盘 | 推荐 | 原因 |
|---|---|---|
| **Windows 盘** | **NTFS** | 有日志，突然拔盘能自恢复；跑应用**一直在写**，日志很重要 |
| **macOS 盘** | **APFS**（或 HFS+ / Mac OS 扩展） | ⛔⛔ **不能是 exFAT** —— 见下 |

#### ⛔⛔ 为什么 macOS 盘不能用 exFAT（硬阻断，不是取舍）

**macOS 的 `.app` 应用包必然含符号链接，而 exFAT 不支持符号链接。**

三条实证：

1. **项目自己的代码就用 symlink** —— `scripts/prepare-mac-tools.cjs:69`：
   ```js
   fs.renameSync(modules, path.join(prefix, "node_modules"));
   fs.symlinkSync("../node_modules", modules);   // npm-global/node_modules → ../node_modules
   ```
   另有 `npm-global/bin/nuphus-call` 等 shim（`runtime-ipc.ts:93` 注释确认"symlink 到包内 bin"）。

2. **Electron 的 macOS 包结构本身是一堆 symlink** —— 标准 Framework 布局即
   `Xxx.framework/Versions/Current -> A`，以及 `Resources`/`Libraries` 指向 `Versions/Current/...`。
   这是 macOS 规定死的结构，**`dyld` 与 codesign 都依赖它**。

3. **社区实证**（多源）：zip 里的 symlink 被"展平"后，解压出的 bundle
   `codesign --verify` 直接失败（"bundle format is ambiguous"），
   运行时表现为 `dyld: Library not loaded: @rpath/Electron Framework.framework/...`。

**后果**：把 `.app` 拷到 exFAT U 盘 ⇒ symlink 创建失败/被展平 ⇒ Framework 结构损坏
⇒ **双击打不开**。这不是性能问题，是**能不能跑**的问题。

#### ⚠️ APFS 带来的新风险（必须知道）

- **Windows 完全不认识 APFS**（连盘符都不出）。
- ⛔⛔ **真正危险的**：APFS U 盘插到 Windows 上，系统常弹
  **"使用驱动器中的磁盘之前需要将其格式化"** —— 手抖点了「格式化」，**整盘数据全没**。
  ⇒ 建议在 U 盘外壳**贴标签写明"macOS 专用 · 勿在 Windows 上格式化"**。
- 两个盘彻底独立、不能互读。

#### 偶尔要传文件怎么办

在 Mac 盘上**分一个小区**（如 4 GB exFAT，**不放 .app**，只放便携标记与普通文件），
其余分区用 APFS 放 `.app` + `Data/`。
⚠️ 分区要在**空盘时**做；且 Windows 仍会对那个 exFAT 小区提示格式化。
⇒ 嫌麻烦就别交换（走云盘/微信传文件）。

### 9.3 数据能否在两盘之间搬？

**可以，但要挑对内容**：

| 内容 | 能否跨平台搬 | 说明 |
|---|---|---|
| `Data/codex-home/`（会话 / rollout / 技能 / 记忆） | ✅ 可以 | 纯文本 / JSONL，格式无关平台 |
| `Data/memory.json`、`expert-teams.json` 等配置 | ✅ 可以 | JSON |
| `Data/` 里的**密钥**（`encryptedKey` 等） | ⛔ **不可以** | DPAPI ↔ Keychain 互不兼容（§8 改造后可） |
| 应用本体（`win-unpacked` / `.app`） | ⛔ 不可以 | 平台专用二进制 |

⇒ 所以：**想要"两边数据同步"，只需同步 `Data/` 里除密钥外的部分**；
或者做 §8 的改造，连密钥也能跟着走。

---

## 9.4 ⛔ 性能：不是"只吃电脑的"，U 盘本身就是瓶颈

> 你的原话是「运行的时候性能吃电脑的」。**这句只对一半，而错的那一半恰好最关键。**

**对的一半**：CPU 调度、内存、GPU 渲染 —— 确实是电脑的能力，U 盘不参与。

**⛔ 错的一半：存储 IO 完全是 U 盘的，而且这个应用的 IO 模式极不友好。**

实测（本机 userData）：

```
codex-home            19,720 个文件   1115 MB   ← 会话 / rollout / 技能 / 记忆
voice-models             401 个文件    509 MB
其余（缓存/存储）          231 个文件
--------------------------------------------------
合计                  20,352 个文件
```

**→ 两万个小文件**，这是**随机 IOPS 密集型**负载，恰恰是所有 U 盘**最弱**的维度：

| 指标 | 内置 NVMe | 固态 U 盘 (10Gbps) | 普通 U 盘 |
|---|---|---|---|
| 顺序读写 | 3000+ MB/s | 550–1050 MB/s | 30–150 MB/s |
| **4K 随机读 IOPS** | **几十万** | 数千–数万 | **约 1,000–3,000** |

⇒ 普通 U 盘的随机 IOPS 比内置盘**低两个数量级**。体感就是：
**开会话卡、搜记忆卡、引擎启动慢、每回合落盘有顿挫。**

**另有两处持续损耗**：

1. 启动要读 **803 MB** 引擎 vendor（顺序读，U 盘勉强能扛）
2. **全天候在写**：SQLite 随机写 + rollout JSONL 追加写 + 记忆/配置读改写
   ⇒ 固态 U 盘 SLC 缓存写满后实测掉速约 20%，普通 U 盘掉得更多

**⇒ 结论**：U 盘的**随机性能**直接决定"顺不顺"，不能随便买。
优先级 **主控质量 + DRAM 缓存 + 散热** > 顺序速度标称值。
预算允许就上 **PSSD**（散热好、多为 DRAM 方案）。

---

## 9.5 权限：基本一致，但有 4 处可移动介质特有的差异

**结论先说**：U 盘版的权限 = **运行它的那个用户账户的权限**，与安装版**没有区别**，
也**不需要管理员**（因为数据全写 U 盘，不碰系统目录）。

**但有 4 处与"从可移动介质运行"相关的真实差异**：

| # | 差异 | 影响 | 规避 |
|---|---|---|---|
| 1 | **exFAT/FAT 没有 ACL 权限位** | 依赖文件权限位的操作会静默异常 | Windows 盘用 **NTFS** 即可避开 |
| 2 | **企业策略常禁"从可移动介质执行"** | AppLocker / Defender ASR 规则可能直接拦掉 | 公司电脑上可能根本跑不起来，需 IT 放行 |
| 3 | **macOS：从外部卷运行要重新授权** | "完全磁盘访问 / 屏幕录制 / 辅助功能"等权限**绑定路径**，换 U 盘或换挂载点就要重授 | 首次运行按提示授权 |
| 4 | **USB 接触/拔出** | 写入中断 ⇒ exFAT 无日志可能损坏卷 | 安全弹出；NTFS/APFS 有日志能自恢复 |

**✅ 一个好消息（已核实）**：代码里**没有硬编码盘符假设**。
`harness-image://` 的可信根校验用的是 `path.resolve` + `path.relative` 相对判断
（`features/boot.ts:308-311`、`isInsideTrustedRoots`）——
⇒ 盘符从 `E:` 漂到 `F:` **不会**破坏图片协议与可信根判定。

---

## 10 高速 U 盘推荐

### 10.1 ⛔ 先立三条选购原则（否则一定买错）

1. **跑应用看的是「随机 IOPS + 持续写入」，不是包装上那个顺序读速度。**
   厂商标的 1000/2000 MB/s 是**突发顺序速度**（SLC 缓存还没写满的那几十秒）。
   而应用运行是**大量小文件随机读写**（SQLite、rollout 追加写、配置读改）。
2. **U 盘形态有结构性劣势**：用低等级 NAND、**无 DRAM 缓存**、散热面积小。
   三者叠加的后果就是"跑数据库类应用会卡 + 长时间写入掉速"。
3. **USB 3.2 Gen2×2（标 2000MB/s）Mac 根本不支持**（多源确认）。
   插 Mac 最多 ~1000MB/s ⇒ **别为这个参数多花钱**。

### 10.2 推荐（按形态分两类）

**A 类 · U 盘形态（直插、不用带线、最便携）**

| 型号 | 接口 | 参考容量 | 说明 |
|---|---|---|---|
| **创见 Transcend ESD310** ⭐ | USB-A + USB-C **双头滑出** · 10Gbps · 1050/950 | 512G / 1TB | **出厂 exFAT**、即插即用、5 年保固；多源评测交叉验证，实测读约 1040MB/s。⚠️ 连续传 120GB 后降速约 20%（散热限制） |
| SSK SD301 | 双头 · 10Gbps · 550/500 | 256G / 512G | 便宜，锌合金外壳 |
| 雷克沙 D70E | 双头 · 20Gbps · 2000 | 1TB / 2TB | ⛔ Mac 用不上 20Gbps，纯 Windows 才值 |

**B 类 · PSSD 移动固态硬盘（盒子形态、要带线，但更稳）**

| 型号 | 参考价（搜索所得） | 说明 |
|---|---|---|
| **三星 T7 Shield 1TB** ⭐ | 约 ¥1,437–1,459 | IP65 防水防尘、3 米防摔、散热最好 ⇒ **长时间写入最稳** |
| 西数 My Passport 1TB | 约 ¥949 | 硬件 AES-256 加密 |
| 雷克沙 ES4 1TB | 约 ¥1,349 | 附 C-C 与 C-A 双线 |
| 佰维 PD450 1TB | 约 ¥499 | 性价比最高，京东自营 |

**C 类 · 追求 Mac 上的极致速度（要突破 10Gbps）**

只有走 **USB4 / Thunderbolt 硬盘盒 + NVMe SSD**（macOS 支持，实测可达 ~2800MB/s）。
⛔ 但成本高、发热大，**且对"跑应用"的收益远小于对"传大文件"的收益** ——
不建议为这个场景上。

### 10.3 我的实际建议

| 你的偏好 | 选择 |
|---|---|
| 便携优先（揣兜里、不用带线） | **创见 ESD310**（两个盘都可以用它，最简单） |
| 稳定性优先（跑应用不卡、长时间写不掉速） | **三星 T7 Shield**（PSSD，散热最好） |
| 预算优先 | **佰维 PD450**（约 ¥499 拿到 10Gbps PSSD） |

⚠️ **三点提醒**：
- 上表价格为**第三方导购站搜索所得，可能已变动**，请以京东/天猫实时价为准。
- 别买杂牌 —— 虚标容量、黑片、假固态在这类产品上很常见。
- **格式别用出厂默认就算了**：Windows 盘建议重格 **NTFS**（§9.2），
  Mac 盘保持 **exFAT**。

---

## 11 决策记录与剩余待办

### 11.1 已定（用户 10-05 明确）

| 决策 | 状态 | 影响 |
|---|---|---|
| **一个系统一个 U 盘** | ✅ 已定 | 两盘彻底独立，不需要互通（正好避开 NTFS/APFS 互不兼容问题） |
| **会话记录保留在 U 盘** | ✅ 可行 | `codex-home/` 与全部 JSON 配置都在 userData 下，跟着 U 盘走 |
| **换电脑只重配供应商（API Key）** | ✅ 可行 | ⇒ **§8 的凭据可移植改造不做** —— 方案大幅简化，零代码风险 |
| **性能靠电脑** | ⚠️ **需修正** | 见 §9.4：CPU/内存是电脑的，但 **IO 是 U 盘的瓶颈**（2 万个文件） |

### 11.2 因此**不需要做**的事（相比早期方案砍掉）

- ❌ §8 的 `vault` 板块 + 主密码 UX + 恢复码机制 —— **整块砍掉**
- ❌ 两盘数据互读 / 同步机制 —— 不需要

### 11.3 剩余待办

1. **要不要我落地实现便携化？**
   §3.2 便携标记（含 §7.1 的 macOS 分支）+ §3.3 `dir` target + §3.4 启动器
   ⇒ 约 40 行代码 + 打包配置，可同轮加守卫与验收项。
2. **U 盘买了哪个、按 §9.2 格式化**（Windows 盘 NTFS / mac 盘 **APFS**）。
3. **可选**：Mac 版要不要顺手把 Gatekeeper 放行步骤写进 U 盘里的说明文件
   （`xattr -dr com.apple.quarantine`），省得每台新机器查一次。

⛔ **仍未实测、需真机确认的三点**（我不下结论）：
- 单实例锁在「本机版 + U 盘版并存」时的行为
- 固态 U 盘上跑完整功能的实际体感（尤其 SQLite 随机写与技能市场解压）
- macOS 未签名 `.app` 从外部卷运行时的 Gatekeeper 实际拦截强度
  （arm64 可能比 Intel 更严，且**外部卷路径可能加重拦截**）
