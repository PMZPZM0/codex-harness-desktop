/**
 * 右侧检查器（域内私有）：看/改选中节点的完整字段、改连线关系、回写分镜表。
 *
 * 卡面只放最常用的三五个按钮 —— 完整字段全在这儿。这样卡片能保持固定尺寸
 * （尺寸一变，画布排版与命中测试全得跟着变），也避免卡面上堆二十个输入框。
 */
import { AppSelect } from "../../components/AppSelect";
import { Clapperboard, Link2, RefreshCw, X } from "lucide-react";
import { dramaNodeDef, dramaNodeLabel, dramaRelationLabel, dramaRelationOptions } from "../../lib/drama-canvas-model.mjs";
import { STORYBOARD_ASPECTS, STORYBOARD_SHOT_SIZES } from "../../lib/drama-storyboard.mjs";
import { VIDEO_ASPECTS } from "../../lib/media-aspects.mjs";
import { useDramaActions } from "./drama-actions";
/* ⛔ 生成按钮与通道映射表都从 DramaChannelButton 取（卡面同源）—— 检查器原来自己写了一份
   「生成图片」按钮：文案与卡面不一致、未配置不给引导、还不查节点类型（笔记卡上也能点），
   三处都与卡面相反。同一个动作只能有一个实现。 */
import { DramaChannelButton, GEN_CHANNELS } from "./DramaChannelButton";

interface FieldSpec {
  key: string;
  label: string;
  type?: "text" | "textarea" | "number" | "select";
  options?: string[];
  placeholder?: string;
  hint?: string;
}

/** 每种卡在检查器里露哪些字段。**只列会被用到、会被回写的**，不做万能表单。 */
/** 生图尺寸预设（09-29 自媒体刚需：平台画幅各不相同，手填容易错）。
 *  ⛔ 网关接受的尺寸各不相同 —— 报错就把这项清空走默认，不要硬试。 */
const IMAGE_SIZE_PRESETS = [
  { value: "1024x1024", label: "方图 1:1 · 1024×1024（头像 / 图标 / 方版配图）" },
  { value: "1024x1536", label: "竖图 2:3 · 1024×1536（小红书 / 竖版海报）" },
  { value: "1536x1024", label: "横图 3:2 · 1536×1024（公众号封面 / 横版配图）" },
  { value: "768x1365", label: "竖屏 9:16 · 768×1365（抖音 / 视频号封面）" },
  { value: "1365x768", label: "宽屏 16:9 · 1365×768（B 站 / 横屏封面）" },
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
    { key: "size", label: "尺寸 / 画幅", type: "select", options: IMAGE_SIZE_PRESETS.map((p) => p.value), hint: "按平台选：小红书 2:3、抖音 9:16、公众号/B站横版。网关不认这个尺寸会报错 —— 清空即走默认" },
    { key: "negative", label: "负面提示词", type: "textarea", placeholder: "不要文字、不要畸形手指、不要水印、不要多余肢体…", hint: "写清楚**不想要什么**，比在正面词里绕半天有效；不是每个网关都支持，无效时改回正面描述" },
    { key: "role", label: "用途" },
    { key: "path", label: "文件路径" },
    { key: "text", label: "说明", type: "textarea" },
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

export function DramaInspector({ onClose }: { onClose: () => void }) {
  const actions = useDramaActions();
  const id = actions.board.anchor || actions.board.selectedIds[0] || "";
  const node = actions.board.nodes.find((n) => n.id === id);
  if (!node) return null;
  const kind = String(node.data?.kind || "note");
  const payload = node.data.payload || {};
  const def = dramaNodeDef(kind);
  const fields = FIELDS[kind] || [];
  const outEdges = actions.board.edges.filter((e) => e.source === id);
  const inEdges = actions.board.edges.filter((e) => e.target === id);
  const label = (nodeId: string) => {
    const n = actions.board.nodes.find((x) => x.id === nodeId);
    return n ? dramaNodeLabel(String(n.data?.kind || ""), n.data.payload || {}) : nodeId;
  };

  return (
    <aside className="drama-canvas-inspector" aria-label="节点属性">
      <header className="drama-canvas-inspector-head">
        <div>
          <b>{dramaNodeLabel(kind, payload)}</b>
          <small>{def.label} · {selectedSummary(actions.board.selectedIds.length)}</small>
        </div>
        <button className="drama-canvas-icon-btn nodrag" title="关闭属性面板" onClick={onClose}><X size={14} /></button>
      </header>

      {actions.board.selectedIds.length > 1 ? (
        <p className="drama-canvas-hint">选中了 {actions.board.selectedIds.length} 个节点 —— 多选时只显示批量操作，单个节点的字段在单选时改。</p>
      ) : null}

      <div className="drama-canvas-inspector-body nowheel">
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
              <AppSelect value={String(payload[f.key] ?? "")} onChange={(v) => { actions.board.updatePayload(id, { [f.key]: v }); void actions.story.writeBack(id); }} options={[...((f.options || [])).map((o) => ({ value: (o), label: (`${o}`), }))]} className="nodrag" />
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

        <div className="drama-canvas-inspector-actions">
          {/* 生成通道按钮：与卡面**同一颗组件、同一张映射表** —— 未配置会变「生图 · 去配置」
              直达设置页；策划类节点（笔记/剧本…）这里也不给生成按钮（与卡面行为一致）。 */}
          {(GEN_CHANNELS[kind] || []).map((what) => (
            <DramaChannelButton
              key={what}
              id={id}
              kind={kind}
              what={what}
              payload={payload}
              busyKey={(ch) => actions.story.busy.has(`${id}:${ch}`)}
            />
          ))}
          <button className="drama-canvas-btn is-ghost" onClick={() => void actions.story.writeBack(id)}><RefreshCw size={12} />写回分镜表</button>
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
              <AppSelect className="nodrag" value={String(e.data?.relation || "input")} onChange={(v) => actions.board.setRelation(e.id, v)} ariaLabel="连线关系" options={dramaRelationOptions(String(e.data?.relation || "input"), kind, String(actions.board.nodes.find((n) => n.id === e.target)?.data?.kind || "")).map(([key, text]) => ({ value: key, label: text }))} />
            </div>
          ))}
          {inEdges.map((e) => (
            <div className="drama-canvas-link-row" key={e.id}>
              <span className="drama-canvas-link-dir is-in">←</span>
              <span title={label(e.source)}>{label(e.source)}</span>
              <em>{dramaRelationLabel(String(e.data?.relation || "input"))}</em>
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
