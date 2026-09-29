/**
 * video-providers —— 视频生成接口的**纯适配层**（无副作用，可被守卫真跑）。
 *
 * 覆盖：国内 5 家（可灵 / 通义万相 / 即梦Seedance〔1.0 文本参数协议 + 2.0/2.5 body 参数协议与视频参考〕/ 智谱CogVideoX / MiniMax海螺）
 *      国外 3 家（Runway / Luma / Google Veo）。
 * 每家四个纯函数语义：buildSubmit（组装提交请求）→ parseSubmit（拿 jobId）→
 * buildPoll（组装查询请求）→ parsePoll（归一成 queued/running/succeeded/failed + 产物 url）。
 *
 * ⛔ 接口端点/字段以各厂商官方文档为准（2026-09 快照）；全部**异步任务制**（提交拿 id → 轮询）。
 * ⛔ imageInput 三种：base64（本地首帧直接可用）/ url（必须可公网访问）/ both。
 *    本地文件 + url-only 厂商 ⇒ 上层必须给出明确报错，不许静默失败。
 * 确定性：klingToken 接收 nowMs 参数（JWT 里不能有隐藏的 Date.now，守卫要能真跑真值表）。
 */
import { createHmac } from "node:crypto";
import { VIDEO_ASPECTS } from "./media-aspects.mjs";

/** 所有厂商通用的**可选覆盖**字段（09-28 用户要求「API 地址和模型要能自己填」）：
 *  · baseUrl —— 中转站/代理地址（留空用官方）：只换 origin+前缀，路径不变
 *  · model   —— 覆盖内置模型清单（留空用 defaultModel）
 *  ⛔ 与 fields（必填凭证）分开：hasCredentials 只看 fields，可选字段不参与「已配置」判定。 */
export const VIDEO_OPTIONAL_FIELDS = ["baseUrl", "model"];

/** 厂商清单（渲染层下拉 / 设置表单都吃这一份）。 */
export const VIDEO_PROVIDERS = [
  { id: "kling", name: "可灵 Kling（快手）", region: "cn", modes: ["t2v", "i2v"], imageInput: "both", baseUrl: "https://api.klingai.com", fields: ["accessKey", "secretKey"], models: ["kling-v1", "kling-v1-6"], defaultModel: "kling-v1" },
  { id: "wanx", name: "通义万相（阿里百炼）", region: "cn", modes: ["t2v", "i2v"], imageInput: "url", baseUrl: "https://dashscope.aliyuncs.com", fields: ["apiKey"], models: ["wan2.2-t2v-plus", "wan2.2-i2v-plus", "wanx2.1-t2v-turbo"], defaultModel: "wan2.2-t2v-plus", aspects: ["16:9", "9:16", "1:1"] },
  { id: "seedance", name: "即梦 Seedance（火山方舟）", region: "cn", modes: ["t2v", "i2v"], imageInput: "url", baseUrl: "https://ark.cn-beijing.volces.com", fields: ["apiKey"], models: ["doubao-seedance-2-5-260628", "doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-1-0-lite-t2v-250428", "doubao-seedance-1-0-pro-250528"], defaultModel: "doubao-seedance-2-5-260628", aspects: ["16:9", "9:16", "1:1"] },
  { id: "cogvideo", name: "智谱 CogVideoX", region: "cn", modes: ["t2v", "i2v"], imageInput: "both", baseUrl: "https://open.bigmodel.cn", fields: ["apiKey"], models: ["cogvideox-3", "cogvideox-2"], defaultModel: "cogvideox-3" },
  { id: "minimax", name: "MiniMax 海螺视频", region: "cn", modes: ["t2v", "i2v"], imageInput: "both", baseUrl: "https://api.minimaxi.com", fields: ["apiKey"], models: ["T2V-01", "I2V-01-live", "S2V-01"], defaultModel: "T2V-01" },
  { id: "runway", name: "Runway Gen-4", region: "global", modes: ["i2v"], imageInput: "both", baseUrl: "https://api.dev.runwayml.com", fields: ["apiKey"], models: ["gen4_turbo", "gen3a_turbo"], defaultModel: "gen4_turbo", aspects: ["16:9", "9:16", "1:1"] },
  { id: "luma", name: "Luma Dream Machine", region: "global", modes: ["t2v", "i2v"], imageInput: "url", baseUrl: "https://api.lumalabs.ai", fields: ["apiKey"], models: ["ray-2", "ray-flash-2"], defaultModel: "ray-2" },
  { id: "veo", name: "Google Veo", region: "global", modes: ["t2v", "i2v"], imageInput: "base64", baseUrl: "https://generativelanguage.googleapis.com", fields: ["apiKey"], models: ["veo-3.0-generate-001", "veo-3.0-fast-generate-001", "veo-2.0-generate-001"], defaultModel: "veo-3.0-generate-001", aspects: ["16:9", "9:16", "1:1"] },
];

const jsonHeaders = (extra = {}) => ({ "Content-Type": "application/json", ...extra });

/** 可灵鉴权：JWT(HS256)，签名材料 = AccessKey/SecretKey。nowMs 显式传入保证确定性。 */
export function klingToken(cfg, nowMs) {
  const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: cfg.accessKey, exp: nowMs + 1800_000, nbf: nowMs - 5000 }));
  const sig = b64url(createHmac("sha256", cfg.secretKey).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

/** 画幅（09-29 自媒体刚需：抖音 / 小红书 / 视频号的默认形态是 **9:16 竖屏**）。
 *  ⛔ 为什么必须显式化：此前各家把画幅**写死成横屏**（`size:"1280*720"` / `ratio:"1280:720"` /
 *     `aspectRatio:"16:9"`）⇒ 用户**根本出不了竖屏**，而这恰恰是短视频最主流的形态。
 *  ⛔ 各家接受的**格式不同**，且**不是每家都支持** —— `VIDEO_PROVIDERS[].aspects` 是唯一真相源，
 *     不支持的厂商一律**明确报错**（与 url-only 首帧同一纪律：不许静默按默认画幅出片）。 */
export { VIDEO_ASPECTS };

/** 各家画幅取值映射（同一画幅在不同厂商是不同写法）。没有条目的厂商 = 不支持定制画幅。 */
const ASPECT_VALUES = {
  wanx: { "16:9": "1280*720", "9:16": "720*1280", "1:1": "960*960" },
  seedance: { "16:9": "16:9", "9:16": "9:16", "1:1": "1:1" },
  runway: { "16:9": "1280:720", "9:16": "720:1280", "1:1": "960:960" },
  veo: { "16:9": "16:9", "9:16": "9:16", "1:1": "1:1" },
};

/** 提交前校验画幅：厂商不支持而我们被要求指定 ⇒ 当场报错（换厂商或去掉画幅）。 */
export function videoAssertAspectOk(providerId, aspect) {
  if (!aspect) return;
  const provider = assertProvider(providerId);
  const supported = provider.aspects || [];
  if (!supported.length) {
    throw new Error(`${provider.name} 不支持指定画幅（按它的模型默认画幅输出）—— 要定画幅请改用：`
      + VIDEO_PROVIDERS.filter((p) => p.aspects?.length).map((p) => p.name.replace(/（.*/, "")).join(" / "));
  }
  if (!supported.includes(aspect)) {
    throw new Error(`${provider.name} 不支持 ${aspect} 画幅（支持：${supported.join(" / ")}）`);
  }
}

function assertProvider(providerId) {
  const provider = VIDEO_PROVIDERS.find((p) => p.id === providerId);
  if (!provider) throw new Error(`未知的视频生成厂商：${providerId}`);
  return provider;
}

/** 提交前校验：厂商认不认这种图片输入（url-only 厂商吃不了本地 base64）。 */
export function videoAssertImageOk(providerId, mode, image) {
  const provider = assertProvider(providerId);
  if (mode === "i2v") {
    if (!image) throw new Error("图生视频需要首帧图（先在该镜头卡上生成首帧）");
    const isUrl = /^https?:\/\//i.test(image);
    if (provider.imageInput === "url" && !isUrl) throw new Error(`${provider.name} 的图生视频只接受可公网访问的图片 URL —— 本地首帧请改用可灵 / 智谱 / MiniMax / Runway / Veo`);
    if (provider.imageInput === "base64" && isUrl) throw new Error(`${provider.name} 的图生视频只接受图片 base64（本地文件可直接用；URL 请先下载）`);
  }
  return provider;
}

/** 组装提交请求。input: {mode:"t2v"|"i2v", prompt, image?, model?, duration?} */
export function videoBuildSubmit(providerId, cfg, input, nowMs) {
  const provider = assertProvider(providerId);
  // 模型优先级（09-28）：调用方（卡片上的 per-node 覆盖）> 用户在设置里填的自定义模型 > 内置默认
  const model = input.model || String(cfg?.model ?? "").trim() || provider.defaultModel;
  const duration = Math.max(3, Math.min(20, Number(input.duration) || 5));
  const aspect = String(input.aspect || "").trim();
  videoAssertAspectOk(providerId, aspect);
  const prompt = String(input.prompt || "").trim();
  const image = input.image ? String(input.image) : "";
  if (!prompt) throw new Error("提示词为空");
  const kind = input.mode === "i2v" ? "image2video" : "text2video";
  switch (providerId) {
    case "kling": {
      const token = klingToken(cfg, nowMs);
      const body = kind === "image2video"
        ? { model_name: model, image, prompt, cfg: { mode: "std", duration: String(duration) } }
        : { model_name: model, prompt, cfg: { mode: "std", duration: String(duration) } };
      return { url: `https://api.klingai.com/v1/videos/${kind}`, headers: jsonHeaders({ Authorization: `Bearer ${token}` }), body };
    }
    case "wanx": {
      const body = { model, input: { prompt, ...(kind === "image2video" ? { img_url: image } : {}) }, parameters: { size: (aspect && ASPECT_VALUES.wanx[aspect]) || "1280*720", duration } };
      return { url: "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis", headers: jsonHeaders({ Authorization: `Bearer ${cfg.apiKey}`, "X-DashScope-Async": "enable" }), body };
    }
    case "seedance": {
      /* ⛔ 双协议（09-29）：1.0 走「--文本参数」旧协议；2.0/2.5 走 **body 参数**新协议
         （resolution / ratio / duration / generate_audio 是顶层字段，content 只放素材）。
         ⛔ 2.x 才支持 video_url 参考视频（白模预演管线的核心输入）—— 1.0 + video 明确报错。 */
      const isV2 = /-2-(0|5)-/.test(model);
      const content = [];
      if (isV2) {
        content.push({ type: "text", text: prompt });
        if (kind === "image2video") content.push({ type: "image_url", image_url: { url: image }, role: "first_frame" });
        if (input.video) content.push({ type: "video_url", video_url: { url: input.video }, role: "reference_video" });
        const body = {
          model, content,
          resolution: "720p",
          duration,
          ratio: aspect ? (ASPECT_VALUES.seedance[aspect] || "adaptive") : "adaptive",
          generate_audio: true,
        };
        return { url: "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks", headers: jsonHeaders({ Authorization: `Bearer ${cfg.apiKey}` }), body };
      }
      if (input.video) throw new Error("参考视频（白模预演）需要 Seedance 2.0/2.5 —— 请在镜头卡把模型切到 doubao-seedance-2-5 系列后再提交");
      content.push({ type: "text", text: `${prompt} --resolution 720p --duration ${duration}${aspect ? ` --ratio ${ASPECT_VALUES.seedance[aspect]}` : ""}` });
      if (kind === "image2video") content.push({ type: "image_url", image_url: { url: image } });
      return { url: "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks", headers: jsonHeaders({ Authorization: `Bearer ${cfg.apiKey}` }), body: { model, content } };
    }
    case "cogvideo": {
      const body = { model, prompt, quality: "quality", with_audio: true, ...(kind === "image2video" ? { image_url: image } : {}) };
      return { url: "https://open.bigmodel.cn/api/paas/v4/videos/generations", headers: jsonHeaders({ Authorization: `Bearer ${cfg.apiKey}` }), body };
    }
    case "minimax": {
      const body = { model, prompt, duration, ...(kind === "image2video" ? { first_frame_image: image } : {}) };
      return { url: "https://api.minimaxi.com/v1/video_generation", headers: jsonHeaders({ Authorization: `Bearer ${cfg.apiKey}` }), body };
    }
    case "runway": {
      if (kind !== "image2video") throw new Error("Runway Gen-4 当前只支持图生视频（先在该镜头卡上生成首帧）");
      const body = { model, promptImage: image, promptText: prompt, ratio: (aspect && ASPECT_VALUES.runway[aspect]) || "1280:720", duration };
      return { url: "https://api.dev.runwayml.com/v1/image_to_video", headers: jsonHeaders({ Authorization: `Bearer ${cfg.apiKey}`, "X-Runway-Version": "2024-11-06" }), body };
    }
    case "luma": {
      const body = { prompt, model, resolution: "720p", duration: `${duration}s`, ...(kind === "image2video" ? { keyframes: { frame0: { type: "image", url: image } } } : {}) };
      return { url: "https://api.lumalabs.ai/dream-machine/v1/generations", headers: jsonHeaders({ Authorization: `Bearer ${cfg.apiKey}` }), body };
    }
    case "veo": {
      if (!cfg.apiKey) throw new Error("Veo 需要 API Key（Google AI Studio）");
      const instance = { prompt };
      if (kind === "image2video") instance.image = { bytesBase64Encoded: image.replace(/^data:[^;]+;base64,/, "") };
      return { url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${encodeURIComponent(cfg.apiKey)}`, headers: jsonHeaders(), body: { instances: [instance], parameters: { aspectRatio: (aspect && ASPECT_VALUES.veo[aspect]) || "16:9", durationSeconds: Math.min(8, duration) } } };
    }
    default:
      throw new Error(`未知的视频生成厂商：${providerId}`);
  }
}

/** 提交响应 → jobId（各家字段不同；拿不到就抛错，别让上层轮询空气）。 */
export function videoParseSubmit(providerId, respJson) {
  const jobId = respJson?.data?.task_id ?? respJson?.output?.task_id ?? respJson?.id ?? respJson?.task_id ?? respJson?.name;
  if (!jobId) throw new Error(`提交成功但响应里没有任务 id：${JSON.stringify(respJson).slice(0, 160)}`);
  return String(jobId);
}

/** 组装轮询请求。 */
export function videoBuildPoll(providerId, cfg, jobId, nowMs) {
  assertProvider(providerId);
  switch (providerId) {
    case "kling": {
      const token = klingToken(cfg, nowMs);
      return { url: `https://api.klingai.com/v1/videos/image2video/${encodeURIComponent(jobId)}`, headers: jsonHeaders({ Authorization: `Bearer ${token}` }) };
    }
    case "wanx":
      return { url: `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(jobId)}`, headers: { Authorization: `Bearer ${cfg.apiKey}` } };
    case "seedance":
      return { url: `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${encodeURIComponent(jobId)}`, headers: { Authorization: `Bearer ${cfg.apiKey}` } };
    case "cogvideo":
      return { url: `https://open.bigmodel.cn/api/paas/v4/videos/generations/${encodeURIComponent(jobId)}`, headers: { Authorization: `Bearer ${cfg.apiKey}` } };
    case "minimax":
      return { url: `https://api.minimaxi.com/v1/query/video_generation?task_id=${encodeURIComponent(jobId)}`, headers: { Authorization: `Bearer ${cfg.apiKey}` } };
    case "runway":
      return { url: `https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(jobId)}`, headers: { Authorization: `Bearer ${cfg.apiKey}`, "X-Runway-Version": "2024-11-06" } };
    case "luma":
      return { url: `https://api.lumalabs.ai/dream-machine/v1/generations/${encodeURIComponent(jobId)}`, headers: { Authorization: `Bearer ${cfg.apiKey}` } };
    case "veo":
      return { url: `https://generativelanguage.googleapis.com/v1beta/${jobId}?key=${encodeURIComponent(cfg.apiKey)}`, headers: {} };
    default:
      throw new Error(`未知的视频生成厂商：${providerId}`);
  }
}

const PICK = (v, candidates) => { for (const c of candidates) if (v?.[c] != null && v[c] !== "") return v[c]; return ""; };

/** 轮询响应 → 归一状态。返回 {status:"queued"|"running"|"succeeded"|"failed", url?, fileId?, error?}。 */
export function videoParsePoll(providerId, respJson) {
  const j = respJson ?? {};
  switch (providerId) {
    case "kling": {
      const s = String(j?.data?.task_status ?? "");
      if (s === "succeed") return { status: "succeeded", url: PICK(j?.data?.task_result ?? {}, ["videoUrl"]) || j?.data?.task_result?.videos?.[0]?.url || "" };
      if (s === "submitted") return { status: "queued" };
      if (s === "processing") return { status: "running" };
      return { status: "failed", error: String(j?.data?.task_status_msg ?? s ?? "未知失败") };
    }
    case "wanx": {
      const s = String(j?.output?.task_status ?? "");
      if (s === "SUCCEEDED") return { status: "succeeded", url: String(j?.output?.video_url ?? j?.output?.results?.[0]?.url ?? "") };
      if (s === "PENDING") return { status: "queued" };
      if (s === "RUNNING") return { status: "running" };
      return { status: "failed", error: String(j?.output?.message ?? j?.message ?? s) };
    }
    case "seedance": {
      const s = String(j?.status ?? "");
      if (s === "succeeded") return { status: "succeeded", url: String(PICK(j?.content ?? {}, ["video_url"]) || j?.content?.video_url || "") };
      if (s === "queued") return { status: "queued" };
      if (s === "running") return { status: "running" };
      return { status: "failed", error: String(j?.error?.message ?? s) };
    }
    case "cogvideo": {
      const s = String(j?.task_status ?? "");
      if (s === "SUCCESS") return { status: "succeeded", url: String(j?.video_result?.[0]?.url ?? "") };
      if (s === "PROCESSING") return { status: "running" };
      return { status: "failed", error: String(j?.status_reason ?? s) };
    }
    case "minimax": {
      const s = String(j?.status ?? j?.task_status ?? "");
      if (s === "Success") return { status: "succeeded", url: "", fileId: String(j?.file_id ?? "") };
      if (s === "Queueing" || s === "Preparing" || s === "Processing") return { status: "running" };
      return { status: "failed", error: String(j?.status_wait_n ?? s ?? "未知失败") };
    }
    case "runway": {
      const s = String(j?.status ?? "");
      if (s === "SUCCEEDED") return { status: "succeeded", url: String(j?.output?.[0] ?? "") };
      if (s === "PENDING" || s === "THROTTLED") return { status: "queued" };
      if (s === "RUNNING") return { status: "running" };
      return { status: "failed", error: String(j?.failure ?? s) };
    }
    case "luma": {
      const s = String(j?.state ?? "");
      if (s === "completed") return { status: "succeeded", url: String(j?.assets?.video ?? "") };
      if (s === "queued") return { status: "queued" };
      if (s === "dreaming") return { status: "running" };
      return { status: "failed", error: String(j?.failure_reason ?? s) };
    }
    case "veo": {
      if (!j?.done) return { status: "running" };
      if (j?.error) return { status: "failed", error: String(j.error.message ?? JSON.stringify(j.error).slice(0, 120)) };
      const sample = j?.response?.generateVideoResponse?.generatedSamples?.[0] ?? j?.response?.generatedVideos?.[0] ?? null;
      return { status: "succeeded", url: String(sample?.video?.uri ?? sample?.uri ?? "") };
    }
    default:
      throw new Error(`未知的视频生成厂商：${providerId}`);
  }
}

/** MiniMax 两段式：成功后还要拿 file_id 换下载地址。 */
export function videoBuildFileRetrieve(cfg, fileId) {
  return { url: `https://api.minimaxi.com/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}&Type=output`, headers: { Authorization: `Bearer ${cfg.apiKey}` } };
}

export function videoParseFileRetrieve(respJson) {
  const url = String(respJson?.file?.download_url ?? "");
  if (!url) throw new Error(`拿不到视频下载地址：${JSON.stringify(respJson).slice(0, 140)}`);
  return url;
}

/* ── 自定义 API 地址（09-28 用户要求「API 地址要能自己填」） ──────────────────────
   ⛔ 为什么只换 origin+前缀、不整条替换：路径是各家协议的一部分（`/v1/videos/image2video`
   之类），用户填的应该是「中转站/代理的地址」，路径由我们按官方协议生成。整条替换意味着
   用户得自己拼路径，填错就是整个不可用 —— 换前缀则中转站（同协议换域名）直接可用。 */
export function videoApplyBaseUrl(request, providerId, cfg) {
  const custom = String(cfg?.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!custom || !request?.url) return request;
  const provider = VIDEO_PROVIDERS.find((p) => p.id === providerId);
  if (!provider?.baseUrl) return request;
  try {
    const official = new URL(provider.baseUrl);
    const target = new URL(String(request.url));
    // 只改这家官方域下的请求（MiniMax 换下载地址等跨域步骤原样保留）
    if (target.origin !== official.origin) return request;
    return { ...request, url: custom + target.pathname + target.search };
  } catch {
    return request;
  }
}
