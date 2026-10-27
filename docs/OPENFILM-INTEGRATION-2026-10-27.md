# OpenFilm × Codex Harness 对接方案（2026-10-27）

> 状态：**设计稿**（未实施）。本文覆盖调研结论、对接架构、安装/镜像/更新、调用工具与技能、
> Windows/macOS 适配、开源声明与合规，以及分批实施与判据。
>
> ⛔ 本文所有"上游事实"均标注来源；标 **〔待实测〕** 的条目**尚未验证**，实施前必须先跑一遍。

---

## 0. 一句话结论

OpenFilm 不是"又一个时间线编辑器"，而是**把影片当网页写**的 agent 工具：影片 = 一个文件夹里的
`film.html`，每个镜头 = 一个暴露 `frame(t)` 的网页，Studio 是本地浏览器里的编辑器，CLI 负责开/校验/渲染。
它的对外接口**只有 CLI（+ 本地 Studio HTTP 服务）**，没有 MCP、没有插件协议、没有账号体系。
⇒ 对 Codex 的对接本质是：**装好一个 CLI + 打开它的本地 Studio + 教会模型按它的契约改 film.html**。

本产品要做的四件事（用户令）：

| # | 需求 | 落点 |
|---|---|---|
| 1 | 工具界面按需下载入口 + 国内镜像加速 | 「设置 → 工具/扩展」新增 OpenFilm 卡片（独立板块 `openfilm`）+ 安装器 |
| 2 | 控制台提供自动更新开关 | 「设置 → 关于与更新」新增 OpenFilm 组件更新区块（复用既有组件更新链） |
| 3 | 配套调用工具 + 技能，需求即自动完成下载/安装/连接/配对/剪辑 | 5 个宿主 dynamicTools + 1 个内置技能 |
| 4 | Windows / macOS 差异与适配 | §6 差异表（含两条硬差异：**Windows 只有 x64**、**macOS 未公证**） |

---

## 1. 上游调研（事实）

### 1.1 项目身份

| 项 | 值 |
|---|---|
| 仓库 | **https://github.com/openfilm/openfilm** |
| 官网 | https://openfilm.dev |
| 定位 | "The open source AI video agent"（把 coding agent 变成视频 agent，并提供可手改的编辑器） |
| 语言 | TypeScript 56.6% / JavaScript 42.2% / 其他 1.2% |
| 规模 | ≈1.9k stars / 189 forks / 21+ contributors（2026-10-27 读取） |
| 最新版 | **v0.2.6**（2026-10-26T23:16Z，CI 自动发布；此前 0.2.5 = 10-21） |
| 许可 | **MIT**（format / CLI / Studio / desktop app）；**名称与 Logo 是商标**（`TRADEMARK.md`） |
| 第三方声明 | `packages/openfilm/THIRD_PARTY_NOTICES.md` |

### 1.2 仓库结构（monorepo，pnpm 9.15.9 / Node ≥ 22.18 构建）

```
packages/openfilm       # 本体：film 格式 + CLI + Studio（server + UI）
  bin/openfilm.mjs      # CLI 入口（唯一 bin：openfilm）
  MANUAL.md             # ★ 给 agent 的契约手册（CLI 无参数时原样打印）
  SPEC.md               # 给"实现 player / renderer / editor 的人"的格式规范
  skills/               # 10 个官方技能（collage / keynote / long-to-short / lyric-video /
                        #   motion-graphics / presenter-pip / replicate / screen-demo /
                        #   vintage-film / whiteboard）
  studio/server/        # 本地 Studio 服务（server.mjs、projects.mjs、fetch-repo.mjs、providers/）
  studio/ui/            # React 19 + Tailwind 4 + Vite 7 的编辑器前端
apps/desktop            # Electron 44 桌面壳（Studio + 侧边 chat，可接 Codex/Claude Code）
```

`packages/openfilm/package.json` 事实：

- `bin`: `openfilm` → `bin/openfilm.mjs`
- `engines.node`: **>= 22.2**（构建要 22.18）
- **唯一运行期依赖：`playwright-core@1.61.1`**（⇒ 浏览器由它按需装，见 1.5）
- `exports` 暴露 `./host`、`./look`、`./render`、`./skills`、`./studio` 等，理论上可被 Node 进程直接 import（但我们不用这条：版本与内部结构不稳，**只走 CLI**）。

### 1.3 影片模型（决定我们要教模型什么）

```html
<!-- film.html：一个 <section> = 一条轨（自上而下 = 轨道顺序，前面的盖后面） -->
<section>
  <iframe src="title.html"></iframe>                                   <!-- 镜头页 -->
  <img src="assets/logo.png#t=0,3" at="6" style="left:1640px;top:60px;width:200px">
</section>
<section>
  <video src="assets/a.mp4#t=2,8" at="2" class="card" style="left:160px;top:90px;width:1600px;height:700px"></video>
</section>
<section><audio src="assets/bed.mp3" volume="0.6"></audio></section>
```

```js
// 镜头页：window.film 契约
window.film = {
  frame(t) { /* 画出 t 秒那一帧的**完整画面** */ },
  duration: 6, ready: loadFonts(), width: 480, height: 320,
};
```

**唯一铁律：画面只依赖 t**（同一个 t 必须画出同一张图，与之前画过什么、以什么顺序画无关）。
主进程会**乱序、并行**取帧（含帧间插值做运动模糊）⇒ 页面不许自己跑动画循环、不许 autoplay、
WebGL 必须 `preserveDrawingBuffer: true`。剪辑 = **只改 `#t=in,out` 与 `at` / `speed`**，
⛔ 绝不重编码或裁出新素材文件（裁切靠 CSS）。

其他硬约束（写进我们的技能正文）：

- 页面没有声音：所有声音都是 film.html 里的 clip，镜头页的音效要按"片段 at + 页内 t − in"换算后单独摆。
- 字幕是媒体旁的 WebVTT（同名 .vtt，逐词带时间戳），⛔ 不许在页面里画字幕。
- Studio 的改动以 `overrides` 写回元素：**保持原样**，改之前先读。
- `locked` 轨是用户的（不许动）；`.film/`、`.git/` 属工具所有。

### 1.4 对外接口：CLI（唯一编程接口）+ 本地 Studio 服务

```
openfilm                        # 无参数 = 打印 MANUAL.md（agent 全靠它）
openfilm open  [folder|url]     # 新片建目录 / 打开已有 / 从 GitHub 拉一个；打印 `Studio <url>`
openfilm look  [what] [t|a-b]   # 联系表 + 确定性自检；单帧 / 区间 / 单个媒体文件
openfilm render [a-b]           # MP4（默认 30fps），--4k --blur --alpha --subtitles --fps --out …
openfilm get   [what]           # 配音/音乐/音效/转写/图片/视频/搜索（需用户先在 Studio 连服务 + 自带 key）
openfilm skills | skill <name>  # 列出/读取技能（按"项目 skills/ → 用户技能目录 → 官方"优先级）
openfilm doctor                 # 这台机器为 OpenFilm 准备了什么（贴 issue 用）
openfilm update                 # CLI 自更新
```

参数与退出码（读 `bin/openfilm.mjs` 得到）：

- 通用：`--count(1..200) --fps(1..240) --scale(0.1..8) --samples(1..64) --shutter(0..1) --workers(1..64)`
  `--4k --blur --alpha --subtitles --out/-o`；越界 → **退出码 2**
- 退出码语义：**0 成功 / 1 影片或命令失败 / 2 不是项目或用错**（我们按此分流提示，别一律当"安装失败"）
- `render` 会 `setPriority(10)` 降优先级；`VideoNotShown` 会自动换一种"能显示视频的浏览器"重绘一次
- **Windows + Node 24.17** 的退出码 127（libuv assertion）已在 0.2.6 修掉；我们仍按"非 0 一律带 stderr"处理

Studio 与"连接/配对"（关键，也是最容易被误解的一点）：

- Studio = **本地 HTTP 服务 + 浏览器编辑器**，`open` 会打印 `Studio http://127.0.0.1:<port>/…`；
  端口由 `studio/client.mjs` 的 `openInStudio()` 决定（**不由 CLI 固定**）。
- `open` 成功会写 `.film/opened` 标记；已有页面在浏览器打开时只切项目、不新开。
- 环境变量：`OPENFILM_NO_BROWSER`（我们自己开内置浏览器时必须设，否则它会抢着弹系统浏览器）、
  `OPENFILM_SKILLS`（用户技能目录）、`OPENFILM_RUN`（显示名）。
- **没有账号、没有云端、没有配对码**：所谓"配对" = 让 Codex 与用户看的**同一个 Studio 实例**指向
  **同一个 film 目录**。桌面 App 与 CLI 共享同一份"项目库"路径，这是我们唯一的同步锚点〔待实测：库根路径〕。

### 1.5 安装方式（三条路，我们只推荐前两条）

| 方式 | 命令 | 适用 | 代价 |
|---|---|---|---|
| **A. npx / npm 全局** | `npx -y openfilm@latest`｜`npm i -g openfilm` | 我们已经管着 Node 工具链 | 需要 Node ≥22.2 + ffmpeg；首次运行装 Chromium ≈100MB |
| **B. 技能包** | `npx skills add openfilm/openfilm` | 用户已有 Agent Skills 体系 | 只装"说明书"，仍要 A 的运行时 |
| **C. 桌面 App** | 官网 / Releases 下载 `OpenFilm-Setup-x64.exe`(NSIS, ≈265MB) / `OpenFilm-{arm64,x64}.dmg`、`-mac.zip`(≈279/293MB) | 想要"开箱带 ffmpeg + 浏览器"的 GUI | 安装包大；macOS 未公证会撞 Gatekeeper |

Chromium 的来源（决定镜像策略）：CLI 里 `installChromium()` 用
`node <playwright-core>/cli.js install chromium-headless-shell`，
触发点是 **`open` 启动失败且 stderr 含 `Executable doesn't exist`**，或其他命令报错时兜底重试一次。
缓存路径由 playwright 决定（默认 `%LOCALAPPDATA%\ms-playwright` / `~/Library/Caches/ms-playwright`）。
⛔ 上游**没有**任何 `DOWNLOAD_HOST` / `MIRROR` / CDN 覆盖逻辑 —— 要加速只能在我们侧注入 playwright 自己的
下载环境变量（见 §3.2）。

依赖外部二进制：`ffmpeg` + `ffprobe` 必须在 PATH（`look`/`render` 缺 → 退出码 2；`open` 缺只告警）。

### 1.6 许可与商标（合规红线）

- 代码/格式/Studio/桌面 App：**MIT**（保留版权与许可声明即可商用、可分发、可改）。
- **名称 "OpenFilm" 与 Logo 是商标**（`TRADEMARK.md`）：
  - ⛔ 我们**不得**把 OpenFilm 的 Logo/图标塞进我们的品牌面（本仓已有品牌纪律：三仓品牌不互串）。
  - ⛔ 不得宣称"官方合作/官方集成"；文案只写"第三方开源项目 + 链接"。
  - 引用名称做事实描述（"调用 OpenFilm"）是允许的，加一句"名称归其所有者"最稳。
- 若我们**不随包分发**它的二进制（本方案默认如此），只需在界面/文档标注来源与许可；
  若将来内置桌面 App 或 ffmpeg 二进制，则必须随包附 MIT 全文 + 版权行，且 ffmpeg 的 GPL/LGPL 归属单独核算
  （⇒ 本方案**明确不内置 ffmpeg 二进制**，只用系统包管理器或用户自备，见 §6）。

---

## 2. 我们这边的现状（可复用什么）

| 能力 | 现成资产 | 复用方式 |
|---|---|---|
| 工具链安装/卸载/校验 | `electron/install-runtimes.ts`（三级解压降级、坏缓存校验、marker、卸载落点） | OpenFilm 安装器照它的骨架写（**同一套纪律**：先校验再删、删除必须落在 tools 目录内） |
| 国内镜像 | `electron/gh-mirror.ts`（gh-proxy.com → ghfast.top → 直连，单一真相源） | 桌面 App 安装包直链复用这条候选序；npm / playwright 各加一张候选表（§3.2） |
| 组件更新 | `updates` 域 + 组件更新链（`12l-component-update` 守卫）+ 版本比较真相源 `electron/updates.ts` 的 `compareVersions` | OpenFilm CLI 版本比较**只准**用 `compareVersions`，⛔ 不写第二份 |
| 渲染层-主进程通道 | IPC manifest → `gen:ipc` → `ipc-registry` 域表 | 新域 `openfilm`：**一个板块一个前缀**（`electron/features/openfilm-ipc.ts` + `src/features/openfilm/`） |
| 模型工具面 | 宿主 dynamicTools（引擎 0.157 起内置 MCP 整批延迟暴露 ⇒ **只走宿主工具**） | 5 个工具走 dynamicTools，不新增 MCP |
| 技能体系 | `skill-pack.ts`：全局 `$CODEX_HOME/skills` + 项目 `.codex/skills` | 内置 1 个技能 `openfilm-video-editing` |
| 内置浏览器 | `browserPane` / `openInBrowserPane` | Studio URL 直接开在右栏内置浏览器（Chromium = 与导出同引擎） |
| 设置页 | 注册表一行一页（`settingsPagesOf`） | OpenFilm 卡片挂「工具/扩展」页，更新开关挂「关于与更新」页 |

---

## 3. 对接总体方案

### 3.1 分层

```
┌──────────────────────────── 渲染层 src/features/openfilm/ ────────────────────────────┐
│ 工具页卡片（下载/进度/版本/卸载/打开 Studio）   设置页：自动更新三档 + 镜像偏好        │
└───────────────────────────────┬───────────────────────────────────────────────────────┘
                                │ IPC（openfilm:*，全部经 manifest + gen:ipc）
┌───────────────────────────────▼───────────────────────────────────────────────────────┐
│ 主进程 electron/features/openfilm-ipc.ts                                              │
│  ├ installer：Node/npm 探测 → npm 装 CLI（私有 prefix）→ Chromium → ffmpeg → doctor 校验 │
│  ├ runner  ：spawn(openfilm, args[], cwd=film 目录, env=镜像+缓存+NO_BROWSER) 白名单命令 │
│  ├ session ：{ projectPath, studioUrl, port, pid, startedAt } ← userData/openfilm/session.json │
│  └ updater ：compareVersions + npm dist-tags（镜像优先）/ 桌面 App 走 latest-*.yml       │
└───────────────────────────────┬───────────────────────────────────────────────────────┘
                                │ dynamicTools（模型工具面）
        openfilm_make_film / openfilm_check / openfilm_render / openfilm_get / openfilm_skill
```

`film` 库位置（**决定成败的一条**）：放在**用户项目目录** `<workspace>/films/`，不放在 `userData`。
原因：我们的 `userData` 路径含空格与中文（`Codex Harness Desktop`），macOS 侧还要经过 dmg 拷贝；
上游 0.2.6 才修 Windows 非英文路径乱码，跨版本行为不稳。⛔ 不要为了"整洁"塞进安装目录。

### 3.2 安装器（按需下载入口）

**依赖探测 → 分步执行 → 每步可单独重试**（每步一条进度事件，失败带可执行建议）：

| 步 | 做什么 | Windows | macOS |
|---|---|---|---|
| 0 | 探测 | `node -v ≥22.2`、`npm -v`、`ffmpeg -version`、`ffprobe -version`、磁盘 ≥1.5GB | 同左（另测 `xcode-select -p` 不必需） |
| 1 | 装 CLI（私有 prefix，不污染全局） | `npm install openfilm@<pin> --prefix "%APPDATA%\\Codex Harness Desktop\\openfilm\\runtime" --registry=<镜像>`，入口 `.bin\\openfilm.cmd` | 同命令，入口 `…/runtime/node_modules/.bin/openfilm`（符号链接） |
| 2 | 装 Chromium ≈100MB | `PLAYWRIGHT_DOWNLOAD_HOST=<镜像> node <runtime>/node_modules/playwright-core/cli.js install chromium-headless-shell` | 同左 |
| 3 | ffmpeg | ① PATH 有 → 跳过；② 无 → 提示 `winget install Gyan.FFmpeg`（**不静默装系统包**，要用户确认）；③ 用户同意后执行并复核 | ① PATH 有 → 跳过；② 无 → 检测 `/opt/homebrew/bin/brew` → `brew install ffmpeg`；③ 无 Homebrew → 给官网链接，不代装 |
| 4 | 校验 | 解析 `openfilm doctor` 输出 + 读 `runtime/node_modules/openfilm/package.json` 的 `version` | 同左 |

**镜像候选序**（每条都要"探活 → 失败换下一跳 → 全失败回官方并明确告知"）：

| 资源 | 候选序 | 说明 |
|---|---|---|
| npm 包 | `https://registry.npmmirror.com` → `https://registry.npmjs.org` | `npm ping --registry=<url>` 探活；镜像同步延迟 >24h 时降级官方 |
| Chromium（playwright） | `https://cdn.npmmirror.com/binaries/playwright` → 官方（`PLAYWRIGHT_DOWNLOAD_HOST` 不设即默认 CDN） | ⛔ **〔待实测〕** npmmirror 是否同步 `chromium-headless-shell` 该版本；不同步则跳过这一跳 |
| 桌面 App 安装包 | 复用 `electron/gh-mirror.ts`（gh-proxy.com → ghfast.top → 直连） | 与我们自身发版同一条真相源，⛔ 不另写一份 |
| ffmpeg | **不自建镜像**：系统包管理器或用户自备 | 避免来源不可信；若将来必须自带，需锁 sha256 + 独立 notices |

**安装状态机**（`openfilm:status` 的 `phase`）：

```
absent → probing → installing-cli → installing-browser → awaiting-ffmpeg → verifying → ready
                                   ↘ failed(code, hint)（任何一步可单独 retry）
ready → updating → ready
ready → studio-running → (studio-stale) → ready
```

错误码（渲染层按码给文案，不解析英文 stderr）：
`OF_E_NODE_OLD` / `OF_E_NPM_MISSING` / `OF_E_NPM_REGISTRY` / `OF_E_BROWSER_DOWNLOAD` /
`OF_E_FFMPEG_MISSING` / `OF_E_NOT_PROJECT`（退出码 2 且 stderr 含 "not a project"）/
`OF_E_RENDER_FAILED`（退出码 1）/ `OF_E_PORT`（Studio 端口拿不到）/ `OF_E_TIMEOUT`。

### 3.3 Studio 打开与"配对"

1. 主进程 `spawn(openfilm, ["open", filmDir], { env: { OPENFILM_NO_BROWSER: "1", … } })`
   ⛔ 必须设 `OPENFILM_NO_BROWSER`：否则它 15 秒后自己弹系统浏览器，我们就拿不到 `Studio <url>` 的正交体验。
2. 从 stdout 抓 `Studio\s+(http://\S+)`（**正则只认这一行**，URL 结构随版本变）。
3. 写 `session.json`，并向渲染层广播 `openfilm:studio-changed`。
4. 渲染层用**内置浏览器 pane** 打开该 URL（Chromium 引擎 ⇒ 预览即导出）。
5. 用户手改 Studio → 上游把改动写回 film 文件（`overrides`）⇒ Codex 下一轮 `look`/读文件即看到。
   **这就是"配对"的全部**：同一实例 + 同一目录 + 一句 `open` 幂等（已有页面时只切项目）。
6. 进程守护：`session.pid` 存活探测（Windows `tasklist /FI "PID eq …"`，macOS `kill -0`）；
   退出应用时**不强杀**（用户可能还在看），只在"重新 open"时复用同一 pid。

### 3.4 模型工具（dynamicTools，5 个，白名单命令）

| 工具 | 参数 | 行为 |
|---|---|---|
| `openfilm_make_film` | `brief`, `filmDir?`, `open?` | 确保 ready（必要时先返回"需要安装 + 让用户点一次"）→ `open <dir>` → 返回 `{studioUrl, manualDigest}` |
| `openfilm_check` | `filmDir`, `at?` | `look`（无 at）/`look <t>`（单帧）/`look a-b`（区间）；返回问题清单摘要 |
| `openfilm_render` | `filmDir`, `range?`, `fps?`, `alpha?`, `subtitles?`, `fourK?`, `out?` | `render`；返回产物绝对路径（不返回二进制） |
| `openfilm_get` | `kind`, `params` | `get`；未连服务时**原样回传上游提示**（让模型告诉用户去 Studio 连哪个服务） |
| `openfilm_skill` | `name` | `skill <name>` 打印正文（只读；⛔ 不改上游技能内容） |

实现纪律（照本仓既有规定）：

- `spawn(cmd, args[])`，**不经 shell**、不拼字符串；`cwd` 只能是 film 目录（做一个 `isInsideFilmRoot` 校验）。
- 每次调用带 `timeout`（look 120s / render 600s / get 120s），超时 `kill` 并回 `OF_E_TIMEOUT`。
- stdout 逐行流回渲染层（工具卡实时显示），**stderr 结构化**：`{ code, hint }`。
- ⛔ 不把 `render` 的产物读进内存回给模型（可能是几百 MB）；只回路径，符合"图片/产物一律落盘"的既有规则。

### 3.5 技能（内置 1 个）

`openfilm-video-editing/SKILL.md`（落 `$CODEX_HOME/skills` 由 skill-pack 管理）要点：

1. **什么时候用**：用户说"剪个视频/做个片子/口播/字幕/封面动效"→ 先用 `openfilm_status`，
   未安装就引导点卡片安装（**不要自己 npm install**）。
2. **必须走工具**，不许自己 `ffmpeg` 拼时间线（我们不允许模型重编码素材）。
3. film.html 五条铁律（本文件 §1.3 的浓缩版）：t 决定画面 / 只改 `#t=` 与 `at` / 不重编码 /
   字幕用 .vtt / Studio 的 `overrides` 与 `locked` 不许动。
4. 自检循环：改完必须 `openfilm_check`；有问题按返回项修，**两次不过就交人看**。
5. `render` 只在用户开口要文件时调；导出前先 `check`。
6. `get`（配音/配乐/图片）需要用户先在 Studio 连服务并给 key；没连就停下来说明。
7. 每次产出告诉用户：film 目录路径、Studio 是否打开、导出文件路径。

⛔ 不把上游 10 个 skill 复制进仓（版本会漂、许可混叠）——`openfilm skill <name>` 按需读即可。

### 3.6 控制台：自动更新开关

位置：「设置 → 关于与更新 → OpenFilm 组件」（设置页注册表一行）。

| 控件 | 值 | 默认 |
|---|---|---|
| 自动更新 | `关 / 启动时检查 / 自动安装`（三档，与主应用同款语义） | 启动时检查 |
| 检查频率 | 启动 + 每 24h（沿用主应用节奏） | 固定 |
| 立即检查 / 立即更新 | 按钮（有版本差才可点） | — |
| 镜像 | `跟随全局（自动）/ 只用官方` | 跟随全局 |

实现要点：

- CLI 形态：`GET https://registry.npmmirror.com/openfilm/latest`（失败降级 npmjs）取 `version`，
  **只与 `compareVersions` 比较**（单一真相源）；更新 = 重跑 §3.2 第 1 步（同一 prefix，原子替换）。
- 桌面 App 形态（若用户装了）：读 `latest-win-x64.yml` / `latest-mac-{arm64,x64}.yml` 的 `version` 字段
  （⛔ 注意上游文件名**不是** `latest.yml`）；我们**只提示**，不代跑 electron-updater（那是它自己的更新器）。
- 两形态互斥显示（装了 App 就以 App 为主，CLI 仍可并存——它们的项目库共享）。
- 更新按钮的执行必须**可取消**（复用既有 `install-runtimes` 的取消信号），并在结束时复核 `doctor`。

---

## 4. 数据与状态（落盘）

```
<userData>/openfilm/
  settings.json          # { autoUpdate: "startup"|"auto"|"off", mirror: "auto"|"official", ffmpegPolicy }
  session.json           # { projectPath, studioUrl, port, pid, startedAt }
  install.log            # 最近一次安装的分步日志（截断 200 行）
  runtime/               # npm 私有 prefix（node_modules/openfilm + .bin/openfilm）
```

⛔ 不放二进制 ffmpeg；⛔ 不缓存渲染产物（产物都在 film 目录里）。

---

## 5. IPC 通道清单（manifest → gen:ipc）

| 通道 | 方向 | 载荷 |
|---|---|---|
| `openfilm:status` | invoke | → `{ phase, version?, node?, ffmpeg?, browser?, error? }` |
| `openfilm:install` | invoke + 事件 | `{ steps }` / 进度事件 `openfilm:install-progress { step, pct, log }` |
| `openfilm:retry` | invoke | `{ step }` 单步重试 |
| `openfilm:uninstall` | invoke | `{ keepFilms: true }`（⛔ 永不删用户 film 目录） |
| `openfilm:update` | invoke | `{ check: boolean }` → `{ current, latest, action }` |
| `openfilm:settings` | invoke | 读写 `settings.json` |
| `openfilm:studio-open` | invoke | `{ filmDir }` → `{ url }`（内部开内置浏览器） |
| `openfilm:run` | invoke | `{ verb, args, filmDir }`（白名单：`look/render/get/skill/doctor/skills`） |
| `openfilm:studio-changed` | 主→渲 | `{ url, projectPath, alive }` |

域登记：`ipc-registry.ts` 里 `{ prefix: "openfilm", count: 9, status: "in-features" }`；
`composition.json` 加一行 `openfilm`；跑 `gen:ipc` + `gen:domains`（⛔ 生成物各仓自产）。

---

## 6. Windows / macOS 适配差异（必读表）

| 维度 | Windows | macOS | 我们的处理 |
|---|---|---|---|
| **桌面 App 产物** | 只有 `OpenFilm-Setup-x64.exe`（**无 arm64**） | `OpenFilm-{arm64,x64}.dmg` + `-mac.zip` | 按 `process.arch` 选包；Windows ARM 用户**:只能用 CLI 形态**，UI 明说 |
| 安装方式 | NSIS 静默 `/S`（**首次**可能弹 UAC；`--all-users` 需管理员） | 挂载 dmg → `cp -R` 到 `/Applications` → **`xattr -dr com.apple.quarantine`** | dmg 里的 app **未公证**，不清 quarantine 会被 Gatekeeper 拦（文案要写清这是上游现状） |
| 卸载 | `%LOCALAPPDATA%\Programs\OpenFilm\Uninstall OpenFilm.exe /S` | 删 `/Applications/OpenFilm.app` + `~/Library/Application Support/OpenFilm` | 我们只管 CLI 形态的卸载；App 形态给"打开卸载器"按钮，不代删 |
| CLI 入口 | `node_modules\.bin\openfilm.cmd`（**必须走 cmd 或 node 直接执行 mjs**；不要 `shell:true`） | `node_modules/.bin/openfilm`（symlink） | 统一用 `node <runtime>/node_modules/openfilm/bin/openfilm.mjs` 调用，绕过 .cmd/.ps1 差异 |
| Chromium 缓存 | `%LOCALAPPDATA%\ms-playwright` | `~/Library/Caches/ms-playwright` | 安装前探测是否已有（有就跳过下载，省 100MB） |
| ffmpeg | `winget install Gyan.FFmpeg`（需用户确认） | `brew install ffmpeg`；无 Homebrew 时给官网 | ⛔ 不代装系统包；⛔ 不内置二进制（GPL 传染风险） |
| 路径 | 空格/中文在 0.2.6 前有乱码 bug | 同上 | film 库固定 `<workspace>/films`，并在创建前校验"无空格、无中文"失败即提示换目录 |
| 端口 | 随机；被占用时由 Studio 自己选 | 同左 | 只从 stdout 抓，不猜端口；拿不到 → `OF_E_PORT` |
| 进程结束 | `taskkill /PID <pid> /T /F`（Studio 是 node 子树） | `kill -TERM <pid>` | 只在"重开/卸载"时结束，退出应用不动它 |
| 退出码 | Node 24.17 曾返回 127（0.2.6 已修） | 正常 | 统一按 0/1/2 分流，其余归 `OF_E_*` + 原样 stderr |
| 更新元数据 | `latest-win-x64.yml` + `.exe.blockmap` | `latest-mac-arm64.yml` / `latest-mac-x64.yml` + `.zip/.dmg.blockmap` | 只读版本号提示；⛔ 不代跑 electron-updater |
| 签名 | 安装包未签名（可能 SmartScreen 提示） | 未公证 | 文档明说来源（GitHub Releases 官方仓），并给 sha256 校验入口 |

---

## 7. 界面与文档中的开源声明（用户明确要求）

### 7.1 工具页卡片文案（逐字）

```
OpenFilm（第三方开源项目）
  开源许可：MIT（格式 / CLI / Studio / 桌面端）
  项目地址：https://github.com/openfilm/openfilm
  官网：https://openfilm.dev
  “OpenFilm” 名称与图标归 OpenFilm 项目所有（TRADEMARK.md）；本产品仅提供下载/安装/调用入口，
  与该项目无隶属或背书关系。安装包与运行时均由上游发布，我们只做镜像加速与校验和比对。
```

> ⛔ 卡片里**不出现**上游 Logo（品牌面纪律）；只用文字链接 + `ExternalLink` 图标。
> ⛔ 不用"官方集成/合作"措辞。

### 7.2 文档与 notices

- 本文（`docs/OPENFILM-INTEGRATION-2026-10-27.md`）即调研与方案的事实来源。
- 实施时在 `THIRD_PARTY_NOTICES.md` 增条：
  ```
  OpenFilm (https://github.com/openfilm/openfilm) — MIT License, Copyright (c) OpenFilm contributors.
  本产品不分发 OpenFilm 二进制；安装时由 npm registry / GitHub Releases 获取，并保留其 LICENSE 与
  TRADEMARK.md。名称与图标为 OpenFilm 项目商标，本产品与其无隶属关系。
  ```
- 用户首次安装成功 → 安装完成卡片里带一次同样的声明（可折叠，不打扰）。

---

## 8. 实施计划（按批，每批一提交 + 全链 check 绿）

| 批 | 内容 | 判据 |
|---|---|---|
| **P0** | 本文档 + `openfilm` 域空壳（status 探测 + 设置读写） | 新板块守卫生效（一前缀一板块）；`gen:ipc`/`gen:domains` 生成物齐；`check-preflight` 绿 |
| **P1** | 安装器（CLI + Chromium + ffmpeg 探测 + 镜像候选序 + 单步重试） | 真机：断网/镜像挂掉/Node 过旧 三种失败路径都有正确错误码；重装幂等 |
| **P2** | Studio 打开 + session.json + 内置浏览器 pane + 进程守护 | 真机：`open` 拿到 URL、内置浏览器可见、重开幂等（不 New Tab） |
| **P3** | 5 个 dynamicTools + 内置技能 + 工具面守卫 | 真机一条龙：`make_film` → 改 film.html → `check` → `render` 出 MP4 |
| **P4** | 更新开关（三档）+ 桌面 App 形态（下载/静默装/Gatekeeper 引导） | 更新开关落盘 + 手工检查能拿到版本；App 形态安装/卸载各一次 |
| **P5** | 声明与文档（卡片文案、notices、README 段落） | 文案逐字核对 + 无 Logo 混用 |

**实施前必须先跑的 5 个实测〔待实测〕**：

1. Studio 库根路径（`studio/server/projects.mjs` 的 `libraryRoot()`）在 Windows/macOS 各是什么，
   桌面 App 与 CLI 是否共用 → 决定"配对"是否只靠同一目录。
2. `PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright` 是否真能装到
   `chromium-headless-shell`（版本对齐 1.61.1）；不行就退回官方并如实告知慢。
3. NSIS 静默安装参数与安装目录（`/S` 是否带 `/D=`），以及首次是否必弹 UAC。
4. macOS 未公证 App 在 `xattr -dr` 之后能否直接启动（Sonoma/Sequoia 差异）。
5. `render --4k` 的耗时/内存基线（决定我们的超时与并发上限；同时验证 `--workers`）。

---

## 9. 风险与不做的

| 风险 | 处置 |
|---|---|
| 上游 CLI 输出/参数漂移（0.2.x 迭代很快） | 版本 pin + 解析只认 `Studio <url>` 与退出码；其余输出不解析；`doctor` 兜底 |
| Chromium 100MB 下载失败率高 | 三级候选（镜像→官方→提示手装 `npx playwright-core install chromium-headless-shell`） |
| macOS Gatekeeper 拦截 | 文案前置说明 + `xattr` 步骤 + 不假装"已签名" |
| ffmpeg GPL 传染 | **不内置二进制**；只引导系统包管理器 |
| 模型乱用（自己写 ffmpeg 拼片） | 技能正文 + 工具白名单 + 守卫断言（禁 `ffmpeg` 出现在我们自己的调用参数里） |
| 磁盘占用失控（render 产物） | 产物只落 film 目录（用户可见可删）；我们只在卡片显示大小 |

**明确不做**：不做 OpenFilm 的 MCP 封装（上游没有、也不稳定）；不 fork/改上游；不内置其 Electron 桌面端；
不用它的 Logo；不做"云端渲染"。

---

## 10. 参考

- 仓库：https://github.com/openfilm/openfilm
- 手册（给 agent）：`packages/openfilm/MANUAL.md`
- 格式规范：`packages/openfilm/SPEC.md`
- 商标：`packages/openfilm/TRADEMARK.md`；第三方：`packages/openfilm/THIRD_PARTY_NOTICES.md`
- 发布资产：https://github.com/openfilm/openfilm/releases/tag/v0.2.6
- 第三方概览（交叉验证）：https://www.opensourcealternatives.to/item/openfilm · https://alphasignal.ai/news/openfilm-lets-coding-agents-build-and-edit-videos-with-plain-html
