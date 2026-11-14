/**
 * 开发工具 · 运行时分类目录（11-01 用户令：外面只展示分类名字，明细进二级弹窗）。
 *
 * 一级（开发工具页）= 每个分类一张卡：分类名 + 一句定位 + 就绪数 + 「一键安装」；
 * 二级（SettingsDialog）= 该分类下的工具行，逐个手动下载 / 卸载 / 取消 / 看进度。
 *
 * ⛔ 分类判定只在这里写一份：一级卡片与二级弹窗都从本模块取（两处各写一套 =
 *   卡片上算出来的数字与弹窗里列出来的行对不上）。末组「其它按需下载」是兜底 ——
 *   将来新增工具忘了归类时落在那里，而不是从界面上凭空消失。
 */
import type { ReactNode } from "react";
import { Activity, BookOpen, Download, Globe2, TerminalSquare, Wrench } from "lucide-react";

/** runtime:list 下发的完整行（DevRuntimeEntry 是全局类型，这里补上清单里的可选字段）。 */
export type RuntimeRow = DevRuntimeEntry & {
  bundled?: boolean;
  hidden?: boolean;
  fallbackPrompt?: string;
};

export type RuntimeGroupKey = "base" | "auto" | "devchain" | "media" | "ai" | "system" | "ondemand";

export type RuntimeGroup = {
  key: RuntimeGroupKey;
  title: string;
  desc: string;
  hint: string;
  icon: ReactNode;
  ids: string[];
};

const AUTO_IDS = ["nuphus", "ponytail"];
const DEVCHAIN_IDS = ["pwsh", "git", "conda", "mingw"];
const MEDIA_IDS = ["ffmpeg", "markitdown"];
const AI_IDS = ["kb-embedding"];
/** 有专用卡片的工具（飞书 CLI / Filee / MoeKoe / Laya / 手机控制）—— 不在分类里再列一遍。 */
const DEDICATED_IDS = ["feishu-cli", "filee", "apkstart", "openmaic", "husk", "moekoe", "laya", "phone-harness"];
/** 已归入具体分类的 id ——「其它按需下载」兜底时必须排除它们，否则同一条会画两遍。 */
const GROUPED_IDS = new Set([...AUTO_IDS, ...DEVCHAIN_IDS, ...MEDIA_IDS, ...AI_IDS]);

export const RUNTIME_GROUPS: RuntimeGroup[] = [
  { key: "base", title: "基础运行时", desc: "Python / Node / VS Code CLI 与 50MB 以内的小工具，随包离线可用", hint: "随应用内置，离线可用", icon: <Wrench size={15} />, ids: [] },
  { key: "auto", title: "桌面与浏览器自动化", desc: "Nuphus 桌面自动化 + ponytail；浏览器自动化优先外部 Ego Lite", hint: "Nuphus 随包内置；浏览器优先 Ego Lite", icon: <TerminalSquare size={15} />, ids: AUTO_IDS },
  { key: "devchain", title: "开发工具链", desc: "Git / PowerShell 7 / Miniconda / MinGW，按需下载（国内镜像优先）", hint: "按需下载 · 国内镜像优先", icon: <Download size={15} />, ids: DEVCHAIN_IDS },
  { key: "media", title: "媒体与文档", desc: "FFmpeg 音视频处理 + markitdown 文档转 Markdown", hint: "音视频处理与文档格式转换", icon: <Activity size={15} />, ids: MEDIA_IDS },
  { key: "ai", title: "本地智能", desc: "知识库本地语义检索（ONNX 离线推理，不依赖供应商）", hint: "本地推理 / 语义检索", icon: <BookOpen size={15} />, ids: AI_IDS },
  { key: "system", title: "系统级安装", desc: "Docker Desktop / OpenSSL，需要到官网装（管理员权限）", hint: "打开官网手动安装", icon: <Globe2 size={15} />, ids: [] },
  { key: "ondemand", title: "其它按需下载", desc: "REA 逆向分析等零散工具（新工具没归类时落在这里）", hint: "联网下载安装（国内镜像优先）", icon: <Download size={15} />, ids: [] },
];

/** 该分类下的工具行（已剔除 hidden —— 它们各有专用卡片）。 */
export function runtimeGroupItems(group: RuntimeGroup, runtimes: RuntimeRow[]): RuntimeRow[] {
  return runtimes.filter((runtime) => !runtime.hidden && inGroup(group.key, runtime));
}

function inGroup(key: RuntimeGroupKey, runtime: RuntimeRow): boolean {
  if (key === "base") return Boolean(runtime.builtIn);
  if (key === "system") return runtime.kind === "guide";
  if (key === "auto" || key === "devchain" || key === "media" || key === "ai") {
    return RUNTIME_GROUPS.find((group) => group.key === key)?.ids.includes(runtime.id) ?? false;
  }
  return !runtime.builtIn && runtime.kind !== "guide"
    && !DEDICATED_IDS.includes(runtime.id) && !GROUPED_IDS.has(runtime.id);
}

/** 可下载（不是内置 / 随包 / 系统级，且当前未安装）。 */
export function isInstallable(runtime: RuntimeRow): boolean {
  return !runtime.builtIn && !runtime.bundled && !runtime.noUninstall
    && runtime.kind !== "guide" && !runtime.installed;
}

/** 可真卸载（已安装、非内置、非随包资源、非系统级）。 */
export function isRemovable(runtime: RuntimeRow): boolean {
  return !runtime.builtIn && !runtime.bundled && !runtime.noUninstall
    && runtime.kind !== "guide" && runtime.installed && !runtime.installedBySystem;
}

/** 运行时是否已就绪（已安装 / 系统已有 / 内置都算）。 */
export function isReady(runtime: RuntimeRow): boolean {
  return Boolean(runtime.installed || runtime.installedBySystem || runtime.builtIn);
}

/** 分类卡的「已就绪 n / m 项」（该分类本机一项都没有时如实写「暂无」）。 */
export function readyLabel(items: RuntimeRow[]): string {
  if (!items.length) return "本机暂无";
  return `已就绪 ${items.filter(isReady).length} / ${items.length} 项`;
}

/** 卡片 key（`tools-xxx`）→ 对应的运行时分组；不是工具卡片返回 undefined。 */
export const groupOfCardKey = (cardKey: string): RuntimeGroup | undefined =>
  cardKey.startsWith("tools-") ? RUNTIME_GROUPS.find((group) => `tools-${group.key}` === cardKey) : undefined;

/** 一键安装 / 一键卸载的串行进度（卡片上显示，关掉弹窗也不丢）。 */
export type RuntimeBatch = {
  kind: "install" | "uninstall" | null;
  done: number;
  total: number;
  /** 正在处理的那一项（id 用来接取消 / 读百分比）。 */
  id: string;
  name: string;
  /** 触发它的分类卡 key（`tools-<group>`）。 */
  card: string;
};