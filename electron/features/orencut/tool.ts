/**
 * OrenCut · Codex 工具执行端（11-28）。
 *
 * 与右栏「动效」页共用同一份安装目录（`<userData>/orencut`，见 orencut-protocol.ts）：
 * ⛔ 这里不另存组件数据 —— 直接读上游 `catalog.json`，上游更新（重新下载）后工具输出自动跟上。
 *
 * 为什么要这个工具：OrenCut 的 33 个组件各自带 `id / group / inputs / studioUrl`，
 * 模型拿不到目录就只能瞎猜编号；open 动作会**在右栏打开对应组件**（带 ?id=），
 * 用户当场看到画面，而不是拿到一句"已打开"。
 */
import fs from "node:fs";
import path from "node:path";
import { orencutRoot } from "../../orencut-protocol";
import { installOrencut, orencutStatus } from "./ipc";

type Args = Record<string, unknown>;

type CatalogComponent = {
  id: string;
  title: string;
  group: string;
  keywords?: string[];
  width?: number;
  height?: number;
  fps?: number;
  durationSeconds?: number;
  mode?: string;
  audio?: boolean;
  inputs?: Record<string, { type?: string; enum?: string[]; maxLength?: number; default?: unknown; description?: string }>;
  studioUrl?: string;
};

type Catalog = { release?: string; components?: CatalogComponent[] };

/** 读安装目录里的组件目录；没装或读不到返回 null（调用方给出"先安装"的提示）。 */
function readCatalog(): Catalog | null {
  try {
    const file = path.join(orencutRoot(), "catalog.json");
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as Catalog;
  } catch {
    return null;
  }
}

/** 把一条组件压成一行（给模型看，别把 inputs 的完整 JSON 倒进去）。 */
function describeComponent(item: CatalogComponent): string {
  const size = item.width && item.height ? `${item.width}x${item.height}` : "";
  const dur = item.durationSeconds ? `${item.durationSeconds}s` : "";
  const inputs = Object.entries(item.inputs ?? {})
    .map(([key, spec]) => {
      const range = spec?.enum?.length ? `[${spec.enum.join("|")}]` : spec?.maxLength ? `≤${spec.maxLength}字` : "";
      return `${key}${range ? ` ${range}` : ""}`;
    })
    .join("、");
  return [
    `${item.id}. ${item.title}`,
    `   分类：${item.group}`,
    size || dur ? `   ${[size, dur, item.mode ?? "", item.audio ? "带音轨" : "静音"].filter(Boolean).join(" · ")}` : "",
    inputs ? `   可改：${inputs}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * 工具入口。动作：
 *  · status  —— 是否已下载 / 文件数 / 下载时间
 *  · list    —— 列组件（可按 group 或 keyword 过滤；不装则提示先 install）
 *  · open    —— 在右栏「动效」页打开指定组件（id 可省，省则开 Studio 首页）
 *  · install —— 下载并安装（约 57 MB）
 * ⛔ open 只负责"让用户看见"，不代用户导出 MP4（导出是浏览器本地编码，需用户在 Studio 里点）。
 */
export async function runOrencutTool(args: Args): Promise<{ ok: boolean; output?: string; error?: string }> {
  const action = String(args?.action ?? "status").trim() || "status";

  if (action === "status" || action === "install") {
    let status = orencutStatus();
    if (action === "install" && !status.installed) {
      status = await installOrencut();
      if (!status.installed) return { ok: false, error: `安装失败：${status.error || "未知原因"}` };
      return { ok: true, output: `OrenCut 已下载安装（${status.files} 个文件，位于 userData/orencut）。现在可以用 list 看 33 个组件，用 open 在右栏打开。` };
    }
    if (!status.installed) {
      return { ok: true, output: `OrenCut 尚未安装。用 action=install 下载（约 57 MB，纯静态站，装完离线可用）。` };
    }
    return { ok: true, output: `OrenCut 已安装：${status.files} 个文件${status.installedAt ? `，${status.installedAt.slice(0, 10)} 下载` : ""}。` };
  }

  const catalog = readCatalog();
  if (!catalog?.components?.length) {
    return { ok: false, error: "OrenCut 还没安装（或目录读不到）。先调用 action=install，或让用户在右栏「动效」页点「下载并安装」。" };
  }

  if (action === "list") {
    const group = String(args?.group ?? "").trim();
    const keyword = String(args?.keyword ?? "").trim().toLowerCase();
    const id = String(args?.id ?? "").trim();
    let items = catalog.components;
    if (id) items = items.filter((c) => c.id === id || c.id === id.padStart(2, "0"));
    if (group) items = items.filter((c) => c.group.includes(group));
    if (keyword) {
      items = items.filter((c) => c.title.toLowerCase().includes(keyword)
        || (c.keywords ?? []).some((k) => k.toLowerCase().includes(keyword)));
    }
    if (!items.length) return { ok: true, output: `没有匹配的组件（共 ${catalog.components.length} 个）。试试不带过滤条件，或按分类：${[...new Set(catalog.components.map((c) => c.group))].join(" / ")}` };
    const head = `OrenCut ${catalog.release ?? ""} · 共 ${catalog.components.length} 个组件，本次列出 ${items.length} 个：`;
    return { ok: true, output: `${head}\n${items.map(describeComponent).join("\n")}` };
  }

  if (action === "open") {
    const id = String(args?.id ?? "").trim();
    const target = catalog.components.find((c) => c.id === id || c.id === id.padStart(2, "0"));
    if (id && !target) return { ok: false, error: `没有编号 ${id} 的组件（用 list 查可用编号）` };
    /* 让渲染层切到「动效」页并定位组件：与 3D/媒体同一套「主进程推事件 + 页面订阅」写法。 */
    try {
      const { sendToWindow } = await import("../window-bus");
      sendToWindow("orencut:open", { id: target?.id ?? "" });
    } catch (error) {
      return { ok: false, error: `通知界面失败：${String((error as Error)?.message ?? error)}` };
    }
    return {
      ok: true,
      output: target
        ? `已在右栏「动效」页打开 ${target.id}. ${target.title}。用户可在页面里改 ${Object.keys(target.inputs ?? {}).join(" / ") || "（无）"} 并导出 MP4（浏览器本地编码）。`
        : "已在右栏「动效」页打开 OrenCut Studio 首页。",
    };
  }

  return { ok: false, error: `未知动作：${action}（可用 status / list / open / install）` };
}
