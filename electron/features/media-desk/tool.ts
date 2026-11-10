/**
 * 自媒体工作台 · Codex 工具执行端（11-09）。
 *
 * 与界面用的是**同一份数据与流程**：请求打到本地的原版宿主服务（media-desk/embed.ts），
 * ⛔ 不在这里另写生产管线。动作：state / capture / draft / produce / schedule / metric / style / delete / undo。
 */
import { mediaDeskRequest } from "./embed";

type Args = Record<string, unknown>;

/** 跑一次 media_desk 工具；返回给模型的是提炼后的 JSON（⛔ 不塞整份 state）。 */
export async function runMediaDeskTool(args: Args): Promise<{ ok: boolean; output?: string; error?: string }> {
  const action = String(args?.action ?? "state");
  const out = (value: unknown) => ({ ok: true, output: JSON.stringify(value).slice(0, 8000) });
  const summarize = (payload: any) => {
    const state = payload?.state ?? payload ?? {};
    const items: any[] = Array.isArray(state.items) ? state.items : [];
    return {
      counts: { items: items.length, styles: (state.styles ?? []).length, metrics: (state.metrics ?? []).length },
      items: items.slice(0, 10).map((i) => ({ id: i.id, title: i.title, kind: i.kind, status: i.status, platform: i.platform, scheduledAt: i.scheduledAt, produced: i.production?.status === "done" })),
      styles: (state.styles ?? []).slice(0, 10).map((s: any) => ({ id: s.id, name: s.name })),
      model: payload?.model ?? undefined,
      canUndo: payload?.canUndo ?? undefined,
    };
  };
  const addItem = async (item: Record<string, unknown>) => {
    const res = await mediaDeskRequest("ops", { ops: [{ op: "add_item", item }] });
    const errors: string[] = Array.isArray(res?.errors) ? res.errors : [];
    if (errors.length) throw new Error(errors.join("；"));
    return String(res?.receipts?.[0]?.target ?? "");
  };
  /** 等生产完成（produce 异步起跑）；超时也如实回当前进度。 */
  const waitProduced = async (id: string, timeoutMs = 240_000) => {
    const t0 = Date.now();
    let last: any = null;
    while (Date.now() - t0 < timeoutMs) {
      last = await mediaDeskRequest("production?id=" + encodeURIComponent(id)).catch(() => null);
      const status = String(last?.production?.status ?? "");
      if (status === "done" || status === "failed" || status === "cancelled") break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return last;
  };

  switch (action) {
    case "state":
      return out(summarize(await mediaDeskRequest("state")));
    case "capture": {
      const url = String(args?.url ?? "").trim();
      const text = String(args?.text ?? "").trim();
      if (!url && !text) return { ok: false, error: "capture 需要 text 或 url" };
      const id = await addItem({ title: text.slice(0, 40) || url, body: text || url, ...(url ? { url } : {}), kind: "note", status: "idea" });
      return out({ id, state: summarize(await mediaDeskRequest("state")) });
    }
    case "draft": {
      const text = String(args?.text ?? "").trim();
      const id = await addItem({
        title: String(args?.title ?? "").trim() || text.slice(0, 40) || "未命名选题",
        body: text,
        kind: "note",
        status: "idea",
        ...(args?.platform ? { platform: String(args.platform) } : {}),
        ...(args?.styleId ? { angleId: String(args.styleId) } : {}),
      });
      if (!id) return { ok: false, error: "建灵感失败" };
      await mediaDeskRequest("produce", { id });
      const done = await waitProduced(id);
      const state = await mediaDeskRequest("state");
      const item = (state?.state?.items ?? []).find((row: any) => row.id === id);
      return out({
        id,
        production: done?.production ?? item?.production ?? null,
        title: item?.title,
        article: String(item?.production?.article ?? "").slice(0, 5000),
        shots: item?.production?.shots ?? undefined,
        state: summarize(state),
      });
    }
    case "produce": {
      const state = await mediaDeskRequest("state");
      const id = String(args?.postId ?? state?.state?.items?.[0]?.id ?? "");
      if (!id) return { ok: false, error: "还没有内容，先 capture 或 draft" };
      await mediaDeskRequest("produce", { id });
      const done = await waitProduced(id);
      return out({ id, production: done?.production ?? null, state: summarize(await mediaDeskRequest("state")) });
    }
    case "schedule": {
      const whenRaw = args?.when;
      const when = typeof whenRaw === "number" ? new Date(whenRaw).toISOString() : String(whenRaw ?? "");
      if (!when || Number.isNaN(Date.parse(when))) return { ok: false, error: "when 需要 ISO 时间（如 2026-11-10T09:00:00+08:00）或毫秒时间戳" };
      const id = await addItem({
        title: String(args?.title ?? "未命名排期"), body: String(args?.text ?? ""),
        kind: "note", status: "idea", scheduledAt: when,
        ...(args?.platform ? { platform: String(args.platform) } : {}),
      });
      return out({ id, state: summarize(await mediaDeskRequest("state")) });
    }
    case "metric": {
      const res = await mediaDeskRequest("ops", { ops: [{
        op: "add_metric",
        itemId: args?.postId ? String(args.postId) : undefined,
        date: String(args?.date ?? new Date().toISOString().slice(0, 10)),
        views: Number(args?.views ?? 0) || 0, likes: Number(args?.likes ?? 0) || 0,
        comments: Number(args?.comments ?? 0) || 0, shares: Number(args?.shares ?? 0) || 0,
        ...(args?.platform ? { platform: String(args.platform) } : {}),
      }] });
      return out({ receipts: res?.receipts, errors: res?.errors, state: summarize(await mediaDeskRequest("state")) });
    }
    case "style": {
      const res = await mediaDeskRequest("ops", { ops: [{
        op: "add_style",
        name: String(args?.name ?? "新风格"),
        summary: String(args?.description ?? ""),
        structure: String(args?.prompt ?? ""),
      }] });
      return out({ receipts: res?.receipts, errors: res?.errors, state: summarize(await mediaDeskRequest("state")) });
    }
    case "delete": {
      const id = String(args?.id ?? "");
      if (!id) return { ok: false, error: "delete 需要 id（state 里有）" };
      const res = await mediaDeskRequest("ops", { ops: [{ op: "delete_item", id }] });
      return out({ receipts: res?.receipts, errors: res?.errors, state: summarize(await mediaDeskRequest("state")) });
    }
    case "undo": {
      const res = await mediaDeskRequest("undo", {});
      return out({ label: res?.label, state: summarize(res) });
    }
    default:
      return { ok: false, error: "media_desk 不认识的 action：" + action + "（可用 state / capture / draft / produce / schedule / metric / style / delete / undo）" };
  }
}
