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
      items: items.slice(0, 10).map((i) => ({ id: i.id, title: i.title, kind: i.kind, status: i.status, platform: i.platform, scheduledAt: i.scheduledAt, produced: i.production?.status === "done", productionStatus: i.production?.status ?? undefined, productionError: i.production?.error ?? undefined })),
      styles: (state.styles ?? []).slice(0, 10).map((s: any) => ({ id: s.id, name: s.name })),
      model: payload?.model ?? undefined,
      canUndo: payload?.canUndo ?? undefined,
    };
  };
  /** 跑一批上游 op；有 errors 就抛（上游对非法字段是逐条回错误的）。 */
  const applyOps = async (ops: Array<Record<string, unknown>>) => {
    const res = await mediaDeskRequest("ops", { ops });
    const errors: string[] = Array.isArray(res?.errors) ? res.errors : [];
    if (errors.length) throw new Error(errors.join("；"));
    return res as { receipts?: Array<{ target?: string }> };
  };
  const addItem = async (item: Record<string, unknown>) => {
    /* 上游 op 是「扁平字段」（{op:'add_item', title, body…}），⛔ 不是 {op, item:{…}}。 */
    const res = await applyOps([{ op: "add_item", ...item }]);
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
  /** 上游 production 里有整篇正文（可达 20 万字），⛔ 不能原样塞给模型：只留判据与摘要。 */
  const productionSummary = (production: any) => {
    if (!production) return null;
    return {
      status: production.status ?? undefined,
      error: production.error ?? undefined,
      notice: production.notice ?? undefined,
      title: production.title ?? undefined,
      article: typeof production.article === "string" ? production.article.slice(0, 5000) : undefined,
      cover: production.cover ?? undefined,
      imageCount: Array.isArray(production.images) ? production.images.length : 0,
      shotCount: Array.isArray(production.shots) ? production.shots.length : 0,
    };
  };

  try {
    switch (action) {
      case "state":
        return out(summarize(await mediaDeskRequest("state")));
      case "capture": {
        const url = String(args?.url ?? "").trim();
        const text = String(args?.text ?? "").trim();
        if (!url && !text) return { ok: false, error: "capture 需要 text 或 url" };
        /* 带链接走上游的 capture-url：它会抓标题/摘要/封面（内网地址由它自己的采集闸拒绝）。 */
        const id = url
          ? String((await mediaDeskRequest("capture-url", {
            url,
            ...(args?.title ? { title: String(args.title) } : {}),
            ...(text ? { note: text } : {}),
          }))?.id ?? "")
          : await addItem({ title: text.slice(0, 40), body: text, kind: "note", status: "idea" });
        if (!id) return { ok: false, error: "记灵感失败（上游没有回执）" };
        return out({ id, state: summarize(await mediaDeskRequest("state")) });
      }
      case "draft": {
        const text = String(args?.text ?? "").trim();
        const styleId = String(args?.styleId ?? "").trim();
        const id = await addItem({
          title: String(args?.title ?? "").trim() || text.slice(0, 40) || "未命名选题",
          body: text,
          kind: "note",
          status: "idea",
          ...(args?.platform ? { platform: String(args.platform) } : {}),
        });
        if (!id) return { ok: false, error: "建灵感失败" };
        /* 上游的写作风格是「当前风格」（state.activeStyleId），不支持逐条绑；先切再产稿。 */
        if (styleId) await applyOps([{ op: "set_style", id: styleId }]);
        await mediaDeskRequest("produce", { id });
        const done = await waitProduced(id);
        const state = await mediaDeskRequest("state");
        const item = (state?.state?.items ?? []).find((row: any) => row.id === id);
        const production = productionSummary(item?.production ?? done?.production ?? null);
        if (production?.status === "failed") return { ok: false, error: `成稿失败：${production.error ?? "未知原因（检查工作台的模型设置）"}` };
        if (production?.status === "cancelled") return { ok: false, error: "成稿已取消" };
        return out({ id, production, title: item?.title, state: summarize(state) });
      }
      case "produce": {
        const state = await mediaDeskRequest("state");
        const id = String(args?.postId ?? state?.state?.items?.[0]?.id ?? "");
        if (!id) return { ok: false, error: "还没有内容，先 capture 或 draft" };
        await mediaDeskRequest("produce", { id });
        const done = await waitProduced(id);
        const production = productionSummary(done?.production ?? null);
        if (production?.status === "failed") return { ok: false, error: `成稿失败：${production.error ?? "未知原因（检查工作台的模型设置）"}` };
        if (production?.status === "cancelled") return { ok: false, error: "成稿已取消" };
        return out({ id, production, stillRunning: production?.status === "running", state: summarize(await mediaDeskRequest("state")) });
      }
      case "schedule": {
        const whenRaw = args?.when;
        const when = typeof whenRaw === "number" ? new Date(whenRaw).toISOString() : String(whenRaw ?? "");
        if (!when || Number.isNaN(Date.parse(when))) return { ok: false, error: "when 需要 ISO 时间（如 2026-11-10T09:00:00+08:00）或毫秒时间戳" };
        const postId = String(args?.postId ?? "").trim();
        if (postId) {
          /* 给已有内容改排期（上游 schedule_item）。 */
          await applyOps([{
            op: "schedule_item",
            id: postId,
            scheduledAt: when,
            ...(args?.platform ? { platform: String(args.platform) } : {}),
          }]);
          return out({ id: postId, scheduledAt: when, state: summarize(await mediaDeskRequest("state")) });
        }
        const id = await addItem({
          title: String(args?.title ?? "").trim() || "未命名排期", body: String(args?.text ?? ""),
          kind: "note", status: "idea", scheduledAt: when,
          ...(args?.platform ? { platform: String(args.platform) } : {}),
        });
        if (!id) return { ok: false, error: "排期失败（上游没有回执）" };
        return out({ id, state: summarize(await mediaDeskRequest("state")) });
      }
      case "metric": {
        const platform = String(args?.platform ?? "").trim();
        if (!platform) return { ok: false, error: "metric 需要 platform（公众号 / 小红书 / 抖音 / B站 / 视频号 / TikTok / Instagram / YouTube / X）" };
        const res = await applyOps([{
          op: "add_metric",
          itemId: args?.postId ? String(args.postId) : undefined,
          date: String(args?.date ?? new Date().toISOString().slice(0, 10)),
          views: Number(args?.views ?? 0) || 0, likes: Number(args?.likes ?? 0) || 0,
          comments: Number(args?.comments ?? 0) || 0, shares: Number(args?.shares ?? 0) || 0,
          platform,
        }]);
        return out({ receipts: res?.receipts, state: summarize(await mediaDeskRequest("state")) });
      }
      case "insights": {
        const data: any = await mediaDeskRequest("insights");
        return out({
          views: data?.views ?? 0,
          engaged: data?.engaged ?? 0,
          engagementRate: data?.engagementRate ?? 0,
          published: data?.published ?? 0,
          followers: data?.followers ?? 0,
          platforms: (data?.platforms ?? []).slice(0, 8),
          top: (data?.top ?? []).slice(0, 8),
          hasSample: data?.hasSample ?? undefined,
        });
      }
      case "style": {
        const res = await applyOps([{
          op: "add_style",
          name: String(args?.name ?? "新风格"),
          summary: String(args?.description ?? ""),
          structure: String(args?.prompt ?? ""),
        }]);
        return out({ receipts: res?.receipts, state: summarize(await mediaDeskRequest("state")) });
      }
      case "delete": {
        const id = String(args?.id ?? "");
        if (!id) return { ok: false, error: "delete 需要 id（state 里有）" };
        const res = await applyOps([{ op: "delete_item", id }]);
        return out({ receipts: res?.receipts, state: summarize(await mediaDeskRequest("state")) });
      }
      case "undo": {
        const res = await mediaDeskRequest("undo", {});
        return out({ label: res?.label, state: summarize(res) });
      }
      default:
        return { ok: false, error: "media_desk 不认识的 action：" + action + "（可用 state / capture / draft / produce / schedule / metric / insights / style / delete / undo）" };
    }
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error).slice(0, 300) };
  }
}
