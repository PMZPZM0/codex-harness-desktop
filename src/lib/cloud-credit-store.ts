/**
 * 云端积分**展示用**的缓存与订阅（不参与计费；计费只在服务端）。
 *
 * 为什么要有这一层：
 *   · **写入点**只有一个 —— 回合完成事件（那里才同时拿得到 turnId、模型、用量）；
 *   · **读取点**有两个 —— 消息页脚（按 turnId 查本轮消耗）、输入框积分徽标（要闲时快照）。
 *   两点之间隔着好几层组件，⛔ 不往中间层加 props（本项目既有做法：走桥，不走透传）。
 *
 * 数据从哪来：`cloudModelsCatalog()`（服务端 `GET /models` 原样透传）里每个模型的 `credits`
 * + 全局 `offPeak` 快照。⛔ 拿不到目录 ⇒ 一律**不显示**（宁可不显示，也不显示错的数字）。
 *
 * ⛔ 目录带 TTL 缓存：管理员改倍率后，最多 TTL 过期后的下一次用时才反映到本地显示。
 *   （账本以服务端为准，这里只是"提前告诉你大概会扣多少"。）
 */
import { useSyncExternalStore } from "react";
import { estimateTurnCredit, offPeakWindowAt } from "./credit-estimate.mjs";
import type { OffPeakConfig, TurnCreditEstimate } from "./credit-estimate.mjs";

/** 本轮消耗记录（在估算结果上补一个模型名，页脚 tooltip 要显示"是哪个模型算出来的"）。 */
export type TurnCreditRecord = TurnCreditEstimate & { model: string };

/** 目录缓存时长：与输入框徽标的轮询同频（5 分钟），再密只是白打网络。 */
const CATALOG_TTL_MS = 5 * 60_000;
/** 记录上限：超出后淘汰最早的（只影响"翻很久以前的回合还看不看得到估算"，不影响账本）。 */
const MAX_RECORDS = 800;

type CatalogSnapshot = { models: Map<string, string>; offPeak: OffPeakConfig | null };
type CatalogReply = { ok?: boolean; models?: Array<{ id?: string; credits?: string }>; offPeak?: OffPeakConfig };
type CatalogApi = { cloudModelsCatalog?: () => Promise<CatalogReply> };

let catalog: CatalogSnapshot | null = null;
let catalogAt = 0;
let catalogInflight: Promise<CatalogSnapshot> | null = null;

const records = new Map<string, TurnCreditRecord>();
/** 用 `credits` 里有它才算"这是云端目录里的模型"，否则一律不显示（别的供应商走它没意义）。 */
const listeners = new Set<() => void>();
/** 徽标只关心闲时快照；单独给一个稳定的对象引用，避免每次 render 都触发重订阅。 */
let offPeakSnapshot: OffPeakConfig | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function readCatalog(): Promise<CatalogSnapshot> {
  const api = (window as unknown as { codex?: CatalogApi }).codex;
  if (!api || !api.cloudModelsCatalog) return Promise.resolve({ models: new Map(), offPeak: null });
  return api.cloudModelsCatalog()
    .then((reply) => {
      const models = new Map<string, string>();
      if (reply && reply.ok && Array.isArray(reply.models)) {
        for (const m of reply.models) if (m && m.id) models.set(String(m.id), m.credits == null ? "" : String(m.credits));
      }
      return { models, offPeak: (reply && reply.offPeak) || null };
    })
    .catch(() => ({ models: new Map(), offPeak: null }));
}

/** 拿目录（带 TTL）；失败也缓存一个空目录，靠 TTL 到期重试 —— 不会在热路径上反复打网络。 */
function ensureCatalog(): Promise<CatalogSnapshot> {
  const fresh = catalog && Date.now() - catalogAt < CATALOG_TTL_MS;
  if (fresh) return Promise.resolve(catalog as CatalogSnapshot);
  if (catalogInflight) return catalogInflight;
  catalogInflight = readCatalog().then((next) => {
    catalog = next;
    catalogAt = Date.now();
    catalogInflight = null;
    offPeakSnapshot = next.offPeak;
    emit();                     // 目录到位/刷新 ⇒ 让已渲染的页脚与徽标重算
    return next;
  });
  return catalogInflight;
}

/** 预热目录（进入某个云端会话时调一次即可；不调也行，第一次记录回合时会自己拉）。 */
export function warmCloudCreditCatalog() { void ensureCatalog(); }

/**
 * 记下这一回合的积分估算。⛔ 只对"目录里确实有、且倍率非空"的模型记录；
 * 其余情况（非云端供应商 / 目录没到 / 模型不在目录）**什么都不存** ⇒ 页脚不显示。
 */
export function recordTurnCredit(turnId: string, model: string, input: number, output: number) {
  const id = String(turnId || "");
  const name = String(model || "");
  if (!id || !name) return;
  const compute = (snap: CatalogSnapshot): TurnCreditRecord | null => {
    if (!snap.models.has(name)) return null;
    const estimate = estimateTurnCredit({ credits: snap.models.get(name), offPeak: snap.offPeak, input, output });
    return estimate ? { ...estimate, model: name } : null;
  };
  const apply = (record: TurnCreditRecord | null) => {
    if (!record) return;
    records.set(id, record);
    while (records.size > MAX_RECORDS) {
      const oldest = records.keys().next();
      if (oldest.done) break;
      records.delete(oldest.value);
    }
    emit();
  };
  if (catalog) { apply(compute(catalog)); return; }
  /* 目录还没到 ⇒ 先记 0 条、等目录到位后补算（页脚这会儿不显示，到位后自动出现）。 */
  void ensureCatalog().then((snap) => { apply(compute(snap)); });
}

/** 某回合的积分估算（页脚用）。没有就是 null —— 调用方据此**不占位**。 */
export function useTurnCredit(turnId?: string): TurnCreditRecord | null {
  return useSyncExternalStore(subscribe, () => (turnId ? records.get(String(turnId)) ?? null : null));
}

/** 闲时快照（徽标用）。返回稳定的对象引用；同时把"当前命中哪个窗口"现算出来。 */
export function useOffPeak(): OffPeakConfig | null {
  return useSyncExternalStore(subscribe, () => offPeakSnapshot);
}

/** 现在命中哪个闲时窗口（按服务器时间；未启用/没命中 ⇒ null）。 */
export function currentOffPeakWindow(offPeak: OffPeakConfig | null) {
  return offPeakWindowAt(offPeak);
}
