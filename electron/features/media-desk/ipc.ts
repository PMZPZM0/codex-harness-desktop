/**
 * media-desk 域：自媒体工作台（11-09 立项，逻辑移植自开源 dsh-media-desk 2.6.2，MIT）。
 *
 * 通道：media-desk:state / add / update / delete / undo / settings / harvest / plan / produce / chat
 * 真相源：`<userData>/media-desk/state.json`（图片在 files/）。
 * ⛔ 一个板块一个域前缀；密钥只留主进程（对外 state 抹空）。
 * ⛔ 所有 app.getPath 都在 handler 内求值（守卫【91】）。
 */
import { app } from "electron";
import { defineFeature } from "../../context";
import type { IpcHost } from "../../ipc-host";
import {
  addItem, deleteItem, filesDir, mergeSettings, newId, publicState, readState, undo, updateItem,
  type Collection, type MediaDeskState, type Post, type PostPlan, type StylePreset,
} from "./store";
import { articlePrompts, callModel, chatPrompts, extractJson, imagePrompt, normalizePlan, planPrompts, resolveModel, setSecureHost } from "./ai";
import type { HostCaps } from "../../runtime/seams";
import { generateImage } from "./images";
import { harvest } from "./harvest";

function userDataDir(): string {
  return app.getPath("userData");
}

const CHANNELS = [
  "media-desk:state", "media-desk:add", "media-desk:update", "media-desk:delete", "media-desk:undo",
  "media-desk:settings", "media-desk:harvest", "media-desk:plan", "media-desk:produce", "media-desk:chat",
] as const;

function styleOf(state: MediaDeskState, post: Post): StylePreset | null {
  return state.styles.find((s) => s.id === post.styleId) ?? null;
}

function inspirationTexts(state: MediaDeskState, post: Post): string[] {
  const ids = Array.isArray(post.inspirationIds) ? post.inspirationIds : [];
  const picked = state.inspirations.filter((i) => ids.includes(i.id)).map((i) => [i.title, i.text].filter(Boolean).join("："));
  return picked.length ? picked : state.inspirations.slice(0, 5).map((i) => [i.title, i.text].filter(Boolean).join("："));
}

/** 生成计划并回写 post（title 也跟随，除非用户已手动改过标题）。 */
async function producePlan(userData: string, postId: string): Promise<{ ok: boolean; error?: string }> {
  const state = readState(userData);
  const post = state.posts.find((p) => p.id === postId) ?? state.posts[0] ?? null;
  if (!post) return { ok: false, error: "先建一篇稿子（从灵感一键成稿会同时建稿）" };
  const target = await resolveModel(state.settings);
  const raw = await callModel(target, planPrompts(inspirationTexts(state, post), styleOf(state, post), post.platform));
  const plan = normalizePlan(extractJson(raw), post.title || "未命名选题");
  updateItem(userData, "posts", post.id, { plan, title: post.title && post.title !== "未命名选题" ? post.title : plan.title });
  return { ok: true };
}

async function produceArticle(userData: string, postId: string): Promise<{ ok: boolean; error?: string }> {
  let state = readState(userData);
  let post = state.posts.find((p) => p.id === postId) ?? null;
  if (!post) return { ok: false, error: "稿子不存在" };
  if (!post.plan) {
    const planned = await producePlan(userData, post.id);
    if (!planned.ok) return planned;
    state = readState(userData);
    post = state.posts.find((p) => p.id === postId) ?? post;
  }
  const target = await resolveModel(state.settings);
  const raw = await callModel(target, articlePrompts(post.plan as PostPlan, styleOf(state, post)));
  updateItem(userData, "posts", post.id, { script: raw, status: "draft" });
  return { ok: true };
}

async function produceImages(userData: string, postId: string): Promise<{ ok: boolean; error?: string; failed?: string[] }> {
  let state = readState(userData);
  let post = state.posts.find((p) => p.id === postId) ?? null;
  if (!post) return { ok: false, error: "稿子不存在" };
  if (!post.plan) {
    const planned = await producePlan(userData, post.id);
    if (!planned.ok) return planned;
    state = readState(userData);
    post = state.posts.find((p) => p.id === postId) ?? post;
  }
  const plan = post.plan as PostPlan;
  const style = styleOf(state, post);
  const shots = plan.shots.slice(0, Math.max(0, Math.min(4, state.settings.shotCount || 6)));
  const figures = plan.points.slice(0, Math.max(0, Math.min(2, state.settings.imageCount || 2)));
  const images: Array<{ id: string; label: string; path: string }> = [];
  const failed: string[] = [];
  let cover = post.cover ?? "";
  const dir = filesDir(userData);
  const jobs: Array<{ label: string; kind: "cover" | "figure" | "shot"; text: string }> = [
    { label: "封面", kind: "cover", text: plan.coverText || plan.title || post!.title },
    ...figures.map((text, i) => ({ label: `配图 ${i + 1}`, kind: "figure" as const, text })),
    ...shots.map((s, i) => ({ label: `分镜 ${i + 1}`, kind: "shot" as const, text: s.text })),
  ];
  for (const job of jobs) {
    try {
      const file = await generateImage(state.settings, imagePrompt(job.kind, job.text, style), dir);
      if (job.kind === "cover") cover = file;
      else images.push({ id: newId("pic"), label: job.label, path: file });
      // 每张落一张就回写一次：中途失败也保住已生成的图。
      updateItem(userData, "posts", post.id, { cover, images: images.slice() });
    } catch (error: any) {
      failed.push(`${job.label}：${String(error?.message ?? error).slice(0, 120)}`);
    }
  }
  updateItem(userData, "posts", post.id, { cover, images: images.slice(), status: "ready" });
  if (!cover && !images.length) return { ok: false, error: failed[0] ?? "没有生成出图片", failed };
  return { ok: true, failed };
}

export const mediaDeskFeature = defineFeature<null>({
  id: "media-desk",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("media-desk: 缺少 ipc 服务（宿主未提供）");
    /* 密钥接缝（⛔ 域不许直取 safeStorage，守卫【266】）：解析「应用当前供应商」的 Key 时用。 */
    setSecureHost(ctx.get<HostCaps>("host")?.secure ?? null);

    ipcHost.handle("media-desk:state", () => publicState(readState(userDataDir())));
    ipcHost.handle("media-desk:add", (_event, collection: Collection, item: Record<string, unknown>) => {
      addItem(userDataDir(), collection, item ?? {});
      return publicState(readState(userDataDir()));
    });
    ipcHost.handle("media-desk:update", (_event, collection: Collection, id: string, patch: Record<string, unknown>) => {
      updateItem(userDataDir(), collection, String(id ?? ""), patch ?? {});
      return publicState(readState(userDataDir()));
    });
    ipcHost.handle("media-desk:delete", (_event, collection: Collection, id: string) => {
      deleteItem(userDataDir(), collection, String(id ?? ""));
      return publicState(readState(userDataDir()));
    });
    ipcHost.handle("media-desk:undo", () => {
      undo(userDataDir());
      return publicState(readState(userDataDir()));
    });
    ipcHost.handle("media-desk:settings", (_event, patch: Record<string, unknown>) => {
      mergeSettings(userDataDir(), (patch ?? {}) as never);
      return publicState(readState(userDataDir()));
    });
    ipcHost.handle("media-desk:harvest", (_event, url: string) => harvest(String(url ?? "")));
    ipcHost.handle("media-desk:plan", async (_event, postId: string) => {
      try {
        const r = await producePlan(userDataDir(), String(postId ?? ""));
        return { ...r, state: publicState(readState(userDataDir())) };
      } catch (error: any) {
        return { ok: false, error: String(error?.message ?? error), state: publicState(readState(userDataDir())) };
      }
    });
    ipcHost.handle("media-desk:produce", async (_event, postId: string, what: string) => {
      try {
        const id = String(postId ?? "");
        const mode = String(what ?? "all");
        let result: { ok: boolean; error?: string; failed?: string[] } = { ok: true };
        if (mode === "plan") result = await producePlan(userDataDir(), id);
        else if (mode === "article") result = await produceArticle(userDataDir(), id);
        else if (mode === "images") result = await produceImages(userDataDir(), id);
        else {
          const planned = await producePlan(userDataDir(), id);
          if (!planned.ok) result = planned;
          else {
            const article = await produceArticle(userDataDir(), id);
            const images = await produceImages(userDataDir(), id);
            result = { ok: article.ok || images.ok, error: article.error ?? images.error, failed: images.failed };
          }
        }
        return { ...result, state: publicState(readState(userDataDir())) };
      } catch (error: any) {
        return { ok: false, error: String(error?.message ?? error), state: publicState(readState(userDataDir())) };
      }
    });
    ipcHost.handle("media-desk:chat", async (_event, postId: string, message: string) => {
      try {
        const state = readState(userDataDir());
        const post = state.posts.find((p) => p.id === String(postId ?? "")) ?? null;
        const target = await resolveModel(state.settings);
        const reply = await callModel(target, chatPrompts(post, String(message ?? "")));
        return { ok: true, reply };
      } catch (error: any) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    });

    ctx.effect(() => {
      for (const channel of CHANNELS) ipcHost.removeHandler(channel);
      setSecureHost(null);
    });
  },
});
