/**
 * 右侧检查器（域内私有）：看/改选中节点的完整字段、改连线关系、回写分镜表。
 *
 * 卡面只放最常用的三五个按钮 —— 完整字段全在这儿。这样卡片能保持固定尺寸
 * （尺寸一变，画布排版与命中测试全得跟着变），也避免卡面上堆二十个输入框。
 */
import { useCallback, useEffect, useState } from "react";
import { AppSelect } from "../../components/AppSelect";
import { Clapperboard, FolderOpen, FolderSearch, Link2, Loader2, RefreshCw, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { detailPanelsOf, dramaNodeDef, dramaNodeLabel, dramaRelationLabel, dramaRelationOptions, imageKindMeta, imageKindOptions } from "../../lib/drama-canvas-model.mjs";
import { STORYBOARD_ASPECTS, STORYBOARD_SHOT_SIZES } from "../../lib/drama-storyboard.mjs";
import { VIDEO_ASPECTS } from "../../lib/media-aspects.mjs";
import { useDramaActions } from "./drama-actions";
/* ⛔ 生成按钮与通道映射表都从 DramaChannelButton 取（卡面同源）—— 检查器原来自己写了一份
   「生成图片」按钮：文案与卡面不一致、未配置不给引导、还不查节点类型（笔记卡上也能点），
   三处都与卡面相反。同一个动作只能有一个实现。 */
import { DramaChannelButton, dramaCardActions, dramaCardRole, GEN_CHANNELS, POLISH_LABEL, visibleChannels } from "./DramaChannelButton";

interface FieldSpec {
  key: string;
  label: string;
  type?: "text" | "textarea" | "number" | "select";
  options?: Array<string | { value: string; label: string }>;   // 字符串 = 值即显示；对象 = value 存 payload、label 给人看
  placeholder?: string;
  hint?: string;
}

/** 每种卡在检查器里露哪些字段。**只列会被用到、会被回写的**，不做万能表单。 */
/** 生图尺寸预设（09-29 自媒体刚需：平台画幅各不相同，手填容易错）。
 *  ⛔ 网关接受的尺寸各不相同 —— 报错就把这项清空走默认，不要硬试。 */
const IMAGE_SIZE_PRESETS = [
  { value: "1024x1024", label: "1:1 · 1024×1024（电商主图 / 头像 / 方图）" },
  { value: "1024x1365", label: "3:4 · 1024×1365（电商详情 / 小红书）" },
  { value: "768x1365", label: "9:16 · 768×1365（抖音 / 视频号封面）" },
  { value: "1024x1536", label: "2:3 · 1024×1536（竖版海报 / 手机壁纸）" },
  { value: "1536x1024", label: "3:2 · 1536×1024（横版配图 / 公众号封面）" },
  { value: "1365x768", label: "16:9 · 1365×768（B 站 / 宽屏封面）" },
  { value: "2048x512", label: "4:1 · 2048×512（店铺 / 活动横幅）" },
];

const FIELDS: Record<string, FieldSpec[]> = {
  note: [{ key: "title", label: "标题" }, { key: "text", label: "内容", type: "textarea" }],
  script: [
    { key: "title", label: "标题" },
    { key: "text", label: "剧本正文", type: "textarea", placeholder: "一句话概念、人物关系、冲突、对白与结局" },
    { key: "aspect", label: "画幅", type: "select", options: STORYBOARD_ASPECTS },
    { key: "shotDuration", label: "每镜时长（秒）", type: "number" },
    { key: "style", label: "统一风格", placeholder: "光线、色调、质感 —— 会拼在每镜提示词最前面", hint: "不写的话镜与镜之间画风会飘" },
  ],
  agent: [
    { key: "title", label: "标题" },
    { key: "task", label: "任务描述", type: "textarea" },
    { key: "status", label: "状态" },
  ],
  character: [
    { key: "name", label: "姓名" },
    { key: "role", label: "定位" },
    { key: "look", label: "外貌描写", type: "textarea", hint: "写死一段，后面每镜照抄 —— 每镜现编会让脸一镜一个样" },
    { key: "description", label: "性格与目标", type: "textarea" },
    { key: "size", label: "尺寸 / 画幅", type: "select", options: IMAGE_SIZE_PRESETS.map((p) => p.value), hint: "按平台/用途选；网关不认这个尺寸会报错 —— 清空即走默认" },
    { key: "negative", label: "负面提示词", type: "textarea", placeholder: "不要文字、不要畸形手指、不要水印、不要多余肢体…", hint: "写清楚不想要什么；不是每个网关都支持，无效时改回正面描述" },    { key: "ref", label: "定妆照路径", hint: "这是每一镜生首帧要参照的那张图" },
  ],
  location: [
    { key: "name", label: "场景名" },
    { key: "time", label: "时间 / 光线" },
    { key: "description", label: "场景描写", type: "textarea" },
    { key: "size", label: "尺寸 / 画幅", type: "select", options: IMAGE_SIZE_PRESETS.map((p) => p.value), hint: "按平台/用途选；网关不认这个尺寸会报错 —— 清空即走默认" },
    { key: "negative", label: "负面提示词", type: "textarea", placeholder: "不要文字、不要畸形手指、不要水印、不要多余肢体…", hint: "写清楚不想要什么；不是每个网关都支持，无效时改回正面描述" },    { key: "ref", label: "场景图路径" },
  ],
  storyboard: [
    { key: "board", label: "分镜表" },
    { key: "style", label: "统一风格（读自分镜表）" },
  ],
  scene: [
    { key: "id", label: "场次号" },
    { key: "place", label: "地点" },
    { key: "time", label: "时间 / 光线" },
  ],
  shot: [
    { key: "id", label: "镜头号" },
    { key: "shot_size", label: "景别", type: "select", options: STORYBOARD_SHOT_SIZES },
    { key: "duration", label: "时长（秒）", type: "number" },
    { key: "aspect", label: "画幅", type: "select", options: VIDEO_ASPECTS, hint: "只有通义万相 / 即梦Seedance / Runway / Veo 支持指定画幅；其余厂商按模型默认输出（选了会明确报错）" },
    { key: "ref_video", label: "参考视频（白模预演）", placeholder: "白模参考片的公网 URL —— 仅 Seedance 2.0/2.5 支持", hint: "白模工作流：把 Blender 渲染的参考片传到可公网访问的位置，URL 粘到这里；用 Seedance 2.5 时 AI 跟着白模的构图与运镜渲染" },
    { key: "prompt", label: "首帧提示词", type: "textarea", placeholder: "景别 + 场景 + 姿态 + 光线" },
    { key: "motion", label: "动作与运镜", type: "textarea", placeholder: "只写动作和运镜，画面内容已经在首帧里" },
    { key: "line", label: "台词 / 旁白", placeholder: "空着就是无人声镜头" },
    { key: "speaker", label: "说话人（角色 id）" },
    { key: "first_frame", label: "首帧产物", hint: "由生成写回；改它会同步回分镜表" },
    { key: "video", label: "视频产物" },
    { key: "audio", label: "配音产物" },
  ],
  image: [
    { key: "title", label: "标题" },
    { key: "size", label: "尺寸 / 画幅", type: "select", options: [{ value: "", label: "默认（由生图接口决定）" }, ...IMAGE_SIZE_PRESETS.map((p) => ({ value: p.value, label: p.label }))], hint: "按用途选比例：电商主图 1:1、详情 3:4、抖音 9:16、B站 16:9。个别接口不认该尺寸会报错 —— 选回「默认」即可" },
    { key: "negative", label: "负面提示词", type: "textarea", placeholder: "不要文字、不要畸形手指、不要水印、不要多余肢体…", hint: "写清楚**不想要什么**，比在正面词里绕半天有效；不是每个网关都支持，无效时改回正面描述" },
    { key: "role", label: "用途" },
    { key: "path", label: "文件路径" },
    { key: "text", label: "说明", type: "textarea" },
  ],
  /* 独立生图节点（09-29 用户：把生图节点独立出来 + 六类图 + 尺寸等可选配置）。
     ⛔ 与 image（参考图）/ video 不共用字段表 —— 它是**产出位**：类型 / 尺寸 / 张数 / 锁定主体 /
        提示词 / 负面词 / 图块清单，视频那套（画幅 / 时长 / 参考视频）一个字都不带。 */
  imagegen: [
    { key: "title", label: "标题" },
    { key: "imageType", label: "图片类型", type: "select", options: imageKindOptions(), hint: "六类图：主图 / SKU 图 / 详情图 / 场景图 / 白底图 / 买家秀。换类型会自动带出该类型的默认尺寸与构图要点" },
    { key: "size", label: "尺寸 / 画幅", type: "select", options: [{ value: "", label: "默认（由生图接口决定）" }, ...IMAGE_SIZE_PRESETS.map((p) => ({ value: p.value, label: p.label }))], hint: "主图 / SKU / 白底 默认 1:1；场景 / 详情 / 买家秀 默认 3:4。网关不认该尺寸会报错 —— 选回「默认」" },
    { key: "count", label: "出图张数", type: "number", hint: "一次出几张变体（建议 1–4；要批量走顶栏「批量生成」）" },
    { key: "subject", label: "锁定主体（整套图共用）", type: "textarea", hint: "点卡片上的「锁定主体」自动填（把商品参考图反推成一段固定描述）；生成时拼在每张提示词最前 ⇒ 六类图是同一件商品" },
    { key: "prompt", label: "提示词（三段式：主体 + 场景 + 品质）", type: "textarea", placeholder: "例：哑光黑 500ml 保温杯，银色杯盖，放在大理石台面上，晨光从左侧，浅景深，商业产品摄影" },
    { key: "negative", label: "负面提示词", type: "textarea", placeholder: "不要文字、不要水印、不要多余道具、不要畸形" },
    { key: "panels", label: "图块清单（仅详情图）", type: "textarea", hint: "详情图 = 纵向长图 = 这些图块从上到下拼成。本卡逐块写提示词分别出图；长图拼接需在外部完成" },
    { key: "ref", label: "参考图路径", hint: "商品参考图；空着则自动沿用连入的上游参考图" },
    { key: "path", label: "产物路径" },
    { key: "text", label: "备注", type: "textarea" },
  ],
  audio: [
    { key: "title", label: "标题" },
    { key: "text", label: "文本", type: "textarea" },
    { key: "path", label: "音频路径" },
  ],
  video: [
    { key: "title", label: "标题" },
    { key: "prompt", label: "提示词", type: "textarea" },
    { key: "model", label: "模型" },
    { key: "aspect", label: "画幅", type: "select", options: STORYBOARD_ASPECTS },
    { key: "duration", label: "时长（秒）", type: "number" },
  ],
  timeline: [
    { key: "title", label: "标题" },
    { key: "description", label: "说明", type: "textarea" },
    { key: "video", label: "成片路径" },
  ],
};

/**
 * 字段表按**卡角色**给（09-29 用户实测：参考图卡冒出「尺寸 / 负面词 / 用途 / 文件路径 / 说明」——
 * 它只是个上传位）。角色的判据与动作分发同源（act / hint），别再各写一套。
 */
/* ⛔ 导出给守卫用：角色 → 字段是**结构契约**（素材位不许出现尺寸/负面词）。 */
export function fieldsFor(kind: string, payload: Record<string, any>): FieldSpec[] {
  const act = String(payload.act || "");
  const material = act === "upload" || payload.hint === "ref";
  const product = act === "output" || payload.hint === "output";
  if (material && kind === "image") {
    return [
      { key: "title", label: "标题" },
      { key: "ref", label: "参考图路径", hint: "点下面的「上传参考图」把商品图放进来 —— 这张卡只负责把图传进来，出图在生图卡上做" },
    ];
  }
  if (product && kind === "imagegen") {
    return [{ key: "title", label: "标题" }, { key: "path", label: "产物路径" }, { key: "text", label: "备注", type: "textarea" }];
  }
  if (product && kind === "image") {
    return [{ key: "title", label: "标题" }, { key: "path", label: "文件路径" }, { key: "text", label: "说明", type: "textarea" }];
  }
  return FIELDS[kind] || [];
}

/** 「写回分镜表」只对这些 kind 有意义（分镜表里有它们的位置）。 */
const WRITEBACK_KINDS = ["script", "character", "location", "storyboard", "scene", "shot"];

export function DramaInspector({ onClose }: { onClose: () => void }) {
  const actions = useDramaActions();
  const id = actions.board.anchor || actions.board.selectedIds[0] || "";
  const node = actions.board.nodes.find((n) => n.id === id);
  if (!node) return null;
  const kind = String(node.data?.kind || "note");
  const payload = node.data.payload || {};
  const def = dramaNodeDef(kind);
  const fields = fieldsFor(kind, payload);
  /* 动作与字段都按**这张卡在工作流里的角色**给 —— 与卡面**同一份**判据。 */
  const cardActions = dramaCardActions(kind, payload);
  const cardRole = dramaCardRole(kind, payload);
  /* 这张卡属于哪条工作流（09-29）：生图族 = 生图 / 电商出图 / 3D 建模；其余归视频族。 */
  const imageKindFamily = ["imagegen", "image"].includes(kind) ? "image" : "drama";
  const polishField = cardActions.polishField;
  const outEdges = actions.board.edges.filter((e) => e.source === id);
  const inEdges = actions.board.edges.filter((e) => e.target === id);
  const label = (nodeId: string) => {
    const n = actions.board.nodes.find((x) => x.id === nodeId);
    return n ? dramaNodeLabel(String(n.data?.kind || ""), n.data.payload || {}) : nodeId;
  };

  return (
    <aside className={`drama-canvas-inspector is-kind-${kind} is-family-${imageKindFamily}`} aria-label="节点属性">
      <header className="drama-canvas-inspector-head">
        <div>
          <b>{dramaNodeLabel(kind, payload)}</b>
          {/* 头部标明「属于哪条工作流 + 这一步是干什么的」（09-29 用户：「侧边栏未按功能更新」）：
              ⛔ 不同工作流的卡片在检查器里必须**一眼可辨**，而不是统一外样让人以为都一样。 */}
          <small>
            <span className={`drama-canvas-flow-chip is-${imageKindFamily}`}>{imageKindFamily === "image" ? "生图工作流" : "视频工作流"}</span>
            <span className="drama-canvas-flow-chip">{def.label}</span>
            {/* 角色：这张卡在工作流里负责什么（一一对应、职责明确） */}
            <span className={`drama-canvas-flow-chip is-role-${cardRole.key}`} title={cardRole.hint}>{cardRole.label}</span>
            <span>{selectedSummary(actions.board.selectedIds.length)}</span>
          </small>
        </div>
        <button className="drama-canvas-icon-btn nodrag" title="关闭属性面板" onClick={onClose}><X size={14} /></button>
      </header>

      {actions.board.selectedIds.length > 1 ? (
        <p className="drama-canvas-hint">选中了 {actions.board.selectedIds.length} 个节点 —— 多选时只显示批量操作，单个节点的字段在单选时改。</p>
      ) : null}

      <div className="drama-canvas-inspector-body nowheel">
        {/* 生图节点：先把「这是什么图 / 多大 / 几个图块」讲清楚，再给字段（新手最需要这句） */}
        {/* 角色说明（职责明确）：这张卡该干什么、不该干什么 */}
        <p className="drama-canvas-hint">{cardRole.label}：{cardRole.hint}</p>
        {kind === "imagegen" ? (
          <p className="drama-canvas-hint">
            {imageKindMeta(payload.imageType).label}（{imageKindMeta(payload.imageType).ratio}）·
            {imageKindMeta(payload.imageType).purpose}
            {imageKindMeta(payload.imageType).key === "detail" ? ` · 图块 ${detailPanelsOf(payload).length} 个` : ""}
          </p>
        ) : null}
        {!fields.length ? <p className="drama-canvas-hint">这个类型的节点没有可编辑字段。</p> : null}
        {fields.map((f) => (
          <label className="drama-canvas-field" key={f.key}>
            <span>{f.label}</span>
            {f.type === "textarea" ? (
              <textarea
                className="nodrag"
                rows={3}
                value={String(payload[f.key] ?? "")}
                placeholder={f.placeholder}
                onChange={(e) => actions.board.updatePayload(id, { [f.key]: e.target.value })}
                onBlur={() => void actions.story.writeBack(id)}
              />
            ) : f.type === "select" ? (
              <AppSelect value={String(payload[f.key] ?? "")} onChange={(v) => { actions.board.updatePayload(id, { [f.key]: v }); void actions.story.writeBack(id); }} options={(f.options || []).map((o) => typeof o === "string" ? { value: o, label: o } : { value: o.value, label: o.label })} className="nodrag" />
            ) : (
              <input
                className="nodrag"
                type={f.type === "number" ? "number" : "text"}
                value={String(payload[f.key] ?? "")}
                placeholder={f.placeholder}
                onChange={(e) => actions.board.updatePayload(id, { [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value })}
                onBlur={() => void actions.story.writeBack(id)}
              />
            )}
            {f.hint ? <small className="drama-canvas-field-hint">{f.hint}</small> : null}
          </label>
        ))}

        {/* 产物目录（09-29 用户：「产物路径，你就在 codexharness 目录下面新增一个存的目录，
            也可以选择和修改目录」）—— 只给生图节点（它才是产出位）。 */}
        {kind === "imagegen" || kind === "shot" || kind === "video" ? <OutputDirField /> : null}

        <div className="drama-canvas-inspector-actions">
          {/* 生成通道按钮：与卡面**同一颗组件、同一张映射表** —— 未配置会变「生图 · 去配置」
              直达设置页；策划类节点（笔记/剧本…）这里也不给生成按钮（与卡面行为一致）。 */}
          {cardActions.channels.map((what) => (
            <DramaChannelButton
              key={what}
              id={id}
              kind={kind}
              what={what}
              payload={payload}
              busyKey={(ch) => actions.story.busy.has(`${id}:${ch}`)}
            />
          ))}
          {/* ⛔ 只有**分镜相关**的卡才有「写回分镜表」这条动作（原来每张卡都挂 = 旧统一外样的残留）：
              笔记 / 生图节点跟分镜表没有对应字段，点了也是空转。 */}
          {WRITEBACK_KINDS.includes(kind) ? (
            <button className="drama-canvas-btn is-ghost" title="把这张卡的字段同步进分镜表（镜头卡改台词/景别会真的回写）" onClick={() => void actions.story.writeBack(id)}><RefreshCw size={12} />写回分镜表</button>
          ) : null}
          {/* 与卡面**同源**的「AI 润色」（09-29 用户要求每张提示词卡都有）——
              检查器里也给一颗，不必关掉面板回卡面点。素材位没有提示词可润色，不挂。 */}
          {cardActions.canUpload ? (
            <button className="drama-canvas-btn is-ghost" title="从本机选一张图当参考图 / 首帧（也会存进工作区）" onClick={() => void actions.story.uploadRef(id)}><Link2 size={12} />上传参考图</button>
          ) : null}
          {polishField ? (
            <button
              className="drama-canvas-btn is-ghost"
              title={`用已配置的模型润色「${POLISH_LABEL[polishField] || "提示词"}」，结果就地写回这张卡（不开会话）`}
              disabled={actions.story.busy.has(`${id}:polish`)}
              onClick={async () => {
                const polished = await actions.story.polishPrompt(id, String(payload[polishField] || "").trim());
                if (polished) actions.board.updatePayload(id, { [polishField]: polished });
              }}
            >
              {actions.story.busy.has(`${id}:polish`) ? <Loader2 size={12} className="is-spin" /> : <Sparkles size={12} />}AI 润色
            </button>
          ) : null}
          {kind === "storyboard" ? (
            <button className="drama-canvas-btn is-brand" disabled={!payload.board || !actions.boardNodeId} onClick={() => void actions.story.expand(id, String(payload.board))}><Clapperboard size={12} />展开场次与镜头</button>
          ) : null}
        </div>

        <section className="drama-canvas-links">
          <h4><Link2 size={12} />连线（{outEdges.length + inEdges.length}）</h4>
          {!outEdges.length && !inEdges.length ? <p className="drama-canvas-hint">还没有连线。从卡片右侧的圆点拖到另一张卡，就能表达「这份输入喂给下一步」。</p> : null}
          {outEdges.map((e) => (
            <div className="drama-canvas-link-row" key={e.id}>
              <span className="drama-canvas-link-dir">→</span>
              <span title={label(e.target)}>{label(e.target)}</span>
              <button className="drama-canvas-btn is-ghost" title="删掉这根连线" onClick={() => actions.board.removeEdges([e.id])}><Trash2 size={12} /></button>
              <AppSelect className="nodrag" value={String(e.data?.relation || "input")} onChange={(v) => actions.board.setRelation(e.id, v)} ariaLabel="连线关系" options={dramaRelationOptions(String(e.data?.relation || "input"), kind, String(actions.board.nodes.find((n) => n.id === e.target)?.data?.kind || "")).map(([key, text]) => ({ value: key, label: text }))} />
            </div>
          ))}
          {inEdges.map((e) => (
            <div className="drama-canvas-link-row" key={e.id}>
              <span className="drama-canvas-link-dir is-in">←</span>
              <span title={label(e.source)}>{label(e.source)}</span>
              <em>{dramaRelationLabel(String(e.data?.relation || "input"))}</em>
              <button className="drama-canvas-btn is-ghost" title="删掉这根连线（想留线只改方向的话，拖线两端的圆点即可）" onClick={() => actions.board.removeEdges([e.id])}><Trash2 size={12} /></button>
            </div>
          ))}
        </section>

        {actions.story.problems.length ? (
          <section className="drama-canvas-problems">
            <h4>分镜表的问题（{actions.story.problems.length}）</h4>
            <ul>{actions.story.problems.slice(0, 6).map((p, i) => <li key={i}>{p}</li>)}</ul>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function selectedSummary(count: number) {
  return count > 1 ? `已选 ${count} 个` : "单选";
}

/**
 * 产物目录（09-29 用户要求）：生成的图存到哪里。
 *  · 默认 = 应用数据目录下的 outputs（跟着应用走 —— 画布没绑会话工作区时也能出图落盘）；
 *  · 可用系统对话框另选一个目录，或一键恢复默认；也能直接打开目录看文件。
 *  ⛔ 独立成子组件：检查器在没有选中节点时提前 return null，hooks 不能写在它后面。
 *  ⛔ 主进程是唯一真相源（存 canvas-output.json）：这里只读回来显示，改完重新读，不做本地猜测。
 */
function OutputDirField() {
  const [info, setInfo] = useState<{ dir: string; isDefault: boolean }>({ dir: "", isDefault: true });
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const next = await window.codex.dramaCanvasOutputDir().catch(() => null);
    if (next) setInfo({ dir: String(next.dir || ""), isDefault: Boolean(next.isDefault) });
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const apply = async (input: { dir?: string; pick?: boolean }) => {
    setBusy(true);
    try {
      const next = await window.codex.dramaCanvasOutputDirSet(input);
      if (next) setInfo({ dir: String(next.dir || ""), isDefault: Boolean(next.isDefault) });
    } catch { /* 主进程已把原因报出来了（目录不可用等），这里不重复弹 */ }
    finally { setBusy(false); }
  };
  return (
    <label className="drama-canvas-field nodrag">
      <span>产物目录（生成的图 / 视频存这里）</span>
      <input className="nodrag" value={info.dir} readOnly title={info.dir} />
      <div className="drama-canvas-card-actions nodrag" style={{ marginTop: 6 }}>
        <button className="drama-canvas-btn is-ghost" disabled={busy} onClick={() => void apply({ pick: true })}><FolderOpen size={12} />选择目录</button>
        {info.dir ? (
          <button className="drama-canvas-btn is-ghost" disabled={busy} onClick={() => void window.codex.revealInFolder(info.dir).catch(() => {})}><FolderSearch size={12} />打开目录</button>
        ) : null}
        {!info.isDefault ? (
          <button className="drama-canvas-btn is-ghost" disabled={busy} onClick={() => void apply({ dir: "" })}><RotateCcw size={12} />恢复默认</button>
        ) : null}
      </div>
      <small className="drama-canvas-field-hint">默认在应用数据目录下的 outputs（跟着应用走）；选过的目录会记住，随时可改回默认</small>
    </label>
  );
}
