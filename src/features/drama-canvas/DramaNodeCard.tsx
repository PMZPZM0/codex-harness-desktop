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

function GenButtons({ id, kind, payload, busyKey }: { id: string; kind: string; payload: Record<string, any>; busyKey: (what: string) => boolean }) {
  const actions = useDramaActions();
  const hasImage = Boolean(payload.first_frame || payload.ref || payload.path);
  const imageLabel = kind === "character" ? "生成定妆照" : kind === "location" ? "生成场景图" : hasImage ? "重跑首帧" : "生成首帧";
  return (
    <div className="drama-canvas-card-actions nodrag">
      <button className="drama-canvas-btn" disabled={busyKey("image")} onClick={(e) => { e.stopPropagation(); void actions.story.generate(id, "image"); }}>
        {busyKey("image") ? <Loader2 size={12} className="drama-canvas-spin" /> : <Sparkles size={12} />}
        {busyKey("image") ? "生成中…" : imageLabel}
      </button>
      {kind === "shot" || kind === "audio" ? (
        <button className="drama-canvas-btn is-ghost" disabled={busyKey("audio") || !String(payload.line || payload.text || "").trim()} onClick={(e) => { e.stopPropagation(); void actions.story.generate(id, "audio"); }} title={String(payload.line || payload.text || "").trim() ? "用本机语音模型合成这一句" : "这一镜没有台词，先写上 line"}>
          {busyKey("audio") ? <Loader2 size={12} className="drama-canvas-spin" /> : <Mic size={12} />}
          {busyKey("audio") ? "合成中…" : payload.audio || payload.path ? "重做配音" : "生成配音"}
        </button>
      ) : null}
      <button className="drama-canvas-btn" onClick={(e) => { e.stopPropagation(); void actions.story.generate(id, "video"); }} title={payload.first_frame ? "图生视频（用已生成的首帧）" : "文生视频（没有首帧时走 t2v）"}>
        {busyKey("video") ? <Loader2 size={12} className="drama-canvas-spin" /> : <Video size={12} />}
        {busyKey("video") ? "生成中…" : payload.video ? "重做视频" : "生成视频"}
      </button>
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
