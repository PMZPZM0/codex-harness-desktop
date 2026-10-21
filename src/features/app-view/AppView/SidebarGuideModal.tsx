/**
 * 侧栏能力入口的教程弹窗（10-21 用户要求）。
 *
 * 用户原话：新建/搜索并排胶囊、快捷键保留但不显示；前端UI/组件库、技能/插件/MCP、
 * 子智能体/专家/专家团、人格市场/记忆中心各一行，点击弹窗并配套使用教程；
 * 还要让用户知道 Codex 可以直接操作组件库（已配备工具）。
 *
 * ⛔ 教程里点名的工具必须真实存在（组件库 ui_component_* 见 dispatch-core；专家
 *    expert_* / subagent_save / agent_invoke 同文件）。别写成“应该可以”的能力。
 * ⛔ 本组件自包含：只收 props，不进 bag；弹窗关闭三路（✕ / 遮罩 / Esc）并归还焦点。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Heart,
  LayoutGrid,
  Library,
  MousePointerClick,
  Server,
  Sparkles,
  Store,
  Users,
  Wand2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { copyTextToClipboard } from "../../../lib/clipboard";

export type SidebarGuideKey = "frontend" | "extensions" | "agents" | "identity";

/** 能力卡片直接跳到哪：由侧栏统一翻译成 setSettingsPage / 开画布。 */
export type SidebarGuideTarget =
  | "component-library"
  | "ui-sketch"
  | "drama-canvas"
  | "skills"
  | "plugins"
  | "mcp"
  | "expert-center"
  | "teams"
  | "agents"
  | "soul-market"
  | "memory"
  | "knowledge-base";

type Guide = {
  key: SidebarGuideKey;
  title: string;
  subtitle: string;
  tone: "ic-blue" | "ic-pink" | "ic-violet" | "ic-amber";
  icon: LucideIcon;
  intro: string;
  capabilities: { icon: LucideIcon; title: string; desc: string; target?: SidebarGuideTarget }[];
  steps: { title: string; desc: ReactNode }[];
  examples: string[];
  codexNote: ReactNode;
};

const GUIDES: Record<SidebarGuideKey, Guide> = {
  frontend: {
    key: "frontend",
    title: "前端 UI · 组件库",
    subtitle: "用现成组件拼界面，再交给 Codex 写进项目",
    tone: "ic-blue",
    icon: LayoutGrid,
    intro: "组件库收了 Uiverse 的 3800+ 个 MIT 控件；前端开发画布可以先把手机 / 电脑 / 网页界面摆出来，AI 画布工作流负责批量生图 / 视频 / 短剧。都能直接交给 Codex 落地。",
    capabilities: [
      { icon: Library, title: "3800+ 现成控件", desc: "按钮、卡片、表单、加载器等 11 类，带真实预览与 HTML + CSS 源码。", target: "component-library" },
      { icon: MousePointerClick, title: "可视化画布", desc: "拖 44 种 Material 3 组件，摆手机 / 电脑 / 网页，一键预览。", target: "ui-sketch" },
      { icon: Wand2, title: "AI 画布工作流", desc: "生图 / 视频 / 短剧，卡片连线把上一张结果喂给下一步。", target: "drama-canvas" },
    ],
    steps: [
      { title: "找组件", desc: "打开组件库，按分类或搜索找；点卡片看源码，点「复制代码」可直接粘进项目。" },
      { title: "摆界面", desc: "打开前端开发画布，拖组件、连页面跳转；顶部「预览」检查效果，预览不会改动设计稿。" },
      { title: "跑工作流", desc: "需要批量生图 / 视频 / 短剧时，打开「AI 画布工作流」：写提示词卡、连出图卡，按连线顺序跑。" },
      { title: "交给 Codex", desc: "画布点「交给 Codex 实现」；或在对话里直接说「用 ui_component_search 找…，用 ui_component_get 取代码写进…」。" },
    ],
    examples: [
      "用 ui_component_search 找 3 个深色模式的加载动画，挑一个用到我的登录页",
      "用 ui_component_get 取这个按钮的完整代码，写进 src/components/PrimaryButton.tsx",
      "把当前前端画布的设计稿交给 Codex 实现，先给我文件改动清单",
    ],
    codexNote: "这两个工具查的是同一个组件库，取出的代码带原作者与 MIT 许可；不用你手动复制。",
  },
  extensions: {
    key: "extensions",
    title: "技能 · 插件 · MCP",
    subtitle: "给 Codex 加装做法、能力与外部工具",
    tone: "ic-pink",
    icon: Zap,
    intro: "技能教它「怎么做」，插件可以打包一整套能力，MCP 把外部服务接进来。装好后它们会出现在 Codex 的技能 / 工具清单里，可以直接调用。",
    capabilities: [
      { icon: Sparkles, title: "技能", desc: "一份可读的做法说明书与检查清单；合适任务会自动参考，也能点名「用 xx 技能」。", target: "skills" },
      { icon: Store, title: "插件", desc: "一个包可带技能 / MCP / 钩子；内置插件里还能配生图、视频、视觉辅助接口。", target: "plugins" },
      { icon: Server, title: "MCP 连接器", desc: "接 GitHub、数据库、公司内部系统；工具以「连接器__工具」的名字出现在工具列表。", target: "mcp" },
    ],
    steps: [
      { title: "装技能", desc: "设置 → 技能，搜索安装或导入 SKILL.md；安装前会做安全检查，放行 / 有条件 / 拒绝都会写明理由。" },
      { title: "装插件 / 接 MCP", desc: "设置 → 插件 / MCP；官方市场多数组件要登录鉴权，卡片上会标「装了 ≠ 能用」。" },
      { title: "让 Codex 用", desc: "直接说「用刚装的总结技能…」或「调用 MCP 里的 GitHub 工具…」；不确定有哪些工具就先让它列出来。" },
    ],
    examples: [
      "先列出你现在能用的技能和 MCP 工具，再说哪些适合处理这份合同",
      "用刚装的总结技能把这份 PDF 整理成三句话",
      "调用 GitHub MCP 查一下这个仓库最近的未合并 PR",
    ],
    codexNote: "技能 / 插件 / MCP 装好后不需要另写提示词：Codex 在会话里能看到技能与工具清单，按需调用。",
  },
  agents: {
    key: "agents",
    title: "子智能体 · 专家 · 专家团",
    subtitle: "把任务派给专人或一支小队",
    tone: "ic-violet",
    icon: Users,
    intro: "专家 = 单人专长，专家团 = 主理人带成员按 SOP 协作，子智能体 = 你自定义的轻量角色。它们各有独立上下文，结果汇总回主会话。",
    capabilities: [
      { icon: Users, title: "专家", desc: "代码审查、内容创作、演示文稿等现成专长，开一对一会话。", target: "expert-center" },
      { icon: CheckCircle2, title: "专家团", desc: "主理人按流程拆分、多人协作，适合能并行的大任务。", target: "teams" },
      { icon: Brain, title: "子智能体", desc: "自定义角色与系统提示词，反复使用；Codex 可直接创建。", target: "agents" },
    ],
    steps: [
      { title: "建对象", desc: "设置 → 专家/专家团：子智能体、专家中心、专家团三张卡，按需要建或直接使用现成的。" },
      { title: "开调度", desc: "会话顶栏「调度」面板打开总开关，勾选允许派出的类别；同一时刻只有一个会话持有调度权。" },
      { title: "直接派活", desc: "在对话里说「这个任务交给…」。Codex 也能用 expert_list / expert_save / subagent_save / agent_invoke 自己建和调。" },
    ],
    examples: [
      "这个需求拆给专家团：产品、前端、测试各一人，最后汇总给我",
      "创建一个专门做周报的子智能体，跟随当前会话的模型和审批",
      "先列出可用专家，再按任务挑一个最合适的",
    ],
    codexNote: "专家 / 专家团会话本身不开放对外调度，避免「谁在干活」失控；这是刻意设计，不是故障。",
  },
  identity: {
    key: "identity",
    title: "人格市场 · 记忆中心 · 知识库",
    subtitle: "换一套性格，并让它越用越懂你",
    tone: "ic-amber",
    icon: Heart,
    intro: "人格市场是整套人设包，应用后写进全局个性化；记忆中心把偏好、项目背景和会话经验沉淀下来；知识库放项目资料，检索时直接引用。",
    capabilities: [
      { icon: Heart, title: "人格", desc: "16 套现成人格；整套换性格、语气、称呼，下一个新会话生效。", target: "soul-market" },
      { icon: Brain, title: "记忆", desc: "项目共享层 + 会话独立层；每轮自动注入，重要条目按 P0–P3 管理。", target: "memory" },
      { icon: BookOpen, title: "知识库", desc: "项目资料放本机，检索时直接引用；和记忆一起让回答更贴近这个项目。", target: "knowledge-base" },
    ],
    steps: [
      { title: "挑人格", desc: "设置 → 人格市场，点「应用此人格」；当前会话不变，新开一个任务看效果。想微调就去「个性化」。" },
      { title: "开记忆", desc: "设置 → 记忆中心默认已启用；选内置金字塔或 MCP 后端，项目资料可以放进知识库。" },
      { title: "直接用", desc: "对 Codex 说「记住…」「以后回复先给结论」「按当前人格写…」；要回忆就说「你记得这个项目什么」。" },
    ],
    examples: [
      "记住：这个项目代号是 ORION，以后都这么叫",
      "以后回复先给结论，再给过程；别用表情",
      "按当前人格的语气帮我写一封给客户的邮件",
    ],
    codexNote: "人格写的是全局个性化，下一个新会话生效；记忆与知识库都在本机，删除对应条目即可清掉。",
  },
};

export function SidebarGuideModal({ guideKey, onNavigate, onClose }: { guideKey: SidebarGuideKey; onNavigate: (target: SidebarGuideTarget) => void; onClose: () => void }) {
  const guide = GUIDES[guideKey];
  const Icon = guide.icon;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [copied, setCopied] = useState("");
  /** 同一个弹窗内的两级视图；⛔ 不叠第二个弹窗（用户 10-21 明确「不要内嵌弹窗」）。 */
  const [view, setView] = useState<"overview" | "tutorial">("overview");
  const firstViewRef = useRef(true);
  const copyTimerRef = useRef<number | null>(null);

  /* Esc 关闭 + Tab 焦点陷阱 + 关闭后把焦点还给触发按钮（设计规范要求，别只做遮罩点击）。 */
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusables = () => Array.from(
      dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []
    );
    focusables()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      previous?.focus?.();
    };
  }, []);

  /* 视图切换后原来的按钮会被卸载（使用教程 ↔ 返回），焦点必须跟着落到新视图的主控件上，
     否则焦点会掉回 body，键盘用户找不到位置。 */
  useEffect(() => {
    if (firstViewRef.current) {
      firstViewRef.current = false;
      return;
    }
    const target = view === "tutorial"
      ? dialogRef.current?.querySelector<HTMLElement>(".sidebar-guide-back")
      : dialogRef.current?.querySelector<HTMLElement>(".sidebar-guide-tutorial-btn");
    target?.focus();
  }, [view]);

  const copyExample = async (text: string) => {
    await copyTextToClipboard(text);
    setCopied(text);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(""), 1600);
  };

  return (
    <div className="info-modal-mask sidebar-guide-mask" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        className={`info-modal sidebar-guide ${guide.tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`sidebar-guide-title-${guide.key}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sidebar-guide-head">
          {view === "tutorial" ? (
            <button className="sidebar-guide-back" title="返回概览" aria-label="返回概览" onClick={() => setView("overview")}><ChevronLeft size={17} /></button>
          ) : null}
          <span className="sidebar-guide-icon" aria-hidden><Icon size={19} /></span>
          <span className="sidebar-guide-heading">
            <strong id={`sidebar-guide-title-${guide.key}`}>{view === "tutorial" ? `使用教程 · ${guide.title}` : guide.title}</strong>
            <small>{view === "tutorial" ? "照着步骤做；示例可以直接复制到对话里" : guide.subtitle}</small>
          </span>
          <button className="sidebar-guide-close" title="关闭（Esc）" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </header>

        <div className={`sidebar-guide-body ${view === "tutorial" ? "is-tutorial" : ""}`}>
          {view === "overview" ? (
            <>
              <p className="sidebar-guide-intro">{guide.intro}</p>
              <section className="sidebar-guide-section">
                <h4>能做什么</h4>
                <div className="sidebar-guide-caps" data-count={guide.capabilities.length}>
                  {guide.capabilities.map((capability) => {
                    const CapIcon = capability.icon;
                    const body = (
                      <>
                        <span className="sidebar-guide-cap-icon" aria-hidden><CapIcon size={15} /></span>
                        <span className="sidebar-guide-cap-text"><strong>{capability.title}</strong><small>{capability.desc}</small></span>
                      </>
                    );
                    return capability.target ? (
                      <button
                        type="button"
                        className="sidebar-guide-cap is-action"
                        key={capability.title}
                        title={`打开${capability.title}`}
                        onClick={() => { onClose(); onNavigate(capability.target!); }}
                      >
                        {body}
                        <ArrowUpRight size={13} className="sidebar-guide-cap-go" aria-hidden />
                      </button>
                    ) : (
                      <div className="sidebar-guide-cap" key={capability.title}>{body}</div>
                    );
                  })}
                </div>
              </section>
              <section className="sidebar-guide-codex">
                <div className="sidebar-guide-codex-head"><Sparkles size={14} /><strong>Codex 已配备工具，可以直接做</strong></div>
                <p>{guide.codexNote}</p>
              </section>
            </>
          ) : (
            <>
              <p className="sidebar-guide-intro">把「{guide.title}」用起来，按下面几步走。示例可以直接点一下复制，再粘到对话里。</p>
              <section className="sidebar-guide-section">
                <h4>操作步骤</h4>
                <ol className="guide-steps sidebar-guide-steps">
                  {guide.steps.map((step, index) => (
                    <li key={step.title}>
                      <span className="guide-step-index">{index + 1}</span>
                      <span><b>{step.title}</b><small>{step.desc}</small></span>
                    </li>
                  ))}
                </ol>
              </section>
              <section className="sidebar-guide-codex">
                <div className="sidebar-guide-codex-head"><Sparkles size={14} /><strong>Codex 已配备工具，可以直接做</strong></div>
                <p>{guide.codexNote}</p>
                <div className="sidebar-guide-examples">
                  {guide.examples.map((example) => (
                    <button
                      type="button"
                      className={`sidebar-guide-example ${copied === example ? "is-copied" : ""}`}
                      key={example}
                      title="点击复制这条示例"
                      onClick={() => void copyExample(example)}
                    >
                      {copied === example ? <Check size={13} /> : <Copy size={13} />}
                      <span>{copied === example ? "已复制，去对话里粘贴" : example}</span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        <footer className="sidebar-guide-foot">
          <span className="sidebar-guide-foot-note"><CheckCircle2 size={13} />{view === "tutorial" ? "示例可点击复制" : "点上方卡片直接打开对应页面"}</span>
          <div className="sidebar-guide-actions">
            {view === "overview" ? (
              <button type="button" className="primary-setting sidebar-guide-tutorial-btn" onClick={() => setView("tutorial")}>
                <BookOpen size={13} />使用教程
              </button>
            ) : (
              <button type="button" className="secondary-setting" onClick={() => setView("overview")}>
                <ChevronLeft size={13} />返回概览
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
