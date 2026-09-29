/**
 * 短剧业务层（域内私有）：分镜表的读写、展开成卡片、回写，以及**生成**。
 *
 * ⛔ 生成能力的**真实边界**（写在这里，免得 UI 上撒谎）—— 09-28 与代码逐条对齐过：
 *   · **首帧 / 定妆照 / 场景图 —— 能生成**：走 `builtin:generate-image`（OpenAI 兼容 `/images/generations`），
 *     配置在「设置 → 插件」页顶部的**生图插件**卡（userData/builtin-plugins.json 的 `image` 段）。
 *     它只收 prompt、收不了参考图 ⇒ 生成的首帧只保证「按提示词画」，**不保证角色跨镜一致**。
 *   · **配音 —— 能生成**：走本地 sherpa-onnx TTS（`voice:speak`），完全离线。
 *   · **视频 —— 能生成**（09-27 接入）：走 `video:*` 通道的 8 家内置厂商，配置在
 *     「设置 → 插件」页的**视频生成接口（内置）**卡。
 *     ⛔ 旧注释此处曾写「视频生成不了」——那是 09-27 之前的实情，接入后未同步，属**过期注释**
 *     （09-28 用户据此以为功能是假的，故留此说明）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wavBase64FromFloat32Pcm, wavDurationSeconds } from "../../lib/wav-encode.mjs";
import {
  storyboardBoardPlan,
  storyboardApplyCharacterPatch,
  storyboardApplyPatches,
  storyboardCharacterPatch,
  storyboardNormalize,
  storyboardShotPatch,
  storyboardDefault,
  type Storyboard,
} from "../../lib/drama-storyboard.mjs";
import * as store from "./drama-storage";
import type { DramaBoardApi, DramaRFNode } from "./use-drama-board";
// ⛔ 通道映射表只有一份（DramaChannelButton.tsx 的 GEN_CHANNELS）—— 批量生成与卡片按钮
//    必须用同一张表判断「这张卡能生成什么」，否则会出现「卡上有按钮但批量不跑它」。
import { CHANNEL_LABEL, GEN_CHANNELS } from "./DramaChannelButton";

export type DramaGenerationKind = "image" | "audio" | "video";

/** 批量生成范围（09-29）：selected = 只跑选中的卡（当成「重跑」）；pending = 跑全画布还没产物的卡。 */
export type DramaBatchScope = "selected" | "pending";

/** 批量生成进度（顶栏按钮据此显示「3/8 正在出图…」并可中止）。 */
export interface DramaBatchProgress {
  running: boolean;
  /** 本轮要跑的**卡数**（不是通道数 —— 用户视角的「几张卡」） */
  total: number;
  done: number;
  failed: number;
  /** 已完成的图片 / 已提交的视频（视频是异步任务，提交成功即算这一轮的完成） */
  images: number;
  videos: number;
  /** 当前动作文案（「出图 A · 生成图片」） */
  label: string;
}
const EMPTY_BATCH: DramaBatchProgress = { running: false, total: 0, done: 0, failed: 0, images: 0, videos: 0, label: "" };

/** 生成通道的就绪状态（09-28）：卡片据此**前置**提示「去配置」，而不是点了才报错。 */
export interface DramaChannelState {
  /** 生图：配了 baseUrl + apiKey + model 才算就绪 */
  image: { ready: boolean; model: string };
  /** 视频：至少一家厂商填了 API Key 才算就绪 */
  video: { ready: boolean; provider: string };
}

export interface DramaStoryApi {
  stories: store.StoryboardMeta[];
  storyName: string;
  story: Storyboard | null;
  problems: string[];
  switchStory: (name: string) => void;
  /** 改分镜表显示标题（name 引用键不动） */
  renameStory: (name: string, title: string) => void;
  /** 删分镜表（级联：本机两份状态 + 工作区文件 + 画布卡与 meta 的引用解绑） */
  deleteStory: (name: string) => Promise<void>;
  createStory: (title: string) => Promise<Storyboard>;
  saveNow: () => Promise<void>;
  expand: (boardNodeId: string, boardName: string) => Promise<{ scenes: number; shots: number; characters: number; missing: string[] } | null>;
  writeBack: (nodeId: string) => Promise<void>;
  busy: Set<string>;
  /** options.report 把单条通知改道（批量用）；options.submitOnly = 视频只提交不等待 */
  generate: (nodeId: string, what: DramaGenerationKind, options?: { report?: (text: string, tone?: "ok" | "err") => void; submitOnly?: boolean }) => Promise<void>;
  /** 批量生成（09-29）：一条命令跑完一条工作流。图片/配音真生成（层内并发），
   *  视频只**提交**（异步任务，等它跑完会把整批卡死几十分钟）。scope 见 DramaBatchScope。 */
  generateBatch: (scope: DramaBatchScope) => Promise<void>;
  /** 中止批量生成（正在跑的单个通道不打断，只不再派发下一个） */
  stopBatch: () => void;
  /** 批量进度（顶栏按钮显示「3/8」用） */
  batch: DramaBatchProgress;
  /** 整片导出：按分镜顺序把所有片段合并成一条成片，并回写分镜表的 output.video */
  exportMovie: () => Promise<void>;
  /** 正在导出成片（按钮显示「导出中…」并禁用） */
  exporting: boolean;
  /** 上传本地图片当参考图（image 卡回 path / 角色·场景回 ref / 镜头回 first_frame） */
  uploadRef: (nodeId: string) => Promise<void>;
  /** 两条生成通道的就绪状态与当前模型/厂商名（卡片上要显示，未配时按钮变「去配置」） */
  channels: DramaChannelState;
  /** 重新读一遍通道配置（用户去设置页配完回来，画布不用重开） */
  refreshChannels: () => void;
}

const STORYBOARD_SAVE_MS = 900;

export function useDramaStory(
  workspace: string,
  board: DramaBoardApi,
  onNotice: (text: string, tone?: "ok" | "err") => void,
): DramaStoryApi {
  const [stories, setStories] = useState(() => store.listStoryboards());
  const [storyName, setStoryName] = useState(() => store.listStoryboards()[0]?.name || "main");
  const [story, setStory] = useState<Storyboard | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());

  const storyRef = useRef<Storyboard | null>(null);
  const saveTimer = useRef<number | null>(null);
  storyRef.current = story;

  /* 批量生成（09-29）用的**最新节点快照**：闭包里的 board.nodes 是「启动那一刻」的，
     上一阶段刚写回的产物读不到 ⇒ 视频阶段会拿不到首帧、批量会把同一批卡重复跑。
     每次渲染同步一次（不用 useEffect，避免与生成同帧的时序差）。 */
  const nodesRef = useRef(board.nodes);
  nodesRef.current = board.nodes;
  const batchRunning = useRef(false);   // 同时只允许一批在跑
  const batchStopped = useRef(false);   // 用户中止
  const [batch, setBatch] = useState<DramaBatchProgress>(EMPTY_BATCH);
  const exportingRef = useRef(false);   // 导出成片互斥（ffmpeg 跑一次几十秒）
  const [exporting, setExporting] = useState(false);

  const notice = useCallback((text: string, tone?: "ok" | "err") => onNotice(text, tone), [onNotice]);

  /* 载入：两份取新的（工作区文件可能是引擎改的），文件赢时说一声 */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, fromFile } = await store.loadStoryboard(workspace, storyName);
      if (!alive) return;
      if (!data) { setStory(null); setProblems([]); return; }
      const norm = storyboardNormalize(data);
      setStory(norm.data);
      setProblems(norm.problems);
      if (fromFile) notice("已采用工作区里的分镜表（它比本机那份新）");
    })();
    return () => { alive = false; };
  }, [workspace, storyName, notice]);

  const persist = useCallback(async () => {
    const data = storyRef.current;
    if (!data) return;
    const { path, meta } = await store.saveStoryboard(workspace, storyName, data);
    setStories((current) => {
      const next = current.filter((s) => s.name !== meta.name);
      next.unshift(meta);
      return next;
    });
    if (!path && workspace) notice("分镜表已存到本机，但写工作区文件失败 —— 引擎那侧读不到这份", "err");
  }, [notice, storyName, workspace]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { saveTimer.current = null; void persist(); }, STORYBOARD_SAVE_MS);
  }, [persist]);

  const saveNow = useCallback(async () => {
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    await persist();
  }, [persist]);

  useEffect(() => () => {
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    void persist();
  }, [persist]);

  const mutate = useCallback((fn: (current: Storyboard) => Storyboard) => {
    const current = storyRef.current;
    if (!current) return;
    const next = fn(current);
    storyRef.current = next;
    setStory(next);
    scheduleSave();
  }, [scheduleSave]);

  const createStory = useCallback(async (title: string) => {
    const raw = String(title || "").trim() || "未命名短剧";
    const name = raw.replace(/[\\/:*?"<>|]/g, "_");
    const data = { ...storyboardDefault(raw), updatedAt: Date.now() } as Storyboard;
    storyRef.current = data;
    setStoryName(name);
    setStory(data);
    setProblems([]);
    const { meta } = await store.saveStoryboard(workspace, name, data);
    setStories((current) => [meta, ...current.filter((s) => s.name !== meta.name)]);
    return data;
  }, [workspace]);

  const switchStory = useCallback((name: string) => {
    if (!name || name === storyName) return;
    void saveNow().then(() => setStoryName(name));
  }, [saveNow, storyName]);

  /** 改分镜表显示标题（09-29 项目管理）：name（文件名/引用键）不动，只改 meta.title。
   *  ⛔ name 不能改：画布卡片 payload.board、BoardMeta.board、工作区文件名都按它引用，
   *  改名 = 全部引用一起换（高风险），本轮只支持改显示标题。 */
  const renameStory = useCallback((name: string, title: string) => {
    const clean = String(title || "").trim();
    if (!clean) return;
    const meta = store.listStoryboards().find((s) => s.name === name);
    if (!meta) return;
    setStories(store.upsertStoryboard({ ...meta, title: clean }));
  }, []);

  /** 删分镜表（09-29 项目管理）。⛔ 级联清干净 —— 「一个对象被删除时，衍生状态都要有去向」：
   *  ① 本机索引 + 本地快照（store.removeStoryboard）
   *  ② 工作区文件 `.drama-canvas/storyboards/<name>.json`（主进程窄通道，幂等）
   *  ③ **画布卡片引用**：kind=storyboard 且 payload.board===name 的卡 → 解绑（board:""，
   *     卡上会显示「（未绑定）」，用户可重选）—— 已展开的场景/镜头卡**保留**（数据在卡里，不丢）
   *  ④ 画布 meta 上挂的 board 字段（BoardMeta.board === name）→ 清掉
   *  ⑤ 删的是当前表 → 切到剩余第一张（没有就 "main"） */
  const deleteStory = useCallback(async (name: string) => {
    if (!name) return;
    setStories(store.removeStoryboard(name));
    // ③ 解绑画布卡片引用（已展开的场次/镜头卡保留 —— 它们是数据副本，不是索引）
    const bound = board.nodes.filter((n) => String(n.data?.kind || "") === "storyboard" && String(n.data?.payload?.board || "") === name);
    for (const node of bound) board.updatePayload(node.id, { board: "", style: "" });
    // ④ 清画布 meta 上的挂表记录（BoardMeta.board === name）
    board.unbindStoryboard(name);
    // ② 工作区文件（不存在时幂等返回，不抛）
    if (workspace) {
      try { await window.codex.dramaCanvasStoryboardFileRemove({ workspace, name }); }
      catch (error) { notice(`分镜表已从列表移除，但工作区文件没删掉：${error instanceof Error ? error.message : String(error)}`, "err"); }
    }
    // ⑤ 删的是当前表 → 换一张
    if (storyName === name) {
      const rest = store.listStoryboards();
      setStoryName(rest[0]?.name || "main");
    }
    board.saveNow();
    notice(`分镜表「${name}」已删除${bound.length ? `（${bound.length} 张画布卡已解绑，卡片内容保留）` : ""}`, "ok");
  }, [board, notice, storyName, workspace]);

  /**
   * 「展开场次与镜头」：读分镜表 → 铺卡片 → 顺手把这一镜的 cast 连线也接上。
   * ⛔ 走 mergeNodes（不是 replaceAll）：画布上可能有用户自己的卡，展开不该把它清掉。
   */
  const expand = useCallback(async (boardNodeId: string, boardName: string) => {
    const data = storyRef.current;
    if (!data) { notice("这张画布还没挂分镜表，先在检查器里选一份或新建", "err"); return null; }
    const plan = storyboardBoardPlan(data, boardName, { boardNodeId });
    if (!plan.nodes.length) { notice("分镜表里还没有角色和场次，展开会是空的", "err"); return null; }
    const added = board.mergeNodes(plan.nodes, plan.edges);
    board.updatePayload(boardNodeId, { board: boardName, style: data.style || "" });
    // 先排版再提示：排版自己也会弹一句，留在屏幕上的是结果
    board.autoLayout();
    if (plan.stats.missing.length) {
      notice(`展开了 ${plan.stats.scenes} 场 ${plan.stats.shots} 镜，但角色 ${plan.stats.missing.join("、")} 在 characters 里查无此人`, "err");
    } else {
      notice(`展开了 ${plan.stats.scenes} 场 ${plan.stats.shots} 镜 ${plan.stats.characters} 个角色（新增 ${added} 张卡）`, "ok");
    }
    return plan.stats;
  }, [board, notice]);

  /** 节点 → 分镜表回写。**不回就等于改了画布、引擎还照旧台词跑** —— 所以每次改完都试一次。 */
  const writeBack = useCallback(async (nodeId: string) => {
    const data = storyRef.current;
    if (!data) return;
    const node = board.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const kind = String(node.data?.kind || "");
    if (kind === "shot") {
      const r = storyboardShotPatch(node.data.payload, data);
      if (!r.ok) { notice(r.reason, "err"); return; }
      if (!r.patch) return;
      const { data: next, applied } = storyboardApplyPatches(data, [r.patch]);
      if (!applied) return;
      mutate(() => next);
      await saveNow();
    } else if (kind === "character") {
      const r = storyboardCharacterPatch(node.data.payload, data);
      if (!r.ok) { notice(r.reason, "err"); return; }
      if (!r.patch) return;
      const { data: next, applied } = storyboardApplyCharacterPatch(data, r.patch);
      if (!applied) return;
      mutate(() => next);
      await saveNow();
    }
  }, [board.nodes, mutate, notice, saveNow]);

  /* --------------------------------------------------------------- 生成 */

  const mark = useCallback((key: string, on: boolean) => {
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(key); else next.delete(key);
      return next;
    });
  }, []);

  /** 读内置生图插件的配置。没配 ⇒ 回 null，由调用方给出「去哪儿配」的指引。 */
  const imageConfig = useCallback(async () => {
    const cfg: any = await window.codex.readBuiltinPlugins().catch(() => null);
    const c = cfg?.image;
    if (!c?.baseUrl || !c?.apiKey || !c?.model) return null;
    return c as { baseUrl: string; apiKey: string; model: string };
  }, []);

  /* ── 两条生成通道的就绪状态（09-28） ──────────────────────────────────
     卡片上要**前置**显示「生图 · 模型名 / 视频 · 厂商名」，没配就直接是「去配置」按钮 ——
     原来是点了才弹 notice 报错，用户根本不知道这功能需要先配东西（截图里的困惑来源）。
     读一次缓存住；用户去设置页配完回来点「刷新」或重开画布即可更新（不轮询，省 IPC）。 */
  const [channels, setChannels] = useState<DramaChannelState>({ image: { ready: false, model: "" }, video: { ready: false, provider: "" } });
  const refreshChannels = useCallback(() => {
    void (async () => {
      const img = await imageConfig().catch(() => null);
      const providers = (await window.codex.videoProviders?.().catch(() => [])) as Array<any> | undefined;
      const configured = (providers ?? []).filter((p) => p?.configured);
      setChannels({
        image: { ready: Boolean(img), model: String(img?.model ?? "") },
        video: { ready: configured.length > 0, provider: String(configured[0]?.name ?? "") },
      });
    })();
  }, [imageConfig]);
  useEffect(() => { refreshChannels(); }, [refreshChannels]);

  /** 沿**入边**收集上游卡片的提示词（prompt/text）—— 连线「这份输入喂给下一步」的兑现（09-28）。
   *  起手工作流里出图 A/B 连着主提示词卡，此前生成只用自己的占位 prompt，主提示词从未参与。
   *  多个上游按连线顺序拼接；去重；截 800 字防提示词爆长。 */
  const upstreamPrompts = useCallback((targetId: string): string => {
    const byId = new Map(board.nodes.map((n) => [n.id, n] as const));
    const texts: string[] = [];
    for (const edge of board.edges) {
      if (String(edge.target || "") !== targetId) continue;
      const src = byId.get(String(edge.source || ""));
      if (!src) continue;
      const p = (src.data?.payload || {}) as Record<string, any>;
      const text = String(p.prompt || p.text || "").trim();
      if (text && !texts.includes(text)) texts.push(text);
    }
    return texts.join("；").slice(0, 800);
  }, [board.nodes, board.edges]);

  /** 上传参考图（09-28 用户：「参考图没有上传功能」）：系统选图 → 落工作区 uploads/ → 回填卡片。
   *  image 卡回 path（可直接当视频首帧）、角色/场景回 ref、镜头回 first_frame。 */
  const uploadRef = useCallback(async (nodeId: string): Promise<void> => {
    const node = board.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const kind = String(node.data?.kind || "");
    if (!workspace) { notice("上传参考图要落盘到工作区，请先为会话选择工作文件夹", "err"); return; }
    const picked = await window.codex.chooseImages().catch(() => [] as string[]);
    if (!picked?.length) return;
    for (const srcPath of picked) {
      try {
        const data = await window.codex.readFile(srcPath);
        const base64 = String(data?.dataBase64 || "");
        if (!base64) { notice(`读不到文件：${srcPath}`, "err"); continue; }
        const written = await window.codex.dramaCanvasAssetWrite({ workspace, name: srcPath.split(/[\\/]/).pop() || "ref.png", base64, subdir: "uploads" });
        const path = String(written?.path || "");
        if (!path) continue;
        if (kind === "shot") board.updatePayload(nodeId, { first_frame: path });
        else if (kind === "character" || kind === "location") board.updatePayload(nodeId, { ref: path });
        else board.updatePayload(nodeId, { path, url: path, title: node.data.payload?.title || "参考图" });
        board.saveNow();
        notice(written?.fallback
          ? `参考图已暂存到应用数据目录：${path.split(/[\\/]/).pop()}（当前画布未绑定会话工作区；想存进工作区就先为会话选工作文件夹）`
          : `参考图已导入：${path.split(/[\\/]/).pop()}`, "ok");
      } catch (error) {
        notice(`导入失败：${error instanceof Error ? error.message : String(error)}`, "err");
      }
    }
  }, [board.nodes, board.updatePayload, workspace, notice]);

  /** 生成一张卡的一个通道。
   *  `report` 供批量调用：把单条通知改道到批量自己的收集器（一批 20 个动作会刷屏；
   *  批量只需要知道**哪些失败了**，然后汇总报一次）。
   *  `submitOnly` 供批量调用：视频只**提交**不等结果 —— 等一个视频跑完要几分钟，
   *  批量十个镜头就是几十分钟，会把「一键生成」变成「一键等待」。提交后 jobId 已记在卡上，
   *  用户/模型可随时续查（续查能力见下方 video 分支的 pendingJob 逻辑）。 */
  const generate = useCallback(async (
    nodeId: string,
    what: DramaGenerationKind,
    options: { report?: (text: string, tone?: "ok" | "err") => void; submitOnly?: boolean } = {},
  ) => {
    // ⛔ 读 nodesRef（最新快照）而不是闭包里的 board.nodes：批量分两阶段跑，
    //    视频阶段必须看到上一阶段刚写回的图（首帧），否则整条 i2v 链路拿不到输入。
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    const kind = String(node.data?.kind || "");
    const payload = node.data.payload || {};
    const key = `${nodeId}:${what}`;
    if (busy.has(key)) return;
    const say = options.report ?? notice;

    if (what === "video") {
      // 09-27 视频生成接入：内置接口（video:* 通道，国内外 8 家厂商）。
      // 闭环 = 选厂商 → 提交 → 5s 轮询 → 产物落 <workspace>/.drama-canvas/assets/video → 回写卡片。
      const providers = (await window.codex.videoProviders?.().catch(() => [])) as Array<any> | undefined;
      const list = providers ?? [];
      const configured = list.filter((p) => p.configured);
      if (!configured.length) {
        say("还没有配置任何视频生成接口 —— 到「设置 → 插件市场」顶部「视频生成接口（内置）」填 API Key", "err");
        return;
      }
      const providerId = String(payload.video_provider || "") || configured[0].id;
      const provider = list.find((p) => p.id === providerId);
      if (!provider) { say(`厂商 ${providerId} 不存在`, "err"); return; }
      if (!provider.configured) { say(`${provider.name} 还没填 API Key（插件市场 → 视频生成接口（内置））`, "err"); return; }
      // ⛔ 09-28 闭环打磨：出图卡（kind=image）生图产物落在 payload.path（不是 first_frame）——
      //    此前只认 first_frame ⇒ 出图卡点「视频 · 生成」白扔已出的图、退回 t2v。
      //    现在：image 卡的 path 同样算「已有首帧」（上游联动见 upstreamPrompts）。
      const firstFrame = String(payload.first_frame || (kind === "image" ? payload.path || "" : "")).trim();
      const mode = firstFrame ? "i2v" : "t2v";
      const promptBase = String(payload.prompt || payload.motion || payload.description || "").trim();
      if (!promptBase) { say("这一镜没有提示词（prompt/motion 都为空），没法生成视频", "err"); return; }
      if (mode === "i2v" && provider.imageInput === "url" && !/^https?:\/\//i.test(firstFrame)) {
        say(`${provider.name} 图生视频只吃公网图片 URL —— 本地首帧请改用可灵 / 智谱 / MiniMax / Runway / Veo（或选 t2v）`, "err");
        return;
      }
      mark(key, true);
      try {
        const style = String(storyRef.current?.style || "").trim();
        const prompt = style ? `${style}。${promptBase}` : promptBase;
        const name = `${String(payload.id || nodeId.replace(/[^\w-]/g, "")).slice(0, 40)}_视频.mp4`;

        /** 轮询到终态：自适应间隔（前 60s 每 3s 快查，之后每 8s）；10 分钟还没好就交还给用户续查。 */
        const waitForVideo = async (jobId: string, pollProvider: string): Promise<{ url?: string } | "timeout"> => {
          const startedAt = Date.now();
          const deadline = startedAt + 10 * 60_000;
          for (;;) {
            if (Date.now() > deadline) return "timeout";
            await new Promise((r) => setTimeout(r, Date.now() - startedAt < 60_000 ? 3000 : 8000));
            const status = await window.codex.videoPoll({ providerId: pollProvider, jobId });
            if (status.status === "succeeded") return { url: String(status.url || "") };
            if (status.status === "failed") throw new Error(String(status.error || "视频生成失败"));
          }
        };
        /** 产物落盘 → 回填卡片 → 清掉未完成任务标记 */
        const finishVideo = async (url: string) => {
          if (!url) throw new Error("任务成功但没有返回视频地址");
          if (!workspace) {
            board.updatePayload(nodeId, { video: url, video_job: "", video_job_provider: "" });
            board.saveNow();
            say("视频已生成（未选工作区，只写 URL 进卡片）", "ok");
            return;
          }
          const written = await window.codex.videoDownload({ url, workspace, name, subdir: "video" });
          const savedPath = String(written?.path || url);
          board.updatePayload(nodeId, { video: savedPath, video_job: "", video_job_provider: "" });
          board.saveNow();
          void writeBack(nodeId);
          say(`视频已生成并落盘：${savedPath.split(/[\\/]/).pop()}（${((written?.bytes || 0) / 1048576).toFixed(1)} MB）`, "ok");
        };

        // ⛔ 09-29 续查优先：卡片上留着未完成任务（上次超时没等完 / 重启前提交的）⇒ **先查它**，
        //    不重复提交 —— 重复提交 = 白花一次钱、同一张卡出两版视频。
        //    任务记录同时由主进程落盘（userData/video-jobs.json），会话里的 MCP 工具也能查同一个。
        const pendingJob = String(payload.video_job || "").trim();
        const pendingProvider = String(payload.video_job_provider || payload.video_provider || "").trim();
        if (pendingJob && pendingProvider) {
          say(`继续等待上一次提交的任务 …${pendingJob.slice(-8)}（不重复提交）`, "ok");
          const outcome = await waitForVideo(pendingJob, pendingProvider);
          if (outcome === "timeout") {
            say(`任务 …${pendingJob.slice(-8)} 还在跑 —— 稍后再点一次「视频 · 生成」即可继续等待，任务不会丢`, "err");
            return;
          }
          await finishVideo(outcome.url || "");
          return;
        }

        const submitted = await window.codex.videoSubmit({
          providerId,
          mode,
          prompt,
          image: mode === "i2v" ? firstFrame : undefined,
          model: String(payload.video_model || "") || provider.defaultModel,
          duration: Number(payload.duration) || 5,
          // 画幅：卡片上选了才传。⛔ 不支持画幅的厂商由适配层**当场报错**（不静默按默认出片）
          aspect: String(payload.aspect || "").trim() || undefined,
        });
        // 提交即记进卡片（主进程另有一份落盘）：超时 / 关画布 / 重启后都能续查
        board.updatePayload(nodeId, { video_job: submitted.jobId, video_job_provider: providerId });
        board.saveNow();
        if (options.submitOnly) {
          // 批量模式：提交即返回（任务已记在卡上 + 主进程落盘，随时可续查）
          say(`${provider.name} 已提交（任务 …${String(submitted.jobId).slice(-8)}）`, "ok");
          return;
        }
        say(`${provider.name} 已提交（任务 …${String(submitted.jobId).slice(-8)}）—— 前 1 分钟每 3 秒查一次，之后每 8 秒`, "ok");
        const outcome = await waitForVideo(submitted.jobId, providerId);
        if (outcome === "timeout") {
          say(`任务 …${String(submitted.jobId).slice(-8)} 已跑 10 分钟还没好 —— 稍后再点一次「视频 · 生成」继续等待（不会重复提交）`, "err");
          return;
        }
        await finishVideo(outcome.url || "");
      } finally {
        mark(key, false);
      }
      return;
    }

    mark(key, true);
    try {
      if (what === "image") {
        const cfg = await imageConfig();
        if (!cfg) {
          say("生图插件未配置：到「设置 → 插件 → 内置插件」填写 API 地址、密钥与模型", "err");
          return;
        }
        const style = String(storyRef.current?.style || "").trim();
        let base = String(payload.prompt || payload.description || payload.look || "").trim();
        // ⛔ 09-28 工作流打磨：自身提示词为空时**自动沿用连入的上游提示词**（此前直接报错
        //    「先写上再生成」—— 出图 A/B 这类下游卡被迫先抄一遍主提示词，流程断在这里）。
        //    模板的 payload 也已不预填引导文本（避免污染真实提示词）。
        const upstream = upstreamPrompts(nodeId);
        if (!base && upstream) base = upstream;
        if (!base) { say("这张卡还没有提示词 —— 写一句，或从上游卡片连线自动带入", "err"); return; }
        // 全片统一风格摆在提示词最前面 —— 否则镜与镜之间画风会飘
        let prompt = style ? `${style}。${base}` : base;
        // 连线「喂给下一步」：上游提示词拼在最前，自身变体词在后（自身为空时上面已沿用）
        if (upstream && base !== upstream) prompt = `${upstream}。${prompt}`;
        const variant = String(payload.variant || "").trim();
        if (variant && !base.includes(variant)) prompt = `${prompt}（变体：${variant}）`;
        const result = await window.codex.generateImage({
          baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, prompt,
          // 尺寸与负面提示词：卡片上设了才传（不同网关接受度不同，默认不带 = 旧行为）
          size: String(payload.size || "").trim() || undefined,
          negative: String(payload.negative || "").trim() || undefined,
        });
        const path = String(result?.path || "");
        if (!path) { say("生成回来了，但没有落盘路径，这张卡没更新", "err"); return; }
        if (kind === "shot") board.updatePayload(nodeId, { first_frame: path });
        else if (kind === "character") board.updatePayload(nodeId, { ref: path });
        else if (kind === "location") board.updatePayload(nodeId, { ref: path });
        else board.updatePayload(nodeId, { path, url: path, title: payload.title || "参考图" });
        board.saveNow();
        void writeBack(nodeId);
        // 下一步指引（09-28 工作流打磨）：出图卡告知可直接转视频，镜头卡告知可继续出视频/配音
        const next = kind === "image"
          ? "—— 可点「视频 · 生成」让这张图动起来"
          : kind === "shot"
            ? "—— 可继续「视频 · 生成」或「配音 · 生成」"
            : "";
        say(`已生成并落盘：${path.split(/[\\/]/).pop()}${next}`, "ok");
        return;
      }

      // what === "audio"
      const line = String(payload.line || payload.text || "").trim();
      if (!line) { say("这一镜没有台词（line 为空），没有可合成的配音", "err"); return; }
      if (!workspace) { say("配音要落盘到工作区，请先为会话选择工作文件夹", "err"); return; }
      const spoken = await window.codex.voiceSpeak(line);
      if (!spoken?.ok || !spoken.audioBase64 || !spoken.sampleRate) {
        say(`配音失败：${spoken?.error || "本地语音模型未就绪（到「设置 → 语音」下载模型后重试）"}`, "err");
        return;
      }
      const wav = wavBase64FromFloat32Pcm(spoken.audioBase64, spoken.sampleRate);
      if (!wav) { say("配音合成结果为空，没有落盘", "err"); return; }
      const name = `${String(payload.id || nodeId.replace(/[^\w-]/g, "")).slice(0, 40)}_配音.wav`;
      const written = await window.codex.dramaCanvasAssetWrite({ workspace, name, base64: wav, subdir: "audio" });
      const path = String(written?.path || "");
      if (!path) { say("配音写盘失败", "err"); return; }
      const seconds = wavDurationSeconds(wav);
      const patch = kind === "shot" ? { audio: path, duration: seconds || payload.duration } : { path, url: path };
      board.updatePayload(nodeId, patch);
      board.saveNow();
      void writeBack(nodeId);
      say(`配音已生成：${name}（${seconds}s）`, "ok");
    } catch (error) {
      say(`生成失败：${String((error as Error)?.message || error).slice(0, 140)}`, "err");
    } finally {
      mark(key, false);
    }
  }, [board, busy, imageConfig, mark, notice, upstreamPrompts, workspace, writeBack]);

  /* ------------------------------------------------------- 批量生成（09-29） */

  /** 一张卡某个通道是否已有产物（pending 模式据此跳过）。字段口径与上面 generate 的写回分支**一一对应**：
   *  镜头 → first_frame、角色 / 场景 → ref、出图卡 → path、配音卡 → path、视频 → video。
   *  ⛔ 口径不一致的后果是静默的：写回存在 A 键、这里查 B 键 ⇒ 批量永远认为「没生成过」，
   *  每次都重跑一遍（白花钱）。改 generate 的写回时**同时**改这里。 */
  const batchHasOutput = useCallback((node: DramaRFNode, what: DramaGenerationKind): boolean => {
    const p = (node.data?.payload || {}) as Record<string, any>;
    const kind = String(node.data?.kind || "");
    const filled = (...values: unknown[]) => values.some((v) => String(v || "").trim().length > 0);
    if (what === "video") return filled(p.video);
    if (what === "audio") return filled(p.audio, kind === "audio" ? p.path : "");
    if (kind === "shot") return filled(p.first_frame);
    if (kind === "character" || kind === "location") return filled(p.ref);
    return filled(p.path, p.image, p.url);
  }, []);

  const stopBatch = useCallback(() => { batchStopped.current = true; }, []);

  /**
   * 批量一键生成（09-29 用户：「批量一键生成…完善一下」）。
   *
   * 口径（为什么这么排）：
   *  ① **两阶段**：先把所有图片/配音真生成，再提交视频。视频要用刚生成的图当首帧，
   *     混在一层跑会拿到空首帧（i2v 退化成 t2v，用户以为「我的图没被用上」）。
   *  ② 图片/配音**并发 3**：生图是网络等待型，串行跑二十张图纯属浪费时间；3 是稳妥值。
   *  ③ 视频**串行 + 只提交**：同时打多家厂商容易撞限流；等待则会把「一键」变成几十分钟的等待。
   *  ④ 失败不中断整批：单张卡失败（没配模型、提示词为空、厂商报错）继续跑后面的 ——
   *     批量最怕「第一个失败就全停」，用户还得一个个排查。
   */
  const generateBatch = useCallback(async (scope: DramaBatchScope) => {
    if (batchRunning.current) { notice("上一批还在跑 —— 等它结束，或点「中止」", "err"); return; }
    const nodes = nodesRef.current;
    type BatchTask = { id: string; what: DramaGenerationKind; title: string };
    const firstStage: BatchTask[] = [];   // 图片 / 配音：真生成，池内并发
    const videoStage: BatchTask[] = [];   // 视频：只提交（排在图片之后）
    for (const node of nodes) {
      const kind = String(node.data?.kind || "");
      const allowed = GEN_CHANNELS[kind] || [];
      if (!allowed.length) continue;                       // 策划类卡（笔记/剧本）不参与生成
      if (scope === "selected" && !node.selected) continue;
      const title = String(node.data?.payload?.title || node.data?.payload?.name || node.id);
      for (const what of allowed) {
        // pending = 「画布上还没生成过的」；selected = 「就这几张，重跑」⇒ 不跳过已有产物
        if (scope === "pending" && batchHasOutput(node, what)) continue;
        (what === "video" ? videoStage : firstStage).push({ id: node.id, what, title });
      }
    }
    const queued = firstStage.length + videoStage.length;
    if (!queued) {
      notice(
        scope === "selected"
          ? "选中的卡片没有可生成的通道（笔记 / 剧本这类策划卡不参与生成）"
          : "画布上已经没有待生成的卡片了",
        scope === "selected" ? "err" : "ok",
      );
      return;
    }

    batchRunning.current = true;
    batchStopped.current = false;
    let done = 0, failed = 0, images = 0, videos = 0;
    const reasons: string[] = [];
    // 批量收集器：成功静默（否则二十条 toast 刷屏），失败**逐条留证**（最多留 3 条给用户看）
    const report = (text: string, tone?: "ok" | "err") => {
      if (tone !== "err") return;
      failed++;
      if (reasons.length < 3) reasons.push(text);
    };
    setBatch({ running: true, total: queued, done: 0, failed: 0, images: 0, videos: 0, label: "准备中…" });
    // ⛔⛔ 09-29 用户：「我没有生成啊，怎么显示生成中」—— 批量此前是**静默开始**的
    //    （只在结束时汇总一次）。用户既不知道它开始了、也不知道去哪儿停 ⇒ 开始就报一次，
    //    并明确说清停止入口。这类"后台悄悄启动的花钱动作"必须自己出声。
    notice(
      `开始批量生成：${queued} 个动作（图片/配音真生成，视频只提交任务）—— 顶栏那颗转圈按钮点一下就停`,
      "ok",
    );

    /** 跑一个动作并推进进度。`submitOnly` 的动作（视频）提交成功即算这一轮完成。 */
    const runOne = async (task: BatchTask, submitOnly = false) => {
      setBatch((prev) => ({ ...prev, label: `${task.title} · ${CHANNEL_LABEL[task.what]}` }));
      const failedBefore = failed;
      await generate(task.id, task.what, { report, submitOnly });
      if (failed === failedBefore) { if (submitOnly) videos++; else images++; }
      done++;
      setBatch((prev) => ({ ...prev, done, failed, images, videos }));
    };

    // ① 图片 / 配音：并发池
    const pool = Math.min(3, firstStage.length);
    let cursor = 0;
    const worker = async () => {
      while (!batchStopped.current) {
        const task = firstStage[cursor++];
        if (!task) return;
        await runOne(task);
      }
    };
    if (pool > 0) await Promise.all(Array.from({ length: pool }, worker));

    // ② 视频：串行提交（不等待结果 —— jobId 已记在卡上，可随时续查）
    for (const task of videoStage) {
      if (batchStopped.current) break;
      await runOne(task, true);
    }

    const stopped = batchStopped.current;
    batchRunning.current = false;
    setBatch({ running: false, total: queued, done, failed, images, videos, label: "" });
    const left = queued - done;
    notice(
      `批量生成${stopped ? "已中止" : "完成"}：图片/配音 ${images} 个`
        + `${videos ? `、视频已提交 ${videos} 个（跑完可在卡片上点一次「视频 · 生成」收取）` : ""}`
        + `${failed ? `，失败 ${failed} 个` : ""}`
        + `${stopped && left > 0 ? `（还剩 ${left} 个未跑）` : ""}`,
      failed ? "err" : "ok",
    );
    if (reasons.length) notice(`失败原因：${reasons.join("；")}`, "err");
  }, [batchHasOutput, generate, notice]);

  /* ------------------------------------------------------- 整片导出（09-29） */

  /**
   * 把各镜片段合并成一条成片（用户：「整片合并导出…完善一下」）。
   *
   * 顺序的**唯一定义**：分镜表的 场次 → 镜头 顺序（它本就是唯一真源）。
   * 表里没覆盖到的散卡按**画布位置**补在末尾（先上后下、先左后右）——
   * 否则「没有分镜表的板」就完全导不出东西。
   *
   * 产物落 `<工作区>/.drama-canvas/export/<分镜表标题>_成片.mp4`，并回写分镜表的
   * `output.video` / `output.duration`（这个落点从设计起就留着，此前一直是空的）。
   */
  const exportMovie = useCallback(async (): Promise<void> => {
    if (exportingRef.current) { notice("正在导出成片，稍等它跑完", "err"); return; }
    if (!workspace) { notice("导出成片要落盘到工作区，请先为会话选择工作文件夹", "err"); return; }
    const nodes = nodesRef.current;
    const data = storyRef.current;
    const picked: Array<{ path: string; seconds: number }> = [];
    const seen = new Set<string>();
    const pushShot = (node: DramaRFNode | undefined, shotId: string, fromTable: string, seconds: number) => {
      // 卡片 payload 是**渲染层实时值**，分镜表里的 video 是回写后的副本 —— 两者取先有的
      const path = String(node?.data?.payload?.video || fromTable || "").trim();
      if (!path || seen.has(path)) return;
      seen.add(path);
      picked.push({ path, seconds: Number.isFinite(seconds) ? seconds : 0 });
    };

    const shotNodeById = new Map<string, DramaRFNode>();
    for (const node of nodes) {
      if (String(node.data?.kind || "") !== "shot") continue;
      shotNodeById.set(String(node.data?.payload?.id || ""), node);
    }
    // ① 分镜表顺序（唯一真源）
    let tableShots = 0;
    if (data) {
      for (const scene of data.scenes || []) {
        for (const shot of scene.shots || []) {
          tableShots++;
          const shotId = String(shot.id || "");
          pushShot(shotNodeById.get(shotId), shotId, String(shot.video || ""), Number(shot.duration));
          shotNodeById.delete(shotId);   // 收过的从「画布补收」里排除，避免重复
        }
      }
    }
    // ② 表外的散卡（没建分镜表 / 表里没写的镜头）：按画布位置排序
    const rest = [...shotNodeById.values()].sort(
      (a, b) => ((a as any).position?.y ?? 0) - ((b as any).position?.y ?? 0)
        || ((a as any).position?.x ?? 0) - ((b as any).position?.x ?? 0),
    );
    for (const node of rest) pushShot(node, "", "", Number(node.data?.payload?.duration));

    if (!picked.length) {
      notice("还没有可合并的视频片段 —— 先给镜头生成视频（顶栏「批量生成」可以一键跑完）", "err");
      return;
    }
    const missing = Math.max(0, tableShots - picked.length);

    // 画布尺寸按分镜表的画幅（成片要统一，否则播放器会一条竖一条横）
    const aspect = String(data?.aspect || "9:16");
    const [width, height] = aspect === "16:9" ? [1280, 720] : aspect === "1:1" ? [720, 720] : [720, 1280];
    const fps = Number(data?.fps) || 24;
    const title = String(data?.title || storyName || "成片");

    exportingRef.current = true;
    setExporting(true);
    try {
      const result = await window.codex.videoConcat({
        workspace,
        name: `${title}_成片`,
        files: picked.map((item) => item.path),
        width, height, fps,
      });
      const path = String(result?.path || "");
      const seconds = picked.reduce((sum, item) => sum + (item.seconds || 0), 0);
      // 回写分镜表的成片落点（output.video / duration）
      if (data && path) {
        mutate(() => ({
          ...data,
          output: { ...(data.output || {}), video: path, duration: seconds > 0 ? Math.round(seconds * 10) / 10 : data.output?.duration },
        }));
        await saveNow();
      }
      const sizeMb = ((result?.bytes || 0) / 1048576).toFixed(1);
      notice(
        `成片已导出：${path.split(/[\\/]/).pop()}（${result?.parts ?? picked.length} 段 · ${sizeMb}MB · `
          + `${result?.mode === "copy" ? "无损拼接" : "统一重编码到 " + width + "×" + height}）`
          + `${missing ? ` —— 有 ${missing} 个镜头还没视频，已跳过` : ""}`,
        "ok",
      );
    } catch (error) {
      notice(`导出成片失败：${error instanceof Error ? error.message : String(error)}`, "err");
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [mutate, notice, saveNow, storyName, workspace]);

  return useMemo<DramaStoryApi>(() => ({
    stories,
    storyName,
    story,
    problems,
    switchStory,
    renameStory,
    deleteStory,
    createStory,
    saveNow,
    expand,
    writeBack,
    busy,
    generate,
    generateBatch,
    stopBatch,
    batch,
    exportMovie,
    exporting,
    uploadRef,
    channels,
    refreshChannels,
  }), [stories, storyName, story, problems, switchStory, renameStory, deleteStory, createStory, saveNow, expand, writeBack, busy, generate, generateBatch, stopBatch, batch, exportMovie, exporting, uploadRef, channels, refreshChannels]);
}
