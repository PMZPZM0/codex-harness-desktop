/**
 * 画布卡片（域内私有）：一种节点类型渲一种卡面。
 *
 * ⛔ 三条硬约束（都踩过）：
 *  ① 卡片里**所有可交互元素都要带 `nodrag`**（React Flow 靠这个类豁免拖拽）；
 *     漏了的话点按钮会变成拖卡片，输入框根本点不进去。
 *  ② 可滚动区域再加 `nowheel`，否则滚它等于缩放画布。
 *  ③ 尺寸由节点 style 定死（见 use-drama-board 的 rfNodesFrom），卡面必须 `height:100%`
 *     且 `overflow:hidden` —— 内容多出去就裁掉，不允许把卡片撑大（撑大会让排版和命中测试全错）。
 */
import { memo, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Bot,
  Clapperboard,
  Eye,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Mic,
  Music,
  NotebookPen,
  Sparkles,
  Settings,
  User,
  Video,
  X,
  type LucideIcon,
  Settings2,
} from "lucide-react";
import { imageDisplaySrc } from "../../lib/image-src.mjs";
import { dramaIsKnownKind, dramaNodeDef, dramaNodeLabel } from "../../lib/drama-canvas-model.mjs";
import { useDramaActions } from "./drama-actions";
import { useLocalAudio } from "./use-local-audio";
import type { DramaRFNode } from "./use-drama-board";

const ICONS: Record<string, LucideIcon> = {
  note: NotebookPen,
  script: FileText,
  agent: Bot,
  character: User,
  location: MapPin,
  storyboard: Clapperboard,
  scene: Film,
  shot: Video,
  image: ImageIcon,
  video: Clapperboard,
  audio: Music,
  timeline: Film,
};

function Head({ kind, id, title, subtitle, extra }: { kind: string; id: string; title: string; subtitle: string; extra?: ReactNode }) {
  const actions = useDramaActions();
  const def = dramaNodeDef(kind);
  const Icon = ICONS[kind] || NotebookPen;
  return (
    <header className="drama-canvas-card-head">
      <span className="drama-canvas-card-glyph"><Icon size={14} /></span>
      <div className="drama-canvas-card-title">
        <b>{title}</b>
        <small>{subtitle || def.subtitle}</small>
      </div>
      {extra}
      <button className="drama-canvas-card-tool nodrag" title="打开设置" aria-label="打开设置" onClick={(e) => { e.stopPropagation(); actions.openInspector(id); }}><Settings size={13} /></button>
      <button className="drama-canvas-card-tool is-danger nodrag" title="删除节点" aria-label="删除节点" onClick={(e) => { e.stopPropagation(); actions.board.removeNodes([id]); }}><X size={13} /></button>
    </header>
  );
}

function MediaPreview({ path, alt, kind }: { path: string; alt: string; kind: "image" | "video" }) {
  if (!path) return null;
  const name = path.split(/[\\/]/).pop() || path;
  if (kind === "video") {
    return <div className="drama-canvas-card-media nodrag nowheel"><Video size={16} /><span title={path}>{name}</span></div>;
  }
  return <img className="drama-canvas-card-shot nodrag" src={imageDisplaySrc(path)} alt={alt} loading="lazy" title={name} />;
}

function AudioPreview({ path }: { path: string }) {
  const url = useLocalAudio(path);
  if (!path) return null;
  if (!url) return <div className="drama-canvas-card-missing">配音文件读不到（可能已从工作区移除）：{path.split(/[\\/]/).pop()}</div>;
  return <audio className="drama-canvas-card-audio nodrag nowheel" controls preload="metadata" src={url} />;
}

/** 节点类型 → 可用生成通道（09-28 用户反馈「生图跟视频没区分开」）。
 *  ⛔ 旧实现把「生成视频」按钮**无条件**渲染在所有卡片上（笔记卡、剧本卡上也有），
 *  用户看不出这两条路各自干什么、也分不清点哪个。现在按节点职责给：
 *  · 素材类（角色/场景/参考图）→ 生图通道（定妆照 / 场景图 / 首帧）
 *  · 拍摄类（镜头/视频）      → 生图（首帧）+ 视频（图生视频 / 文生视频）两个通道
 *  · 声音类（镜头/声音）      → 配音（本地 TTS）
 *  · 策划类（笔记/剧本/Agent/分镜表/场次/时间线）→ **不给生成按钮**（它们的产物是文本，
 *    该用「交给 Agent」而不是生成媒体） */
const GEN_CHANNELS: Record<string, Array<"image" | "video" | "audio">> = {
  character: ["image"],
  location: ["image"],
  image: ["image", "video"],
  shot: ["image", "video", "audio"],
  video: ["video"],
  audio: ["audio"],
};

function GenButtons({ id, kind, payload, busyKey }: { id: string; kind: string; payload: Record<string, any>; busyKey: (what: string) => boolean }) {
  const actions = useDramaActions();
  const allowed = GEN_CHANNELS[kind];
  if (!allowed) return null;
  const channels = actions.story.channels;
  const hasImage = Boolean(payload.first_frame || payload.ref || payload.path);
  const hasVideo = Boolean(payload.video);
  const hasAudio = Boolean(payload.audio || (kind === "audio" && payload.path));
  // 未配置就走「去配置」，不在卡片上画一个点了才报错的假按钮
  const needConfig = (what: "image" | "video") => (what === "image" ? !channels.image.ready : !channels.video.ready);
  /* 通道前缀（09-28 用户：「生图、生视频，你是搞不清楚吗」）：
     类别词必须**放在按钮文案最前面**。原来叫「生成首帧 / 文生视频」—— 类别藏在词中间，
     一眼扫过去分不出哪个出图、哪个出片。现在统一「生图 · X / 视频 · X / 配音 · X」，
     配合图标配色（蓝/紫/橙）双重区分。 */
  const CH_LABEL: Record<string, string> = { image: "生图", video: "视频", audio: "配音" };
  const labelOf = (what: "image" | "video" | "audio") => {
    const head = `${CH_LABEL[what]} · `;
    if (what === "audio") return head + (hasAudio ? "重做" : "生成");
    if (what === "video") return head + (hasVideo ? "重做" : "生成");
    return head + (kind === "character" ? "定妆照" : kind === "location" ? "场景图" : hasImage ? "重出" : "首帧");
  };
  const configLabelOf = (what: "image" | "video") => `${CH_LABEL[what]} · 去配置`;
  return (
    <div className="drama-canvas-card-actions nodrag">
      {allowed.map((what) => {
        if (what === "audio") {
          const hasLine = Boolean(String(payload.line || payload.text || "").trim());
          return (
            <button key="audio" className="drama-canvas-btn is-ghost is-channel-audio" disabled={busyKey("audio") || !hasLine} onClick={(e) => { e.stopPropagation(); void actions.story.generate(id, "audio"); }} title={hasLine ? "配音通道：用本机语音模型合成这一句（离线，不出网）" : "这一镜没有台词，先在检查器里写上 line"}>
              {busyKey("audio") ? <Loader2 size={12} className="drama-canvas-spin" /> : <Mic size={12} />}
              {busyKey("audio") ? "合成中…" : labelOf("audio")}
            </button>
          );
        }
        const missing = needConfig(what);
        const channelName = what === "image" ? channels.image.model : channels.video.provider;
        return (
          <button
            key={what}
            className={`drama-canvas-btn is-channel-${what} ${missing ? "is-ghost" : ""}`}
            disabled={busyKey(what)}
            title={missing
              ? `还没配置${what === "image" ? "生图模型" : "视频接口"} —— 点这里去「设置 → 插件」配置`
              : what === "image"
                ? `生图通道：${channelName}（按提示词画，不保证角色跨镜一致）`
                : `视频通道：${channelName}（有首帧走图生视频，否则文生视频）`}
            onClick={(e) => {
              e.stopPropagation();
              if (missing) { actions.openGenSettings(what); return; }
              void actions.story.generate(id, what);
            }}
          >
            {busyKey(what) ? <Loader2 size={12} className="drama-canvas-spin" /> : missing ? <Settings2 size={12} /> : what === "image" ? <Sparkles size={12} /> : <Video size={12} />}
            {busyKey(what) ? "生成中…" : missing ? configLabelOf(what) : labelOf(what)}
          </button>
        );
      })}
    </div>
  );
}

function DramaNodeCardInner({ id, data, selected }: NodeProps<DramaRFNode>) {
  const actions = useDramaActions();
  const kind = String(data?.kind || "note");
  const payload = (data?.payload || {}) as Record<string, any>;
  const def = dramaNodeDef(kind);
  const busyKey = (what: string) => actions.story.busy.has(`${id}:${what}`);
  const update = (patch: Record<string, any>) => actions.board.updatePayload(id, patch);
  const subtitleOf = () => {
    if (kind === "shot") return `${payload.shot_size || "镜头"} · ${payload.duration || 4}s`;
    if (kind === "scene") return `${payload.place || "未命名场次"}${payload.time ? ` · ${payload.time}` : ""}`;
    if (kind === "agent") return payload.role || def.subtitle;
    if (kind === "image" || kind === "audio") return payload.role || def.subtitle;
    return def.subtitle;
  };

  /* 认不出的类型：照原样显示、只读。⛔ 别画成可编辑的空白笔记 —— 用户一打字就把人家的
     payload 覆盖成 { text }，那是真丢数据。 */
  if (!dramaIsKnownKind(kind)) {
    const keys = Object.keys(payload).filter((k) => payload[k] !== "" && payload[k] != null).slice(0, 5);
    return (
      <article className={`drama-canvas-card is-unknown ${selected ? "is-selected" : ""}`}>
        <Head kind="note" id={id} title={payload.title || payload.name || id} subtitle={`这个版本不认识「${kind}」`} />
        <div className="drama-canvas-card-body">
          <p className="drama-canvas-hint">内容已原样保留，不会丢。换成建它的那个版本就能编辑。</p>
          <dl className="drama-canvas-kv">{keys.map((k) => <div key={k}><dt>{k}</dt><dd>{String(payload[k]).slice(0, 40)}</dd></div>)}</dl>
        </div>
        <Handle type="target" position={Position.Left} className="drama-canvas-handle" />
        <Handle type="source" position={Position.Right} className="drama-canvas-handle" />
      </article>
    );
  }

  const body: ReactNode = (() => {
    if (kind === "note") {
      return (
        <div
          className="drama-canvas-card-note nodrag nowheel"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => update({ text: e.currentTarget.textContent || "" })}
        >
          {payload.text || "在这里记录想法、任务或素材线索…"}
        </div>
      );
    }
    if (kind === "script") {
      return (
        <>
          <div className="drama-canvas-card-text">{payload.text || "还没有剧本内容。写一句话概念、人物关系、冲突与结局。"}</div>
          <div className="drama-canvas-card-actions nodrag">
            <button className="drama-canvas-btn" onClick={(e) => { e.stopPropagation(); actions.askAgent(id); }}><Bot size={12} />让 Agent 生成分镜表</button>
          </div>
        </>
      );
    }
    if (kind === "storyboard") {
      const options = actions.story.stories;
      return (
        <>
          <label className="drama-canvas-field nodrag">
            <span>选择分镜表</span>
            <select
              className="nodrag"
              value={payload.board || ""}
              onChange={(e) => { e.stopPropagation(); update({ board: e.target.value }); }}
            >
              <option value="">{options.length ? "（未绑定）" : "还没有分镜表 —— 先去右侧新建一份"}</option>
              {options.map((s) => <option key={s.name} value={s.name}>{s.title || s.name} · {s.shots} 镜</option>)}
            </select>
          </label>
          <div className="drama-canvas-card-actions nodrag">
            <button className="drama-canvas-btn" disabled={!payload.board || !actions.boardNodeId} onClick={(e) => { e.stopPropagation(); void actions.story.expand(id, String(payload.board)); }}><Clapperboard size={12} />展开场次与镜头</button>
          </div>
          <p className="drama-canvas-hint">分镜表是唯一真源：镜头卡改了会回写它，引擎读的也是它（工作区 .drama-canvas/storyboards/）。</p>
        </>
      );
    }
    if (kind === "scene") {
      const shots = actions.linkedShots(id);
      return (
        <>
          <div className="drama-canvas-count">{shots.length} 镜</div>
          <div className="drama-canvas-shotlist nowheel">
            {shots.length
              ? shots.slice(0, 6).map((s, i) => (
                <div className="drama-canvas-shotrow" key={String(s.id || i)}>
                  <span>{String(s.id || `镜 ${i + 1}`)}</span>
                  <span>{String(s.shot_size || "镜头")}</span>
                  <span>{String(s.line || "无人声")}</span>
                </div>
              ))
              : <p className="drama-canvas-hint">这一场还没有镜头卡。展开分镜表，或直接拖一张镜头卡连过来。</p>}
          </div>
        </>
      );
    }
    if (kind === "shot") {
      return (
        <>
          {payload.first_frame ? <MediaPreview path={String(payload.first_frame)} alt="首帧" kind="image" /> : <div className="drama-canvas-empty"><Sparkles size={16} /><span>还没有首帧</span></div>}
          <div className="drama-canvas-card-text is-prompt">{String(payload.prompt || "还没有镜头提示词")}</div>
          <div className="drama-canvas-card-line">{String(payload.line || "无人声")}</div>
          {payload.audio ? <AudioPreview path={String(payload.audio)} /> : null}
          <GenButtons id={id} kind={kind} payload={payload} busyKey={busyKey} />
        </>
      );
    }
    if (kind === "agent") {
      return (
        <>
          <div className="drama-canvas-badge">{String(payload.status || "待执行")}</div>
          <div className="drama-canvas-card-text">{String(payload.task || "描述要让 Agent 完成的创作任务")}</div>
          <div className="drama-canvas-card-actions nodrag">
            <button className="drama-canvas-btn is-brand" onClick={(e) => { e.stopPropagation(); actions.askAgent(id); }}><Bot size={12} />交给 Agent</button>
          </div>
        </>
      );
    }
    if (kind === "video") {
      return (
        <>
          <div className="drama-canvas-empty">{payload.video ? <Video size={16} /> : <Sparkles size={16} />}<span>{payload.video ? String(payload.video).split(/[\\/]/).pop() : "生成结果会显示在这里"}</span></div>
          <GenButtons id={id} kind={kind} payload={payload} busyKey={busyKey} />
          <p className="drama-canvas-hint">视频生成本项目尚未接入 —— 这里保留落点，接入后无需改结构。</p>
        </>
      );
    }
    if (kind === "image" || kind === "audio") {
      const path = String(payload.path || payload.url || "");
      return (
        <>
          {kind === "image" && path ? <MediaPreview path={path} alt={String(payload.title || "参考图")} kind="image" /> : null}
          {kind === "audio" ? <AudioPreview path={path} /> : null}
          <div className="drama-canvas-card-text">{String(payload.text || payload.prompt || "还没有素材或描述")}</div>
          <GenButtons id={id} kind={kind} payload={payload} busyKey={busyKey} />
        </>
      );
    }
    if (kind === "timeline") {
      const film = String(payload.video || "");
      return (
        <>
          <p className="drama-canvas-card-text">{film ? `成片：${film.split(/[\\/]/).pop()}` : String(payload.description || "按分镜顺序逐镜合轨、拼接，全在本机跑。")}</p>
          <div className="drama-canvas-card-actions nodrag">
            <button className="drama-canvas-btn is-brand" onClick={(e) => { e.stopPropagation(); actions.askAgent(id); }}><Bot size={12} />让 Agent 合成成片</button>
          </div>
          <p className="drama-canvas-hint">合成要用 ffmpeg，由 Agent 在本机会话里跑（本项目不内置合成器）。</p>
        </>
      );
    }
    // character / location
    const embedded = String(payload.ref || "");
    return (
      <>
        {embedded ? <MediaPreview path={embedded} alt={String(payload.name || def.label)} kind="image" /> : null}
        <div className="drama-canvas-card-text">{String(payload.description || (embedded ? "" : kind === "character" ? "还没有人物设定" : "还没有场景设定"))}</div>
        <GenButtons id={id} kind={kind} payload={payload} busyKey={busyKey} />
      </>
    );
  })();

  return (
    <article className={`drama-canvas-card is-${kind} ${selected ? "is-selected" : ""}`} data-kind={kind}>
      <Head kind={kind} id={id} title={dramaNodeLabel(kind, payload)} subtitle={subtitleOf()} />
      <div className="drama-canvas-card-body">{body}</div>
      <Handle type="target" position={Position.Left} className="drama-canvas-handle" />
      <Handle type="source" position={Position.Right} className="drama-canvas-handle" />
      {kind === "shot" && payload.first_frame ? (
        <button className="drama-canvas-card-peek nodrag" title="在右侧预览" onClick={(e) => { e.stopPropagation(); actions.openInspector(id); }}><Eye size={12} /></button>
      ) : null}
    </article>
  );
}

export const DramaNodeCard = memo(DramaNodeCardInner);
