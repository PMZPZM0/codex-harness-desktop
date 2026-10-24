import fs from "node:fs/promises";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
/**
 * 应用级运行时开关（不写入 config.toml 的用户段落，harness 自持）。
 * 持久化在 userData/app-settings.json，跟随 memory-mode.json / personalization.json 的既有模式。
 *
 * - webSearch: 每轮 prompt 都会被引擎带上的服务端搜索工具，关掉能省掉模型「顺手联网」的往返。
 * - desktopAutomation: 桌面自动化（nuphus MCP），关闭后不注册 nuphus，引擎不再加载 35 个桌面工具。
 * - browserAutomation: 浏览器自动化（ego-browser 唯一通道），关闭后从基础指令里移除
 * ⛔ Playwright CLI / 内核已从应用移除（10-22 用户令），不要再新增回落通道。
 *   调用说明并关掉 features.browser_use，模型不再被引导去操作浏览器。
 * - engineWatchdog: ⛔ **已停用（2026-09-09 移除看门狗本体）**，字段仅为兼容历史 app-settings.json
 *   与调用点而保留；**没有任何界面渲染它**，`server.startWatchdog()` 是空实现（见 codex-server.ts）。
 *   保留此字段 = 老配置里的值不会被清掉；若要恢复该能力，必须先给重启加"忙碌闸"
 *   （有活动回合时只记数不重启），否则会打断正在跑的会话。守卫【140】钉住这条。
 * - adaptiveTone: 语气自适应（默认开）。按会话维护状态（心情/精力/默契），把状态映射成
 *   一句「只影响说法、不影响内容」的语气指引，随该会话自己的 developer instructions 下发；
 *   状态按会话各自一份（渲染层键族 agent-mood-<threadId>），A 会话不会改到 B 会话的语气。
 * - memoryBackend: **记忆后端二选一**（09-25 加，用户明确要求「不重复」）：
 *   - "builtin"（默认缺省）：内置记忆金字塔（L0~L7 + 纪律/坑分类写入）。
 *   - "mcp"：**优先用 MCP 记忆服务**（@vheins/local-memory-mcp，可选安装，装在
 *     `<userData>/memory-mcp`，见 scripts/install-memory-mcp.cjs）。
 *     ⛔ 选它之后内置金字塔**停止捕获写入**（`MemoryLayers.appendLesson` 会让位），
 *     否则会出现「MCP 写一份、金字塔再写一份」的双份记忆。
 * 以后新开关都往这里加。
 */
export type AppSettings = {
  webSearch?: boolean;
  desktopAutomation?: boolean;
  browserAutomation?: boolean;
  engineWatchdog?: boolean;
  /** 功能入口（10-24）：位置 / 顺序 / 更多分组。渲染层 localStorage 只是缓存，
   *  这里才是重启后的回灌源（强制结束进程时 localStorage 最后写入可能丢）。 */
  functionMenu?: { location?: "top" | "bottom"; order?: string[]; overflow?: string[] };
  /** 功能入口折叠态（10-24）：与 localStorage 双写，启动后以本文件为准。 */
  sidebarOptionsCollapsed?: boolean;
  /** 模型目录自愈回执（10-24）：启动时修复损坏的 model-catalog.json 后写入，
   *  渲染层读一次展示成可见提醒后就清掉（不残留）。 */
  modelCatalogRepairNotice?: string;
  /** 记忆后端："builtin"= 内置记忆金字塔（默认）；"mcp"= MCP 记忆服务（此时内置停止写入） */
  memoryBackend?: "builtin" | "mcp" | "cloud";
  /** 知识库后端："local"=项目本地库（kb:*）；"cloud"=云端 weknora（MCP 工具） */
  kbBackend?: "local" | "cloud";
  /** 记忆容量倍率（10-10 用户要求「记忆库容量增加倍率功能」）：把记忆注入预算按倍数放大，
   *  可选 1 / 2 / 4 / 8 / 10 / 16（×1 = 基准）。⛔ 只放大**字符**类预算，`logDays`（回灌窗口）
   *  不参与放大。非法值由 normalizeMemoryScale 回退基准 —— 手改配置也写不出 NaN 预算。 */
  memoryScale?: number;
  /** 全局自动压缩比例：上下文用量达到该比例时引擎自动压缩（0.1~0.95，默认见 DEFAULT_AUTO_COMPACT_RATIO） */
  autoCompactRatio?: number;
  /** Codex 引擎更新用的 HTTP 代理（如 http://127.0.0.1:7890）。空 = 国内镜像直连 */
  engineProxyUrl?: string;
  /** 硬件加速模式（主进程在 app ready 前同步读取并应用，重启生效）：
   *  - "auto"（默认缺省）：Chromium 自行判断（健康显卡自动硬件加速，弱核显/黑名单显卡回退软件渲染）
   *  - "force"：忽略 GPU 黑名单 + 强制 GPU 光栅化/零拷贝——低配机上软件渲染卡顿时可选
   *  - "off"：完全关闭硬件加速（极个别驱动与 GPU 通道冲突时用） */
  hardwareAcceleration?: "auto" | "force" | "off";
  /** 应用主题（10-16，与云助手同轮同步）：渲染层选的主题**主进程也必须知道** ——
   *  窗口创建时要读 `titleBarOverlayOptions()` 决定标题栏 overlay 的符号色，而渲染层把主题
   *  存在 localStorage（主进程读不到）⇒ 不落盘就只能按**系统**主题画：
   *  系统亮 + 应用暗时，深色符号画在深色顶栏上 = 用户报的「暗色下独立窗口右上角系统钮看不见」。
   *  由 theme:apply 顺带写入，启动早期（窗口创建前）同步读回并应用。 */
  theme?: "light" | "dark";
  /**
   * 被用户停用的宿主域（10-04 阶段 6）。
   *
   * ⛔ **语义 = "下次启动不挂载"，不是"运行时卸载"**。理由：
   *   真热插拔要求域在卸载时把私有状态（子进程、句柄、定时器、单例）全部安全交还，
   *   而多数域的私有状态是**模块级变量**（如 voice 的 worker 池、relay 的 purchaseWindow），
   *   容器管不到它们 ⇒ 卸载后再挂载极可能拿到半初始化的单例。
   *   首版诚实地只做"重启后生效"，不假装支持热插拔。
   *
   * ⚠️ 停用后该域的通道**不存在** ⇒ 渲染层 `invoke` 抛 `No handler registered`。
   *   所以 UI 必须把它呈现为"功能不可用"而不是"坏了"，且清单视图要显式提示这一点。
   *
   * ⚠️ 不可停用的域：组合表里标了 `essential: true` 的（如 user / app / dialog）——
   *   它们承载应用自身能力（用户信息、文件对话框），关掉等于应用不能用了。
   *   由 `essential-domains.ts` 单一真相源约束，设置侧只允许停用非 essential 的。
   */
  disabledDomains?: string[];
  /**
   * 已停用的**声明式插件** id（10-04 B 档）。
   *
   * ⚠️ 与 `disabledDomains` 的区别（这两个别混）：
   *   · disabledDomains          = 停用**宿主功能域**（编译期就在包里的 79 个，
   *                                部分域因共享单例只能重启生效）
   *   · disabledDeclaredPlugins  = 停用**外部声明式插件**（用户目录里的 JSON，
   *                                只有界面内容 ⇒ 插槽即时刷新，真热插拔）
   *
   * ⛔ 缺省 = 启用（不在名单里就是启用）⇒ 升级不改变任何现有行为。
   */
  disabledDeclaredPlugins?: string[];
  /**
   * 改动备份（10-13 用户令，与 WorkBuddy 的「改动备份」同构）。
   *
   * - `changeBackupEnabled`：每回合结束把该回合改过的文件落一份可回看的档案
   *   （新增/修改/删除 + 增删行数 + 变更块全文）。⛔ **默认关** ——
   *   用户没主动开之前不写盘（属可见行为变化：磁盘占用与备份目录）。
   * - `changeBackupDir`：备份根目录；空串 = 用默认 `<userData>/change-backups`。
   *   ⛔ **开启时才创建**（关闭状态下不预先建目录）。
   * ⛔ 相对路径 / 文件系统根 / 空值一律回退默认（见 change-backup 的 normalizeBackupDir），
   *   配置写错不得让应用起不来。
   */
  changeBackupEnabled?: boolean;
  changeBackupDir?: string;
  /**
   * 技能自动更新（10-13 用户令）：开启后主进程后台静默检查市场技能内容变化并自动更新
   * （启动 15s 后一次 + 每 6 小时一次；走与手动更新完全相同的链路，含安全检查）。
   * ⛔ **默认关** —— 会改用户技能目录里的文件，属可见行为变化；单技能失败静默跳过，
   *   下个周期再试，绝不打断启动。
   */
  skillAutoUpdate?: boolean;
  /**
   * 插件自动更新（10-24 用户令：「精简成一个技能更新开关，和插件更新开关就行」）：
   * 开启后后台静默检查 Gitee 镜像与 Codex 官方市场里已安装插件的版本，有新版才重装。
   * ⛔ **默认关** —— 会改写插件目录并重启引擎；单个失败静默跳过，下周期再试。
   */
  pluginAutoUpdate?: boolean;
  /** 统一更新体系：每个组件行的独立偏好（键 = 组件行 id）。缺省语义见 readAutoUpdateRowSwitch。 */
  autoUpdateOverrides?: Record<string, boolean>;
  /**
   * 自动化能力与引擎的自动更新（10-13 用户令）：四类**各自独立、互不影响**，缺省即**开启**。
   *   · autoUpdateDesktop     = 桌面自动化（nuphus MCP，`@nuphus/nuphus-mcp`）
   *   · autoUpdateComputerUse = Mac 电脑操作（`open-computer-use`，仅 macOS 生效，其它平台恒跳过）
   *   · autoUpdateEngine      = Codex 引擎本体（`@openai/codex`）
   * ⛔ 缺省值判据统一走 `autoUpdateEnabled(settings, key)`（**`!== false`**）—— 字段不存在 = 开；
   *   ⛔ 别在别处另写一份默认判断（本项目反复栽在两处各写一套上）。
   * ⛔ 更新源统一走国内镜像（npmmirror），失败回落官方源 —— 与手动更新**同一条链路**。
   * ⛔ 后台更新只在「开关开 + 确有新版」时才动盘；单类失败只跳过该类，下周期再试，绝不打断启动。
   */
  autoUpdateDesktop?: boolean;
  autoUpdateComputerUse?: boolean;
  autoUpdateEngine?: boolean;
  /** 语气自适应（默认开）：按会话维护少量状态（心情/精力/默契），随会话自己的
   *  developer instructions 下发一句「只影响说法、不影响内容」的语气指引。
   *  状态按会话各自一份（agent-mood-<threadId>），关掉即停止更新与注入。 */
  adaptiveTone?: boolean;
  /** 关闭窗口时最小化到托盘（默认**关**，09-23 加）：
   *  开着时点窗口 X 只隐藏窗口 —— 应用主进程、引擎、调度器、渠道机器人与正在跑的回合都继续活着，
   *  真正退出走托盘右键「退出」/ Cmd+Q。**开关入口在系统托盘右键菜单**（放托盘上比塞设置页更顺手）。
   *  ⛔ 默认必须是关：开着等于"点 X 不退出"，属可见行为变化，只能由用户主动打开。 */
  closeToTray?: boolean;
  /** 关闭确认弹窗的「不再询问」（10-13 加，默认**关**）：
   *  用户点窗口 X 时弹确认框（最小化到托盘 / 完全退出 / 取消）。勾选后**记住所选动作**并
   *  不再弹窗：动作就落在 `closeToTray`（true=最小化到托盘，false=完全退出）。
   *  ⛔ 该标记只表示"已经问过"，动作本身永远以 `closeToTray` 为准（单一真相源）。 */
  closePromptSeen?: boolean;
  /** 开发工具下载源（09-20 用户：「下载太慢了，所有工具下载加下载源选择」）。
   *  对「开发工具」页的所有按需下载生效：工具链（install-runtimes.cjs）、npm 包
   *  （Ego Lite 外部安装）。
   *  - "auto"（默认）：国内镜像优先 → 本机代理（若配置）→ 官方直连 → gh 加速，逐通道回落
   *  - "mirror"：国内镜像优先，失败回落官方直连
   *  - "ghproxy" / "ghfast"：GitHub 资产走对应加速前缀，失败回落官方直连（非 GitHub 资产按 auto）
   *  - "direct"：只走官方直连
   *  - "proxy"：本机代理优先（PROXY 环境变量），失败回落直连 */
  downloadSource?: "auto" | "mirror" | "ghproxy" | "ghfast" | "direct" | "proxy";
};

/* ── 本文件是「应用级默认值」的**主进程侧真相源** ─────────────────────────────
   ⛔ 渲染层拿不到本模块（electron/ 不引用 src/，两侧是独立打包产物）⇒ 这几个默认值在渲染层
      有**同源副本**：`src/features/app-state/parts/part01/04-optimistic-turn-approval-e2e.tsx`
      （autoCompactRatio）。守卫【159】逐字比对两侧取值，改一边忘另一边即红。
   ⛔ 归一化不是洁癖：`autoCompactRatio` 是被乘进 `model_auto_compact_token_limit` 的**乘数**，
      存档里出现 0 / 负数 / 字符串（手改 app-settings.json、旧版本残留）会让阈值变成 0
      ⇒ 引擎每轮都在压缩，对话直接不可用（09-25 加归一化时顺手堵上）。
   ⛔ 10-07 下限 0.5 → **0.1**（用户要在大会话上实测「运行中自动压缩」——1M 窗口 × 0.5 = 52 万
      阈值对已有 32 万上下文的会话压不出来；0.1 仍远高于「0 = 每轮都压」的危险区）。 */
export const DEFAULT_AUTO_COMPACT_RATIO = 0.6;

export function normalizeAutoCompactRatio(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.1 || n > 0.95) return DEFAULT_AUTO_COMPACT_RATIO;
  return n;
}

let cached: AppSettings | null = null;
/** 缓存归属的设置文件路径。
 *  ⛔ 按**路径**归属（10-07 事故）：userData 重定向（app.setPath）之前的调用读过默认目录，
 *     若那次读失败把空对象缓存下来，重定向后的正确读取会被 `if (cached)` 短路返回空
 *     ⇒ **整个进程**的设置读取全部失效（用户设的 0.9 压缩比例从未生效，config.toml 恒为
 *     默认 0.6 的阈值）。缓存命中必须同时满足「有缓存」且「路径一致」，不一致就重读。 */
let cachedFor = "";

function settingsFile(userData: string) {
  return path.join(userData, "app-settings.json");
}

export async function readAppSettings(userData: string): Promise<AppSettings> {
  const file = settingsFile(userData);
  if (cached && cachedFor === file) return cached;
  try {
    const raw = await fs.readFile(file, "utf8");
    cached = JSON.parse(raw) as AppSettings;
  } catch {
    cached = {};
  }
  cachedFor = file;
  return cached;
}

export function readAppSettingsSync(userData: string): AppSettings {
  const file = settingsFile(userData);
  if (cached && cachedFor === file) return cached;
  try {
    cached = JSON.parse(readFileSync(file, "utf8")) as AppSettings;
  } catch {
    cached = {};
  }
  cachedFor = file;
  return cached;
}

export async function saveAppSettings(userData: string, patch: Partial<AppSettings>): Promise<AppSettings> {
  const file = settingsFile(userData);
  const current = cached && cachedFor === file ? cached : await readAppSettings(userData);
  cached = { ...current, ...patch };
  cachedFor = file;
  await fs.mkdir(userData, { recursive: true });
  await fs.writeFile(file, JSON.stringify(cached, null, 2), "utf8");
  return cached;
}

export function invalidateAppSettings() {
  cached = null;
  cachedFor = "";
}

/**
 * 自动化 / 引擎自动更新开关的**唯一默认判据**（10-13）。
 *
 * ⛔ 缺省 = 开启（`!== false`）：用户要求「开关默认状态为开启」，而老配置的 JSON 里根本没有这些字段，
 *    若用 `=== true` 判定，升级后所有人的自动更新会**静默关闭** —— 与需求相反。
 * ⛔ 只有显式写成 `false` 才算关；任何其它假值（undefined / null 之外的脏数据）一律按开启处理，
 *    不做「脏值回退默认」的花活，因为这里没有需要保护的边界（最坏结果是多查一次 registry）。
 */
export function autoUpdateEnabled(
  settings: AppSettings,
  key: "autoUpdateDesktop" | "autoUpdateComputerUse" | "autoUpdateEngine",
): boolean {
  return settings?.[key] !== false;
}

/** 自动更新项在 AppSettings 上的开关字段（含技能那条，它缺省判据不同，见下）。 */
export type AutoUpdateSettingKey =
  | "autoUpdateDesktop" | "autoUpdateComputerUse" | "autoUpdateEngine" | "skillAutoUpdate" | "pluginAutoUpdate";

/**
 * 每个组件行的独立偏好（键 = 组件行 id，见 electron/update-registry.ts 与动态行的 `<spec>/<slug>`）。
 *
 * 为什么要有它：四个历史命名开关只覆盖了桌面/浏览器/电脑操作/引擎四类。统一更新体系纳入了
 * 十几类组件（市场技能、市场插件、官方插件、专家包、人格包、ponytail、pip 工具……），
 * 给每一类都加一个具名字段会让 AppSettings 无限膨胀 ⇒ 用一张 map 承载，键即组件 id。
 * ⛔ 具名那四个**保持优先**：它们已经落进用户配置并被界面引用，迁移它们得不偿失。
 */
export type AutoUpdateOverrides = Record<string, boolean>;

/** 每一行「属于哪个具名开关」（没有归属的走组件自身的默认），解析唯一入口在 readAutoUpdateSwitch。 */
export const AUTO_UPDATE_ROW_OWNER: Record<string, AutoUpdateSettingKey> = {
  nuphus: "autoUpdateDesktop",
  "computer-use": "autoUpdateComputerUse",
  engine: "autoUpdateEngine",
  skill: "skillAutoUpdate",
  plugin: "pluginAutoUpdate",
  // ⛔ 「技能内容更新」那把历史开关管的就是市场技能 ⇒ 动态行 `market-skill/<folder>` 也归属它。
  //    不接上的话用户把那把开关打开，技能却依然默认关、不检查 —— 界面说开了、后台没动。
  "market-skill": "skillAutoUpdate",
  // 插件自动更新（10-24 用户令）：市场插件与官方插件的动态行都归这一把开关。
  "market-plugin": "pluginAutoUpdate",
  "official-plugin": "pluginAutoUpdate",
};

/** 默认 **关** 的行：它们会改写用户自己的文件/技能目录，或升级外部大体积应用，必须用户点头。 */
const AUTO_UPDATE_DEFAULT_OFF = new Set(["market-skill", "expert-skill", "soul", "market-plugin", "official-plugin", "ego-lite"]);

/**
 * 统一读「某一行」自动更新的生效值 —— **界面、后台循环、手动入口三处共用这一个判据**。
 *
 * 解析顺序（⛔ 只此一处，别在别处再写一份默认值）：
 *   1. 该行自己的显式偏好（settings.autoUpdateOverrides[行id]）；
 *   2. 该行归属的具名开关（如 nuphus → autoUpdateDesktop）；
 *   3. 组件默认值：会改写用户文件的三类（市场技能 / 专家包 / 人格包）默认 **关**，其余默认 **开**。
 *
 * @param rowId 组件行 id（静态=spec.id，动态=`<spec.id>/<slug>`）
 */
export function readAutoUpdateRowSwitch(settings: AppSettings, rowId: string): boolean {
  const id = String(rowId ?? "").trim();
  const overrides = settings?.autoUpdateOverrides;
  if (overrides && typeof overrides === "object" && id in overrides) return overrides[id] === true;
  const owner = AUTO_UPDATE_ROW_OWNER[id] ?? AUTO_UPDATE_ROW_OWNER[id.split("/")[0]];
  if (owner) return readAutoUpdateSwitch(settings, owner);
  return !AUTO_UPDATE_DEFAULT_OFF.has(id.split("/")[0]);
}

/** 写某一行的偏好（⛔ 只 patch 这一个键，其余行的偏好不动 —— 各行物理独立）。 */
export function writeAutoUpdateRowSwitch(settings: AppSettings, rowId: string, enabled: boolean): AutoUpdateOverrides {
  const id = String(rowId ?? "").trim();
  const next = { ...(settings?.autoUpdateOverrides ?? {}) };
  next[id] = Boolean(enabled);
  return next;
}

/**
 * 统一读一个自动更新开关的**生效值**。
 *
 * ⛔⛔ 缺省语义**分两档**，这是刻意的，不是不一致：
 *   · 四类「装包/换二进制」的更新（桌面 / 浏览器 / Mac 电脑操作 / 引擎）缺省 = **开**（用户令）；
 *   · **技能内容更新缺省 = 关**：它会改用户技能目录里的文件（覆盖已装技能），
 *     属可见行为变化，必须用户主动打开（10-13 上一轮的定稿）。
 *   ⇒ 判据只此一处，界面与后台都走它 —— ⛔ 别在别处再写一份默认值。
 */
export function readAutoUpdateSwitch(settings: AppSettings, key: AutoUpdateSettingKey): boolean {
  return key === "skillAutoUpdate" || key === "pluginAutoUpdate"
    ? settings?.[key] === true
    : autoUpdateEnabled(settings, key);
}
