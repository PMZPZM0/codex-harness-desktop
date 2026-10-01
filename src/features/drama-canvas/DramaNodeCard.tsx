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
import { AppSelect } from "../../components/AppSelect";
import { memo, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Bot,
  Clapperboard,
  Eye,
  FileText,
  Film,
  Image as ImageIcon,
  Images,
  ListChecks,
  Lock,
  MapPin,
  Music,
  NotebookPen,
  Sparkles,
  Settings,
  User,
  Video,
  X,
  Upload,
  type LucideIcon,
  Loader2,
} from "lucide-react";
import { imageDisplaySrc } from "../../lib/image-src.mjs";
import { detailPanelsOf, dramaIsKnownKind, dramaNodeDef, dramaNodeLabel, imageKindMeta } from "../../lib/drama-canvas-model.mjs";
import { useDramaActions } from "./drama-actions";
/* ⛔ 按钮本体共享（卡面 + 检查器同一颗）—— 见 DramaChannelButton.tsx 顶部注释。 */
import { DramaChannelButton, dramaCardActions, GEN_CHANNELS, POLISH_LABEL, visibleChannels } from "./DramaChannelButton";
import { useLocalAudio } from "./use-local-audio";
import type { DramaRFNode } from "./use-drama-board";

/** 参考图列表：新格式 payload.refs（多张）；旧画布只有单值 payload.ref ⇒ 兼容读取。 */
export function refsOf(payload: Record<string, any> | undefined): string[] {
  const list = Array.isArray(payload?.refs) ? (payload!.refs as unknown[]).filter((entry) => typeof entry === "string" && entry) as string[] : [];
  if (list.length) return list;
  const single = String(payload?.ref || "").trim();
  return single ? [single] : [];
}

/**
 * 参考图九宫格（10-01 用户：「参考图要能传多个 + 九宫格展示 + 可删除」）：
 * 卡面与检查器**共用这一颗**（同一份展示与删除逻辑，免得两处长得不一样）。
 * 缩略图按三列网格排、统一裁切成同高方块 —— 原图再大也不会把卡片撑爆（用户实测「参考图太大了」）。
 */
export function DramaRefGrid({ refs, onRemove, title }: { refs: string[]; onRemove?: (path: string) => void; title?: string }) {
  if (!refs.length) return null;
  return (
    <div className="drama-canvas-card-ref" title={title ?? `参考图 ${refs.length} 张（生成时用第一张；点右上角 × 可删除单张）`}>
      <span className="drama-canvas-card-ref-tag">参考图 · {refs.length}</span>
      <div className="drama-ref-grid">
        {refs.map((ref) => (
          <span className="drama-ref-cell" key={ref} title={String(ref).split(/[\\/]/).pop()}>
            <img className="drama-ref-thumb" src={imageDisplaySrc(ref)} alt="参考图" loading="lazy" />
            {onRemove ? <button type="button" className="drama-ref-remove" title="移除这张参考图" onClick={(event) => { event.stopPropagation(); onRemove(ref); }}><X size={10} /></button> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

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
  imagegen: Images,
  video: Clapperboard,
  audio: Music,
  timeline: Film,
};

function Head({ kind, id, title, subtitle, extra, role, step }: { kind: string; id: string; title: string; subtitle: string; extra?: ReactNode; role?: { key: "input" | "output"; label: string } | null; step?: number }) {
  const actions = useDramaActions();
  const def = dramaNodeDef(kind);
  const Icon = ICONS[kind] || NotebookPen;
  return (
    <header className="drama-canvas-card-head">
      <span className="drama-canvas-card-glyph"><Icon size={14} /></span>
      <div className="drama-canvas-card-title">
        <b>{step ? <span className="drama-canvas-card-step" title={`流程第 ${step} 步`}>{step}</span> : null}{title}{role ? <span className={`drama-canvas-card-role is-${role.key}`} title={role.key === "input" ? "这一步是「输入」——把提示词 / 参考喂进去" : "这一步是「产物」——生成结果落在这张卡上"}>{role.label}</span> : null}</b>
        <small>{subtitle || def.subtitle}</small>
      </div>
      {extra}
      <button className="drama-canvas-card-tool nodrag" title="打开设置" aria-label="打开设置" onClick={(e) => { e.stopPropagation(); actions.openInspector(id); }}><Settings size={13} /></button>
      <button className="drama-canvas-card-tool is-danger nodrag" title="删除节点" aria-label="删除节点" onClick={(e) => { e.stopPropagation(); actions.board.removeNodes([id]); }}><X size={13} /></button>
    </header>
  );
}

/** 卡片上的媒体缩略图（09-29 用户：「工作流卡片里面的图片没有预览功能，不方便」）。
 *  ⛔ 包成 button 是为了**可点开** —— 缩略图本身就是看产物的入口，只显示不给点等于没有预览。
 *    stopPropagation 必须有：否则点图片会连带选中/拖动卡片。 */
function MediaPreview({ path, alt, kind, title, nodeId, fields, channel }: {
  path: string; alt: string; kind: "image" | "video";
  title?: string; nodeId?: string; fields?: string[]; channel?: "image" | "video" | "audio";
}) {
  const actions = useDramaActions();
  if (!path) return null;
  const name = path.split(/[\\/]/).pop() || path;
  const open = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    actions.openMedia({ path, kind, title: title ? `${title} · ${name}` : name, nodeId, fields, channel });
  };
  if (kind === "video") {
    return (
      <button className="drama-canvas-card-media nodrag nowheel" title={`点开预览/操作：${path}`} onClick={open}>
        <Video size={16} /><span>{name}</span>
      </button>
    );
  }
  return (
    <button className="drama-canvas-card-shotbtn nodrag" title={`点开预览大图：${name}`} onClick={open}>
      <img className="drama-canvas-card-shot" src={imageDisplaySrc(path)} alt={alt} loading="lazy" />
    </button>
  );
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
/* ⛔ 通道映射表已提到 DramaChannelButton.tsx（导出 GEN_CHANNELS）—— 卡面与检查器共用一份。
   原来检查器不查这张表 ⇒ 选中笔记卡也能点「生成图片」，与卡面行为相反（09-28 code review 抓到）。 */

function GenButtons({ id, kind, payload, busyKey }: { id: string; kind: string; payload: Record<string, any>; busyKey: (what: string) => boolean }) {
  const actions = useDramaActions();
  /* ⛔ 不再因为"没有生成通道"就整体不渲染：笔记 / 剧本卡没有通道，但「AI 润色」必须还在。 */
  /* ⛔ 按状态过滤通道（09-29 按钮精简）：没出图的卡不给「视频」—— 见 visibleChannels 注释。 */
  /* ⛔⛔ 卡角色（payload.act，09-29 用户：「每个工作流内所有卡片上的按键名称和功能必须唯一，不得重复」）：
     模板卡显式声明角色，按键按角色分发 ⇒ 同一工作流里**生成入口只有一张卡**：
       · act: "generate" ⇒ 生成按钮（按通道表与状态）+ 上传参考图（唯一的动作入口）
       · act: "upload"   ⇒ **只有**「上传参考图」（素材位：从外部拖/传进来，不在本工作台生成）
       · act: "output"   ⇒ **不出按钮**（产物位：纯展示结果，空态已写明「点左边的生图，图出在这里」）
       · 未标记（用户自由拖的卡）⇒ 走 kind + 状态规则（自由编排不受限）
     ⚠️ 口径：**不同角色**的卡按键不重复；**同一角色多张卡**（短剧流里多个角色卡）保有同类按键是
        必要能力（否则第二个角色没法制图），不算重复。 */
  /* ⛔⛔ 卡角色按键（09-29 用户纠正：「写提示词，就加一个 AI 润色文案功能，出图就生图按键…
     出图现在没有生图按键，怎么行」—— 上轮我把产物位按钮删空了，理解偏了）：
       每张卡按角色给**专属**按键，名字不重复、功能各自齐备：
       · act: "prompt"（写提示词位）⇒ 「AI 润色」+「上传参考图」（生图入口在出图卡）
       · act: "output"（出图位）      ⇒ 「生图」（已有图时按钮自动叫「重出」）
       · act: "upload"（素材位）      ⇒ 「上传参考图」
       · act: "produce"（产出位：素材从上游来）⇒ 生成按钮，**不给**上传（避免每张卡都挂上传）
       · act: "generate"（通用生成位）⇒ 生成按钮 + 上传参考图
       · 未标记（自由拖的卡）         ⇒ 走 kind + 状态规则 */
  /* ⛔ 判据全部来自共享的 dramaCardActions —— 卡面与检查器必须同一份实现（两份必漂移）。 */
  const { channels: allowed, canUpload, polishField } = dramaCardActions(kind, payload);
  const act = String(payload.act || "");
  /* ⛔ 按钮本体在 DramaChannelButton（09-28）—— 卡面与右侧检查器**共用同一颗按钮**。
     原来两处各写一份：卡面改名后（09-29 定稿为「生图」），检查器里还叫「生成图片」、未配置也不给
     引导（点了才报错）—— 同一个动作两套实现的必然结果。这里只决定「露出哪几条通道」。
     09-28 闭环追加：素材类卡加「上传参考图」（此前只有拖拽一条路，用户不知道能传）。 */
  /* ⛔ 上传参考图只在**输入位**给（09-29 精简）：没图的出图卡 / 已有定妆照的角色卡 / 已有首帧的镜头卡
     都不再重复出现这颗按钮 —— 每张卡都挂全套按键正是用户吐槽的「重复按键」。 */
  return (
    <div className="drama-canvas-card-actions nodrag">
      {allowed.map((what) => (
        <DramaChannelButton key={what} id={id} kind={kind} what={what} payload={payload} busyKey={busyKey} />
      ))}
      {/* 「AI 润色」**每张提示词卡都给**（09-29 用户：「在每张提示词卡片中都要集成AI润色功能」）：
          按 kind 找到这张卡**自己的**提示词字段，润色结果就地写回那个字段（不再只认 text）。
          ⛔ 不开会话 —— 主进程用已配置的模型发一次短请求。 */}
      {polishField && act !== "output" ? (
        <button
          className="drama-canvas-btn is-ghost"
          title={`用已配置的模型润色这张卡的「${POLISH_LABEL[polishField] || "提示词"}」（补主体细节 / 环境 / 光线 / 构图 / 风格），结果直接写回卡片`}
          disabled={busyKey("polish")}
          onClick={async (e) => {
            e.stopPropagation();
            const current = String(payload[polishField] || "").trim();
            const polished = await actions.story.polishPrompt(id, current);
            if (polished) actions.board.updatePayload(id, { [polishField]: polished });
          }}
        >
          {busyKey("polish") ? <Loader2 size={12} className="is-spin" /> : <Sparkles size={12} />}AI 润色
        </button>
      ) : null}
      {/* 锁定主体（09-29 电商出图工作流）：把「商品参考图」反推成一段固定主体描述，六类图共用。
          ⛔ 生图通道是纯文生图（无图输入）⇒ 这是「参考图锁主体」的可行替代：文本层面锁死同一件商品。 */}
      {/* 「锁定主体」只在**母版卡**（白底图）上给 —— 它是整套图的主体真相源；
          其余卡生成时自动沿用上游那段描述 ⇒ 不必 6 张卡各挂一颗重复键（用户：「功能全是重复的」）。 */}
      {kind === "imagegen" && (payload.imageType === "white" || payload.subject) ? (
        <button
          className="drama-canvas-btn is-ghost"
          title={payload.subject ? "重新锁定主体（会覆盖当前这段主体描述）" : "把上游「商品参考图」反推成一段固定主体描述 —— 主图 / SKU / 详情 / 场景 / 白底 / 买家秀 共用，保证一套图是同一件商品"}
          disabled={busyKey("subject")}
          onClick={async (e) => {
            e.stopPropagation();
            const text = await actions.story.describeSubject(id);
            if (text) actions.board.updatePayload(id, { subject: text });
          }}
        >
          {busyKey("subject") ? <Loader2 size={12} className="is-spin" /> : <Lock size={12} />}锁定主体
        </button>
      ) : null}
      {canUpload ? (
        <button className="drama-canvas-btn is-ghost" title="从本机选一张图当参考图 / 首帧（也会存进工作区）" onClick={(e) => { e.stopPropagation(); void actions.story.uploadRef(id); }}>
          <Upload size={12} />上传参考图
        </button>
      ) : null}
    </div>
  );
}

function DramaNodeCardInner({ id, data, selected }: NodeProps<DramaRFNode>) {
  const actions = useDramaActions();
  const kind = String(data?.kind || "note");
  const payload = (data?.payload || {}) as Record<string, any>;
  const def = dramaNodeDef(kind);
  const busyKey = (what: string) => actions.story.busy.has(`${id}:${what}`);
  /* 这张卡正在干活吗（09-29 用户：「卡片那个在工作，那个就亮起来」）——
     忙碌键形如 `${nodeId}:${通道}`，按前缀判即可，不用逐个通道去问。 */
  const working = [...actions.story.busy].some((k) => k.startsWith(`${id}:`));
  const update = (patch: Record<string, any>) => actions.board.updatePayload(id, patch);
  const subtitleOf = () => {
    if (kind === "shot") return `${payload.shot_size || "镜头"} · ${payload.duration || 4}s`;
    if (kind === "scene") return `${payload.place || "未命名场次"}${payload.time ? ` · ${payload.time}` : ""}`;
    if (kind === "agent") return payload.role || def.subtitle;
    if (kind === "image" || kind === "audio") return payload.role || def.subtitle;
    if (kind === "imagegen") { const meta = imageKindMeta(payload.imageType); return `${meta.label} · ${meta.ratio}`; }
    return def.subtitle;
  };
  /* 卡片角色（09-29 用户：「生图流程看不懂」—— 卡片角色分不清 / 图落在哪张卡不明）。
     ⛔ 按**状态**判定，不按 kind：同一张 image 卡，没出图时它是「提示词」（输入），出图后是「出图结果」（产物）。
     配色也按 input / output 两大类走（见 21-drama-canvas.css 的 .is-role-*），一眼分出喂进去的与吐出来的。 */
  const roleOf = (): { key: "input" | "output"; label: string } | null => {
    if (kind === "image") return payload.path || payload.url ? { key: "output", label: "出图结果" } : payload.hint === "ref" ? { key: "input", label: "参考图" } : { key: "input", label: "提示词" };
    if (kind === "imagegen") return payload.path || payload.url ? { key: "output", label: "出图结果" } : { key: "input", label: "提示词" };
    if (kind === "shot") return payload.video ? { key: "output", label: "镜头成片" } : payload.first_frame ? { key: "output", label: "镜头首帧" } : { key: "input", label: "镜头提示词" };
    if (kind === "character") return payload.ref ? { key: "output", label: "角色定妆照" } : { key: "input", label: "角色设定" };
    if (kind === "location") return payload.ref ? { key: "output", label: "场景图" } : { key: "input", label: "场景设定" };
    if (kind === "script") return { key: "input", label: "剧本" };
    if (kind === "storyboard") return { key: "input", label: "分镜表" };
    if (kind === "timeline") return { key: "output", label: "成片" };
    return null;
  };
  const role = roleOf();
  const step = Number(payload.step) > 0 ? Number(payload.step) : 0;

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
            <AppSelect value={payload.board || ""} onChange={(v) => update({ board: v })} options={[{ value: "", label: `${options.length ? "（未绑定）" : "还没有分镜表 —— 先去右侧新建一份"}` }, ...(options).map((s) => ({ value: (s.name), label: (`${s.title || s.name} · ${s.shots} 镜`), }))]} className="nodrag" />
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
      const shotRefs = actions.linkedShotRefs(id);
      /* 一致性检查（调研里的 continuity pass）：同一场的首帧并排看 ——
         发型 / 服装 / 光线方向 / 色温 不一致，切镜就会"像换了个世界"。 */
      const frames = shotRefs.filter((s) => s.payload.first_frame);
      return (
        <>
          <div className="drama-canvas-count">{shots.length} 镜 · 首帧 {frames.length}/{shots.length}</div>
          {frames.length ? (
            <div className="drama-canvas-strip nowheel" title="本场已出的首帧并排看：检查发型 / 服装 / 光线方向 / 色温是否一致（切镜才不像换了个世界）">
              {frames.slice(0, 6).map((s, i) => (
                <img key={s.id} className="drama-canvas-strip-img" src={imageDisplaySrc(String(s.payload.first_frame))} alt={String(s.payload.id || `镜 ${i + 1}`)} loading="lazy" />
              ))}
            </div>
          ) : null}
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
          {/* 按场分批（调研：同类光照/场景的提示词连着跑更稳，也更快看出漂移）。
              这里只做「选中本场镜头」，出图交给顶栏「批量生成 → 仅选中」——
              ⛔ 不在这里偷偷替用户发请求（批量是花钱的，要用户自己按）。 */}
          <div className="drama-canvas-card-actions nodrag">
            <button
              className="drama-canvas-btn is-ghost"
              disabled={!shotRefs.length}
              title="选中这一场的所有镜头卡；再用顶栏「批量生成 → 仅选中」按场出首帧（按场分批比逐镜跳场景更稳）"
              onClick={(e) => { e.stopPropagation(); actions.board.select(shotRefs.map((s) => s.id), shotRefs[0].id); actions.openResults?.(); }}
            >
              <ListChecks size={12} />选中本场 {shotRefs.length} 镜
            </button>
          </div>
        </>
      );
    }
    if (kind === "shot") {
      return (
        <>
          {payload.first_frame ? <MediaPreview path={String(payload.first_frame)} alt="首帧" kind="image" title={String(payload.title || "首帧")} nodeId={id} fields={["first_frame"]} channel="image" /> : <div className="drama-canvas-empty"><Sparkles size={16} /><span>还没有首帧</span></div>}
          <div className="drama-canvas-card-text is-prompt">{String(payload.prompt || "（生成时自动沿用连入的剧本与场景描述，可直接生成）")}</div>
          {/* 上游摘要（09-29）：这张镜头吃谁 —— 本场 / 角色 / 场景，不用回头数线 */}
          {(() => {
            const ups = actions.board.edges
              .filter((e) => e.target === id)
              .map((e) => actions.board.nodes.find((n) => n.id === e.source))
              .filter((n) => n && ["scene", "character", "location"].includes(String(n.data?.kind)));
            if (!ups.length) return null;
            const tag: Record<string, string> = { scene: "本场", character: "角色", location: "场景" };
            return (
              <div className="drama-canvas-chips">
                {ups.slice(0, 4).map((n) => (
                  <span className="drama-canvas-chip" key={n!.id} title={`${tag[String(n!.data?.kind)] || "输入"}：${String(n!.data?.payload?.name || n!.data?.payload?.place || n!.id)}`}>
                    {tag[String(n!.data?.kind)] || "输入"} {String(n!.data?.payload?.name || n!.data?.payload?.place || "").slice(0, 6)}
                  </span>
                ))}
              </div>
            );
          })()}
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
        </>
      );
    }
    if (kind === "imagegen") {
      /* 独立生图节点的卡面（09-29）：图类型 + 尺寸 + 提示词 + 锁定主体 + 参考图 + 详情图块清单。
         ⛔ 与 image 卡分开写 —— 两者语义不同（参考图是素材槽，这张是产出槽），共用一个分支
            必然又要互相迁就。 */
      const meta = imageKindMeta(payload.imageType);
      const outPath = String(payload.path || payload.url || "");
      const refPath = String(payload.ref || "");
      const tiles = meta.key === "detail" ? detailPanelsOf(payload) : [];
      return (
        <>
          {outPath
            ? <MediaPreview path={outPath} alt={String(payload.title || meta.label)} kind="image" title={String(payload.title || meta.label)} nodeId={id} fields={["path", "url"]} channel="image" />
            : <div className="drama-canvas-empty"><Sparkles size={16} /><span>{payload.hint === "output" ? "产物位：点上游那张卡的「生图」" : `还没有${meta.label} —— 写好提示词点下面的「生图」`}</span></div>}
          <div className="drama-canvas-card-line">{meta.label} · {meta.ratio}{meta.key === "detail" && tiles.length ? ` · ${tiles.length} 图块` : ""}</div>
          <div className="drama-canvas-card-text is-prompt">{String(payload.prompt || meta.skeleton)}</div>
          {payload.subject ? (
            <div className="drama-canvas-card-ref" title="整套图共用的主体描述（锁定同一件商品）">
              <span className="drama-canvas-card-ref-tag">锁定主体</span>
              <span>{String(payload.subject)}</span>
            </div>
          ) : null}
          {meta.key === "detail" ? (
            <ul className="drama-canvas-hint" style={{ margin: 0, paddingLeft: 16 }}>
              {tiles.slice(0, 6).map((tile) => <li key={tile}>{tile}</li>)}
            </ul>
          ) : null}
          {refsOf(payload).length ? <DramaRefGrid refs={refsOf(payload)} onRemove={(refPath) => void actions.story.removeRef(id, refPath)} title="商品参考图（可多张，与生成结果分开存；生成时用第一张）" /> : null}
          <GenButtons id={id} kind={kind} payload={payload} busyKey={busyKey} />
        </>
      );
    }
    if (kind === "image" || kind === "audio") {
      const path = String(payload.path || payload.url || "");
      /* ⛔ 参考图（payload.ref）与生成产物（payload.path）**分开显示**（09-29 用户：上传的参考图
         会把已生成的图顶掉）。规则：有产物时主位给产物、参考图退到下方缩略条；只有参考图还没出图时，
         主位显示参考图并在标题里写明是它（免得用户以为已经出图了）。 */
      const refPath = String(payload.ref || "");
      const imageRefs = refsOf(payload);
      return (
        <>
          {/* ⛔ 参考图统一走九宫格（10-01 用户：多张 + 九宫格 + 可删；「参考图太大了」——
              原先是整张大图直接铺满卡片）。产物位（path）仍用大预览。 */}
          {kind === "image" && refPath && !path && imageRefs.length === 1 ? <MediaPreview path={refPath} alt="参考图" kind="image" title="参考图（还没出图）" nodeId={id} fields={["ref"]} channel="image" /> : null}
          {kind === "image" && path ? <MediaPreview path={path} alt={String(payload.title || "出图")} kind="image" title={String(payload.title || "出图")} nodeId={id} fields={["path", "url"]} channel="image" /> : null}
          {kind === "image" && imageRefs.length ? <DramaRefGrid refs={imageRefs} onRemove={(refItem) => void actions.story.removeRef(id, refItem)} /> : null}
          {kind === "audio" ? <AudioPreview path={path} /> : null}
          {/* ⛔ 空态文案要让人**照做**（09-29 用户要新手向）：说清"在这写什么 + 写完点哪 + 图去哪"。 */}
          <div className="drama-canvas-card-text">{String(payload.text || payload.prompt || (path
            ? "这张已经出图了：想换一版点下面的「重出」；想微调就先改提示词再出。"
            : payload.hint === "output"
              ? "产物位：点左边「写提示词」卡上的「生图」，图会出在这里。（也可以在这张卡直接写提示词生成）"
              : payload.hint === "ref"
                ? "商品参考图：点下面的「上传参考图」把商品照片放进来；再到右边的生图卡点「锁定主体」，它就变成整套图共用的主体描述（六类图不再各拍各的）。"
                : "在这里写你要什么，例：一只橘猫坐在窗台上，暖色午后光。写完点下面的「生图」。"))}</div>
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
            {/* ⛔ 09-29 纠错：这里原写「本项目不内置合成器」——**已经过期**，本机 ffmpeg 拼接
                通道（video:concat）当天就接好了。卡面必须给真实能力，否则用户被文案骗去开会话。 */}
            <button className="drama-canvas-btn is-brand" disabled={actions.story.exporting} title="把这一场/整片按分镜顺序拼接成一条成片（本机 ffmpeg；缺镜会自动跳过并告诉你）" onClick={(e) => { e.stopPropagation(); void actions.story.exportMovie(); }}>
              {actions.story.exporting ? <Loader2 size={12} className="is-spin" /> : <Film size={12} />}拼接成片（本机）
            </button>
            <button className="drama-canvas-btn is-ghost" title="要加字幕 / 调色 / 精剪时再走会话 —— 本机拼接只做合轨与拼接" onClick={(e) => { e.stopPropagation(); actions.askAgent(id); }}><Bot size={12} />让 Agent 精修</button>
          </div>
          <p className="drama-canvas-hint">本机拼接 = 按分镜顺序合轨 + 拼接（缺镜跳过）；字幕 / 调色 / 变速这些要进剪辑器或让 Agent 做。</p>
        </>
      );
    }
    // character / location
    const embedded = String(payload.ref || "");
    /* 关联性（09-29 用户：「各个卡片之间应具有较高的关联性」）：角色 / 场景是**一致性锚点**，
       用了多少镜必须一眼看见 —— 没有它，「定妆照改了要不要重出首帧」根本无从判断。 */
    const usedBy = actions.board.edges
      .filter((e) => e.target === id)
      .map((e) => actions.board.nodes.find((n) => n.id === e.source))
      .filter((n) => n && String(n.data?.kind) === "shot").length;
    return (
      <>
        {/* 角色/场景锚点：定妆照/场景图是**产出**（大预览），上传的参考图另走九宫格
            （10-01：可多张、可删除；与产物分开存，互不覆盖）。 */}
        {embedded ? <MediaPreview path={embedded} alt={String(payload.name || def.label)} kind="image" title={String(payload.name || def.label)} nodeId={id} fields={["ref"]} channel="image" /> : null}
        {refsOf(payload).length && refsOf(payload)[0] !== embedded ? <DramaRefGrid refs={refsOf(payload)} onRemove={(refItem) => void actions.story.removeRef(id, refItem)} title="参考图（可多张；生成时用第一张）" /> : null}
        {usedBy ? <div className="drama-canvas-card-line" title="有几张镜头卡连到了这张锚点卡 —— 改了它，这些镜头的首帧要重出才一致">{usedBy} 镜在用</div> : null}
        <div className="drama-canvas-card-text">{String(payload.description || (embedded ? "" : kind === "character" ? "（人物设定：生成定妆照时自动沿用连入的剧本内容，可在此改写）" : "（场景设定：生成场景图时自动沿用连入的剧本内容，可在此改写）"))}</div>
        <GenButtons id={id} kind={kind} payload={payload} busyKey={busyKey} />
      </>
    );
  })();

  return (
    <article className={`drama-canvas-card is-${kind} ${role ? `is-role-${role.key}` : ""} ${selected ? "is-selected" : ""} ${working ? "is-working" : ""}`} data-kind={kind}>
      <Head kind={kind} id={id} title={dramaNodeLabel(kind, payload)} subtitle={subtitleOf()} role={role} step={step} />
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
