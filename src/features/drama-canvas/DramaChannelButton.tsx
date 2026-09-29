/**
 * 生成通道按钮（域内共享）。
 *
 * ⛔⛔ 09-28 立此文件的直接原因（code review 抓到的**配套漂移**）：
 *   卡面与右侧检查器**各自写了一份**生成按钮 ⇒
 *     ① 文案漂移：卡面当年叫「生图 · 首帧」（09-29 已改回「生图」——「首帧」是视频术语），检查器里还叫「生成图片」（一个动作两个名字）；
 *     ② 未配置引导只做在卡面 —— 检查器里点了才 notice 报错，**正是用户最初抱怨的
 *        「生图模型都没有配置的地方」的旧病根残留**（我只修了卡面、漏了检查器）。
 *   ⇒ 同一个动作只能有一个实现：两处都渲染本组件，改文案/改引导只改一处。
 *
 * 通道类别词**必须前置**（「生图 · 首帧」而不是「生成首帧」）：类别藏在词中间，
 * 一眼分不出哪个出图、哪个出片（用户原话「生图，生视频，你是搞不清楚吗」）。
 */
import { Loader2, Mic, Settings2, Sparkles, Video, type LucideIcon } from "lucide-react";
import { useDramaActions } from "./drama-actions";

export type DramaChannel = "image" | "video" | "audio";

/** 节点类型 → 这颗卡能用的生成通道（卡面与检查器**共用这一张表**）。
 *  ⛔ 策划类（笔记/剧本/Agent）不在表里 ⇒ 不给生成按钮。原来「生成视频」无条件渲染在
 *  所有卡片上，用户据此以为「生图跟视频流程一样」（09-28 原话）。
 *  ⛔ 检查器曾不查这张表 ⇒ 选中笔记卡也能点「生成图片」，与卡面行为相反。 */
export const GEN_CHANNELS: Record<string, DramaChannel[]> = {
  character: ["image"],
  location: ["image"],
  image: ["image", "video"],
  /* 独立生图节点（09-29）：**只有生图** —— 生图与视频不共用结构，天然不可能出现视频按钮。 */
  imagegen: ["image"],
  shot: ["image", "video", "audio"],
  video: ["video"],
  audio: ["audio"],
};

/** 通道类别词（按钮文案前缀 + 图标配色都按它取）。 */
export const CHANNEL_LABEL: Record<DramaChannel, string> = { image: "生图", video: "视频", audio: "配音" };

/* ⛔⛔ 按**卡片状态**决定露出哪几条通道（09-29 用户：「卡片上的功能按键也要精简，
   不要每个卡片都有重复按键」）。原来 image/shot 卡不分状态一律给「生图 + 视频 + 上传参考图」，
   没出图时「视频」是文生视频（对生图流程纯噪音），三张卡按钮一模一样也看不出主次。
   规则：
     · 「视频」只在**已经有图/首帧**时给 —— 那才是「把这张图动起来」的有意义动作；
     · 「生图」始终给（产物卡上按钮会自动叫「重出」，允许再出一版）。
   ⛔ 卡面与检查器**共用这一份**（原来各自 filter，必然漂移）。 */
export function visibleChannels(kind: string, payload: Record<string, any>): DramaChannel[] {
  const allowed = GEN_CHANNELS[kind] || [];
  /* ⛔⛔ 两类工作流的按键**互不冲突**（09-29 用户：「根据卡片类型区分两类工作流：视频工作流和生图工作流，
     确保按键配置与工作流类型一一对应、互不冲突」）：
     · **生图工作流**的卡（image / character / location）**只给「生图」** —— 不再冒出「视频」；
       此前 image 卡有图时会多出一颗视频按钮，把两类工作流混在同一张卡上，用户分不清点哪个；
     · **视频工作流**的卡（shot / video）才给「视频」；shot 卡保留「生图 · 首帧」当输入位；
     · 镜头卡内部再按状态分：没首帧先出首帧，有首帧才有「视频」；
     · 「配音」只在镜头有台词时给（DramaChannelButton 内部按 hasLine 管）。
     ⇒ 出片请走视频工作流（白模视频 / 短剧工作流的镜头卡）；生图工作流只管出图。 */
  if (kind === "shot") {
    const hasFrame = Boolean(payload.first_frame);
    const hasVideo = Boolean(payload.video);
    return allowed.filter((ch) => ch !== "video" || hasFrame || hasVideo);
  }
  if (kind === "image" || kind === "imagegen" || kind === "character" || kind === "location") return allowed.filter((ch) => ch !== "video");
  return allowed;
}

const CHANNEL_ICON: Record<DramaChannel, LucideIcon> = { image: Sparkles, video: Video, audio: Mic };

/**
 * 单颗通道按钮。卡面按钮组与检查器都渲染它。
 * `busyKey` 由调用方给（卡面按自身 id、检查器按选中节点 id），口径一致：`${nodeId}:${channel}`。
 */
export function DramaChannelButton({
  id,
  kind,
  what,
  payload,
  busyKey,
}: {
  id: string;
  kind: string;
  what: DramaChannel;
  payload: Record<string, any>;
  busyKey: (what: string) => boolean;
}) {
  const actions = useDramaActions();
  const busy = busyKey(what);
  const channels = actions.story.channels;
  const hasImage = Boolean(payload.first_frame || payload.ref || payload.path);
  const hasVideo = Boolean(payload.video);
  const hasAudio = Boolean(payload.audio || (kind === "audio" && payload.path));
  const hasLine = Boolean(String(payload.line || payload.text || "").trim());
  // 配音是本机离线合成，没有「要不要配置」一说；只有生图/视频有凭证概念。
  const missing = what === "image" ? !channels.image.ready : what === "video" ? !channels.video.ready : false;

  const label = (() => {
    const head = `${CHANNEL_LABEL[what]} · `;
    if (missing) return `${head}去配置`;
    if (what === "audio") return head + (hasAudio ? "重做" : "生成");
    if (what === "video") return head + (hasVideo ? "重做" : "生成");
    /* ⛔ 09-29 用户：「生图流程看不懂 … 按钮文案费解」—— 「首帧」是**视频术语**（给镜头卡拍视频用的），
       长在出图卡上让人不知道点下去干什么。现在只有 shot 卡叫「首帧」，出图/角色/场景卡首次就说「生图」。 */
    const suffix = kind === "character" ? "定妆照" : kind === "location" ? "场景图" : hasImage ? "重出" : kind === "shot" ? "首帧" : "";
    return suffix ? head + suffix : CHANNEL_LABEL[what];
  })();

  const title = (() => {
    if (what === "audio") {
      return hasLine ? "配音通道：用本机语音模型合成这一句（离线，不出网）" : "这一镜没有台词，先在上面写上 line";
    }
    if (missing) return `还没配置${what === "image" ? "生图模型" : "视频接口"} —— 点这里去「设置 → 插件」配置`;
    if (what === "image") return `生图通道：${channels.image.model}（按提示词画，不保证角色跨镜一致）`;
    return `视频通道：${channels.video.provider}（有首帧走图生视频，否则文生视频）`;
  })();

  const Icon = CHANNEL_ICON[what];
  const ghost = what === "audio" || missing;
  const disabled = busy || (what === "audio" && !hasLine);

  return (
    <button
      className={`drama-canvas-btn is-channel-${what}${ghost ? " is-ghost" : ""}`}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation(); // 卡面在画布上：别让点击变成「选中/拖动节点」
        if (missing) { actions.openGenSettings(what as "image" | "video"); return; }
        void actions.story.generate(id, what);
      }}
    >
      {busy ? <Loader2 size={12} className="drama-canvas-spin" /> : missing ? <Settings2 size={12} /> : <Icon size={12} />}
      {busy ? "生成中…" : label}
    </button>
  );
}

/* ─────────────────────── 卡动作分发（**唯一真相源**；09-29 用户实测逼出来的）

   ⛔ 为什么必须只有一份：卡面与检查器原来各写一套判据 —— 卡面按 act 隐藏了素材位的生成键，
      检查器没有 ⇒ 用户的**参考图卡在检查器里还能点「生图」**（截图实测）。
      同一个动作两套实现 = 必然漂移，本项目已为此踩过多次（生成按钮文案、写回、上传范围…）。
   ⛔ 也**不要**在没有生成通道时提前 return：笔记 / 剧本卡没有生成通道，但有「AI 润色」。 */
export function dramaCardActions(kind: string, payload: Record<string, any>): {
  channels: DramaChannel[];
  canUpload: boolean;
  polishField: string;
} {
  const act = String(payload?.act || "");
  const materialSlot = act === "upload" || payload?.hint === "ref";   // 素材位：只负责把图传进来
  const channels = act === "upload" || act === "prompt" ? [] : visibleChannels(kind, payload);
  const canUpload = act === "upload" ? true
    : act === "prompt" ? true
    : act === "produce" ? false
    : act === "output" ? false
    : act === "generate" ? (kind === "image" || kind === "shot" || kind === "imagegen")
    : kind === "imagegen" ? !payload?.ref && !payload?.path && !payload?.url
    : kind === "image" ? !payload?.path && !payload?.url && payload?.hint !== "output"
    : kind === "character" || kind === "location" ? !payload?.ref
    : kind === "shot" ? !payload?.first_frame
    : false;
  return { channels, canUpload, polishField: materialSlot ? "" : (POLISH_FIELD[kind] || "") };
}

/* 各卡片的提示词字段 + 给人看的名字（「AI 润色」写回的就是这个字段）。
   ⛔ 新增带提示词的卡片类型必须在这里登记，否则那颗按钮不会出现（守卫【219】钉住）。 */
export const POLISH_FIELD: Record<string, string> = {
  note: "text", script: "text", agent: "task",
  character: "look", location: "description",
  image: "text", imagegen: "prompt",
  shot: "prompt", video: "prompt", audio: "text",
};
export const POLISH_LABEL: Record<string, string> = {
  text: "文案", task: "任务描述", look: "外貌描写", description: "描述", prompt: "提示词",
};

/**
 * 这张卡在工作流里的**角色**（09-29 用户：「每个卡片配独立侧边栏，功能互不重复，一一对应，职责明确」）。
 * ⛔ 与 dramaCardActions / 字段表**同一套判据**：角色变了，字段与动作一起变 —— 三处各写一套必漂移。
 * 角色是"这张卡负责什么"，与卡面那个按状态变的徽章（提示词/出图结果）不是一回事。
 */
export function dramaCardRole(kind: string, payload: Record<string, any>): { key: string; label: string; hint: string } {
  const act = String(payload?.act || "");
  if (act === "upload" || payload?.hint === "ref") return { key: "material", label: "素材位", hint: "只负责把图传进来；出图在出图位的卡上做" };
  if (act === "prompt") return { key: "prompt", label: "提示词位", hint: "写你要什么，然后交给下游出图位" };
  if (act === "produce") return { key: "produce", label: "出图位", hint: "按类型 / 尺寸出图；参考图从上游来" };
  if (act === "generate") return { key: "produce", label: "出图位", hint: "按类型 / 尺寸出图" };
  if (act === "output" || payload?.hint === "output") return { key: "output", label: "产物位", hint: "纯展示结果；再出一版在出图位点" };
  if (kind === "shot") return { key: "shot", label: "镜头位", hint: "可生成、可重跑的最小单元：首帧 → 视频 → 配音" };
  if (kind === "character" || kind === "location") return { key: "anchor", label: "一致性锚点", hint: "跨镜复用的参照：它变了，引用的镜头要重出首帧" };
  if (kind === "timeline") return { key: "deliver", label: "交付位", hint: "把镜头按顺序拼成一条成片" };
  if (kind === "storyboard" || kind === "scene") return { key: "structure", label: "结构位", hint: "分镜的唯一真源与场次组织" };
  return { key: "plan", label: "策划位", hint: "想法、剧本与任务说明" };
}
