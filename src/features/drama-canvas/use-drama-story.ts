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
import type { DramaBoardApi } from "./use-drama-board";

export type DramaGenerationKind = "image" | "audio" | "video";

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
  createStory: (title: string) => Promise<Storyboard>;
  saveNow: () => Promise<void>;
  expand: (boardNodeId: string, boardName: string) => Promise<{ scenes: number; shots: number; characters: number; missing: string[] } | null>;
  writeBack: (nodeId: string) => Promise<void>;
  busy: Set<string>;
  generate: (nodeId: string, what: DramaGenerationKind) => Promise<void>;
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

  const generate = useCallback(async (nodeId: string, what: DramaGenerationKind) => {
    const node = board.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const kind = String(node.data?.kind || "");
    const payload = node.data.payload || {};
    const key = `${nodeId}:${what}`;
    if (busy.has(key)) return;

    if (what === "video") {
      // 09-27 视频生成接入：内置接口（video:* 通道，国内外 8 家厂商）。
      // 闭环 = 选厂商 → 提交 → 5s 轮询 → 产物落 <workspace>/.drama-canvas/assets/video → 回写卡片。
      const providers = (await window.codex.videoProviders?.().catch(() => [])) as Array<any> | undefined;
      const list = providers ?? [];
      const configured = list.filter((p) => p.configured);
      if (!configured.length) {
        notice("还没有配置任何视频生成接口 —— 到「设置 → 插件市场」顶部「视频生成接口（内置）」填 API Key", "err");
        return;
      }
      const providerId = String(payload.video_provider || "") || configured[0].id;
      const provider = list.find((p) => p.id === providerId);
      if (!provider) { notice(`厂商 ${providerId} 不存在`, "err"); return; }
      if (!provider.configured) { notice(`${provider.name} 还没填 API Key（插件市场 → 视频生成接口（内置））`, "err"); return; }
      const mode = payload.first_frame ? "i2v" : "t2v";
      const promptBase = String(payload.prompt || payload.motion || payload.description || "").trim();
      if (!promptBase) { notice("这一镜没有提示词（prompt/motion 都为空），没法生成视频", "err"); return; }
      if (mode === "i2v" && provider.imageInput === "url" && !/^https?:\/\//i.test(String(payload.first_frame))) {
        notice(`${provider.name} 图生视频只吃公网图片 URL —— 本地首帧请改用可灵 / 智谱 / MiniMax / Runway / Veo（或选 t2v）`, "err");
        return;
      }
      mark(key, true);
      try {
        const style = String(storyRef.current?.style || "").trim();
        const prompt = style ? `${style}。${promptBase}` : promptBase;
        const submitted = await window.codex.videoSubmit({
          providerId,
          mode,
          prompt,
          image: mode === "i2v" ? String(payload.first_frame) : undefined,
          model: String(payload.video_model || "") || provider.defaultModel,
          duration: Number(payload.duration) || 5,
        });
        notice(`${provider.name} 已提交（任务 …${String(submitted.jobId).slice(-8)}），每 5 秒查询一次，最长等 10 分钟`, "ok");
        const deadline = Date.now() + 10 * 60_000;
        let url = "";
        for (;;) {
          if (Date.now() > deadline) throw new Error("查询超时（10 分钟）—— 任务可能仍在跑，稍后重试即可");
          await new Promise((r) => setTimeout(r, 5000));
          const status = await window.codex.videoPoll({ providerId, jobId: submitted.jobId });
          if (status.status === "succeeded") { url = String(status.url || ""); break; }
          if (status.status === "failed") throw new Error(String(status.error || "视频生成失败"));
        }
        if (!url) throw new Error("任务成功但没有返回视频地址");
        if (!workspace) {
          board.updatePayload(nodeId, { video: url });
          board.saveNow();
          notice("视频已生成（未选工作区，只写 URL 进卡片）", "ok");
          return;
        }
        const name = `${String(payload.id || nodeId.replace(/[^\w-]/g, "")).slice(0, 40)}_视频.mp4`;
        const written = await window.codex.videoDownload({ url, workspace, name, subdir: "video" });
        const savedPath = String(written?.path || url);
        board.updatePayload(nodeId, { video: savedPath });
        board.saveNow();
        void writeBack(nodeId);
        notice(`视频已生成并落盘：${savedPath.split(/[\\/]/).pop()}（${((written?.bytes || 0) / 1048576).toFixed(1)} MB）`, "ok");
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
          notice("生图插件未配置：到「设置 → 插件 → 内置插件」填写 API 地址、密钥与模型", "err");
          return;
        }
        const style = String(storyRef.current?.style || "").trim();
        const base = String(payload.prompt || payload.description || payload.look || "").trim();
        if (!base) { notice("这张卡还没有提示词，先写上再生成", "err"); return; }
        // 全片统一风格摆在提示词最前面 —— 否则镜与镜之间画风会飘
        const prompt = style ? `${style}。${base}` : base;
        const result = await window.codex.generateImage({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, prompt });
        const path = String(result?.path || "");
        if (!path) { notice("生成回来了，但没有落盘路径，这张卡没更新", "err"); return; }
        if (kind === "shot") board.updatePayload(nodeId, { first_frame: path });
        else if (kind === "character") board.updatePayload(nodeId, { ref: path });
        else if (kind === "location") board.updatePayload(nodeId, { ref: path });
        else board.updatePayload(nodeId, { path, url: path, title: payload.title || "参考图" });
        board.saveNow();
        void writeBack(nodeId);
        notice(`已生成并落盘：${path.split(/[\\/]/).pop()}`, "ok");
        return;
      }

      // what === "audio"
      const line = String(payload.line || payload.text || "").trim();
      if (!line) { notice("这一镜没有台词（line 为空），没有可合成的配音", "err"); return; }
      if (!workspace) { notice("配音要落盘到工作区，请先为会话选择工作文件夹", "err"); return; }
      const spoken = await window.codex.voiceSpeak(line);
      if (!spoken?.ok || !spoken.audioBase64 || !spoken.sampleRate) {
        notice(`配音失败：${spoken?.error || "本地语音模型未就绪（到「设置 → 语音」下载模型后重试）"}`, "err");
        return;
      }
      const wav = wavBase64FromFloat32Pcm(spoken.audioBase64, spoken.sampleRate);
      if (!wav) { notice("配音合成结果为空，没有落盘", "err"); return; }
      const name = `${String(payload.id || nodeId.replace(/[^\w-]/g, "")).slice(0, 40)}_配音.wav`;
      const written = await window.codex.dramaCanvasAssetWrite({ workspace, name, base64: wav, subdir: "audio" });
      const path = String(written?.path || "");
      if (!path) { notice("配音写盘失败", "err"); return; }
      const seconds = wavDurationSeconds(wav);
      const patch = kind === "shot" ? { audio: path, duration: seconds || payload.duration } : { path, url: path };
      board.updatePayload(nodeId, patch);
      board.saveNow();
      void writeBack(nodeId);
      notice(`配音已生成：${name}（${seconds}s）`, "ok");
    } catch (error) {
      notice(`生成失败：${String((error as Error)?.message || error).slice(0, 140)}`, "err");
    } finally {
      mark(key, false);
    }
  }, [board, busy, imageConfig, mark, notice, workspace, writeBack]);

  return useMemo<DramaStoryApi>(() => ({
    stories,
    storyName,
    story,
    problems,
    switchStory,
    createStory,
    saveNow,
    expand,
    writeBack,
    busy,
    generate,
    channels,
    refreshChannels,
  }), [stories, storyName, story, problems, switchStory, createStory, saveNow, expand, writeBack, busy, generate, channels, refreshChannels]);
}
