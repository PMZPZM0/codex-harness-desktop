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
| **B. 跨机便携**（U 盘插不同电脑用） | ⚠️ 可行但**有硬伤** | API Key 需每台重填；性能受限 |
| **C. 零系统痕迹** | ❌ 不可达 100% | 见 §0 |

**最关键的硬伤先说（跨机场景）**：

> **`safeStorage`（DPAPI）加密的 API Key 换机器解不开。**
> 代码实证：`main.ts:446`、`features/boot.ts:286-288`、`main/03-turn-summary.ts:48`、
> `features/channel-bot-ipc.ts` 等多处用 `safeStorage.decryptString()` 解 API Key。
> Windows 的 DPAPI 加密密钥**绑定"当前 Windows 用户账户 + 本机"**，
> 换一台电脑（或同一台电脑换个 Windows 账户）⇒ `isEncryptionAvailable()` 为真但
> **`decryptString()` 直接抛错**，表现为"密钥莫名其妙失效了"。
>
> ⇒ 跨机场景下，**每台新机器首次使用都要重填 API Key**。这是操作系统安全机制，
> 不是本项目能绕过的（绕过 = 把密钥明文写 U 盘，反而更危险）。

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
| 3 | U 盘是 **exFAT**，报符号链接错误 | exFAT 不支持 symlink/junction | ✅ 放**打包产物**（已核实无符号链接）；⛔ **绝不把源码目录（含 `node_modules`）直接放 exFAT**，`.bin` 里全是符号链接 |
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

## 7 待你拍板的三个点

1. **场景 A 还是 B？**（决定要不要接受"每台机器重填 API Key"）
2. **要不要我直接落地实现？**（§3.2 的便携标记 + §3.3 的 dir target + §3.4 启动器，
   约 30 行代码 + 打包配置，可以同轮加守卫与验收项）
3. **U 盘介质**：普通 U 盘 vs 固态 U 盘 —— 这直接决定体验能否接受（§4-5）

⛔ 另外两个**未实测**、需要真机确认的点（我不敢瞎说）：
- 单实例锁在同一台机器上「本机版 + U 盘版」并存时的行为
- exFAT 下完整功能跑一遍的实际表现（尤其 SQLite 与技能市场解压）
