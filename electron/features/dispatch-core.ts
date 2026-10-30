/**
 * dispatch-core（09-22 架构改造：从 electron/main.ts 组合根按域拆出，纯搬迁）
 *
 * 域：调度能力的**常驻核心** —— 令牌持久化、内置调度 MCP 服务器的工具面（schema）、
 *     可调度对象目录（专家 / 专家团 / 子智能体）、以及「不允许开调度」的会话识别。
 * 搬出符号：restrictedThreadRole / DISPATCH_FIXED_PORT / dispatchToken / dispatchHttpPort /
 *           DispatchProbe / dispatchProbes / ensureDispatchToken / stableKey / dispatchMcpTools /
 *           dispatchHttpReady / buildDispatchCatalog。
 * 与 ./dispatch.ts（纯策略：canDispatchFrom / admitDispatch / 文案）和 ./features/dispatch-rpc.ts
 * （HTTP 端点 + RPC 执行入口）的分工：本模块只提供**元数据与状态**，不含执行链路。
 * 消费方：main.ts（bindBoot 注入 + mutableState）、features/dispatch-rpc.ts、features/delegation.ts、
 *         features/engine-ipc.ts、features/teams-agents-ipc.ts、features/custom-model-apply.ts。
 *
 * 代码与原地逐字一致（仅顶部 import、文件头注释、末尾 setter 与 export 清单）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问）。
 * ⛔ dispatchHttpPort / dispatchHttpReady 是 let 且被 features/dispatch-rpc.ts 经 mutableState 赋值
 *   ⇒ 本模块暴露 setter（ESM 里 import 的绑定不可赋值，TS2632）。
 */
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { readUsableExpertTeams } from "../expert-teams";
import type { DispatchTarget } from "../dispatch";
import { readSubAgents } from "../main/09-agents-plugins";
import { CLI_CATEGORIES, cliInstalledFlags, readUsableCliAgents } from "../cli-agents";
import { delegateRegistry, teamRunStore } from "../runtime-refs";
// ── 调度（09-15）：让 Codex 在任意会话里调度 专家 / 专家团 / 子智能体 干活 ─────────────
// 四层防护里主进程负责的部分：L3 执行侧硬闸、L4 并发/深度闸、L1 持久指令。
// L2（注册侧不给工具）在渲染层，但那一层防不住「线程复用 / 竞态 / 以后有人改错注册点」——
// 所以真正的安全边界是下面这行 canDispatchFrom：**给了工具也不认**。

/** 「不允许开调度」的会话识别（09-16 用户要求：专家会话 / 专家团会话也要禁用掉）。
 *  覆盖三类：① 被调度产生的临时会话（delegateRegistry）② 专家团会话（主理人 + 成员）
 *  ③ 单人专家的直达会话 —— ③ 走的是同一条 member-session 链路（单人专家 = 只有 lead 的团队），
 *  所以 teamRunStore 里的 thread→team 映射一并覆盖。 */
async function restrictedThreadRole(threadId: string): Promise<{ restricted: boolean; label?: string }> {
  if (!threadId) return { restricted: false };
  if (await delegateRegistry.infoOf(threadId)) return { restricted: true, label: "被调度的临时会话" };
  if (teamRunStore.teamOfThread(threadId)) return { restricted: true, label: "专家 / 专家团" };
  return { restricted: false };
}

// ⛔ 09-16 重大修正（引擎硬约束，四个决定性实验实测）：dynamicTools **只在 thread/start 生效**——
// resume / fork / turn/start / queue/start 一律不认（引擎二进制里也只有 thread/start.dynamicTools）。
// 这意味着渲染层 dynamicTools 注册的 agent_invoke 对**老会话永远不可见**，之前「开关确认后重放
// resume」的修法是假绿（断言正则匹配到了提问里的「有没有」）。唯一能覆盖所有会话（含老会话）的
// 通道是 **MCP**：引擎级注入，工具对所有线程可见。故 agent_invoke 改走内置 MCP 服务器（下方
// dispatchMcpScript），安全闸全部收敛到主进程 HTTP 端 + 引擎事件旁证（谁调的、有没有权限）。

/** 内置调度 MCP 服务器（HTTP 直连）。⛔ 端口必须**固定**、令牌必须**持久化**：
 *  config.toml 里的 url 是引擎启动时读的，若每次运行都变（随机端口/随机令牌），
 *  引擎就会连到**上一次运行的死端口** → 工具永远注册不上（09-16 实测踩坑）。 */
const DISPATCH_FIXED_PORT = 47120;
let dispatchToken = ""; // 由 ensureDispatchToken() 从文件读/生成
let dispatchHttpPort = DISPATCH_FIXED_PORT;
type DispatchProbe = { threadId: string; argsKey: string; at: number };
const dispatchProbes: DispatchProbe[] = [];

/** 读取（或首次生成并持久化）调度令牌：跨运行稳定，config.toml 无需每次重写。 */
async function ensureDispatchToken(): Promise<string> {
  if (dispatchToken) return dispatchToken;
  const file = path.join(app.getPath("userData"), "dispatch-token.txt");
  try {
    const saved = (await fs.readFile(file, "utf8")).trim();
    if (saved.length >= 16) { dispatchToken = saved; return dispatchToken; }
  } catch { /* 首次运行没有文件 */ }
  dispatchToken = crypto.randomUUID().replace(/-/g, "");
  try { await fs.writeFile(file, dispatchToken, "utf8"); } catch { /* 写失败不致命：本次会话仍可用 */ }
  return dispatchToken;
}

/** 稳定序列化（键排序）：把「item/started 事件里的 arguments」与「MCP 服务器收到的 arguments」对上号 */
function stableKey(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      return Object.keys(obj).sort().map((k) => `${k}:${JSON.stringify(walk(obj[k]))}`).join("|");
    }
    return String(JSON.stringify(v) ?? "null");
  };
  return String(walk(value)).slice(0, 4000);
}

/** 调度工具的 schema（MCP tools/list 与 stdio 通道共用）。 */
function dispatchMcpTools(): unknown[] {
  return [
    {
      name: "agent_invoke",
      description:
        "调度专家 / 专家团 / 子智能体 / CLI 智能体 执行一个独立子任务并拿回产出。"
        + "⛔ **专家、子智能体、CLI 智能体随时可以直接派，不需要用户开任何开关**（别让用户去调度面板勾选）；"
        + "**专家团默认关闭**，team / member 未开启时会被拒绝 —— 要团请用户打开「专家团」，别反复试。"
        + "本会话当前可派哪几类、各有哪些对象，以会话里那条「调度范围已更新」的告知为准。",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["expert", "team", "member", "subagent", "cli"], description: "expert=单个专家, team=专家团(主理人按SOP调度), member=专家团某成员, subagent=子智能体, cli=本机命令行 AI（Claude Code / Codex CLI / OpenClaw 等）。⛔ 专家/子智能体/CLI 随时可派；专家团需用户开启" },
          name: { type: "string", description: "对象名称（专家名 / 团名 / 子智能体名）" },
          member: { type: "string", description: "kind=member 时的成员名" },
          query: { type: "string", description: "交给它的任务描述（要自包含：对方看不到本会话上下文）" },
        },
        required: ["kind", "name", "query"],
      },
    },
    {
      name: "agent_archive_sessions",
      description: "征得用户同意后，归档本次调度产生的临时会话。",
      inputSchema: {
        type: "object",
        properties: { threadIds: { type: "array", items: { type: "string" }, description: "要归档的调度会话 id 列表" } },
        required: ["threadIds"],
      },
    },
    /* ── 知识库检索（10-01 立项）：模型在会话里直接查项目知识库 ──────────────────
       执行端在 dispatch-rpc.ts（knowledge_search 调 kb:search 同源逻辑）。
       workspace 缺省 = 当前会话的工作目录（threadCwd）。 */
    {
      name: "knowledge_search",
      description: "检索当前项目的本地知识库（用户通过「知识库」页导入的文档/笔记/规范）。返回相关片段列表（含来源文档名与高亮片段）。用户说「查一下知识库/项目资料/我们的规范」时用它。",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索关键词（可空格分隔多个词）" },
          limit: { type: "number", description: "返回条数（缺省 8）" },
        },
        required: ["query"],
      },
    },
    /* ── 知识库写入（2026-10-04 用户问「写入知识库的工具有配置好吗」——
       答：只配了一半。knowledge_search 能读，但**模型没有任何工具能写**，
       kb:add-text / kb:add-files 只接在 IPC 上给设置页 UI 用，模型侧不可达。
       ⚠️ 权限闸与 scheduler_save 同源（restrictedThreadRole）：专家/被调度会话不许写知识库
       —— 否则"被委派的模型能往项目知识库塞东西"是**越权**。
       ⛔⚠️ 关于同名：`safeId()` 末尾拼了 `Date.now()` ⇒ **同名不覆盖，而是变成新文档**
       （这是既有实现，防的是"静默丢知识"）。代价是**同名会堆积成重复条目**，
       所以本工具在同名时**明确回报"已存在同名文档"并给出 docId**，让模型决定要不要换标题；
       ⛔ 绝不静默塞一堆同名垃圾进知识库（那会让检索结果被重复条目占满）。 */
    {
      name: "knowledge_add",
      description: "把一段内容写入当前项目的本地知识库（之后可用 knowledge_search 检索到）。用于：用户说「把这个记进知识库/存到项目资料」时，或你刚产出一份会被反复引用的规范/结论/说明。⚠️ 不会自动做语义向量化（全文检索立刻可用），且同名文档不会覆盖、会产生新条目。装了 Laya 智能判断时，低价值内容会被拒写并说明原因——充实内容后重试即可；与已有条目重复的内容同样会被拒写（会给出重复的那条）。",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "文档标题（同一标题再次写入会**新增一条**而不是覆盖）" },
          text: { type: "string", description: "正文（Markdown 纯文本）" },
          source: { type: "string", description: "来源标注（文件路径 / URL / 手写），便于日后追溯与删除" },
        },
        required: ["title", "text"],
      },
    },
    /* ── 定时任务四件套（09-28 用户要求「直接调用定时任务工具」）─────────────────────
       用户在会话里说「每天早上给我 AI 早报」⇒ 模型直接建任务，不用去界面点。
       执行端在 dispatch-rpc.ts：scheduler_save 走 restrictedThreadRole 同源闸
       （专家 / 被调度会话不许建 —— 防套娃：专家安排任务、任务再调专家）。
       ⚠️ 设计变更：此前模型侧没有 scheduler 工具（【196】原负向断言）——放开后
       该断言已改为「必须含四件套」，且 harness-api 的调用面说明已同步。 */
    {
      name: "scheduler_save",
      description: "创建或更新一个定时任务：到点后在指定工作区自动执行提示词（一次性或周期）。可选在已有会话里续聊执行，可选把回合结论推送到微信。不确定用户要在哪个会话执行时，先问用户再建。",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "任务名（如「AI 新闻早报」）" },
          prompt: { type: "string", description: "到点执行的提示词（必须自包含：定时任务看不到本会话的任何上下文）" },
          workspace: { type: "string", description: "工作目录；缺省 = 当前会话的工作目录" },
          threadId: { type: "string", description: "执行所在的会话：\"current\" = 就在当前这个对话里续聊执行（最常用）；或传具体会话 id；**缺省 = 新建会话**。用户说「就在这个对话里…」必须传 \"current\"；不确定用户要哪个会话就先问" },
          scheduleType: { type: "string", enum: ["once", "recurring"], description: "once=只跑一次；recurring=周期" },
          scheduledAt: { type: "string", description: "once 必填：执行时刻（ISO 8601 带时区，如 2026-09-29T09:00:00+08:00）" },
          rrule: { type: "string", description: "recurring 必填：RRULE（如 FREQ=DAILY;BYHOUR=9;BYMINUTE=0）" },
          model: { type: "string", description: "可选：指定模型档位" },
          deliverWeixin: { type: "boolean", description: "执行完成后把回合结论推送给微信用户（需已绑定机器人）" },
          deliverTo: { type: "string", description: "可选：微信收信人（wxid 或绑定昵称）；缺省 = 最近对话的用户。仅在 deliverWeixin=true 时有效" },
        },
        required: ["name", "prompt"],
      },
    },
    {
      name: "scheduler_list",
      description: "列出全部定时任务（名称 / 计划 / 下次运行时刻 / 上次错误）。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "scheduler_run",
      description: "立即手动运行一个定时任务（不等到点；任务的工作区会话里会出现真实回合）。",
      inputSchema: { type: "object", properties: { id: { type: "string", description: "任务 id（从 scheduler_list 拿）" } }, required: ["id"] },
    },
    {
      name: "scheduler_delete",
      description: "删除一个定时任务（不可恢复）。",
      inputSchema: { type: "object", properties: { id: { type: "string", description: "任务 id（从 scheduler_list 拿）" } }, required: ["id"] },
    },
    /* ── Uiverse 组件库两件套（10-01 用户：「Codex 开发软件的时候，可以查这个组件库，调用组件代码」）──
       数据端 electron/features/uiverse-library.ts（与渲染层控件皮肤库同一份 gzip，单一真相源）。
       用户开发前端界面时模型可直接搜组件、取代码粘进用户项目（MIT）。 */
    {
      name: "ui_component_search",
      description: "搜索 Uiverse 社区组件库（3802 个 HTML+CSS 现成组件，MIT）：按钮/卡片/复选框/表单/输入框/通知/图案/单选/开关/工具提示/加载器。给用户写前端界面时先来这里找现成组件，别从零手写。",
      inputSchema: {
        type: "object",
        properties: {
          cat: { type: "string", description: "类目（可省略=全部）：Buttons/Cards/Checkboxes/Forms/Inputs/Notifications/Patterns/Radio-buttons/Toggle-switches/Tooltips/loaders" },
          query: { type: "string", description: "关键词（匹配组件名/作者，可省略）" },
          limit: { type: "number", description: "最多返回几条（默认 20，上限 100）" },
        },
      },
    },
    {
      name: "ui_component_get",
      description: "取一个 Uiverse 组件的完整代码（HTML+CSS 内联，可直接写入用户项目文件）。先用 ui_component_search 拿到 cat/id。",
      inputSchema: {
        type: "object",
        properties: {
          cat: { type: "string", description: "类目（search 结果里的）" },
          id: { type: "string", description: "组件 id（search 结果里的）" },
        },
        required: ["cat", "id"],
      },
    },
    /* ── 3D 预览（2026-10-05，用户拍板「生成 3D 图了 Codex 要晓得怎么调用、打开预览」）──
       引擎拿到 .glb / .gltf（鲁班 Lux3D 管线导出、外部下载等）后调用它，应用内弹出可旋转缩放的
       3D 预览，不用去文件夹找第三方查看器。执行端在 dispatch-rpc.ts：路径过可信根 + 扩展名白名单
       （model-viewer-ipc.ts 的 resolveModelPath，与 model-viewer:read 同一道闸）→ sendToWindow。 */
    {
      name: "preview_3d",
      description: "在应用内打开 3D 模型预览弹窗（可旋转/缩放/自动旋转）。当你生成、下载或写到工作区的 .glb / .gltf 模型文件后调用它让用户立刻查看 3D 效果；3D 资产工作流（如鲁班专家的 Lux3D → GLB）的最后一步应主动调用。",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "模型文件绝对路径（.glb / .gltf，须在会话工作目录或应用数据目录内）" },
          title: { type: "string", description: "预览标题（可省略，默认取文件名）" },
        },
        required: ["path"],
      },
    },
    /* ── 影视源检索（10-20）：用户给的 LibreTV/TVBox 苹果CMS源（内置 5 个，userData 可覆盖）。
       三件套：search（并发搜）→ detail（拿剧集地址）→ open（直链 m3u8/mp4 应用内播，网页页走浏览器）。
       ⛔ 只做检索与打开，不下载/不缓存/不代理第三方流；结果可用性由源站决定。 */
    {
      name: "media_source_search",
      description: "在用户配置的影视源（苹果CMS JSON API）里搜索电影/电视剧/动漫。用户让你「找片/搜片/看看有没有…」时先用它，别凭记忆编片名或链接。会并发查询所有源；个别源超时/失败是正常的，结果里会逐源标注。query 留空 = 只列出已配置的源。拿到结果后：要剧集地址用 media_source_detail，要直接看用 media_source_open。⛔ 影视源仅用于第三方接口调用/检索与打开，不下载/不缓存/不代理内容；版权归源站及权利人，本集成未收费、未二次创作，内容可用性由源站决定。",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "片名或关键词（留空则只列源）" },
          sources: { type: "array", items: { type: "string" }, description: "只搜指定源 key（可省略 = 全部；key 从空 query 的结果里拿）" },
          limit: { type: "number", description: "每个源最多返回几条（默认 8，上限 20）" },
        },
      },
    },
    {
      name: "media_source_detail",
      description: "取一个影视条目的详情与剧集列表（含播放地址）。先用 media_source_search 拿到 source + id。返回的 playGroups 里每条线路的 episodes 是「剧集名 + 地址」；m3u8 可内播，网页播放页会走浏览器。",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", description: "源 key（search 结果里的 source）" },
          id: { type: "string", description: "条目 id（search 结果里的 id）" },
        },
        required: ["source", "id"],
      },
    },
    {
      name: "media_source_open",
      description: "打开影视条目的某一集：直链 m3u8 / mp4 会推到应用内播放器（m3u8 自动走 HLS），网页播放页交给系统浏览器。source + id 从搜索/详情结果拿；episode 可给 1 基序号（如 3）或剧集名片段（如「第03集」）。默认 mode=auto（直链内播、网页外开）；要看别的源可用 detail 里的线路换一条重试。",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", description: "源 key" },
          id: { type: "string", description: "条目 id" },
          episode: { anyOf: [{ type: "number" }, { type: "string" }], description: "第几集（1 基序号）或剧集名片段；省略 = 该线路第一集" },
          mode: { type: "string", enum: ["auto", "in-app", "external"], description: "auto=直链内播/网页外开（默认）；in-app=强制应用内（网页页会报错）；external=强制浏览器" },
        },
        required: ["source", "id"],
      },
    },
    /* ── MoeKoe Music（10-20）：用户本机安装的酷狗第三方客户端 + 它的本地 API 6521。
       搜索走 API；免费歌完整播放，付费/会员歌取决于 MoeKoe 登录账号 VIP（取不到就如实报错）。
       moekoe_install 负责国内镜像安装/启动；⛔ 不把客户端/曲库内置进本应用。 */
    {
      name: "moekoe_status",
      description: "检查本机 MoeKoe Music 是否安装、本地 API（127.0.0.1:6521）是否在运行。用户说「用 MoeKoe 放歌」但搜索/播放报 API 不可达时先调它。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "moekoe_search",
      description: "在 MoeKoe Music（酷狗曲库）里搜索。type=song 返回 hash/albumId/audioId/free/payType/封面，可直接交给 moekoe_play；type=album/author/special/mv 返回专辑/歌手/歌单/MV 元数据（special=歌单），播歌请再用 type=song 搜歌名。用户让你「放首歌/搜首歌」时先用它，别凭记忆编歌名或 hash。query 留空只返回安装/API 状态。",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "歌名 / 歌手 / 关键词（留空则只查状态）" },
          type: { type: "string", enum: ["song", "album", "author", "special", "mv"], description: "搜索类型（默认 song；special=歌单）" },
          limit: { type: "number", description: "最多返回几条（默认 20，上限 50）" },
        },
      },
    },
    {
      name: "moekoe_play",
      description: "播放 MoeKoe 搜索结果里的某首歌，成功后推入应用内音频播放器（自绘播放条 + 封面）。必须先 moekoe_search 拿 hash。standard（128k，客户端同款 ppage_id）通常可完整播放付费歌；high/lossless 可能触发会员/版权试听或风控——失败时如实转述错误并建议降回 standard，不要假装成功。",
      inputSchema: {
        type: "object",
        properties: {
          hash: { type: "string", description: "歌曲 hash（search 结果里的 hash）" },
          albumId: { type: "string", description: "AlbumID（可省略，search 缓存里会带）" },
          audioId: { type: "string", description: "Audioid/album_audio_id（可省略）" },
          quality: { type: "string", enum: ["standard", "high", "lossless"], description: "standard=128k / high=320k / lossless=flac（默认 standard）" },
          title: { type: "string", description: "歌名（可选）" },
          artist: { type: "string", description: "歌手（可选）" },
          artwork: { type: "string", description: "封面 URL（可选）" },
        },
        required: ["hash"],
      },
    },
    {
      name: "moekoe_lyric",
      description: "取 MoeKoe（酷狗）歌曲的 LRC 歌词。优先传 hash（moekoe_search 结果里的）；也可以传 title + artist。返回带时间轴的 LRC 文本，可直接展示或配合播放器使用。",
      inputSchema: {
        type: "object",
        properties: {
          hash: { type: "string", description: "歌曲 hash（可省略，但至少要有 hash 或 title）" },
          title: { type: "string", description: "歌名（可省略）" },
          artist: { type: "string", description: "歌手（可省略，提高匹配准确率）" },
        },
      },
    },
    {
      name: "moekoe_qualities",
      description: "查 MoeKoe（酷狗）歌曲的音质/权限：默认音质、level、pay_type、privilege、是否有 high/lossless，以及当前建议。standard（128k）走客户端同款 ppage 可完整播放；high/lossless 可能需会员/版权。",
      inputSchema: {
        type: "object",
        properties: {
          hash: { type: "string", description: "歌曲 hash（moekoe_search 结果里的）" },
        },
        required: ["hash"],
      },
    },
    {
      name: "moekoe_install",
      description: "检查/启动/安装 MoeKoe Music。已安装会直接启动；未安装必须先得到用户同意，再带 confirm=true 调用。安装包来自官方下载源（music.moekoe.cn/download.html 同款最新 release），中国大陆走 gh-proxy 镜像，失败回落 ghfast/直连；按系统与架构自动选包：Windows x64·ia32、macOS arm64·x64 zip（解压到 Applications）、Linux AppImage，约 130–160MB；会改动系统、可能弹 UAC 或 macOS 安全提示。⛔ 不要在没有用户明确同意时带 confirm=true。",
      inputSchema: {
        type: "object",
        properties: {
          confirm: { type: "boolean", description: "用户已明确同意下载并启动安装程序才传 true" },
        },
      },
    },
    {
      name: "media_preview",
      description: "在应用内打开视频/音频预览（本地绝对路径或 http(s) 直链）；3D 模型（glb/gltf）自动走现有的 3D 预览弹窗。当你生成、下载或把媒体文件写到工作区后想让用户立刻查看时调用。⛔ 远程 3D 模型不支持，请先下载到本地；本地文件必须在可信目录内（会话工作目录 / 应用数据目录）。",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "本地绝对路径或 http(s) 直链" },
          kind: { type: "string", enum: ["video", "audio", "model"], description: "媒体类型（可省略，按扩展名推断；URL 无扩展名时必须给）" },
          title: { type: "string", description: "预览标题（可省略，默认取文件名）" },
        },
        required: ["path"],
      },
    },
    /* ── 本地 HTML/CSS → MP4（10-11，P1）：把工作区里的 HTML 动画成品化。
       ⛔ 零 ffmpeg 依赖（Chromium 抓帧 + 运行时自带 MP4 编码器）；源与输出都过可信根闸。 */
    {
      name: "video_render_html",
      description: "把一段 HTML/CSS 动画在**本地**渲成 MP4（不联网、不花厂商额度、不需要 ffmpeg）。传一个 .html 文件的绝对路径（须在工作区或应用数据目录内）或 http(s) URL，指定时长与帧率，产出 mp4 并返回路径。适合把工作区里做好的界面 / 动画 / 分镜 HTML 成品化成视频。",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", description: "本地 .html 文件绝对路径（须在会话工作目录或应用数据目录内）或 http(s) URL" },
          seconds: { type: "number", description: "渲染时长秒数（0.5~120，默认 3）" },
          fps: { type: "number", description: "帧率（5~60，默认 30）" },
          width: { type: "number", description: "画布宽（默认 1280）" },
          height: { type: "number", description: "画布高（默认 720）" },
          outPath: { type: "string", description: "输出 mp4 路径（可选；须在可信目录内，不传则落 <userData>/renders/）" },
        },
        required: ["source"],
      },
    },
    /* ── 壁纸设置（10-06 用户：「Codex 自己也能给自己做壁纸」）──
       引擎可自助换壁纸：pattern/particles/vanta 直接切；custom 接 `preset:<id>`（内置精选渐变）
       或**你自己生成的图片**（生图 → 写入工作区 → 传绝对路径，主进程过可信根闸）。
       执行端 dispatch-rpc.ts：校验后 sendToWindow("wallpaper:apply") → 渲染层走 saveWallpaper
       同一条链路（与设置页同源）。这就是壁纸的**免改码拓展接口**：做新图 = 新壁纸。 */
    {
      name: "wallpaper_set",
      description: "设置应用壁纸（用户立刻可见）。四种用法：① mode=pattern + pattern=图案id（dots/scatter/grid/blueprint/waves/zigzag/diagonal/plus/rings/topo）；② mode=particles（粒子网络）；③ mode=vanta（3D 网格）；④ mode=custom + image=`preset:<id>`（内置精选渐变：sunrise/mint/dusk/ocean/graphite/ember）或 image=<图片绝对路径>。给自己做壁纸：用生图出图 → 写入工作区 → 调本工具传路径。",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", description: "off / pattern / particles / vanta / custom" },
          pattern: { type: "string", description: "mode=pattern 时的图案 id（省略 = dots）" },
          image: { type: "string", description: "mode=custom 时：`preset:<id>` 或图片绝对路径（须在工作区/应用数据目录内）" },
          opacity: { type: "number", description: "浓度 2~40（省略 = 16；只作用于图案档）" },
        },
        required: ["mode"],
      },
    },
    /* ── 专家 / 子智能体管理三件套（09-29 用户：「让用户可以通过 Codex 会话新建专家和专家团还有子智能体」）──
       用户在会话里说「帮我建一个 XX 专家」⇒ 模型直接建，落盘 userData/expert-teams.json，
       重启后专家列表可见。normalizeTeamConfig 负责字段缺省与 id 规范；同 teamId 即更新。
       ⛔ 内置六专家（知微/呈象/洞明/鲁班/画意/剪承团）每次启动确保存在——提示模型用独有 teamId。 */
    {
      name: "expert_save",
      description: "创建或更新一个专家 / 专家团（写进应用的专家列表，重启应用后可见）。displayNameZh 与 lead（name + systemPrompt）必填；多角色协作加 members。不确定用户要单人专家还是多人团队时先问一句。",
      inputSchema: {
        type: "object",
        properties: {
          displayNameZh: { type: "string", description: "专家/团队显示名（如「SEO 专家」「三人文案团」）" },
          displayNameEn: { type: "string", description: "可选：英文名" },
          profession: { type: "string", description: "一句话职业定位（如「跨境电商 SEO 策略师」）" },
          description: { type: "string", description: "两三句：擅长什么、怎么帮用户" },
          category: { type: "string", description: "可选：分类 id（不确定就缺省）" },
          sop: { type: "string", description: "标准工作流程（Markdown，分 Phase 描述怎么干活）" },
          leadName: { type: "string", description: "主理人名字（如「鲁班」；单人专家 = 专家本人）" },
          leadSystemPrompt: { type: "string", description: "主理人的系统提示词（角色、工作方式、输出规范、边界；必填）" },
          members: { type: "array", description: "可选：团队成员（多角色协作时给），每项 {name, profession, description, systemPrompt}", items: { type: "object" } },
          quickPrompts: { type: "array", description: "可选：3 条快速开始提示词", items: { type: "string" } },
        },
        required: ["displayNameZh", "leadName", "leadSystemPrompt"],
      },
    },
    {
      name: "expert_list",
      description: "列出应用里已有的专家 / 专家团（teamId / 名称 / 定位 / 主理人 / 成员数），用于查重或给用户展示可选专家。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "subagent_save",
      description: "创建或更新一个子智能体（轻量自定义角色，独立上下文）。name 与 systemPrompt 必填，同 name 即更新；省略的字段保持原值（新建时模型/沙箱/审批默认跟随主对话）。保存后到「设置 → 专家/专家团 → 子智能体」刷新即可见；会话「调度」面板勾选「子智能体」后，用 agent_invoke（kind=\"subagent\"）派活。",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "子智能体名（如「周报整理员」）" },
          systemPrompt: { type: "string", description: "系统提示词（角色 + 工作方式 + 输出规范；必填）" },
          description: { type: "string", description: "可选：一句话说明它负责什么（缺省自动生成）" },
          effort: { type: "string", enum: ["low", "medium", "high", "xhigh"], description: "可选：推理强度（低/中/高/极高，缺省 high）" },
          model: { type: "string", description: "可选：模型 id（省略 = 新建跟随主对话 / 更新保持原值）" },
          sandbox: { type: "string", enum: ["read-only", "workspace-write", "danger-full-access"], description: "可选：沙箱（省略 = 新建跟随主对话 / 更新保持原值）" },
          approvalPolicy: { type: "string", enum: ["never", "on-request", "on-failure", "untrusted"], description: "可选：审批策略（省略 = 新建跟随主对话 / 更新保持原值）" },
        },
        required: ["name", "systemPrompt"],
      },
    },
    /* ── CLI 智能体四件套（10-31 用户令：「看看有没有配套工具，codex 可以新建智体、专家、专家团，
       安装 cli 智体工具」）──
       专家 / 专家团（expert_save，members≥1）/ 子智能体（subagent_save）此前已有；
       这里补上「装没装 / 一键装 / 卸载」的模型侧入口 —— 执行端复用主进程唯一实现
       `electron/cli-install.ts`（⛔ 不另写一条 npm/pip 调用）。
       ⛔⛔ 装/卸是**改用户机器**的动作：必须 `confirm:true` 且模型先征得用户同意（描述里写死），
          被委派会话（专家/子智能体/CLI）一律拒绝。 */
    {
      name: "cli_agent_list",
      description: "列出本机 CLI 智能体目录（内置 + 用户新增）：id / 名称 / 可执行名 / 分类 / 是否已安装 / 能不能一键安装。用户问「有哪些 CLI 智能体」「装没装」时先调它。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "cli_agent_detect",
      description: "检测某个 CLI 在本机装没装（where/which + --version）。参数 id 或 bin 二选一。",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "目录条目 id（如 builtin-qwen-code）" },
          bin: { type: "string", description: "可执行名（如 qwen）" },
        },
      },
    },
    {
      name: "cli_agent_install",
      description: "一键安装一个 CLI 智能体（真的在这台机器上跑 npm/pip，可能几分钟）。⛔⛔ 调用前**必须先向用户说明要装哪个、执行哪条命令并征得同意**，然后才传 confirm:true —— 不传 confirm 直接拒绝。装完会真复核 PATH；失败原样转述，⛔ 不许假装成功。",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "目录条目 id（先用 cli_agent_list 查）" },
          confirm: { type: "boolean", description: "用户已明确同意安装 ⇒ 传 true（缺省/ false 一律拒绝）" },
        },
        required: ["id", "confirm"],
      },
    },
    {
      name: "cli_agent_uninstall",
      description: "卸载一个 CLI 智能体（只动应用自己的工具目录，系统里用户自装的另一份不越界）。⛔ 同样必须先征得用户同意并传 confirm:true。",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "目录条目 id" },
          confirm: { type: "boolean", description: "用户已明确同意卸载 ⇒ 传 true" },
        },
        required: ["id", "confirm"],
      },
    },
    /* ── 配音（09-29 排查：视频工作流的配音环节模型侧没有工具 —— 声线 SOP 指望的 voice:speak
       是渲染层通道。本地 TTS 同步合成（几秒级），落盘返回路径。模型未下载时报错并指路设置页。 */
    {
      name: "voice_generate",
      description: "把一段台词合成为配音 WAV（本地 TTS，落盘返回文件路径）。视频工作流给镜头配台词、或任何需要配音的场景。语音模型未下载时会报错并提示去「设置 → 语音」下载。",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "要合成的台词" },
          name: { type: "string", description: "输出文件名（不含扩展名；缺省按时间戳）" },
          workspace: { type: "string", description: "落盘目录；缺省 = 当前会话的工作目录（写到其下 voice/ 子目录）" },
          sid: { type: "number", description: "可选：音色 id（缺省 = 设置 → 语音 里选的默认音色）" },
          speed: { type: "number", description: "可选：语速（1 = 正常）" },
        },
        required: ["text"],
      },
    },
    /* ── 自造工具（09-29 用户：「Codex 有没有办法给自己新增工具能力」）────────────
       没有现成工具时，模型可以自己写一个 stdio MCP server 脚本（工作区或 userData 下），
       再用 connector_register 注册成本地连接器 —— 用户重启应用后，新会话的 tools/list
       就带上新工具。这是模型「给自己造工具」的持久化通道；一次性需求直接写工作区脚本跑即可。
       ⛔ 不做热更新（用户明确：重启应用即可）——注册完提示用户重启，不中断当前回合。 */
    {
      name: "connector_register",
      description: "注册一个本地 stdio MCP 连接器（给自己新增持久化工具）：先用工作区脚本写好一个 MCP server（node 脚本，stdin/stdout 行分隔 JSON-RPC，零依赖），再把它的启动命令注册进来。**注册后提示用户重启应用**；重启完成后新会话的 tools/list 会带上新工具。脚本的 node 依赖必须自包含（优先零依赖）。",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "连接器 id（字母/数字/连字符，如 my-tools）" },
          name: { type: "string", description: "显示名（如「我的自造工具」）" },
          command: { type: "string", description: "启动命令（绝对路径更稳，如 node 或自带的 node 完整路径）" },
          args: { type: "array", description: "启动参数（如「C:/path/my-tool-server.mjs」这样的脚本路径数组）", items: { type: "string" } },
          env: { type: "object", description: "可选：注入脚本的环境变量", additionalProperties: { type: "string" } },
        },
        required: ["id", "name", "command"],
      },
    },
    /* ── 画布工作流打通（09-29 用户看 Codex 回答「我没法调用你画布上的那个工作流」）────────
       画布快照由渲染层防抖镜像到 userData/drama-canvas/boards.json（drama-canvas:board-sync）。
       workflow_read 读它 ⇒ 模型知道画布上有什么、要跑什么；模型用 image_generate 等现有工具
       按链路执行；workflow_writeback 把产物路径写回节点并广播，渲染层收到后 updatePayload
       （卡片即时显示并落 localStorage）。 */
    {
      name: "workflow_read",
      description: "读取 AI 画布上工作流的内容（每个画布的工作流类型、节点清单、连线、各节点的提示词/尺寸/产物现状）。用户说「按画布那套跑 / 画布里搭好的流程执行一下」时先用它看清要跑什么，再用 image_generate / video_generate / voice_generate 按连线顺序逐节点执行。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "workflow_writeback",
      description: "把执行结果写回画布节点（用户重启前画布打开着就能实时看到；重启应用也不丢——镜像与画布存储同源）。updates 里给节点 payload 字段：path=产物图片/视频路径、text=文本结论等。",
      inputSchema: {
        type: "object",
        properties: {
          canvas: { type: "string", description: "画布名（从 workflow_read 的输出拿；缺省 = 最近更新的画布）" },
          nodeId: { type: "string", description: "节点 id（workflow_read 输出里的 id）" },
          updates: { type: "object", description: "要写回的字段（值必须是字符串或数字），如「path = 产物图片的完整路径」或「text = 结论文本」", additionalProperties: true },
        },
        required: ["nodeId", "updates"],
      },
    },
    /* ── 媒体生成三件套（09-29 用户：「让 Codex 能够直接调用生图工作流与视频工作流」）────────
       为什么是「生图一件 + 视频两件」：生图是同步 HTTP（几十秒，模型等着就行）；
       视频是**异步任务**（提交后要跑几分钟）—— 如果让工具一直等，会卡死整个回合，
       所以拆成「提交（立刻拿 jobId）」+「查询（稍后问一次）」。jobId 由主进程落盘
       （userData/video-jobs.json），关掉画布 / 重启应用都不丢，模型随时能续查。
       ⛔ 与画布卡片共用同一套 core（video-gen.ts / builtin-images），不另写一份实现。 */
    {
      name: "video_generate",
      description: "提交一个视频生成任务（异步），**立即**返回 jobId；随后用 video_status 查询进度。图生视频传 image（本地路径或公网 URL）。不要把本工具当同步接口反复等待 —— 提交完可以先做别的事，隔一会儿再查。",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "画面/运镜描述" },
          mode: { type: "string", enum: ["t2v", "i2v"], description: "t2v=文生视频（默认）；i2v=图生视频（要给 image）" },
          image: { type: "string", description: "i2v 的首帧：本地图片路径或公网 URL" },
          providerId: { type: "string", description: "厂商 id（缺省用第一个已配置凭证的厂商；id 见设置 → 插件 → 视频生成接口）" },
          model: { type: "string", description: "覆盖厂商默认模型" },
          duration: { type: "number", description: "时长（秒），缺省 5" },
          workspace: { type: "string", description: "产物落盘的工作目录（缺省 = 调用者会话的工作目录）" },
          name: { type: "string", description: "产物文件名（缺省 视频.mp4）" },
          aspect: { type: "string", enum: ["16:9", "9:16", "1:1"], description: "画幅。⚠️ 只有部分厂商支持指定（通义万相 / 即梦Seedance / Runway / Veo）；不支持的会明确报错并告诉你改用哪几家" },
          video: { type: "string", description: "参考视频（白模预演）的公网 URL。⚠️ 仅 Seedance 2.0/2.5 支持；role=reference_video 传给模型。本地视频请先传到可公网访问的位置" },
        },
        required: ["prompt"],
      },
    },
    {
      name: "video_status",
      description:
        "查询 video_generate 提交的任务：pending（还在跑，稍后再查）/ succeeded（已好，会自动下载落盘并返回本地路径）/ failed（失败原因）。也可以不带参数查最近的任务列表。"
        + "**想等到出片为止就给 `wait: true`**：主进程按配置好的间隔一直查到出片/失败/超时（查询失败会自动重试，"
        + "用户在界面上随时能中止），返回的就是最终结果 —— 别自己写循环反复调用这个工具。",
      inputSchema: {
        type: "object",
        properties: {
          jobId: { type: "string", description: "video_generate 返回的 jobId；不给则列出最近 10 个任务的状态" },
          providerId: { type: "string", description: "厂商 id（缺省用该任务提交时记下的厂商）" },
          workspace: { type: "string", description: "成功时下载到哪个工作目录（缺省用提交时记下的工作目录）" },
          name: { type: "string", description: "成功时产物的文件名" },
          wait: { type: "boolean", description: "true = 一直查到出片/失败/超时才返回（受「轮询超时上限」约束）；不给或 false = 只查这一次" },
          intervalMs: { type: "number", description: "wait 时的查询间隔（毫秒，缺省用用户在界面上配的那档；会被钳到 0.5~120 秒）" },
          timeoutMs: { type: "number", description: "wait 时的超时上限（毫秒，缺省用用户在界面上配的那档；会被钳到 5 秒~1 小时，且不小于间隔的两倍）" },
          maxRetry: { type: "number", description: "wait 时连续查询失败最多重试几次（缺省用界面上配的那档）" },
        },
      },
    },
    {
      name: "video_concat",
      description:
        "把多个视频片段合并成一条成片（整片导出）。内部用 ffmpeg：片段编码一致时**无损秒拼**，"
        + "不一致时自动统一画布尺寸与帧率重编码。顺序完全按传入的 files 顺序 —— 要成片顺序对，就自己排好。"
        + "产物落在 <workspace>/.drama-canvas/export/。需要 FFmpeg（设置 → 开发工具页可一键安装）。",
      inputSchema: {
        type: "object",
        properties: {
          files: {
            type: "array",
            items: { type: "string" },
            description: "要合并的片段路径列表，**按成片顺序**排列（通常是 video_status / image_generate 返回的本地 path）",
          },
          name: { type: "string", description: "成片文件名（默认「成片」，自动补 .mp4）" },
          workspace: { type: "string", description: "输出到哪个工作目录（缺省用调用者会话的工作目录）" },
          width: { type: "number", description: "需要重编码时的画布宽（默认 720）" },
          height: { type: "number", description: "需要重编码时的画布高（默认 1280，竖屏短剧）" },
          fps: { type: "number", description: "需要重编码时的帧率（默认 24）" },
        },
        required: ["files"],
      },
    },
    /* ── 语音播报（10-09 用户：「记得配套对应工具，没工具他调用不了」）────────────────
       此前播报在模型侧只有「写法」（回复末尾的 ```voice 稿）：模型能把话写进耳朵，却**不能
       现在就说**、也**不能让自己闭嘴** —— 用户中途说「行了别念了」它没有闸。
       这两个工具把「主动发声」与「主动停止」交给它（🅐 水龙头 / 🅑 闭嘴键）。
       ⛔ 与两个播报开关的关系：这是**显式插播**，不受「语音播报」那两个开关影响
          （开关只管"要不要自动念回复"）；但实时语音通话期间必须拒绝 —— 扬声器由通话链路
          独占（它还喂 AEC 参考环），两条一起出声 = 回声 + 抢话。 */
    {
      name: "voice_announce",
      description:
        "立刻对用户**念一句话**（插播，不必等本轮回复结束）。适用于：确认一个危险操作前先出声提醒、"
        + "长时间任务告一段落时口头汇报、用户在别处需要被叫一声。⛔ 通话进行中不可用（那时直接写在回复里就会被念出来）。"
        + "像年轻人聊天一样说，带真实语气（惊喜 / 松了口气 / 抱歉 / 来劲），短句和感叹词把情绪带出来，别用新闻播报腔。"
        + "⛔ 一句话，≤120 字；要讲长内容就写进回复正文。⛔ 这句是**说给耳朵**的 —— 再把它原样抄进正文"
        + "就会被念两遍（用户听着像复读），正文该讲什么照常讲。即时响应=fire-and-forget：本地 TTS 未下载、"
        + "或窗口不在前台时不出声（工具不报错 —— 别据此向用户声称「已经说了」）。",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "要念的话（口语中文，≤120 字；别写 markdown / 列表 / 代码 —— 会被跳读或念出符号）" },
          speed: { type: "number", description: "可选：语速（1 = 正常，缺省用设置里的语速）" },
        },
        required: ["text"],
      },
    },
    {
      name: "voice_announce_stop",
      description:
        "立刻停止当前正在播报的语音（清掉排队，不再念下去）。用户说「行了 / 别念了 / 闭嘴」、"
        + "或你发现自己写得太长需要当场收声时调用。返回后仍可以继续正常回复（文字照常显示）。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "voice_speak_reply",
      description:
        "把**这一条回复的正文**在生成过程中念出来（不用把文字传进来，读的就是你正在写的回复）。"
        + "⛔ 不是每条回复都要念 —— 只在**值得开口**的时候用：用户在催 / 你已经改了好几轮还没做好 / "
        + "当前步骤很关键（有风险、要花很久、需要用户盯着）/ 你有自己的判断想说给用户听。"
        + "判定权在你：不必为了「礼貌」每轮都调，也别在该说的时候一声不响。"
        + "⛔ 只在**运行过程中**生效（从调用那一刻起，本条回复后续生成的正文逐句念）；"
        + "回合结束那段播报稿不受影响。用户把「语音播报」总开关关掉时本工具会被拒绝。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
}

/** 内置 MCP 的执行端：只在 127.0.0.1 监听，token 校验 + 「引擎事件里确实有这条调用」旁证。
 *  端口固定（DISPATCH_FIXED_PORT）→ config.toml 的 url 跨运行稳定，引擎重启也能连上。 */
let dispatchHttpReady: Promise<void> | null = null;



/** 组装「可调度对象目录」（只含已启用的；单人专家 = 只有 lead 的团队，结构同型）
 *  10-29 晚追加：CLI 智能体（`cliagents` 域的用户配置）也进这份目录 —— 一类一个 `kind`，
 *  ⛔ 不塞进 subagent 冒充（那会让"关掉 CLI"变成一个它自己管不了的开关）。 */
async function buildDispatchCatalog(): Promise<DispatchTarget[]> {
  const [teams, subs, clis] = await Promise.all([readUsableExpertTeams(), readSubAgents(), readUsableCliAgents()]);
  const targets: DispatchTarget[] = [];
  for (const team of teams) {
    if (!team.enabled) continue;
    if (!team.members?.length) {
      targets.push({
        kind: "expert",
        key: team.teamId,
        name: team.displayName.zh,
        profession: team.lead?.profession?.zh ?? "",
        description: team.lead?.description ?? team.description?.zh ?? "",
        teamId: team.teamId,
        memberId: team.lead?.id,
      });
    } else {
      targets.push({
        kind: "team",
        key: team.teamId,
        name: team.displayName.zh,
        profession: `${team.members.length} 位成员`,
        description: team.description?.zh ?? "",
        teamId: team.teamId,
        memberCount: team.members.length,
      });
    }
  }
  for (const sub of subs) {
    if (!sub.enabled) continue;
    targets.push({ kind: "subagent", key: sub.id, name: sub.name, profession: "", description: sub.description ?? "" });
  }
  /* CLI 智能体：key = cliagents 条目的稳定 id（⛔ 不是 bin —— bin 改名/换版本时 id 不变，
     否则点名与派活历史会对不上）。profession 用分类标签，让模型一眼看出这是"编码 CLI"还是"通用智能体 CLI"。
     ★ 10-30 用户令「没安装就不能选」：目录每条带 `installed`（批量检测有 5s 短缓存），
       @ 列表按它置灰 —— 未安装的**照样列出**，用户看得见、选不了。 */
  const installedFlags = await cliInstalledFlags(clis).catch(() => ({}) as Record<string, boolean>);
  for (const cli of clis) {
    targets.push({
      kind: "cli",
      key: cli.id,
      name: cli.name,
      profession: CLI_CATEGORIES.find((entry) => entry.key === cli.category)?.label ?? "CLI",
      description: cli.description,
      installed: installedFlags[cli.id] === true,
    });
  }
  return targets;
}

/** ⛔ 被 features/dispatch-rpc.ts 经 main.mutableState 写入的两个 let（见文件头说明）。 */
export function setDispatchHttpPort(v: number): void { dispatchHttpPort = v; }
export function setDispatchHttpReady(v: Promise<void> | null): void { dispatchHttpReady = v; }

export {
  DISPATCH_FIXED_PORT, buildDispatchCatalog, dispatchHttpPort, dispatchHttpReady, dispatchMcpTools,
  dispatchProbes, dispatchToken, ensureDispatchToken, restrictedThreadRole, stableKey,
  type DispatchProbe,
};
