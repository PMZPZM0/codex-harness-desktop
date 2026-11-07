/**
 * 团队模式 · 输入框（11-06）
 *
 * 用户：「对话框的文件上传、+ 号、技能、模型都没有，功能跟对话框对齐，
 *        除了不用 @ 专家那些」。
 *
 * 做法：**只搬主对话工具行的能力，不搬 mention 面板**（群自己的 @ 伙伴 chips 在
 * `04-team-group-view.tsx` 的 atbar 里，与主对话 `@点名专家/子智能体/CLI` 零共享）。
 * 复用的都是纯 props 组件：`ComposerMenu`（权限 / 模型）、`EffortPicker`（推理档位），
 * 以及 `approvalMenuOptions` / `effortLabels` 两个纯函数 —— ⛔ 不碰全局 bag。
 *
 * ⛔ 所有选中项都**真生效**，不是装饰：
 *   · model / effort / sandbox / approvalPolicy → `invokeAgent` → `runDelegatedTask`
 *     → `turn/start.model|effort`、`thread/start.sandbox|approvalPolicy`（类型与透传通道均已存在）；
 *   · 技能 → 发送时拼 `[本轮已引用技能]…[请按上述技能工作流执行]` 进 query（主对话同款）；
 *   · 文件 → 发送时拼 `[附件文件]…[附件结束]` 进 query，伙伴按绝对路径自己读；
 *   · 权限胶囊的 `never` ⇒ `danger-full-access`（与 `changePermissionMode` 同一映射）。
 *
 * 已知边界：麦克风不接。主对话语音听写是**全局单 handler**，会同时把字幕写进主
 * `bag.prompt`；群面板接了会污染主输入框草稿（除非先加 owner 标志改造全局链路）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { AtSign, Bot, Check, ChevronDown, ChevronLeft, FolderOpen, Paperclip, Plus, Search, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { ComposerMenu, ThreadFilePicker } from "../composer";
import { ComposerRail } from "../composer-rail";
import type { HarnessAppApi } from "../app-state";
import { EffortPicker } from "../../components/EffortPicker";
import { effortLabels } from "../../lib/effort-labels";
import { approvalMenuOptions } from "../app-view/helpers/catalogs";
import { getActiveModel, subscribeActiveModel } from "../../lib/active-model.mjs";
import { collectModelChoices } from "../../lib/model-menu.mjs";
import { formatTokenCount, matchModelSpec } from "../../lib/model-specs";
import { avatarToneOf } from "../../lib/entity-avatar";
import { isMacPlatform } from "../../lib/is-mac-platform";

/** 从粘贴事件里取附件路径 —— 与主对话 `ComposerEditor` 同一口径（File.path / text/uri-list）。
    ⛔ 群输入框是 textarea，附件不内联成 chip，统一进 opts.files（发送时拼 `[附件文件]`）。 */
function pastedFilePaths(cb: DataTransfer): string[] {
  const fromFiles = [...cb.files]
    .map((f) => (f as File & { path?: string }).path)
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  const fromUris: string[] = [];
  for (const line of cb.getData("text/uri-list").split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    try {
      if (new URL(raw).protocol !== "file:") continue;
      /* Windows: file:///C:/foo.png → C:\foo.png；mac/Linux 保持正斜杠（主对话同款） */
      const decoded = decodeURIComponent(raw.slice("file://".length));
      fromUris.push(isMacPlatform() ? decoded : decoded.replace(/\//g, "\\").replace(/^\\/, ""));
    } catch { /* 非 URL 行跳过 */ }
  }
  return [...new Set([...fromFiles, ...fromUris])];
}

export type TeamRunOpts = {
  model: string;
  effort: string;
  sandbox: "workspace-write" | "danger-full-access";
  approvalPolicy: "never" | "on-request" | "untrusted";
  skills: Array<{ name: string; description: string }>;
  files: string[];
};

/** 只传给 `runDelegatedTask` 的四项（技能/文件在派活前拼进 query，不走 IPC 字段）。 */
export type TeamRunParams = {
  /** 空串/缺省 = 跟随全局模型；⛔ 必须是裸模型名，不是 custom:<p>:<m> 复合串 */
  model?: string;
  effort: string;
  sandbox: TeamRunOpts["sandbox"];
  approvalPolicy: TeamRunOpts["approvalPolicy"];
};

export const DEFAULT_TEAM_RUN_OPTS: TeamRunOpts = {
  model: "",
  effort: "high",
  sandbox: "workspace-write",
  approvalPolicy: "never",
  skills: [],
  files: [],
};

/* ⛔⛔ 11-06 用户：「模型我切换了，然后重启又变成跟随全局了」——
   原来 runOpts 只是面板内的 useState，弹窗卸载/应用重启即丢。
   ⇒ 四项**偏好**落 localStorage（与主对话 composer-editor-height 同口径），
     每次改动即写、启动时读回；⛔ 技能/文件是「本轮附件」，⛔ 不持久化。
   ⛔ 读回必须校验：脏值/旧版本字段不能把输入框塞坏，一律回落默认。 */
const OPTS_STORAGE_KEY = "harness-team:composer-opts";

export function loadTeamRunOpts(): TeamRunOpts {
  try {
    const raw = localStorage.getItem(OPTS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TEAM_RUN_OPTS };
    const saved = JSON.parse(raw) as Partial<TeamRunOpts> | null;
    if (!saved || typeof saved !== "object") return { ...DEFAULT_TEAM_RUN_OPTS };
    return {
      ...DEFAULT_TEAM_RUN_OPTS,
      model: typeof saved.model === "string" ? saved.model.trim() : "",
      effort: typeof saved.effort === "string" && saved.effort ? saved.effort : DEFAULT_TEAM_RUN_OPTS.effort,
      sandbox: saved.sandbox === "danger-full-access" || saved.sandbox === "workspace-write"
        ? saved.sandbox : DEFAULT_TEAM_RUN_OPTS.sandbox,
      approvalPolicy: saved.approvalPolicy === "never" || saved.approvalPolicy === "on-request" || saved.approvalPolicy === "untrusted"
        ? saved.approvalPolicy : DEFAULT_TEAM_RUN_OPTS.approvalPolicy,
      skills: [],
      files: [],
    };
  } catch {
    return { ...DEFAULT_TEAM_RUN_OPTS };
  }
}

export function saveTeamRunOpts(opts: TeamRunOpts): void {
  try {
    localStorage.setItem(OPTS_STORAGE_KEY, JSON.stringify({
      model: opts.model,
      effort: opts.effort,
      sandbox: opts.sandbox,
      approvalPolicy: opts.approvalPolicy,
    }));
  } catch { /* 存储不可用：至少本次会话内有效，⛔ 不让输入框报错 */ }
}

type Props = {
  value: string;
  onValueChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  opts: TeamRunOpts;
  onOpts: (next: TeamRunOpts) => void;
  sending: boolean;
  canSend: boolean;
  onSend: () => void;
  targetNames: string[];
  /** 群里出现过的本机路径（「引用群里的文件」候选，由父层从消息投影里扫出来） */
  fileCandidates?: Array<{ path: string; source: string }>;
  /** 模型下拉末尾的「更多设置…」—— 与主对话下拉同款入口（打开 设置 → 模型）。 */
  onOpenModelSettings?: () => void;
  /** 11-07 用户令：输入框上方那排常驻 @ chip 收进面板，改由这个按钮召唤。 */
  onOpenMention?: () => void;
  /** 本轮已 @ 的人数（画徽标；0 = 不画） */
  mentionCount?: number;
  /** 工具行右端的「群菜单」按钮（FLOAT 形态下父层不传，按钮画在群视图右下）。 */
  toolsSlot?: React.ReactNode;
  /** 11-07 用户令「侧边粗条同步」：宿主 app（输入框左侧的 ComposerRail 需要它）。 */
  app?: HarnessAppApi;
};

type ModelOption = {
  value: string; title: string; desc?: string;
  badges?: { text: string; kind?: "vision" | "video" }[];
  credits?: string; monogram?: string; tone?: string;
};

/** 与主对话模型下拉同一套徽标：图片/视频（能不能看图）+ 上下文 + 输出。 */
function badgesOf(entry: { modelId: string; inputTypes?: string[]; contextWindow?: number; maxOutputTokens?: number }) {
  const spec = matchModelSpec(entry.modelId);
  const inputs = entry.inputTypes ?? spec?.inputTypes ?? [];
  const ctx = entry.contextWindow ?? spec?.contextWindow;
  const out = entry.maxOutputTokens ?? spec?.maxOutputTokens;
  const badges: { text: string; kind?: "vision" | "video" }[] = [];
  if (inputs.includes("image")) badges.push({ text: "图片", kind: "vision" });
  if (inputs.includes("video")) badges.push({ text: "视频", kind: "video" });
  if (ctx) badges.push({ text: `${formatTokenCount(ctx)} 上下文` });
  if (out) badges.push({ text: `出 ${formatTokenCount(out)}` });
  return badges;
}

export function TeamComposer({
  value, onValueChange, textareaRef, onKeyDown, placeholder,
  opts, onOpts, sending, canSend, onSend, targetNames, fileCandidates = [], onOpenModelSettings,
  onOpenMention, mentionCount = 0, toolsSlot = null, app,
}: Props) {
  const [plusOpen, setPlusOpen] = useState(false);
  /* ⛔ 11-06 用户：「这个展示不对吧，那个技能展示也丑」——
     原来是「一级菜单里缩进一小块竖线列表」，既不像主对话也读不清。
     ⇒ 点「引用技能」后整个面板切到主对话同款「搜索 + 图标列表」视图。 */
  const [plusView, setPlusView] = useState<"main" | "skills" | "files">("main");
  const [skillQuery, setSkillQuery] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [skills, setSkills] = useState<Array<{ name: string; description: string }>>([]);
  /* ⛔⛔ 11-06 用户：「模型也是死的，一点联动性都没有」「跟随模型配置界面，还是旧的」。
     原来「跟随全局」= 不传 model ⇒ 子会话复用时沿用**首次创建时**那个模型，永远不跟
     模型配置界面走；下拉也只写「跟随全局」四个字，看不出跟着谁。
     ⇒ 订阅 AppView 注入的当前生效模型（与主对话模型选择器同源），选项标题实时带出模型名。 */
  const active = useSyncExternalStore(subscribeActiveModel, getActiveModel);
  const [baseModels, setBaseModels] = useState<ModelOption[]>([]);
  const [retired, setRetired] = useState("");
  const models = useMemo<ModelOption[]>(() => [
    {
      value: "",
      title: active.name ? `跟随全局 · ${active.name}` : "跟随全局",
      desc: "随模型配置界面实时变化；派活时显式下发该模型",
    },
    ...baseModels,
    ...(onOpenModelSettings ? [{ value: "__model_settings__", title: "更多设置…" }] : []),
  ], [active.name, baseModels, onOpenModelSettings]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /* 11-07 用户令：「输入框上的小粗条……全部同步一下」——
     与主对话输入框同款：顶部把手拖动改高度（下限 62 / 上限 min(55vh,560px)），双击复位，localStorage 持久化。 */
  const TEAM_COMPOSER_MIN = 62;
  const teamComposerMax = () => Math.min(Math.round(window.innerHeight * 0.55), 560);
  const [editorHeight, setEditorHeight] = useState<number | null>(() => {
    try {
      const raw = Number(localStorage.getItem("team-composer-height"));
      return Number.isFinite(raw) && raw >= TEAM_COMPOSER_MIN ? Math.min(raw, teamComposerMax()) : null;
    } catch { return null; }
  });
  const dragRef = useRef<{ startY: number; startH: number; last: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = Math.max(TEAM_COMPOSER_MIN, Math.min(drag.startH - (event.clientY - drag.startY), teamComposerMax()));
      drag.last = next;
      setEditorHeight(next);
    };
    const up = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (drag) { try { localStorage.setItem("team-composer-height", String(drag.last)); } catch { /* 存储不可用：本次会话内有效 */ } }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging]);
  const onResizeDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const base = editorHeight ?? Math.max(TEAM_COMPOSER_MIN, textareaRef.current?.offsetHeight ?? TEAM_COMPOSER_MIN);
    dragRef.current = { startY: event.clientY, startH: base, last: base };
    setDragging(true);
    event.preventDefault();
  };
  const resetEditorHeight = () => {
    setEditorHeight(null);
    try { localStorage.removeItem("team-composer-height"); } catch { /* 同上 */ }
  };
  /* 启动那一刻的模型值（读回的偏好）：目录还没加载完时也要能显示，别闪成空白 */
  const initialModelRef = useRef(opts.model);
  /* ⛔ 回落要用**最新** opts（目录是异步加载的，期间用户可能已经改过选项），别拿挂载时的旧对象覆盖。 */
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const onOptsRef = useRef(onOpts);
  onOptsRef.current = onOpts;

  /**
   * 模型候选 = 与**主对话输入框同一个口径**（`collectModelChoices`）：
   *   · 只列启用供应商的启用模型 ⇒ 停用旧供应商的模型不会再冒出来（11-07 用户实测）；
   *   · 生效供应商排最前，按裸模型名去重；
   *   · 标题 / 供应商说明 / 徽标 / 倍率 / 配色与主下拉一致。
   * 打开菜单时再拉一次（供应商可能刚改过），避免面板一直用挂载时的旧目录。
   */
  const loadModels = useCallback(async () => {
    try {
      const { providers, current } = await window.codex.listCustomModels();
      const choices = collectModelChoices(providers, current);
      setBaseModels(choices.map((entry) => ({
        value: entry.modelId,
        title: entry.modelId,
        desc: entry.isActive ? "" : entry.providerName,
        badges: badgesOf(entry),
        credits: entry.credits,
        /* 与主下拉同源：主下拉的 tone 取「说明文字 || 标题」，生效行没有说明 ⇒ 用模型名。 */
        tone: avatarToneOf((entry.isActive ? "" : entry.providerName) || entry.modelId),
        monogram: entry.modelId.replace(/^[^A-Za-z0-9]+/, "").slice(0, 1).toUpperCase() || "M",
      })));
      /* ⛔⛔ 11-06：「还是旧的」—— 上次持久化的模型已经不在当前模型目录里，
         原来会被塞成「上次选择」一直挂在下拉上、派活也一直用那个死值。
         ⇒ 自动切回「跟随全局」，由当前生效模型接管；同时留一句说明，别让用户莫名被改。 */
      const ids = new Set<string>([""]);
      for (const entry of choices) ids.add(entry.modelId);
      const retiredModel = initialModelRef.current;
      /* ⛔ 判据与执行对象必须同一时刻取值 —— 目录异步回来之前用户可能已
         自己点了「跟随全局」，否则提示会写成「上次选择的  已不在…」（空名字）并重复写空值。 */
      if (ids.size > 1 && retiredModel && !ids.has(retiredModel) && optsRef.current.model === retiredModel) {
        initialModelRef.current = "";
        setRetired(`上次选择的 ${retiredModel} 已不在当前模型目录，已切回「跟随全局」`);
        onOptsRef.current({ ...optsRef.current, model: "" });
      }
    } catch { /* 目录读不到就保留「跟随全局」，⛔ 不让输入框打不开 */ }
  }, []);

  useEffect(() => {
    let alive = true;
    void loadModels();
    void (async () => {
      try {
        const list = await window.codex.listLocalSkills();
        if (!alive) return;
        setSkills((Array.isArray(list) ? list : [])
          .filter((s) => s && s.name && s.enabled !== false)
          .map((s) => ({ name: String(s.name), description: String(s.description ?? s.descriptionZh ?? "") }))
          .slice(0, 40));
      } catch { /* 没有技能就只留文件入口 */ }
    })();
    return () => { alive = false; };
  }, [loadModels]);

  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) { setPlusOpen(false); setPlusView("main"); }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [plusOpen]);

  /* 技能选择是**居中弹窗**（11-07 用户：「技能选项弹窗，那个」）：Esc 只关这一层。 */
  useEffect(() => {
    if (plusView !== "skills") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setPlusView("main");
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [plusView]);

  const pickFiles = async () => {
    try {
      const paths = await window.codex.chooseFiles();
      if (!Array.isArray(paths) || !paths.length) return;
      onOpts({ ...opts, files: [...new Set([...opts.files, ...paths])].slice(0, 20) });
    } catch { /* 取消选择：什么都不做 */ }
    setPlusOpen(false);
  };

  /* 技能弹窗里点一行 = 选中 / 取消（⛔ 不再点一下就关窗，方便一次选多个）。 */
  const toggleSkill = (s: { name: string; description: string }) => {
    const exists = opts.skills.some((x) => x.name === s.name);
    onOpts({ ...opts, skills: exists ? opts.skills.filter((x) => x.name !== s.name) : [...opts.skills, s].slice(0, 8) });
  };

  /** 粘贴图片 / 文件 = 主对话输入框的「内在功能」：真落到本轮附件（chips 可见 → 拼进 query）。
      ⛔ 普通文字粘贴一律不拦截，preventDefault 只在真有附件时调用。 */
  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const cb = e.clipboardData;
    const paths = pastedFilePaths(cb);
    if (paths.length) {
      e.preventDefault();
      onOpts({ ...opts, files: [...new Set([...opts.files, ...paths])].slice(0, 20) });
      return;
    }
    const image = [...cb.files].find((f) => f.type.startsWith("image/"));
    const plain = cb.getData("text/plain").trim();
    /* 资源管理器复制图片文件：剪贴板只有路径文本、没有位图（主对话的 fallbackPath 同款）。
       ⛔ 必须像绝对路径才认：否则一句以 ".png" 结尾的普通文本会被吞掉、压根不进输入框。 */
    const looksLikePath = /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(plain);
    const imagePath = plain && !plain.includes("\n") && !plain.includes("://") && looksLikePath
      && /\.(png|jpe?g|gif|webp|bmp)$/i.test(plain) ? plain : "";
    if (!image && !imagePath) return;
    e.preventDefault();
    const saved = image ? await window.codex.readClipboardImage().catch(() => "") : imagePath;
    /* ⛔ await 期间用户可能已改过偏好 / 加过附件 ⇒ 用最新的 optsRef，别拿闭包里的旧 opts 覆盖。 */
    if (saved) {
      const cur = optsRef.current;
      onOpts({ ...cur, files: [...new Set([...cur.files, saved])].slice(0, 20) });
    }
  };

  const fullAccess = opts.sandbox === "danger-full-access";
  const permValue = fullAccess ? "never" : opts.approvalPolicy;
  const onPermission = (next: string) => {
    if (next === "never") onOpts({ ...opts, sandbox: "danger-full-access", approvalPolicy: "never" });
    else onOpts({ ...opts, sandbox: "workspace-write", approvalPolicy: next as TeamRunOpts["approvalPolicy"] });
  };

  const fileName = (p: string) => p.split(/[\\/]/).pop() || p;
  const q = skillQuery.trim().toLowerCase();
  const skillMatches = skills.filter((s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));

  return (
    <div className="team-composer" ref={wrapRef}>
      {/* 11-07 用户令：「输入框上的小粗条和侧边粗条，全部同步」——
          顶部把手（拖动改高度 / 双击复位）+ 左侧 ComposerRail 与主对话同一个组件。 */}
      <div
        className="team-composer__resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖动调整输入框高度（双击恢复默认）"
        onPointerDown={onResizeDown}
        onDoubleClick={resetEditorHeight}
      >
        <span className="team-composer__grip" aria-hidden />
      </div>
      {app && <ComposerRail app={app} threadId="" />}
      {(opts.files.length > 0 || opts.skills.length > 0) && (
        <div className="team-composer__chips">
          {opts.files.map((p) => (
            <span key={`f:${p}`} className="team-composer__chip is-file" title={p}>
              <Paperclip size={11} /> <span>{fileName(p)}</span>
              <button type="button" aria-label={`移除 ${fileName(p)}`} onClick={() => onOpts({ ...opts, files: opts.files.filter((x) => x !== p) })}><X size={10} /></button>
            </span>
          ))}
          {opts.skills.map((s) => (
            <span key={`s:${s.name}`} className="team-composer__chip is-skill" title={s.description}>
              <Sparkles size={11} /> <span>{s.name}</span>
              <button type="button" aria-label={`移除技能 ${s.name}`} onClick={() => onOpts({ ...opts, skills: opts.skills.filter((x) => x.name !== s.name) })}><X size={10} /></button>
            </span>
          ))}
        </div>
      )}

      {/* 引用群里的文件：浮在输入卡上方的弹出层（⛔ 不顶替输入框）。 */}
      {plusView === "files" && (
        <div className="team-composer__pane-flyout" role="dialog" aria-label="引用群里的文件">
          <div className="team-composer__skill-pane">
            <div className="team-composer__skill-head">
              <button type="button" onClick={() => setPlusView("main")}><ChevronLeft size={14} /> 返回</button>
              <span>引用群里的文件</span>
              <button type="button" aria-label="关闭文件引用面板" onClick={() => setPlusView("main")}><X size={13} /></button>
            </div>
            <ThreadFilePicker
              query={fileQuery}
              onQuery={setFileQuery}
              candidates={fileCandidates}
              onPick={(path) => {
                onOpts({ ...opts, files: [...new Set([...opts.files, path])].slice(0, 20) });
                setPlusView("main");
              }}
              onClose={() => setPlusView("main")}
            />
          </div>
        </div>
      )}

      {/* 引用技能 = **居中弹窗**（11-07 用户：「技能选项弹窗，那个」）：
          可多选（点行切换），完成 / Esc / 点背景关闭，选中的在输入框上方以 chip 显示。 */}
      {plusView === "skills" && createPortal(
        <div className="modal-backdrop team-skill-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPlusView("main"); }}>
          <section className="team-skill-dialog" role="dialog" aria-modal="true" aria-label="引用技能">
            <header className="team-skill-dialog__head">
              <Sparkles size={15} className="ic-violet" />
              <strong>引用技能</strong>
              <span className="team-skill-dialog__count">已选 {opts.skills.length}</span>
              <button type="button" className="icon-button" title="关闭（Esc）" aria-label="关闭" onClick={() => setPlusView("main")}><X size={15} /></button>
            </header>
            <div className="team-skill-dialog__search">
              <Search size={14} />
              <input autoFocus value={skillQuery} onChange={(e) => setSkillQuery(e.target.value)} placeholder="搜索已安装技能" aria-label="搜索技能" />
            </div>
            <div className="team-skill-dialog__list" role="listbox" aria-multiselectable="true">
              {skillMatches.map((item) => {
                const on = opts.skills.some((x) => x.name === item.name);
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    key={item.name}
                    className={`team-skill-dialog__item${on ? " is-on" : ""}`}
                    title={`${item.name}：${item.description}`}
                    onClick={() => toggleSkill(item)}
                  >
                    <Sparkles size={15} />
                    <span className="team-skill-dialog__name">{item.name}</span>
                    <small>{item.description}</small>
                    {on && <Check size={14} className="team-skill-dialog__check" />}
                  </button>
                );
              })}
              {!skillMatches.length && <p className="submenu-empty">没有匹配的技能</p>}
            </div>
            <footer className="team-skill-dialog__foot">
              <span>已选 {opts.skills.length} 个 · 发送时拼进本轮指令</span>
              <button type="button" className="is-primary" onClick={() => setPlusView("main")}>完成</button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
      <textarea
        ref={textareaRef}
        className="team-composer__input"
        style={editorHeight ? { height: editorHeight, maxHeight: editorHeight } : undefined}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(e) => void onPaste(e)}
        placeholder={placeholder}
        rows={2}
      />

      <div className="team-composer__actions composer-actions">
        <div className="team-composer__left composer-left">
          <div className="composer-quick-menu">
            <button
              type="button"
              className={`icon-button team-composer__icon plus-spin-button${plusOpen ? " is-on" : ""}`}
              title="添加文件 / 引用技能"
              aria-label="添加"
              aria-expanded={plusOpen}
              onClick={() => { setPlusOpen((v) => !v); setPlusView("main"); setSkillQuery(""); }}
            >
              <Plus key={plusOpen ? "on" : "off"} size={16} className="plus-spin" />
            </button>
            {plusOpen && (
              <div className="composer-quick-pop flip-main-up team-composer__pop" role="menu">
                <>
                    {/* ⛔ 11-06 用户：「添加文件，外面有回形针，里面就可以删了」——
                        同一个动作只留一个入口，菜单里不再重复。 */}
                    <button type="button" role="menuitem" onClick={() => { setPlusView("skills"); setPlusOpen(false); setSkillQuery(""); }}>
                      <Sparkles size={16} /><span>引用技能</span><ChevronDown size={14} className="submenu-chevron" />
                    </button>
                    <button type="button" role="menuitem" onClick={() => { setPlusView("files"); setPlusOpen(false); setFileQuery(""); }}>
                      <FolderOpen size={16} /><span>引用群里的文件</span><ChevronDown size={14} className="submenu-chevron" />
                    </button>
                    <button type="button" role="menuitem" onClick={() => { onOpts({ ...opts, files: [], skills: [] }); setPlusOpen(false); }}>
                      <X size={16} /><span>清空本轮附件</span>
                    </button>
                </>
              </div>
            )}
          </div>
          <button type="button" className="icon-button team-composer__icon" title="添加文件（本地绝对路径）" aria-label="添加文件" onClick={() => void pickFiles()}>
            <Paperclip size={15} />
          </button>
          {/* 11-07 用户令：「输入框上面这个列表，改成 @ 面板」——
              原来那块常驻 chip 拆掉了，入口收敛成这一个按钮（打开面板选人，已选的人仍以 chip 显示在框外）。 */}
          {onOpenMention && (
            <button
              type="button"
              className={`icon-button team-composer__icon team-composer__at${mentionCount > 0 ? " is-on" : ""}`}
              title="选择伙伴（@）"
              aria-label="选择伙伴（@）"
              onClick={onOpenMention}
            >
              <AtSign size={15} />
              {mentionCount > 0 && <span className="team-composer__at-badge">{mentionCount}</span>}
            </button>
          )}
          <ComposerMenu
            icon={ShieldCheck}
            label="权限"
            title="本轮派活的沙箱与审批方式"
            value={permValue}
            options={approvalMenuOptions(fullAccess)}
            onChange={onPermission}
            tone={fullAccess ? "danger" : undefined}
            disabled={sending}
          />
        </div>

        <div className="team-composer__right composer-right">
          <span className="team-composer__count" title="本轮输入字符数（不是 token）">{value.length} 字</span>
          <ComposerMenu icon={Bot} label="模型" title={retired ? `本轮派活使用的模型 · ${retired}` : "本轮派活使用的模型（空 = 跟随全局当前模型）"} value={opts.model} options={models} onChange={(v) => { if (v === "__model_settings__") { onOpenModelSettings?.(); return; } onOpts({ ...opts, model: v }); }} onOpen={() => void loadModels()} width={360} disabled={sending} />
          <EffortPicker levels={["low", "medium", "high", "xhigh"]} value={opts.effort || "high"} labels={effortLabels} modelId={opts.model || undefined} disabled={sending} onCommit={(v) => onOpts({ ...opts, effort: v })} />
          {/* 群菜单按钮（飞书 `needShowMenuButton`）：从输入框上方搬到工具行，输入区少占一行 */}
          {toolsSlot}
          <button type="button" className="team-composer__send" onClick={onSend} disabled={sending || !canSend} title={targetNames.length ? `派给 ${targetNames.join("、")}` : "先点 @ 选伙伴"}>
            <Send size={15} /> 发送
          </button>
        </div>
      </div>
    </div>
  );
}
