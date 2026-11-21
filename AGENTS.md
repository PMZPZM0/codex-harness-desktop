# AGENTS.md — Codex Harness Desktop 项目环境速览

本文件供 Codex 引擎读取：进到本项目（Codex Harness Desktop 桌面应用的源码 / 或本机运行环境）时，先读这里就知道「环境里有什么、缺什么怎么装、怎么调用」。保持简洁，详细手册见 `docs/TOOLCHAIN.md`（若存在）。

> ⛔⛔ **两个活跃仓都是纯本地构建 —— 搞错生效方式 = 白干一轮（2026-10-16 用户令；2026-11-19 云助手下线后收敛为两仓）**
>
> | 仓 | 改动怎么生效 | ⛔ 禁忌 |
> |---|---|---|
> | 桌面版 `D://Codex Harness Desktop`（主仓） | **纯本地构建**：`electron/**` → `npm run build:electron`（**必须重启应用**才生效）；`src/**` → `npm run build:vite`（`npm run dev` 下 vite 热更，刷新即可） | ⛔ **没有服务器、没有部署这一说** |
> | PPcode `D://PPcode` | **纯本地构建**（同主仓；本仓 = 源码 + 发布页合一） | ⛔ 同上 |
> | ~~云助手 `D://Codex Assistant`~~ | **已下线（2026-11-19 用户令）**：只保留 GitHub 源码仓 `PMZPZM0/codex-harness-cloud-src` 归档；服务器实例已删，云管理侧暂不动 | ⛔ 不再同步 / 构建 / 部署 / 发版 / 推送 |
>
> ⇒ 动手前**先确认症状出现在哪个仓、那仓的产物怎么生效**，再决定改哪里、拿什么当判据。
> （这条**不替代**下面「两仓同轮同步」的要求，两者都要守。）

## 怎么读这份文件（30 秒版）

| 你要做什么 | 读哪一节 |
|---|---|
| 先确认改哪个仓、怎么生效 | 下面那张「生效方式」表 |
| 提交前的硬红线（敏感信息） | 🔒 敏感信息红线 |
| 改代码前判断放哪一层 | 📐 功能板块划分（细则在 `docs/MODULES.md`） |
| 改完怎么算合格 | ⛔ 验收铁律 + 🧹 交付卫生 |
| 多仓同步 / 发版 | 🔁 多仓协作与发版 |
| 查「某个功能哪一轮加的」 | `docs/CHANGELOG-INDEX.md` |
| 引擎能用什么工具 / 能力 | 内置能力与会话动态工具（细则 `docs/TOOLS-AND-CAPABILITIES.md`） |

> 原则：**常驻只放每轮都要用的规则**；查阅型内容（板块地图、历史流水）在 `docs/`，需要时再读。

## 🔒 敏感信息红线（2026-11-07 用户令，硬性，无例外）

⛔⛔ **禁止把下列内容写进任何仓库、提交、推送或 GitHub 可见内容**（含源码/文档/注释/脚本/截图/commit message/Release Notes/Issue/PR 正文）：

⛔ 同样禁止出现在 AI 的对话回复、工作日志、探针/调试产物与临时文件里：只准报占位符、命中文件数或路径，**不准回显真实值**。用户已明确零容忍，违反一次即视为严重事故，不是「下次注意」。

1. 服务器公网 IP、内网 IP、主机名与云厂商实例标识；
2. SSH 端口、SSH 登录别名与「别名 → 真实地址:端口」的映射；
3. 开发机（本机）出口 IP；
4. IPv6 前缀 / IPv6 地址；
5. 私钥内容、口令、令牌、Cookie。

写运维/交接说明时**一律用占位符**：`<服务器地址>`、`<SSH 端口>`、`<出口 IP>`、`<IPv6 前缀>`；真实值只放在本机私密文件（如 `~/.ssh/config`、密码管理器）或服务器侧配置里，⛔ 不进 git、不进文档、不进截图。

提交前必查（命中任何一条就先删再提交；除 staged diff 外，还要查 `git status --short` 里的未跟踪文件；两仓同步时逐仓各查一次）：
```bash
git diff --cached | grep -nE "([0-9]{1,3}\.){3}[0-9]{1,3}|[0-9a-f]{1,4}(:[0-9a-f]{0,4}){2,}|ssh -p |端口[:：]?[0-9]{2,5}|BEGIN .*PRIVATE KEY"
```
⛔ **误提交 = 已泄露**：删文件/改文档**不算修好**（历史与 GitHub 缓存仍可查），必须同轮①改掉当前文件、②**轮换凭据**（SSH 密钥、面板口令、防火墙白名单），③再评估历史清理（`git filter-repo` + 强推是破坏性操作，需用户点头）。

## 🔁 多仓协作与发版（**AI 协作者必读**：跨仓改动的同步、推送、PPcode 发版全流程）

完整步骤见 **`docs/REPO-WORKFLOW.md`** —— 要点：本仓（主应用源码）与 `D://PPcode`（PPcode 副本，远端 = `PMZPZM0/PPcode`，源码与发布页**合一**；旧私有仓 ppcode-src 已删，10-13 换仓）同步走「主仓 diff → 逐文件 apply 预检 → 副本验证」；PPcode 发版 = 版本对齐 4 处 → mac 审计 → check → tag → CI 三端构建发布到本仓 Release；两仓 `AGENTS.md` 逐字镜像，改一边必须同步另一边。

> ⛔⛔ **改动必须同轮同步两个仓（2026-10-13 用户令；2026-11-19 收敛为两仓，对所有 Agent 生效，无例外）**：本产品现有两个活跃源码仓 —— 桌面版 `D://Codex Harness Desktop`（开发主线）、PPcode `D://PPcode`。**在任一仓完成一轮功能改动后，必须在同一轮把同一批改动同步到另一仓，并各自推送 `origin main`**；⛔ 只改一仓就收尾 = 这一轮工作**未完成**。云助手 `D://Codex Assistant` **已下线**：只保留 GitHub 源码仓 `PMZPZM0/codex-harness-cloud-src` 归档，⛔ 不进同步面、不构建、不部署、不发版、不再推送（服务器实例已删、云管理侧暂不动）。步骤见 `docs/REPO-WORKFLOW.md` §二：主仓 diff → **逐文件 `git apply --check` 预检**（⛔ 不整包瞎 apply）→ apply → 副本侧 `npm run build` + 受影响守卫 + `check-preflight` 验证 → `feat(sync)` 提交（写明主仓区间与判据）。⛔ **同步面包含 `logs/` 结论档案**：条目文件与 `logs/index.jsonl` 都要跟；补录后各仓必须跑 `node scripts/logs.mjs reindex` 重建索引（sha256 与文件字节绑定，直接拷索引会哈希不符）。
> ⛔ **`android/`（安卓远控 App 工程，10-28 立）只存在于主仓，⛔ 不进两仓同步面** —— PPcode 不需要 APK 工程；同步 Electron 源码时整目录跳过，别把两份 Android 工程带出来。
> ⛔⛔ **补丁更新规则（2026-10-25 用户令）**
> · **补丁更新 = NSIS 差分**：GitHub Release 同时发布完整安装包、`*.exe.blockmap`、`latest.yml`；客户端用 electron-updater 只下载变化块，缺 blockmap / 下载失败自动回退完整包。⛔ 不自制覆盖补丁、不直接改安装目录、不从非 GitHub 仓拉可执行文件。
> · **国内镜像固定顺序**：`gh-proxy.com → ghfast.top → GitHub 直连`（`electron/gh-mirror.ts` 单一真相源）。`latest.yml`、exe、blockmap 三类资产都走同一候选序；补丁资产请求⛔不带令牌。
> · **更新面板**「更新方式」= `补丁`（默认）/ `完整包`；手动下载与后台静默下载都按所选方式执行；只有 Windows NSIS 用补丁，mac / 其它平台走完整包。
> · **旧版本 blockmap 必须保留**：electron-updater 需要上一版 blockmap 做基线；从没有 blockmap 的旧版升级时允许整包，但⛔不许删/改历史 Release 资产。
> · **各自 Release 专用**：桌面版 tag `v*`、资产 `Codex.Harness.Desktop-*`；PPcode 用 `PMZPZM0/PPcode` 自己的 Release。⛔ 永不使用 `/releases/latest`；⛔ 不跨仓复用安装包 / blockmap / latest.yml；不另建第三方补丁仓。
> · **两仓 GitHub 对应**：主仓 `PMZPZM0/codex-harness-desktop`（推 `origin main`）；PPcode `PMZPZM0/PPcode`（推 `origin main`，源码+发布合一）。补丁流水线改动按「两仓同轮同步」推齐，但各仓只更新自己的更新源与资产。云助手归档仓 `PMZPZM0/codex-harness-cloud-src` 不进补丁流水线。
> ⛔ 生成物（`electron/preload.ts`、`src/vite-env.d.ts`、`electron/composition.gen.ts`、`electron/builtin-skills/14-skill-harness-api.ts`）由**各仓自己**跑 `npm run gen:ipc` + `npm run gen:domains` 产出，⛔ 别直接套主线仓的（两仓通道数各不相同）；`electron/ipc-channels.manifest.json` 与 `electron/ipc-registry.ts` 是**手写源**，分叉处逐项手工合并；行数棘轮（守卫【265】）按各仓实测值更新。
> ⛔⛔ **品牌不进同步面（2026-10-25 用户令：「codexharness logo 和 PPcode logo 不要串了」）**：两个活跃仓各有自己的身份基线，**同步功能改动时品牌面保持各仓原样**。
> · 桌面版（本仓）= **Codex Harness Desktop** + CH 图标（`public/icon.png` / `build/icon.*`），窗口标题同此；
> · PPcode = **PPcode** + PP 图标（自己的 `public/icon.png` / `build/icon.*`），侧栏品牌名单一来源是 `01-sidebar-shell.tsx` 的 `BRAND_NAME = "PPcode"`，窗口标题 `PPcode`、AUMID `com.ppcode.desktop`、身份基线自称 PPcode —— **这些差异是故意的**；
> ⛔ 具体纪律：① ⛔ 不把任一仓的 `icon.png` / `build/icon*` / 品牌文案拷到另一仓；② 从主仓 apply 到 PPcode 的 diff 若碰到品牌行，**必须保留 PPcode 侧**（冲突时手工合，不许"统一一下"）；③ 侧栏 `brand-name`、窗口标题、AUMID、登录页/启动页、企业微信接入文案、拓展页数据目录示例都算品牌面；④ 发版/截图核对时先确认左上角品牌名与图标属于该应用。PPcode 守卫 06【235】逐条钉住。


## 📐 架构改造计划

> 状态与历史细节已外置：`docs/PROJECT-PLANS.md`（逐字保留）。常驻只留结论：
> 架构改造**已基本完成**（按域拆分 + 插件化阶段 0 清零多前缀欠账）；现状细则见 `docs/MODULES.md` 与 `docs/ARCHITECTURE-RULES.md`。

## 🧩 「一切皆插件」改造方案

> 状态与历史细节已外置：`docs/PROJECT-PLANS.md`（逐字保留）。常驻只留结论：
> 「一切皆插件」**尚未执行**，内核/宿主绑定/安全边界不得插件化；见文档里的阶段 0–6 计划与接缝层纪律。

## 📐 功能板块划分与接口规则

> **细则已外置**：`docs/MODULES.md`（板块清单 / 归属判据 / 新增板块 checklist / 四条接口面契约）。
> 改代码前按下表定位，再读那篇的对应小节。

| 板块 | 目录 | 备注 |
|---|---|---|
| 会话与回合 | `src/features/app-state/`、`electron/main/` | 事件归约、回合容器、折叠 |
| 设置页 | `src/features/settings-*`、`electron/features/*-ipc.ts` | 注册表一行一页（【101】） |
| 技能 | `electron/builtin-skills*`、`electron/skill-packs-*` | 三层索引 + 描述 ≤60 字 |
| 记忆 | `electron/memory-*.ts` | 落盘在 `codex-home/memory/`，注入有预算 |
| 工具面 | `electron/tool-profiles.ts` | 目录 + CORE + 岗位增量 + 回滚开关 |
| 调度 | `electron/features/delegation.ts`、`teams-ipc.ts` | 工具面在 thread/start 定死 |
| 浏览器/桌面自动化 | `electron/automation-policy.ts`、`mcp-gateway.ts` | 三通道优先级 + MCP 懒加载 |
| 图像/影音 | `electron/image-*`、`openfilm/`、`media-tools.ts`、`artcraft.ts` | 生图/剪辑各一套 IPC；含 **Craft 全家桶**（artcraft）与 PhotoCraft |

**四条接口面契约**：① 一个板块 = 一个域前缀；② IPC 桥走生成器（勿手改生成物）；③ 断言读递归聚合面；
④ 新增能力同轮登记（`HOST_TOOL_CATALOG` / `skill-packs-catalog` / 守卫）。

## 🧹 交付卫生（2026-11-08 用户令，硬性，守卫组 14）

> 全文在 `docs/ARCHITECTURE-RULES.md` §12；这里只放**改代码时当场要守**的部分。
> ⛔ 用户原话：「AI 很容易漏掉这些，一定要记得人工复核」。

- **前端不许有孤儿**：新增 `src/` 文件必须**同轮**接进入口（从 `src/main.tsx` 沿 import 可达）。
  ⛔ 不留 demo / playground / 「复刻某某」的示例组件；板块对外出口 `features/xxx/index.ts`
  没人 import 就说明外部绕过了出口 —— 让外部改走出口，或删掉它。【291】
- **后端每条通道都要有消费者**：manifest ↔ preload ↔ 渲染层调用/主进程推送**四方对账**；
  没消费者的算死路由，删或登记进守卫的 `UNWIRED` 棘轮名单（只许缩）。删一条 = handler +
  manifest(`count`) + registry(`channels`/`count`) + `npm run gen:ipc`**四处一起删**。
  ⛔ 危险动词（clear/delete/install/uninstall/exec/write）的通道优先查 —— 11-08 就删掉过
  `favorites:clear`（不带 id、无确认、一把清空收藏，与【129】冲突）。【292】
- **字体只许系统栈**：本仓**不分发任何字体文件**、不许远程 `@font-face`。`font-family` 只能写
  系统字体 + 通用族（白名单在守卫里）。要带品牌字体 ⇒ 随包带 OFL/Apache 授权的 woff2 +
  加白名单 + 写 `THIRD_PARTY_NOTICES.md`，三件一起做。⛔ 商用字体进仓 = 侵权。【293】
- **许可与漏洞**：直接依赖必须可商用（MIT/Apache/ISC/BSD/OFL…），GPL/AGPL/SSPL/CC-BY-NC 零容忍；
  发版前跑 `npm audit --omit=dev`，有补丁的用 `overrides` 收掉，无补丁的写明为什么可接受。【294】
- **导出函数必须有中文注释（缺口恒 0）**：一句「干什么 / 边界 / 什么时候别用」即可，⛔ 不写与代码
  不符的套话。11-08 已把 923 个缺口全部补完，守卫 `BASELINE = 0` ⇒ 新函数不写注释 = 预检红
  （⛔ 不许把数字改大，那是变相豁免）。⛔⛔ **不许按函数名套模板批量生成** —— 试跑 14 条即废
  （产出 `AgentAvatar 组件。` 这种零信息废话）：必须「dump 函数体 → 读完 → 写一句事实」；
  坑 / ⛔ 禁忌钉在**对应函数头顶**，别只写文件头。⚠️ 收尾人工复核 diff：注释与代码冲突时**信代码**。
  批量补法、脚本清单、两仓同步（**导清单，不整份拷文件**）见 `docs/ARCHITECTURE-RULES.md` §12.6。【295】

## 🎨 视觉规范（2026-09-26 立，守卫【170】）

> **改 UI 前先读根目录 `DESIGN.md`**（色板 / 字体 / 组件约定 / 主题机制，全部实测自 `src/styles/`）。
> 三个真相源的分工：`AGENTS.md` 管「怎么建」· `docs/ARCHITECTURE-RULES.md` 管「架构怎么划」· `DESIGN.md` 管「长什么样」。
> ⛔ 改了 CSS 变量必须同步 `DESIGN.md` 的变量表 —— 守卫【170】做的是**真值对账**（文档里的色值 ≠ CSS 真值会打红），不是检查"文件存在"。
> ⛔⛔ **加浮层前先查 `DESIGN.md` 的「层叠层级带」**（09-29 立，守卫【198】）：主界面 <30 < 设置内 backdrop 80~97 < **画布 90** < 全局模态 400 < 轻浮层 1000/1001 < toast 9999+。四条硬规则：轻浮层必高于模态遮罩、全局模态必高于画布、**画布专属弹层只能画布内渲染（不许 portal 到 body）**、画布根 backdrop-filter 会创建 containing block。
>
> 🧩 **设计方法已内置成技能 `frontend-design`**（11-03）：正文唯一真相源 = `DESIGN.md` 的 `DESIGN-METHOD` 标记区，
> 由 `scripts/gen-design-skill.mjs` 生成为内置技能（守卫 12at 比对新鲜度）；改方法段后跑 `node scripts/gen-design-skill.mjs`
> （`npm run gen:ipc` 已带上）。打包版没有源码树，Codex 靠这个技能 + developer_instructions 第 19 条拿到同一套方法。

## ⛔ 临时产物放哪（硬性，2026-09-21 立）

**任何中间产物 —— 命令回显、探针 dump、扫描输出、截图、临时脚本 —— 一律写进 `.workbuddy/tmp/`。**
不许落仓库根目录，**更不许落 `D:\` 盘根**（那条规则是用户 09-21 亲自提的：清理时发现盘根躺着 **664 个**这类文件 / 17.3 MB，把盘搞得很乱）。

```bash
node scripts/xxx.mjs > .workbuddy/tmp/check-1.txt     # ✓ 正确
node xxx.mjs > /d/check-1.txt                          # ✗ 落 D:\ 盘根
node xxx.mjs > ./arch-scan.txt                         # ✗ 落仓库根
```

- `.workbuddy/` 已 gitignore，**不会污染仓库**；临时脚本本身（`tmp-*.cjs` / `tmp-*.mjs`）也放这里，跑完即删。
  ⛔ **「跑完即删」是硬性的**（细则见上方验收铁律纪律 **7**）：10-12 清理时这里已堆到 **1.4 GB** ——
  `.workbuddy/tmp/` 是**中转站，不是仓库**；一次性脚本与它的输出都不许跨轮留下。
- 仓库根只允许出现**源码 / 文档 / 配置**；别处冒出来的中间文件一律视为待清理。
- 收尾自查：`git status` 干净 + `D:\` 盘根没有你新产生的文件。

## 📓 项目日志库 `logs/`（09-25 立，守卫【158】）

**结论档案**（不是流水账）：一个结论一个文件 + 结构化头 + `index.jsonl` 索引 + sha256 校验。
配套：规范 `logs/README.md`、工具 `scripts/logs.mjs`、技能 `.codex/skills/log-archive/SKILL.md`。

```bash
node scripts/logs.mjs new --kind decision --area memory --title "…" --tags a,b --files p1   # 建条目
node scripts/logs.mjs search <关键词...> [--area a] [--since d]     # 检索（本地打分，按相关度）
node scripts/logs.mjs show <唯一前缀即可>                            # 看内容
node scripts/logs.mjs dedupe / verify                              # 查重 / 完整性校验
node scripts/logs.mjs archive <id...>                              # 清理（默认用它）
node scripts/logs.mjs delete <id...> --confirm <id...|all> --reason "…"   # 硬删（留永久墓碑）
```

⛔ **该写**：定了方案（`decision`）/ 修了非显而易见的 bug（`incident`）/ 发版（`milestone`）/ 改了用户可感知行为（`change`）/ 推翻了旧结论（`decision` + `supersedes`）。
⛔ **不该写**：纯格式、重命名、依赖升级 —— 留在每日流水即可。

⛔⛔ **不许重复写**（用户 09-25：「确保没有重复写日志哈」）：同一段正文**只允许存在一份**。
- **日报**（`<ws>/.workbuddy/memory/YYYY-MM-DD.md`）记时间线与零散判断；涉及结论时**只留一行 `→ logs/<id>`**，⛔ 不复述正文
- **`logs/`** 记结论/依据/影响面/回滚；⛔ 不抄日报流水，也不抄进 `lessons/`
- 两道机制拦阻（不靠自觉）：`new` 写入时就拦相似标题（≥0.75）与相同正文；`dedupe` 随时全库查重

⛔ **不丢失的五道保障**（按强度）：① `logs/` **进 git**（⛔ 别被 gitignore 吃掉，条目必须 `.md` —— `.gitignore` 有 `*.log`）
② 一条一目追加写、不覆盖（改结论用 `supersedes`）③ `verify` 用 sha256 抓篡改/截断 ④ 索引可 `reindex` 重建（磁盘才是真相源）
⑤ 删除**先写墓碑再删**（`audit-deletions.jsonl` 永久留 id/path/sha256/reason ⇒ 内容可删，"存在过"不可删）

## 🧭 对话与信息准则（2026-09-26 用户指定，对项目内 AI 助手行为生效）

1. **信息边界**：遇到不确定、无法查证的内容直接回复「不知道」，禁止猜测、编造信息，主动减少幻觉。
2. **信息溯源**：涉及数字、日期、价格、政策等内容，区分有无权威来源；给不出权威来源的，明确标注「需要自行核实」。
3. **语言要求**：使用通俗直白的语言，摒弃空洞晦涩、没有实质内容的词汇。
4. **回答结构**：先给出结论，再阐述理由；不做冗长无效的铺垫。
5. **需求确认**：用户需求表述模糊时，主动提问确认，不自行揣测并直接作答。

## 🦓 默认工作方式 = Ponytail（10-13 用户指定，**默认生效**）

**任何编码类任务默认走 `ponytail` 技能（强度 full）**：写代码、加功能、重构、修 bug、
做设计、选库选依赖 —— 全部适用。装在 `~/.workbuddy/skills/ponytail*`（6 个技能：
`ponytail` / `-review` / `-audit` / `-debt` / `-gain` / `-help`），开关 `/ponytail lite|full|ultra`，
`stop ponytail` 退出。

**决策阶梯（停在第一个站得住的档）**：

1. **这东西需要存在吗？**（YAGNI）
2. **本仓已有吗？** 已有 helper / util / 类型 / 模式 → 复用。**动手前先看**
3. **标准库能做吗？** 用它
4. **平台原生能覆盖吗？** 原生特性优先于引库
5. **已装的依赖能解决吗？** 别为几行代码新增依赖
6. **能一行吗？** 一行
7. **到这才写**：能跑的最小代码

⛔ **阶梯在「读懂问题之后」才走，不是在它之前**。先追完整流程、看清要改哪些文件，
再爬阶梯。**跳过理解直接甩小 diff 是危险的那种懒** —— 穿效率外衣、交付一个自信的错误修法。

**修 bug = 修根因，不修症状**。工单说的是症状；动手前 grep 你要改的函数的所有调用方。
懒办法就是根因修法：共享函数里一处守卫，比每个调用方各加一处 diff 更小，
只补工单点名那条路 ⇒ 兄弟调用方全还坏着。

**规则**：不做没人要的抽象（单实现的接口、单产品的工厂、永不变的配置）；
不做"以后再说"的脚手架；**能删就不加**；动用的文件数尽量少；
复杂需求 ⇒ 先交懒版本，同一条回复里问一句「先这样够吗，要全量说一声」，**绝不卡住等答复**。

**⛔ 不许省的地方（这条优先于上面全部）**：
- 信任边界上的输入校验、防止数据丢失的错误处理、安全措施、可访问性基本项、用户明确要求的；
- **"读懂问题"这件事本身**：阶梯缩短的是解法，不是阅读量；
- **硬件相关的标定旋钮** —— 真实时钟会漂、真实传感器会偏，物理世界需要调参，最小模型看不见；
- **非平凡逻辑要留一个可跑的检查**（分支 / 循环 / 解析器 / 金额与安全路径）：
  留最小的、逻辑坏掉就会失败的那一个（`assert` 自检或一个小 `test_*.py`）。
  平凡的一行不需要测试，测试也适用 YAGNI。

**刻意简化但有已知天花板**（全局锁、O(n²) 扫描、朴素启发式），
用 `# ponytail: <天花板>，<何时升级>` 注释标明 —— 与本项目既有的「⛔ 已知取舍」注释惯例一致。

**输出纪律**：代码优先，其后**至多三行**说明（跳过了什么、何时该加）。
不写没人要的散文与设计长文；**用户明确要的解释（报告、讲解、分阶段说明）不算债务**，照给。

## ⛔ 本文件有注入上限（2026-09-26 实测，守卫【172】）

**引擎读本文件是有字节上限的，超了会静默截断**（不报错、也不加"已截断"提示 ⇒ agent 自己不知道少读了什么）。

- 引擎参数 = `project_doc_max_bytes`，**官方默认仅 32768 字节**；本应用已在启动参数里抬到 **524288**（`electron/codex-server.ts`，守卫【172】钉住 + 校验值必须 > 本文件实际大小且留 2× 余量；⛔ 10-16 由 262144 抬高 —— 本文件长到 131KB 后 2× 余量判据只剩 1.99×，预检会红）。
- ⛔ 引擎会**从 cwd 向上遍历并拼接多级 AGENTS.md**（项目级 + `codex-home` 全局个性化约 12KB），**上限卡的是拼接总量** ⇒ 本文件不要无限增长。
- ⛔ 写在这里、超出上限的部分**等于没写**：agent 读不到，却以为规则已生效。**关键规则往文档前部放**。
- 自查口径：`wc -c AGENTS.md`（字节，不是 `wc -l`）。

## 🔑 现行不变量速查（改这些地方前必读；详解见括号里的文档）

> 09-26 拆骨时从各轮变更小节提炼。**⛔ 每条都有守卫钉着，改坏会红**；这里是「为什么」与「别踩的坑」。

- **长会话滚动 = 顶部/底部双占位 + 5 回合滑动窗口**（10-21，用户定稿「滚轮知道回合条数、自适应滚动条长度」）：打开会话后台用 `thread/turns/list itemsView:"notLoaded"` 拉全量回合元数据（只回 id/startedAt，59 回合实测 7ms）→ `turnHistoryPlan` 用 `windowTail` 取滑动切片；顶部 `.timeline-history-spacer` 与底部 `.timeline-history-bottom-spacer` 都用「隐藏回合数 × 估算回合高」，窗口移动时一增一减、总高度不变。⛔ 渲染**必须用 `historyPlan.visible`**（不是 `visibleTurnWindow` 的尾窗，否则占位区动、内容不动 = 滑进空白）；⛔ DOM 恒 ≈5 个回合，全量加载后切会话不许挂 53 个（实测 2s → 0.5s）；⛔ 只在占位区边界 + 2 屏、且**上滚**时水合（`HISTORY_PAGE=2`；老回合常有巨型工具输出，5 条一页会阻塞主线程十几秒）；下滚走 `slideTurnWindowDown` 本地滑窗；⛔ `contentBottomOf` 只扣**尾部**留白，绝不扣顶部占位区；⛔ 窗口滑动/水合前 `setHistoryPinState` 交接锚点（带 `direction/expectedTail/expectedLength`），layout effect 在 **paint 前**补 scrollTop；⛔ 切回缓存会话恢复阅读位置时 `setScrollUserDetached(true)`（否则 rAF jumpToBottom 落到文档底 = 底部占位区空白）；⛔ `data-history-total` = `hiddenStubs + 已加载回合`（别把已加载隐藏回合重复算）。守卫【14】+ `turnHistoryPlan` 真值表；验收 `scroll-wheel-release` 9 条（含全量加载后切回 DOM≤7/位置保持）。
- **刻度尺联动**（10-21）：当前阅读位置（`contentOffsetTop` 的 30% 探针，⛔ 不用 `offsetTop`）自动成为波浪中心，`wave-0/1/2` 是 26/18/15px；hover 优先。⛔ **波浪只朝聊天一侧（右）变长：左端 `margin-left` 恒 12px**（用户 10-21：「只有靠近对话框这边有波浪效果，左边不要波浪效果」）。压缩绿线**静止 12px，波浪扫过时与相邻刻度同宽（26/18/15px）**（用户 10-21：「绿线也要跟着波浪变化长短」），且可点击跳到压缩回合；每根刻度都有 `data-turn-id` 且点击走 `jumpToTurnInWindow`（滑窗把目标挂载后用内容坐标对齐到顶部 12px）。守卫【12r】30 条；验收 `ruler-wave` 6 条（宽视口真会话；②/⑤ 真量左端对齐）。
- **正文紧凑文件行 + 底部「已编辑 N 个文件」汇总**（11-21 用户对照 Qoder 定稿；旧「本轮产物 7 张卡」已删）：消息正文出完字后渲染一排紧凑文件项（图标 + 文件名，点击走 `src/lib/right-file.mjs` 事件箱 → `RightFileBridge` 开右栏「文件」页、放宽到 420px、高亮并展开项目树）；回合底部只留**一条**可折叠汇总条「已编辑 N 个文件 +X -Y」，点开是逐文件行（点击「审查」/行本身进右栏审阅，悬停看 diff），⛔ 不再逐个出产物卡（同一批文件不许重复展示）。右栏「文件」页 = 项目树（单击预览 / 双击编辑器）+ `WorkspaceFilePreview`（走 `fs:read`，覆盖 Markdown/代码/图片/PDF/二进制占位）；「默认应用」走 `shell:open`。⛔ **创建后又删除的文件也要进汇总条**：最终快照与开始一致时报告会为空 —— 结算必须用最后一次**非空** live 明细把最终快照没有的路径补成 `deleted`（⛔ 空 live 不能清掉这份记录），否则用户看到「我明明改了文件，汇总卡整块消失」。守卫【11p】113 条；验收 `inline-file-row` 3 条（点击文件项真开右栏）。
- **云账号「登录即用」**（10-22）：登录页与设置页的「一键同步 / 修复」共用 `src/lib/cloud-provision.mjs`（顺序 = 模型 → 知识库 → 记忆 → 生效位；生效位放最后，`onlyIfEmpty` 已配置别的供应商时不抢；⛔ 不无条件 force 重签）。设置页三段式：未登录只有「登录即用」卡；已登录是就绪清单 + 一键同步；重签/测试/上传下载会话等手动流程收进「手动流程 / 高级设置」。新手教程在页内与侧栏「新手教程 → 云账号」各一份。服务器云管理联动：模型走主进程 10 分钟轮询，知识库/记忆由 `CloudAccountSyncBridge` 每 10 分钟只刷新**已接通**的资源。守卫【12q】77 条；验收 `cloud-simple` 5 条。
- **模型检测必须真推理**（10-21）：`/models` 里有 **≠** 能用 —— `cn.pptoken.cc` 的 `grok-4.7` 在列表里，但 `/responses` 与 `/chat` 都 30s 零字节；旧探活只看列表就报「检测通过」。现在指定模型必须真发一次推理（35s 超时，失败给中文指引）；协议桥 auto 探活 200 但 18s 无数据 / 非 SSE 时回落 chat，显式 responses 也有 120s 空闲看门狗。守卫 06/07 + 测试 `tests/responses-bridge-fallback.test.mjs`。
- **Codex 日志管理（09-29）**：设置 → 数据管理里的「Codex 日志」管的是引擎写的**会话记录原档**（`codex-home/sessions|archived_sessions/rollout-*.jsonl`，含对话全文），按项目（文件首行 `cwd`）→ 日期两级分组，可勾选批量删除 / 整库清空。⛔ **销毁性功能**：域内通道只认 `rollout-*.jsonl` 且必须落在那两个根目录内（越界/目录一律拒绝、不存在幂等）；删除时**级联剔除 `session_index.jsonl` 对应条目** —— 不剔就是会话列表里一堆打不开的死条目。守卫【200】12 条。

- **语音音色 = 当前真正在合成的引擎**（`voice:models-status` 的 `speech` 是单一真相源：**外部引擎 > 克隆 > MOSS > 本机**）：音色下拉**始终同时列「本机音色」（模型真实说话人；选它＝停用外部引擎、真用本机合成）与「我的音色」（参考音频，外部引擎/克隆拿它当参考）——⛔ 只列参考会把模型音色整个藏掉；本机音色名读模型自带的 `G_multisperaker_latest.json`（⛔ 不再写死「音色 1..5」）；⛔ **试听（`previewVoice`）必须与 `speak` 同一条链**（外部 > MOSS > 本机；行内档案试听用 `explicitProfile` 走本地克隆）——只认 MOSS/本机的旧实现会让「换了模型点试听还是旧声音」；没有可用引擎时不给假下拉。**外部引擎的音色选在各自引擎卡点的二级弹窗里**（分组列：Chatterbox 原生默认音色 / 随包 `resources/voice-presets` 默认音色（不依赖基础模型）/ 本机说话人样本 / 我的音色），**按引擎独立**落 `tts.engineVoices`（key=引擎 id；`native` / `preset:<id>` / `builtin:<sid>` / `profile:<id>`，没选过走开箱默认音色，⛔ 不再共用 `engineVoice`）；轻量播报自己的音色卡在它「音色」二级弹窗里（11-17 从公共「音色与克隆」区移入）——每个语音模型配置独立、互不影响；**每行音色都要能用该引擎现场试听**（`voice:preview-voice` 传 `engineId`/`engineVoice` 强制该引擎，⛔ 不许回落 MOSS/本机；未启用则先启用它，同一时间只跑一个）；音色克隆模型（109MB 主包 / 54MB 声码器）下载**先走多连接分段**（从吞吐探测最快的镜像开 4 路 Range，失败回落单流+续传；进度显示 MB/s）——单连接实测只有 30–530KB/s，用户报「下载巨慢」；⛔ **这四个引擎目前只适配 Windows**（Windows 便携包 / Windows venv / CUDA torch）：目录标 `platforms:["win32"]`，主进程拒绝安装/启用并清掉别处拷来的启用态，卡片标「当前平台不可用」并指路基础模型 / MOSS；mac 仍可用基础模型 + MOSS + 随包默认音色，⛔ 别在 mac 上让用户白下 8GB；⛔ 内置样本必须由 `synthesizeLocal`（本机 vits）生成，别走 `previewVoice`（会自我循环）；**服务状态必须推事件**（`type=service` + 启动中 2s 轮询），⛔ 卡片不许永远挂「启动中」；二级弹窗内再开弹窗用 `SettingsDialog elevated`（950 档）。⛔⛔ **非商用权重的引擎一律不进目录**（IndexTTS2 2.0 / F5-TTS / Fish Speech 已于 11-17 移除，连同端口/适配器模板/安装源；老档案里的启用态由 `activeExternalEngine` 自动清掉）；每个引擎的「怎么用」步骤写在目录数据的 `usage` 里、在弹窗里展示；引擎卡等高、简介/许可限两行、底部「状态左 / 配置右」；配置弹窗同样按「启用与安装 / 音色 / 怎么用 / 来源与许可」四块卡片分区。守卫 11z / 12bv。
- **记忆后端二选一**（`docs/CHANGELOG-ROUNDS.md` →「记忆后端二选一」）：内置金字塔 ⇄ MCP 记忆**互斥**，同一时刻只用一个。⛔ 判定一律用 `effectiveMemoryBackend()`（**不是** `memoryBackend()`）：选了 mcp 但服务起不来 ⇒ **回退内置**（宁可回退也不能"一处都不写 = 丢记忆"）。`electron/memory-backend.ts` 是叶子模块，不许进 `runtime-refs.ts`。守卫【150】。
- **`electron/main/**` 零反向依赖**（同上 →「断环收尾」）：所有 `electron/main/*.ts` 不得 `import ... from "../main"`。路径常量走 `electron/runtime-paths.ts`（叶子）、单例走 `electron/runtime-refs.ts`；`from "../main"` 的**白名单**（守卫【132】，9 符号）与 `main/**` 历史引用上限（守卫【143】）都不许扩大。⛔ 新增守卫 **【147】** 用剥注释后的 import 图求 SCC，`runtime-refs` 与三个叶子不得在任何环里。**注释里写 `from "…"` 会被裸正则当成真 import** ⇒ 环检测器必须剥注释。
- **正文 Markdown：列表尾部的「结语行」**（同上 →「正文 Markdown 渲染」）：列表最后一项后紧跟顶格结语会被 CommonMark 判成 lazy 续行 ⇒ 渲染歪成 `<li>…<br/>结语</li>`。修法是 `softenListTailLazyContinuation`（`src/lib/markdown-blocks.mjs`，纯函数可跑真值表）。⛔ **围栏感知是必须的**：代码块（含流式未闭合 ```）内绝不能注入空行。另：行首/行尾的**全角空格 U+3000 不参与 HTML 空白折叠** ⇒ 会渲染出可见空白，由 `trimInvisibleSpace` 处理（只对非围栏行、不动行中间）。守卫【149】。
- **停止链路：委派场景不要挂"运行中"**（同上 →「停止链路」）：引擎报 `expected active turn id <X> but found <Y>` 时，宿主已结束、真实活跃回合是 Y ⇒ **按报错里的 Y 重试中断**；重试也失败 ⇒ **一律复位运行态**，绝不挂着让用户反复点。守卫【131】。
- **搜索 = 当前会话内**（同上 →「搜索改为『当前会话内』」）：顶栏 🔍 只搜当前会话（跨会话实现保留但不接 UI）。⛔ 开关必须复用 `bag.chatSearchOpen` **单一真相源**（Ctrl+Shift+F 也走它）。⛔ `collectMessageTexts` 必须用 `itemText(item)` 按 type 取字段 —— **userMessage 的正文在 `content[]` 里、`item.text` 为空**，只看 `item.text` 会让用户自己发的消息搜不到。守卫【146】。
- **更新检查的版本比较**（同上 →「审计报告遗漏项补修」）：`updates.ts` 用 `parseVersion`/`compareVersions`，⛔ 不许退回「字符串不等即更新」；stable 通道尊重 `prerelease`（**本地是预发布版时除外**，否则 beta 用户永远收不到更新）。守卫【144】。
- **守卫的「行为断言」要跑真产物**（同上）：`accelerator.ts` 与收藏夹的判据跑 `dist-electron` 产物（sanitizeAccelerator / acceleratorLabel / 收藏夹 add·删·clear），收藏夹用 `mkdtempSync` 临时目录、**不碰用户真实数据**（守卫【145】）。
- **办公室预览 = 像素卡通办公室（v19，现行）**：原生 canvas 2D，画布 **960×640**；底图 `assets/bg.webp` + 6 个 CC0 像素角色（每张 112×96、16×32 帧，坐姿列 6）+ 6 个工位。成员由 `office-sim` 从门口走入、坐班/休息/接水，显示器由 `drawScreen` 逐帧绘制（工作/事件/完成屏保），缩放 contain + 指针锚点。⛔ 用户 10-22 明确「删了，还是做成原来那种卡通人物+办公室场景」⇒ 照片场景、3D 白板/3D 工位板全部删除，不许再复活；守卫 11d + 11o + 06 场景块钉。⭐ 10-25 起**每间 6 人、超出自动开下一间**（同一底图/座位；每间一份独立 `OfficeSim`，老员工留在原办公室，切回来位置不重置）；新开一间自动切过去，底部「办公室 N / M」左右键手动切换。⛔ 不许再用 `slice(0,6)` 把多出的成员静默挤掉（守卫 11d 判据组 H）。

## ⛔ 验收铁律（硬性要求，2026-09-11 起生效，先读这条）

**本项目任何源码改动，一律以「自动验收通过」为完成标准。禁止「我改完了，你自己点一下试试」。**

改动完成 = 下面这条命令**退出码为 0**：

```bash
npm run verify     # 等价于 npm run check && npm run e2e
```

| 层级 | 命令 | 覆盖什么 | 失败意味什么 |
|---|---|---|---|
| ① 离线预检 | `npm run check` | 构建 + **产物新鲜度** + IPC 三件套一致性（main.ts handler ↔ preload 桥接 ↔ vite-env.d.ts 方法面）+ CSS 类覆盖告警 + **纯函数行为断言**（`src/lib/*.mjs`，node 直接 import 跑真实现）+ 结构守卫（零阻塞宿主 / 验收入口唯一化） | 改了没重建 / 桥接漏了类型 / 有死链 / 判定逻辑跑偏 / 架构约束被破 |
| ② 验收（**只有一条脚本**） | `npm run accept` | `scripts/accept.mjs`：拉起**已构建**应用，在**跨轮次复用的持久 profile**（`.e2e-profile/main`，首次把真实会话历史搬进来）上跑本轮验收项，失败自动截图到 `.e2e-artifacts/shots/` | 界面/行为真破了（看截图与逐项输出即知） |

> 🖱 **前端 / 交互改动的「人眼验收」用 computer-use（真键鼠）**（11-08 用户令「以后可以用这个 computeruse 验收前端改动」）：
> MCP `open-computer-use`（Qoder 侧已接；应用内 Codex 侧是随包的 `computer-use`，工具前缀各随客户端）。
> 流程：`npm run build` → **关掉重开**保证窗口在前台 → `get_app_state` 看截图 / AX 树 → `click` / `press_key` 实点 →
> 每步回读状态 → 收尾关掉。⛔ 坑：`app` 写**进程名**（`electron`）不写窗口标题；截图是屏幕区域、窗口必须在前台；
> `type_text` 被拒改用 `press_key`；多窗口时 key window 可能跳到宠物窗。⛔ `npm run accept` / `verify:runtime` **保留**做自动化回归 ——
> computer-use 证明「人能点、能看到」，CDP 证明「逻辑没回归」，两者不互相替代。

纪律清单：

1. **⛔ 验收范围由流程保证：默认只跑「最新一轮」**（用户严令，不靠自觉加 `--only`）—— `scripts/accept.mjs` **按轮次分区**：
   - 每个验收项在文件顶部的 `ROUND_OF` 里登记轮次，`LATEST_ROUND` 指向当前轮；
   - **默认（不带参数）= 只跑 `LATEST_ROUND` 那一轮**；`--only <id>` 只跑指定项；`--all` 才是全量；
   - `--list` 会打印每项所属轮次；新增验收项**必须**登记轮次，否则默认跑不到且会打印警告。
   历史项不删（仍是回归证据），但**永远不会在默认路径上被执行** —— 单跑一次默认验收只有 4~5 项。
   **全量 `--all` 只在三种情况**：发版/里程碑前、跨模块改动无法界定范围、用户明确要求，且跑之前先说明理由。
   判断"本轮该跑什么"的原则：改渲染层交互/滚动 → 那几项渲染项；**改主进程/引擎/打包 → 不跑 accept**
   （CDP 断言测不到），改跑 `check` 并把可静态验证的部分补进预检守卫；纯文档/注释 → 只跑 `check`。
   判据：**这条断言会不会因为这次改动而变红** —— 不会就是纯浪费用户的时间和 token。
2. **改了哪个模块，就改 `scripts/accept.mjs` 里对应的验收项**（每项是 `{ id, name, run(h) }`，可 `--only <id>` 单跑）。⛔ **不要再新建场景目录**（旧「历史场景 + 增量哈希 runner」已删，preflight【7】不许它回来）；本轮不再对应的旧验收项**直接删掉**，别攒着。
3. **断言必须带前置条件**（先断言「有这个前提」再做判断），否则上一步的残留状态会导致假通过。
4. **不做反证**（用户明令）：断言写完直接跑正式那轮，"改回去确认会红"的步骤**取消**。
   ⛔ **反证删除、审查保留**：**代码审查是收尾固定一环，与反证无关，不许一起删**。
5. **能用静态守卫的别用 CDP 跑**：要「重启应用 / 断网 / 换网段 / 并发多会话」才能复现的，钉进 `scripts/check-preflight.mjs`（如【10】【11】），改坏了 build 阶段就红，零运行成本。
6. **⛔ 每个功能/任务收尾都要跑一遍代码审查**（用户明令，**不是可选项**）。用 **`dongming-code-review`** 技能
   （随包在 `resources/expert-skills/dongming-code-review/`，源自 alibaba/open-code-review；⛔ 旧文档里写的
   `open-code-review` 在本机**加载不到** —— 10-08 实测，按那个名字找技能会扑空，故更正）。
   ⛔⛔ **10-31 补充**：这个技能此前**从没装进技能目录**（只在 `resources/expert-skills/` 里躺着）
   ⇒ 文档写着名字、实际加载不到、于是每轮都被跳过（当晚连续 5 轮只跑 build + 守卫就提交）。
   已装到 `~/.workbuddy/skills/dongming-code-review`。若某个环境仍加载不到它，用 **`xaction-code-review`**
   兜底并在结论里说明用了哪个 —— ⛔ 不许因为"技能找不到"就跳过审查。
   ⛔ **判据（10-31 两次踩坑的代价）**：`npm run build` 绿 + 守卫全绿 + 启动校验 PASS **都不等于审过了**。
   守卫只钉已知契约，审不出 **并发窗口 / 共用状态 / 死代码** 这三类 —— 实测代价：并发建会话撞笔名
   （两条会话拿到同一个名字）、两个调度弹窗共用一个 ref 导致自动关失效。
   ⛔ 审查对象是**本轮全部提交**（`git log <上次审查的提交>..HEAD --oneline` 全列），不是"记得的那一个"。
7. **⛔⛔ 收尾必须跑一次「运行时探针」**（10-31 白屏事故后加，用户原话「这都报错，你咋验收的」）：
   `npm run verify:runtime`（= `node scripts/verify-runtime.mjs [端口] [毫秒]`，默认 9391 / 10000）。
   它拉起真应用 → 连 CDP → 抓**控制台 React 报错** + 看 **ErrorBoundary 遮罩** + 验 **.app-shell 渲染**，
   并打印侧栏会话行数与笔名徽标数（"新功能到底跑没跑"的肉眼凭证）；加 `--alias-e2e` 顺带报笔名三通道。
   ⛔ `check-app-dist.mjs` 只证明「产物被加载」，**证明不了界面能跑** —— build 绿 + 守卫绿 + 它 PASS，
   用户一开仍然可能白屏（10-31 我在普通函数 `renderThreadRow` 里调 hook ⇒ React #310）。
   ⛔ 同理：**"我本地跑了一遍"不算**，要贴探针输出里的「ErrorBoundary / .app-shell / 报错明细」三行。
   **审查对象是本轮 diff**（不是全仓库）；**问题当轮修掉再提交**；**结论要能说出依据**。
   改动极小可走轻量路径并说明为何轻量，但**不许因"改动小"跳过**（历史真 bug 全出在"看起来只是小改"的地方）。
   四条自查判据（**完整版 → 技能 `dongming-code-review` §2/§6**）：
   · 改「运行态开关/模式/后端」时，**搜全仓库找每个引用点**逐个确认是否跟着分岔（同族缺陷常散在未改文件里）；
   · **只验「剔除」不验「落地」**：把一批项从顶层摘走改到别处渲染时，反向自问「每一项都还在某处渲染吗」；
   · **断言必须打到「代码形态」**（`indexOf`/`includes` 会命中**注释** ⇒ 代码改回去照样绿）：用数组字面量 / 三元 / 转义 payload / `delete→set` 语句序列；
   · **新加/改过的断言必须做变异测试**（备份 → 改坏 → 跑检查 → **必须报 ✗** → 还原）—— 验证「断言非恒真」的唯一可靠手段。
   ⛔ 环境坑：agent 的 node 里 `spawnSync` 被沙箱拒 ⇒ 变异脚本写 **bash 逐项跑**；检查输出可能走 **stderr** ⇒ 用 `2>&1` 合并。
   ⛔ **负向结构断言必须过 `codeOnly()` 剥注释**（`guards/_ctx.mjs`）：注释里引用代码片段是本项目常态，
   裸 `!/xxx/.test(src)` 随时被注释顶成假红。欠账数由预检末尾的**守卫自检告警**报告（只报告不失败，逐步收敛），
   按**赋值来源**判定（⛔ 不靠变量名猜：`hardCode` 是「hard-coded」缩写，不是 codeOnly 产物）。
7. **⛔ 测试脚本「用完即删」（10-12 用户立，硬性）**：为验收 / 排查临时写的一次性脚本（`tmp-*.mjs`、`tmp-*.cjs`、
   探针 / dump / 变异脚本）**只活这一次** —— 跑完连同它产生的临时输出一起删掉，**不许留在盘上跨轮累积**
   （10-12 清理实测：`.workbuddy/tmp/` 已堆到 **1.4 GB**、含上个月的一次性脚本）。收尾固定两步：
   ① 删脚本与它的输出；② `ls .workbuddy/tmp` 确认没有本轮残留。
   ⛔ **边界（别删错东西）**：常驻判据 `scripts/guards/**`、`scripts/accept.mjs`、`scripts/e2e/**`、
   `scripts/verify-*.mjs` 是**资产**（删了等于毁掉回归），本条只管**一次性脚本**。
   ⛔ 旧的一次性脚本**发现即删** —— 它们不是证据（证据在 `logs/` 存量档案与守卫里），留着只会让人以为"还在用"。


### 排查方法论（09-13 一整天弯路换来的，动手前先读）

> ⚠️ 完整版（含当轮的具体证据与六个反例）→ **`docs/TESTING.md` 的「排查方法论」**。要点：

1. **看到症状先别调阈值、别加条件** —— 先问「**有几个东西在写同一份状态 / 同一根滚动条？**」根因几乎总是两类：① 多个 owner 抢同一个东西；② 状态被提前/错位消费。**阈值从来不是根因。**
2. **先打点，再推理**。打点是第一动作，不是最后手段；打点要带数字（top/gap/pad/err），不要只写"到这里了"。
3. **测试必须跑到事件真正结束**（用户原话：「每次测试消息都不看完，你能发现什么bug，总是运行中就杀应用」）—— 长回合的毛病只在后段暴露。
4. **判据不能用会随渲染状态变化的量**：折叠组收起时 `innerText` 是空串（用 `textContent`）；侧栏按最近活动重排 ⇒ **会话要用标题点、不能用行索引**（用索引测出来的结论一半是假红）。
5. **状态重置要挂在「动作」上，不能挂在「某条渲染分支」上**（挂分支 ⇒ 分支被挡掉时清零也跟着跳过）。
6. **文档与代码同轮更新** —— 过时文档会主动误导下一轮（旧 AGENTS.md 描述过已删的实现，当天的弯路有一部分就是照它走的）。

### 引擎自己怎么跑验收（已实测）

引擎跑在应用体内，而 `accept` 会**再拉起一个隔离实例**——不会和自己撞车。实测依据：单实例锁按 `userData` 隔离，验收用 `.e2e-profile/main`，两实例完全独立并存。

```bash
resources/tools/node/node.exe scripts/accept.mjs              # 跑本轮全部验收项（约 20s）
resources/tools/node/node.exe scripts/accept.mjs --list        # 列出验收项
resources/tools/node/node.exe scripts/accept.mjs --only greet  # 只跑 id 含 greet 的项
resources/tools/node/node.exe scripts/accept.mjs --keep        # 跑完不关应用，留着手动看
```

`npm run accept` / `npm run e2e`（同一条）亦可，前提是 PATH 里有 node。**验收跑的是 `dist/` + `dist-electron/` 产物，必须先构建**——`check` 已含构建。

## 这是什么

一个 Electron 桌面应用，把 OpenAI Codex 引擎（`@openai/codex` app-server，stdio JSON-RPC）封装成可用的桌面工作台：多会话、插件/技能、自动化工具、连接器（MCP）、记忆分层。

## 内置能力与会话动态工具

> **完整对照表已外置**：`docs/TOOLS-AND-CAPABILITIES.md`（内置 11 项 / 按需下载清单 / 每个 dynamicTool 的来源与用途）。
> ⛔ 判断“某个工具现在能不能用”**只认模型工具列表**：工具面按会话画像收窄（`electron/tool-profiles.ts`），
> 文档里写了不等于本会话注册了；没注册的能力走 `harness_tools` 网关。
> 全部通道清单（721 条）见内置技能 `harness-api`（自动生成，别手抄）。

## 工具链清单

**随包内置（离线可用，勿重复下载）**：Node（安装器引导）、VS Code CLI、**Nuphus 桌面自动化**（`tools/npm-global` 预解压）、**ponytail 插件源**（`tools/ponytail-plugin` 1.6MB）。⛔ **必须两条 extraResources 映射**：`from=resources/tools/npm-global`（根级 shim）+ `from=resources/tools/npm-global/node_modules`（包体本身）——electron-builder 会**无条件丢弃 `from` 根级的 `node_modules`**，只写一条映射的话包里只剩 shim、包体全无。其余（Python/Git/PowerShell/rg/uv/CMake/Ninja/7-Zip/jq）09-16 起不随包，走「开发工具」页按需下载；**首次启动检测到缺 Git 会自动后台补装**（`autoInstallGitIfNeeded`：仅 Windows、与手动安装互斥、装完 `restartServerWhenIdle` 刷新引擎、失败广播 done 事件不悬挂安装态，下次启动仍缺会再试）。**ponytail 默认不装**（09-27，见【26】）：随包只留安装源，启动**不再自动种**；想用在「开发工具」页手动安装（`runtime:install` id=ponytail），卸载后不会自动装回。

**按需安装（应用内「开发工具」页 或 手动）**：

| 工具 | 大小 | 安装方式 | 装完效果 |
|---|---|---|---|
| Nuphus 桌面自动化 | 随包 30MB | **随包直出**，卡片显示「内置」；目录损坏时点「修复安装」（重新解压 zip 到 `tools/npm-global/` + 激活联动开关 + 引擎重启） | nuphus MCP 注册 35+ 桌面工具（经 nuphus-call 按需调用） |
| Ego Lite 浏览器自动化（首选） | 安装后约 611MB（不随包） | 「设置 → 开发工具 → Ego Lite」→ 官方安装器（Windows 约 13.5MB 在线包 / macOS 146–164MB），完成 GUI 引导 | `ego-browser` CLI 可用；每会话一个 `codex-<CODEX_THREAD_ID>` TaskSpace，多会话并行、共享登录态 |
| browse-skills 默认浏览器（回落） | 随包（nuphus） | 无需单独安装；装好 Nuphus 后 `nuphus-call browser_*` 即可用 | ego 未安装时的浏览器自动化回落通道 |
| ponytail 写代码模式插件 | 随包 2MB | **默认不装**（09-27 起，按需安装）；用人在开发工具页手动安装 | 会话钩子 + 6 个 ponytail-* 技能 |
| FFmpeg / yt-dlp / Miniconda / MinGW | 各 20~300MB | 开发工具页「下载」（联网） | 对应命令可用 |
| Docker Desktop / OpenSSL | — | 系统级安装（开发工具页打开官网） | 系统命令 |
| 语音模型（sherpa-onnx 三件套，识别+端点检测+合成） | 总 ~270MB | 开发工具页「下载模型」或「本地导入」（开发版专用：识别 4 种常见目录布局，SHA256 校验后落盘到 `<userData>/voice-models/`） | **生产构建不打包**——`package.json` 的 `asarUnpack` 只解 `sherpa-onnx-*/**`（原生 addon），模型数据走 userData 按需下载 |

## 安装操作（引擎缺工具时怎么自助装）

1. **优先看 `tools/` 目录**：`resources/tools/npm-global` 存在 = 自动化工具已装；`tools/{node,python,git,...}` 存在 = 基础运行时已装。
2. **缺 Nuphus（随包内置能力缺失）**：调用应用内 `runtime:install`（id=`nuphus`，从随包 zip 修复解压），或手动：
   - 解压随包 `tools/automation-tools.zip` 到 `tools/`（内置 python：`python -c "import zipfile; zipfile.ZipFile('automation-tools.zip').extractall('tools')"`），结果得到 `tools/npm-global/`。
   - 重启引擎（或重选一次供应商触发 `applyCustomModel`）→ nuphus MCP 段写入 config.toml。
3. **缺 Ego Lite**：到「设置 → 开发工具 → Ego Lite 浏览器自动化」点「下载安装」，完成首次引导（CLI 才会进 PATH）；不要自己跑第三方安装脚本。
4. **缺 ponytail 插件**：默认就没装，要用就走这条安装：`runtime:install`（id=`ponytail`），随包安装源 `tools/ponytail-plugin` 种到 `codex-home/plugins/cache` + 写 `[marketplaces.ponytail]` / `[plugins."ponytail@ponytail"]` / 钩子信任。
5. **装完统一**：重启引擎生效；插件/技能/钩子状态从 `plugin/list`、`skills/list`、`hooks/list` 读。
7. ⛔ **写 config.toml 的键值走 `config/value/write` 时必带 `mergeStrategy: "replace"`**（引擎必填；缺了整条请求被拒 `Invalid request: missing field mergeStrategy`，而这些调用普遍 `.catch(() => undefined)` 静默吞掉 → 表现成「开关点了没生效」）。预检【26】有结构守卫：每处调用 600 字符内必须出现该字段。09-16 实测：ponytail 卸载/装回的 enabled 写入漏了它，长期没生效。

## 人工预览（给用户看 / 自己看）

- `npm run preview:fresh`：拉起一个**全新临时实例**（隔离数据目录 ⇒ 未登录 + 未配模型 + 无历史，不碰真实配置与历史），用来人工确认首启引导、空态与布局观感。**前台运行**，关窗即结束。
  ⛔ 必须在用户自己的终端前台跑：agent 沙箱里命令结束会回收整棵进程树（detached spawn / 系统级启动 / 常驻后台任务三种写法全部实测失败），**窗口活不过命令**。
  ⛔ 临时实例的宿主环境变量必须摘：`ELECTRON_RUN_AS_NODE`（不摘 = 启动即崩）、`NODE_OPTIONS`（不摘 = 窗口能开但功能全哑）、`CODEBUDDY_SAFE_DELETE*`。
- 改了 UI 要「让用户亲眼看」时：先 `npm run build`，再让用户跑这条命令；或自己用 e2e harness 起实例截图给对方（截图前记得关掉挡屏的引导弹窗与展开的下拉菜单）。

## 验证基建实现细节 → `docs/TESTING.md`

**写新验收项 / 调试 e2e 时才需要查**，细节已整体外置。三条最常踩的：

- **E2E 靠主进程自带开关**：`CODEX_HARNESS_USER_DATA`（重定向 userData）+ `CODEX_HARNESS_DEBUG_PORT`（CDP 端口）—— ⛔ **别写行号**（搬过就失效），用符号 grep 定位。
- **测试实例工作区 = 项目根**（harness 用 `addScriptToEvaluateOnNewDocument` 注入 `localStorage.workspace`）；`new ElectronHarness({ workspace: null })` 可关掉。
- ⛔ **宿主环境变量必须摘干净**：`ELECTRON_RUN_AS_NODE`（不摘 = 启动即崩）、`NODE_OPTIONS`（不摘 = 窗口能开但功能全哑）、`CODEBUDDY_SAFE_DELETE*`。harness 已处理。

⛔ **现存验收项不在此列举** —— 要看清单就跑 `node scripts/accept.mjs --list`，要理解某项就读它的 `name` 与 `run(h)`（早期文档列过已删除的脚本，只会误导）。

## 引擎初始化原则（2026-09 定）

- **初始化回归原生**：不预写 marketplace 段、不首启自动种插件/技能。
- **一切可下载的拓展都按需安装**（自动化包、浏览器内核、ponytail、ffmpeg 等），`runtime:install` 统一入口。
- 官方精选市场（`openai-api-curated`）需 ChatGPT 账号登录才能装，API Key 方式装不了。**10-03 用户改判：卡片放出来**（不再整源隐藏），点不动时由 `changePlugin` 给中文提示兜底。想要「装了就能一键用」的官方插件走上面「Codex 官方插件市场」那一节内置的镜像源。

## 引擎怎么知道「宿主有哪些能力、能拓展什么」（09-25 立，守卫【153】【159】）

用户报障：「接口和拓展清单，Codex 好像不知道，扫半天都没扫到，不知道能拓展什么」。实测根因**不是清单没做**，
而是**可达性**：

- 清单本体 = 内置技能 **`harness-api`**，由 `scripts/gen-capability-skill.mjs` 从
  `ipc-channels.manifest.json` + `ipc-registry.ts` **生成**（87 域 / 441 通道，10-11 实测重生成）⇒ 永远与代码同步。
  **加/改通道后必须重跑生成器**（`npm run gen:ipc` 已挂钩顺带重生成）；守卫【153】比对过期即红。
- ⛔ 引擎的技能目录只给 `name + description`（渐进披露）⇒ 模型**不知道要读**；而用户问「能拓展什么」时，
  模型的第一反应是 **grep 源码**，打包版根本没有宿主源码 ⇒ 整轮白跑。所以 `developer-instructions.ts`
  里有一条**常驻**指针（第 11 条，块名 `CAPABILITY_INSTRUCTIONS`）：点名技能、说明「一次读全、
  别用 cmd 的 `type "路径"`（引号会被通道剥掉）」、给出**拓展点分类**、并写明打包版边界。
- 清单正文自带两张表：**「可拓展点」**（想加什么 → 改哪里）与**「怎么读这份清单」**。改生成器时别删。

## 两个「改了就影响所有会话」的默认值：跨进程同源（09-25，守卫【159】）

`electron/` 与 `src/` 是**独立打包产物、互不 import** ⇒ 这两个默认值各有一份字面量，必须同源：

| 默认值 | 主进程真相源 | 渲染层同源副本 |
|---|---|---|
| 自动压缩比例 **0.6** | `electron/app-settings.ts` 的 `DEFAULT_AUTO_COMPACT_RATIO`（经 `normalizeAutoCompactRatio` 归一） | `part01/04-optimistic-turn-approval-e2e.tsx` 的 `AUTO_COMPACT_RATIO_DEFAULT` |
| 供应商最大并发 **10** | `electron/features/custom-model-types.ts` 的 `DEFAULT_MAX_CONCURRENCY` | `src/lib/concurrency.mjs` 的 `DEFAULT_MAX_CONCURRENCY` |

⛔ 只验「常量存在」不够 —— 变异测试证明过：**把接线那行删掉、常量还留着，断言照样绿**。断言一律锚
**接线/取值本身**（`text += CAPABILITY_INSTRUCTIONS;`、两侧字面量逐字比对）。改默认值先看用户档案：
`app-settings.json` 里存着的值**会覆盖默认**（只改默认 = 老用户看不到变化）。

## 应用 UI 速览（引擎了解宿主能力用）

- **内置浏览器在右侧面板**（不在中央主区，聊天不受影响）：右栏「浏览器」标签 = Electron `<webview>`（宿主窗口 `webPreferences.webviewTag: true`），guest 与宿主隔离、无 node API。组件 `src/components/BrowserPane.tsx`（`variant="panel"` 适配右栏宽度）。右栏四个标签（变更/审阅/浏览器/文件）常驻直达，无「打开标签页」选择器（10-22 用户令撤掉「终端」标签 —— 默认宽 308px 放不下五个、审阅被挤出可视区；终端页仍在，Ctrl+J / 命令面板可开。「项目树」同日升级成「工作区文件」= 树 + 只读预览，见下方文件卡不变量）。标题栏行高 44px 与 titleBarOverlay 原生窗口钮对齐。
- **浏览器自动化优先 Ego Lite 的 TaskSpace**（每会话一个 `codex-<CODEX_THREAD_ID>`，共享登录态、并行不抢页）；未安装时回落 browse-skills（`nuphus-call browser_*` 默认浏览器）。内置浏览器面板只用于用户查看页面；Playwright / Cloak 入口已移除。


## 近期功能性变更（索引）

> **全量流水已外置**：`docs/CHANGELOG-INDEX.md`（含每轮「用户原话 → 改了什么 → 判据」）。
> 这里只留最近 3 条，防止 AGENTS.md 反复膨胀。⛔ 只增不回改：搬走的条目不再改写。

- 11-19 记忆金字塔删除 + 技能清单变索引（描述 60 字）+ 工具面按会话画像（CORE/岗位）+ MCP 懒加载网关
- 11-19 `find_skills` 工具：实时扫盘检索本地技能（新装的立即可搜到）
- 11-19 精选技能包：Playwright / Cheat On 随包入册、支持更新、带版本号

更早的条目（10 月至今，含每条的用户原话与守卫编号）→ `docs/CHANGELOG-INDEX.md`。
