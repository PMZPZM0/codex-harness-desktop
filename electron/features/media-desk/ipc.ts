/**
 * media-desk 域：自媒体工作台（11-09）。
 *
 * 界面与流程 = 开源 dsh-media-desk 2.6.2 **原样嵌入**（客户端 bundle + 宿主源码随包，MIT），
 * 主进程只提供宿主适配与一个本地服务（electron/features/media-desk/embed.ts）。
 * 通道：media-desk:endpoint（拿本地页面地址）/ media-desk:popout（开独立窗口，尺寸跟随主窗口）/
 * Codex 工具走 embed 的 mediaDeskRequest（与界面同一份数据/流程），不经过这里。
 * ⛔ 密钥走宿主 secure 接缝（守卫【266】）；app.getPath 只在调用时求值（守卫【91】）。
 */
import { defineFeature } from "../../context";
import type { IpcHost } from "../../ipc-host";
import type { HostCaps } from "../../runtime/seams";
import { ensureMediaDeskServer, mediaDeskRequest, restartMediaDeskServer, setMediaDeskSecure } from "./embed";
import { sendToWindow } from "../window-bus";
import { checkMediaDeskUpdate, installMediaDeskVersion, mediaDeskVersionInfo } from "./vendor";
import { createMediaDeskPopoutWindow } from "../window-factory";

const CHANNELS = ["media-desk:endpoint", "media-desk:popout", "media-desk:version", "media-desk:check-update", "media-desk:update", "media-desk:handoff"] as const;

/** 成稿出口的三种去向（11-18 用户令「自媒体要联动工作台，深度联动」）。 */
type HandoffKind = "group" | "video" | "design";

export const mediaDeskFeature = defineFeature<null>({
  id: "media-desk",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("media-desk: 缺少 ipc 服务（宿主未提供）");
    setMediaDeskSecure(ctx.get<HostCaps>("host")?.secure ?? null);
    ipcHost.handle("media-desk:endpoint", () => ensureMediaDeskServer());
    ipcHost.handle("media-desk:popout", () => createMediaDeskPopoutWindow());

    /* 11-16 用户令：控制台里能更新工作台，更新后自适应现有布局（页面由渲染层重载 iframe）。
       ⛔ 更新只落 userData，不动随包资源；⛔ 不在这里判版本新旧（判断在 vendor 里，单一真相源）。 */
    ipcHost.handle("media-desk:version", () => mediaDeskVersionInfo());
    ipcHost.handle("media-desk:check-update", () => checkMediaDeskUpdate());
    ipcHost.handle("media-desk:update", async (_event: unknown, input?: { version?: string }) => {
      try {
        const latest = String(input?.version ?? "").trim() || (await checkMediaDeskUpdate()).latest;
        const installed = await installMediaDeskVersion(latest);
        /* 起新服务（读新目录）：返回的地址带新令牌前缀，渲染层据此重载 iframe。 */
        const endpoint = await restartMediaDeskServer();
        return { ok: true, version: installed.version, endpoint };
      } catch (error) {
        return { ok: false, error: String((error as { message?: unknown } | null)?.message ?? error) };
      }
    });
    /* 11-18：成稿出口。工作台在**独立窗口**里没有输入框 ⇒ 主进程把提示词发给主窗口预填，
       并把主窗口拉到前面（⛔ 不自动发送；⛔ 不伪造"已发布"）。
       取件口径：state 里**最近一条已出稿**（production.status=done），没有就取最近一条排期/草稿。 */
    ipcHost.handle("media-desk:handoff", async (_event: unknown, input?: { kind?: HandoffKind; itemId?: string }) => {
      const kind = (input?.kind ?? "group") as HandoffKind;
      try {
        const payload = await mediaDeskRequest("state");
        const state = (payload as { state?: { items?: any[] } })?.state ?? (payload as { items?: any[] });
        const items: any[] = Array.isArray(state?.items) ? state!.items! : [];
        const time = (value: unknown) => typeof value === "number" ? value : Date.parse(String(value ?? "")) || 0;
        const newest = (rows: typeof items, produced: boolean) => rows.reduce((best, row) => {
          const stamp = (item: typeof row) => (produced && time(item.production?.finishedAt)) || time(item.createdAt);
          return !best || stamp(row) > stamp(best) ? row : best;
        }, undefined);
        const pick = input?.itemId
          ? items.find((x) => String(x?.id ?? "") === String(input.itemId))
          : (newest(items.filter((x) => x?.production?.status === "done"), true) ?? newest(items, false));
        if (!pick) return { ok: false, error: "工作台里还没有内容 —— 先采集或写一条" };
        const production = pick.production?.status === "done" ? pick.production : null;
        const title = String(production?.title ?? pick.title ?? "未命名").trim();
        const body = String(production?.article ?? pick.body ?? pick.text ?? "").trim().slice(0, 1200);
        const head = `自媒体工作台这条内容：「${title}」`;
        const tail = body ? `\n\n正文摘要：\n${body}` : "";
        const prompts: Record<HandoffKind, string> = {
          group: `${head}${tail}\n\n请做发布前评审：① 标题是否够具体（不要空泛）；② 前两句是否留人；③ 平台与时间是否合适；④ 有无敏感/夸大表述。给出改后的标题与开头，不要自己发布。`,
          video: `${head}${tail}\n\n请把它拆成 60 秒口播分镜（镜号 / 画面 / 口播 / 时长），镜头语言要能直接拍；如果缺素材，列出需要补的 3 个镜头。`,
          design: `${head}${tail}\n\n请先在设计参考库里挑一套合适的风格（design_md），再把这条内容的配图方向写成 3 条可执行的出图提示词（含构图、色调、禁忌）。`,
        };
        const text = prompts[kind] ?? prompts.group;
        sendToWindow("app:prefill", { text, from: "media-desk" });
        /* ⛔ 域不直接碰 BrowserWindow（守卫【266】）—— 走 window 接缝。 */
        const wins = ctx.get<HostCaps>("host")?.window?.getAll?.() ?? [];
        const win = wins.find((w) => !w.isDestroyed() && w.isVisible());
        win?.focus();
        return { ok: true, kind: String(kind), title, itemId: String(pick.id ?? "") };
      } catch (error) {
        return { ok: false, error: String((error as { message?: unknown } | null)?.message ?? error) };
      }
    });
    ctx.effect(() => {
      for (const channel of CHANNELS) ipcHost.removeHandler(channel);
      setMediaDeskSecure(null);
    });
  },
});
