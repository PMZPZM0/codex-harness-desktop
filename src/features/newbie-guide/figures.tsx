/**
 * 新手引导的**图示**（10-18 用户：「把应用功能都扫一遍，做一个详细的新手教程，画图+字结合起来」）。
 *
 * ⛔ 为什么不用截图 / 生成图 / 图片资产：
 *   · 截图分浅色深色两套、还会随 UI 改版过期（过期图 = 主动误导，比没图更糟）；
 *   · 生成图与真实界面长得不一样，新人会拿它去对照界面（对不上更困惑）；
 *   · ⛔ 位图不许放 src/ 让 JS import（before-pack 的可达闭包只认 js/css 与 CSS 的 url()，
 *     JS import 的位图会被当成陈旧死块删掉 —— v0.0.27 事故同型）。
 *   ⇒ 一律用**数据驱动的示意图**：盒子 + 箭头 + 标签，颜色取主题变量（浅色/深色自动适配、改版零维护）；
 *     「界面速览」那一节额外用一张内联 SVG 画窗口分区（真正的"图"）。
 */
import { Fragment } from "react";

/** 图里的一个小盒子。`d` 是一行小字说明（可选）。 */
export type FigureNode = { t: string; d?: string };

export type GuideFigure =
  /** 一条流程：横向盒子 + 箭头（窄屏自动换行） */
  | { kind: "flow"; caption?: string; nodes: FigureNode[] }
  /** 并列分区：2 列网格（适合"右栏四个标签""能力分组"） */
  | { kind: "panes"; caption?: string; panes: FigureNode[] }
  /** 分层：从外到内逐层缩进（适合"技能→插件→MCP"这种嵌套关系） */
  | { kind: "layers"; caption?: string; layers: FigureNode[] }
  /** 窗口分区图（内联 SVG：侧栏 / 顶栏 / 对话区 / 输入框 / 右栏） */
  | { kind: "window"; caption?: string };

function Caption({ text }: { text?: string }) {
  return text ? <figcaption className="guide-figure-caption">{text}</figcaption> : null;
}

function WindowMap() {
  const panel = "var(--panel)";
  const panel2 = "var(--panel-2)";
  const line = "var(--line)";
  const accent = "var(--accent, #3b82f6)";
  return (
    <svg className="guide-window-map" viewBox="0 0 520 306" role="img" aria-label="界面分区示意图：侧栏、顶栏、对话区、输入框、右栏">
      {/* 窗口外框 */}
      <rect x="3" y="3" width="514" height="300" rx="12" fill={panel2} stroke={line} />
      {/* ① 侧栏 */}
      <rect x="3" y="3" width="122" height="300" rx="12" fill={panel} stroke={line} />
      <text className="w-title" x="18" y="24">① 侧栏</text>
      {[38, 54, 70, 86, 102].map((y) => (
        <rect key={y} x="14" y={y} width="100" height="8" rx="4" fill={panel2} />
      ))}
      <text x="18" y="126">新建 · 搜索 / 定时</text>
      <text x="18" y="142">能力入口</text>
      <rect x="14" y="150" width="100" height="10" rx="5" fill={accent} opacity="0.25" />
      <text x="18" y="176">项目 / 分类 视图</text>
      {[184, 200, 216].map((y) => (
        <rect key={y} x="14" y={y} width="100" height="8" rx="4" fill={panel2} />
      ))}
      <text x="18" y="246">会话列表（悬停菜单）</text>
      <rect x="14" y="262" width="100" height="16" rx="6" fill={panel2} />
      <text x="18" y="274">新手引导</text>
      {/* ② 顶栏 */}
      <rect x="125" y="3" width="392" height="34" fill={panel} stroke={line} />
      <text className="w-title" x="137" y="24">② 顶栏</text>
      <text x="193" y="24">📁 工作区 · 标题 · 🔍 搜索 · 调度 · 右栏 · 独立弹窗</text>
      {/* ③ 对话区 */}
      <rect x="125" y="37" width="292" height="188" fill="none" stroke={line} strokeDasharray="4 4" />
      <text className="w-title" x="137" y="56">③ 对话区</text>
      <text x="137" y="72">用户消息 / 回复 / 思考浮窗 / 工具折叠组</text>
      <rect x="137" y="82" width="150" height="26" rx="8" fill={panel} stroke={line} />
      <text x="145" y="99">你：帮我看看这个项目</text>
      <rect x="247" y="114" width="158" height="34" rx="8" fill={panel} stroke={line} />
      <text x="255" y="130">Codex：先列清单，再动手</text>
      <text x="255" y="143">（改动的文件会汇总在回合底部）</text>
      {/* 状态胶囊 */}
      <rect x="196" y="188" width="156" height="18" rx="9" fill={panel} stroke={line} />
      <text x="274" y="201">步骤 2/5 · 3 个文件 +12 −4</text>
      {/* ④ 输入框 */}
      <rect x="133" y="234" width="280" height="42" rx="10" fill={panel} stroke={accent} />
      <text className="w-title" x="143" y="252">④ 输入框</text>
      <text x="143" y="267">+ 附件 · @ 文件 · # 技能 · / 命令 · 模型 · 权限 · 语音</text>
      {/* ⑤ 右栏 */}
      <rect x="421" y="37" width="96" height="239" fill={panel} stroke={line} />
      <text className="w-title" x="432" y="56">⑤ 右栏</text>
      <text x="432" y="74">变更 / 终端</text>
      <text x="432" y="90">浏览器 / 项目树</text>
      <text x="432" y="112">（消息区右侧头像轨</text>
      <text x="432" y="126">末尾还有「办公室」：</text>
      <text x="432" y="140">看专家团实时办公）</text>
    </svg>
  );
}

export function GuideFigureView({ figure }: { figure?: GuideFigure }) {
  if (!figure) return null;
  if (figure.kind === "window") {
    return (
      <figure className="guide-figure is-window">
        <WindowMap />
        <Caption text={figure.caption} />
      </figure>
    );
  }
  if (figure.kind === "flow") {
    return (
      <figure className="guide-figure is-flow">
        <div className="guide-figure-row">
          {figure.nodes.map((node, index) => (
            <Fragment key={node.t}>
              {index > 0 ? <span className="guide-figure-arrow" aria-hidden>→</span> : null}
              <div className="guide-figure-node">
                <b>{node.t}</b>
                {node.d ? <small>{node.d}</small> : null}
              </div>
            </Fragment>
          ))}
        </div>
        <Caption text={figure.caption} />
      </figure>
    );
  }
  if (figure.kind === "panes") {
    return (
      <figure className="guide-figure is-panes">
        <div className="guide-figure-grid">
          {figure.panes.map((pane) => (
            <div className="guide-figure-pane" key={pane.t}>
              <b>{pane.t}</b>
              {pane.d ? <small>{pane.d}</small> : null}
            </div>
          ))}
        </div>
        <Caption text={figure.caption} />
      </figure>
    );
  }
  return (
    <figure className="guide-figure is-layers">
      {figure.layers.map((layer) => (
        <div className="guide-figure-layer" key={layer.t}>
          <b>{layer.t}</b>
          {layer.d ? <small>{layer.d}</small> : null}
        </div>
      ))}
      <Caption text={figure.caption} />
    </figure>
  );
}
