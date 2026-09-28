/**
 * 生成通道按钮（域内共享）。
 *
 * ⛔⛔ 09-28 立此文件的直接原因（code review 抓到的**配套漂移**）：
 *   卡面与右侧检查器**各自写了一份**生成按钮 ⇒
 *     ① 文案漂移：卡面已改成「生图 · 首帧」，检查器里还叫「生成图片」（一个动作两个名字）；
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
  shot: ["image", "video", "audio"],
  video: ["video"],
  audio: ["audio"],
};

/** 通道类别词（按钮文案前缀 + 图标配色都按它取）。 */
export const CHANNEL_LABEL: Record<DramaChannel, string> = { image: "生图", video: "视频", audio: "配音" };

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
    return head + (kind === "character" ? "定妆照" : kind === "location" ? "场景图" : hasImage ? "重出" : "首帧");
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
