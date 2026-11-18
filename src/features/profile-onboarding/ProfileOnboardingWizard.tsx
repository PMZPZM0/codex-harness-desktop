/**
 * 登录后的新人配置引导（10-26 用户令）。
 *
 * 触发：AppView 挂载后读 personalization —— 只有「完全没配置过的新用户」才弹：
 *   `onboarded / profileGuideSeen / greeted` 任一为 true 都不弹。
 *   ⇒ 已配置用户退出登录再登录不会看到；点「稍后配置」只记 profileGuideSeen，
 *     新人对话里的身份引导仍可补位。
 *
 * 联动（全部走现有 personalization.save-identity，不新增状态源）：
 *   · 称呼 → nickname（同时更新左侧账户名与 localStorage）
 *   · 角色 → occupation / userContext（用户人格库的 10 套预设，或自定义职业）
 *   · 兴趣 → interests；沟通风格 → replyStyle / tone / habits
 *   · Codex 名字 → assistantName（消息头立即更新）
 *   · 最后一页 → customInstructions + onboarded=true
 * 保存后 AGENTS.md 立即重写，下一条消息生效；界面称呼与 Codex 名字当场更新。
 */
import { useCallback, useEffect, useState } from "react";
import { ExpertSetup, type GuideExpert } from "./ExpertSetup";
import { guideRecommendation, readGuideChoice, rememberGuideChoice, type GuideLaunch } from "./guide-direction";
import { createPortal } from "react-dom";
import {
  ArrowLeft, ArrowRight, BookOpen, Briefcase, Check, Code2, Dumbbell, Gamepad2, Heart,
  Lightbulb, LoaderCircle, Music, Palette, PenLine, Sparkles, TrendingUp, UserRound, Video, X,
} from "lucide-react";
import { USER_PERSONAS, userPersonaFields } from "../../lib/user-personas.mjs";
// 内置 Codex 人格（11-01 用户令「联动引导配置」）：与引导简版四选一并列，选内置写完整人设 + soulSlug
import { BUILT_IN_SOULS } from "../../lib/builtin-souls.mjs";
import { setCodexIdentity, storeCodexAvatar } from "../../lib/codex-identity.mjs";
import { avatarAsset, CODEX_AVATAR_PRESETS, CODEX_DEFAULT_AVATAR_FILE, USER_AVATAR_PRESETS } from "../../lib/avatar-presets";
import { REPLY_STYLES as REPLY_STYLE_PRESETS, replyStyleTitleOf, replyStyleIdOf } from "../../lib/reply-styles.mjs";

/** 本向导用到的档案字段子集（不依赖生成 d.ts 的窄口径；saveIdentity 仍按 Record 透传）。 */
type Config = {
  nickname?: string;
  customInstructions?: string;
  assistantName?: string;
  occupation?: string;
  replyStyle?: string;
  tone?: string;
  interests?: string;
  habits?: string;
  userContext?: string;
  persona?: string;
  soulSlug?: string;
  onboarded?: boolean;
  profileGuideSeen?: boolean;
  greeted?: boolean;
};

type Tone = "casual" | "professional" | "none";

const STEPS = [
  { id: "work", label: "工作方向", title: "你想先做什么？", desc: "选择这次要做的工作，再挑一个适合的身份。", icon: Briefcase },
  { id: "team", label: "专家与工具", title: "谁来和你一起做？", desc: "选择专家后，可以查看配套技能、检测工具或准备安装。", icon: UserRound },
  { id: "preferences", label: "协作偏好", title: "你希望 Codex 怎样配合？", desc: "可以沿用当前搭档，也可以调整人格、称呼和沟通习惯。", icon: Sparkles },
  { id: "review", label: "核对与开始", title: "准备从哪里开始？", desc: "核对本次配置，选择保存后要执行的动作。", icon: Check },
] as const;

/** Codex 的人格预设：写进 personalization.persona（与人格市场同一注入位），
 *   ⛔ 只用通用性格描述，不引用任何第三方 IP。 */
const ASSISTANT_PERSONAS = [
  { id: "default", label: "默认 Codex", desc: "平衡、直接，按任务切换表达", persona: "" },
  /* ⛔ 「严谨工程师」简版已删：与内置 built-in:engineer（极简工程师，完整人设）重复 —— 由下方合并项提供 */
  { id: "assistant", label: "高效助理", desc: "结论先行，少客套，直接给动作", persona: "你是高效助理：结论先行，能一句话说清就不写三段；直接给动作与结果，少寒暄，不主动扩展无关话题。" },
  { id: "teacher", label: "耐心老师", desc: "把原理讲透，循序渐进", persona: "你是耐心的老师：先给结论，再用类比与步骤解释原理；重要概念配小例子；不堆术语，不一次塞太多。" },
  { id: "creative", label: "创意搭档", desc: "多给点子，敢提不同方案", persona: "你是创意搭档：先理解目标，再给 2~3 个不同方向的方案与取舍；鼓励尝试，但明确风险与成本。" },
  { id: "gentle", label: "温柔陪伴", desc: "语气温和，情绪支持但不失准确", persona: "你是温柔的陪伴者：先接住情绪，再处理问题；语气温和、简短，不敷衍；技术判断仍然准确、不牺牲严谨。" },
];

const INTERESTS = [
  { label: "编程", icon: Code2 },
  { label: "AI", icon: Sparkles },
  { label: "写作", icon: PenLine },
  { label: "设计", icon: Palette },
  { label: "视频", icon: Video },
  { label: "投资", icon: TrendingUp },
  { label: "学习", icon: BookOpen },
  { label: "游戏", icon: Gamepad2 },
  { label: "健身", icon: Dumbbell },
  { label: "音乐", icon: Music },
];

/* ⛔ 11-08 用户：「回复风格不止三个吧」—— 原来这里只写死 3 档，引导里根本选不到
   需求询问 / 敢于反驳 / 直击本质。清单改为共用 `lib/reply-styles.mjs`（个性化页 / 用户中心同源）。
   ⛔ 落档仍存**中文名**（历史档案就是中文），⛔ 别改成存 id。 */
const REPLY_STYLES = REPLY_STYLE_PRESETS.map((item) => ({ id: item.value, title: item.title, desc: item.desc }));

const TONES: { id: Tone; label: string; desc: string }[] = [
  { id: "casual", label: "轻松幽默", desc: "可以开玩笑，别太端着" },
  { id: "professional", label: "专业中性", desc: "稳定、克制、少情绪" },
  { id: "none", label: "不指定", desc: "跟随默认风格" },
];

const HABITS = ["直接指出我的错误", "先给结论，少客套", "不确定时先问我"];

function parseList(text?: string): string[] {
  return String(text ?? "").split(/[、,，;；]/).map((item) => item.trim()).filter(Boolean);
}

function inferPersona(config: Config): string {
  const hit = USER_PERSONAS.find((p) => p.occupation === config.occupation);
  return hit?.id ?? "";
}

function inferReplyStyle(value?: string): string {
  return replyStyleIdOf(value) || "none";
}

function inferTone(value?: string): Tone {
  if (value === "轻松幽默" || value === "轻松") return "casual";
  if (value === "专业中性" || value === "专业") return "professional";
  return "none";
}

const STARTS = [
  { id: "devtools", title: "软件开发", path: "写代码、调试与运维", entry: "开发工具", icon: Code2, assistant: "assistant" },
  { id: "media-desk", title: "自媒体创作", path: "写稿、剪辑与内容运营", entry: "自媒体工作台", icon: PenLine, assistant: "creative" },
  { id: "component-library", title: "产品与设计", path: "原型、组件与界面设计", entry: "组件库", icon: Palette, assistant: "creative" },
  { id: "artifacts", title: "办公与研究", path: "资料整理、研究与交付", entry: "产物档案", icon: Briefcase, assistant: "assistant" },
] as const;
type Start = typeof STARTS[number]["id"];
const assistants: Array<{id: string; label: string; desc: string; persona: string; soulSlug?: string}> = [
  ...ASSISTANT_PERSONAS,
  ...BUILT_IN_SOULS.map(s => ({ id: s.slug, label: s.displayName, desc: s.summary, persona: s.content, soulSlug: s.slug })),
];
/** 画像引导向导：逐项问清身份与偏好，应用后写回个性化配置。 */
export function ProfileOnboardingWizard({ onApplied, onNotice, onUserAvatar, onStart, install, onExpert }: {
  install: (id: string) => Promise<boolean>;
  onExpert: (selection: GuideExpert) => Promise<void>;
  onStart: (target: Start) => void | Promise<void>;
  onApplied?: (config: Config) => void;
  onNotice?: (text: string) => void;
  onUserAvatar?: (avatar: { type: "image" | "emoji" | "none"; value: string }) => void;
}) {
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [start, setStart] = useState<Start | null>(null);
  const [expert, setExpert] = useState<GuideExpert | null>(null);
  const [launch, setLaunch] = useState<GuideLaunch>("save");
  const [restoreKey, setRestoreKey] = useState<string | null>(null);
  const [config, setConfig] = useState<Config>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [nickname, setNickname] = useState("");
  const [assistantName, setAssistantName] = useState("");
  const [userAvatar, setUserAvatarState] = useState(() => {
    try {
      const profile = JSON.parse(localStorage.getItem("user-profile") || "{}");
      if (profile.avatarType === "image" && profile.avatar) return String(profile.avatar);
    } catch { /* 忽略 */ }
    return avatarAsset(USER_AVATAR_PRESETS[0].file);
  });
  const [codexAvatar, setCodexAvatarState] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("codex-avatar") || "{}");
      if (raw?.type === "image" && raw.value) return String(raw.value);
    } catch { /* 忽略 */ }
    return avatarAsset(CODEX_DEFAULT_AVATAR_FILE);
  });
  const [personaId, setPersonaId] = useState("");
  const [assistantPersonaId, setAssistantPersonaId] = useState("default");
  /** 用户在本次引导里是否真的点过 Codex 人格卡；没点就保留档案里原有的人格（含人格市场）。 */
  const [assistantPersonaTouched, setAssistantPersonaTouched] = useState(false);
  const [showOtherAssistants, setShowOtherAssistants] = useState(false);
  const [occupation, setOccupation] = useState("");
  const [customInterest, setCustomInterest] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [replyStyle, setReplyStyle] = useState<string>("pragmatic");
  const [tone, setTone] = useState<Tone>("none");
  const [habits, setHabits] = useState<string[]>([]);
  const [customInstructions, setCustomInstructions] = useState("");

  /** 把档案灌回表单：首次自动弹出与「重新配置引导」共用，避免两套初始化逻辑漂移。 */
  const hydrate = useCallback((stored: Config) => {
    const persona = inferPersona(stored);
    const rec = guideRecommendation(persona);
    const last = readGuideChoice(stored.occupation ?? "");
    const direction = rec.direction ?? last?.direction ?? null;
    const compatible = last?.direction === direction;
    setStart(direction);
    setLaunch(compatible && last ? last.launch : last?.launch === "save" || !direction ? "save" : "entry");
    setRestoreKey(compatible && last?.teamId && last.memberId ? JSON.stringify([last.teamId, last.memberId]) : null);
    setExpert(null);
    const cachedName = localStorage.getItem("username") ?? "";
    setNickname(stored.nickname || (cachedName && cachedName !== "Codex 用户" && cachedName !== "Administrator" ? cachedName : ""));
    setAssistantName(stored.assistantName || "");
    setPersonaId(persona);
    const matched = assistants.find(a => a.id === stored.soulSlug || (a.persona && a.persona === stored.persona));
    setAssistantPersonaId(matched?.id ?? (stored.persona || stored.soulSlug ? "stored" : "default"));
    setShowOtherAssistants(false);
    setAssistantPersonaTouched(false);
    setOccupation(persona ? "" : stored.occupation || "");
    const known = new Set(INTERESTS.map((item) => item.label));
    const storedInterests = parseList(stored.interests);
    setInterests(storedInterests.filter((item) => known.has(item)));
    setCustomInterest(storedInterests.filter((item) => !known.has(item)).join("、"));
    setReplyStyle(inferReplyStyle(stored.replyStyle));
    setTone(inferTone(stored.tone));
    setHabits(parseList(stored.habits).filter((item) => HABITS.includes(item)));
    setCustomInstructions(stored.customInstructions || "");
    try {
      const profile = JSON.parse(localStorage.getItem("user-profile") || "{}");
      if (profile.avatarType === "image" && profile.avatar) setUserAvatarState(String(profile.avatar));
      const rawCodex = JSON.parse(localStorage.getItem("codex-avatar") || "{}");
      if (rawCodex?.type === "image" && rawCodex.value) setCodexAvatarState(String(rawCodex.value));
    } catch { /* 坏缓存忽略 */ }
  }, []);

  useEffect(() => {
    let alive = true;
    void window.codex.readPersonalization().then((raw) => {
      const stored = raw as Config;
      if (!alive) return;
      setChecked(true);
      if (stored.onboarded || stored.profileGuideSeen || stored.greeted) return;
      setConfig(stored);
      hydrate(stored);
      setOpen(true);
    }).catch(() => { if (alive) setChecked(true); });
    return () => { alive = false; };
  }, [hydrate]);

  /* 用户中心「重新配置引导」入口：已配置用户也能手动重开，改完立即覆盖档案。 */
  useEffect(() => {
    const onOpen = () => {
      void window.codex.readPersonalization().then((raw) => {
        const stored = raw as Config;
        setConfig(stored);
        hydrate(stored);
        setError("");
        setSaving(false);
        setStep(0);
        setChecked(true);
        setOpen(true);
      }).catch(() => undefined);
    };
    window.addEventListener("codex-open-profile-guide", onOpen);
    return () => window.removeEventListener("codex-open-profile-guide", onOpen);
  }, [hydrate]);

  const finish = useCallback(async (skipped: boolean) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      if (skipped) {
        await window.codex.saveIdentity({ profileGuideSeen: true });
        setOpen(false);
        onNotice?.("已跳过配置，之后可在「设置 → 个性化」里继续");
        return;
      }
      const selected = USER_PERSONAS.find((item) => item.id === personaId) ?? null;
      const selectedAssistant = assistants.find(item => item.id === assistantPersonaId);
      const fields = selected ? userPersonaFields(selected.id) : null;
      const finalOccupation = occupation.trim() || fields?.occupation || "";
      const interestText = [...interests, customInterest.trim()].filter(Boolean).join("、");
      const habitText = habits.join("；");
      const payload: Record<string, unknown> = {
        onboarded: true,
        greeted: true,
        profileGuideSeen: true,
        ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
        ...(assistantName.trim() && assistantName.trim() !== "Codex" ? { assistantName: assistantName.trim() } : {}),
        occupation: finalOccupation,
        ...(fields ? { userContext: fields.userContext } : USER_PERSONAS.some(p => p.userContext === config.userContext) ? { userContext: "" } : {}),
        ...(interestText ? { interests: interestText } : {}),
        ...(replyStyle !== "none" ? { replyStyle: replyStyleTitleOf(replyStyle) } : {}),
        ...(tone !== "none" ? { tone: tone === "casual" ? "轻松幽默" : "专业中性" } : {}),
        ...(habitText ? { habits: habitText } : {}),
        ...(customInstructions.trim() ? { customInstructions: customInstructions.trim() } : {}),
        ...(assistantPersonaTouched && selectedAssistant ? { persona: selectedAssistant.persona, soulSlug: selectedAssistant.soulSlug ?? "" } : {}),
      };
      const saved = (await window.codex.saveIdentity(payload as unknown as Record<string, string>)) as Config;
      try {
        const profile = JSON.parse(localStorage.getItem("user-profile") || "{}");
        localStorage.setItem("user-profile", JSON.stringify({
          ...profile,
          ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
          avatarType: "image",
          avatar: userAvatar,
          occupation: finalOccupation,
          /* 领域不要复制职业（否则用户中心会出现「产品经理 · 产品经理」）：
             选了角色卡就不填领域；手填职业时只保留原本不同的领域。 */
          field: selected ? "" : (profile.field && profile.field !== finalOccupation ? profile.field : ""),
          hobby: interestText || profile.hobby || "",
          habit: habitText || profile.habit || "",
          style: replyStyle || "none",
        }));
      } catch { /* localStorage 写失败不影响落盘 */ }
      if (nickname.trim()) localStorage.setItem("username", nickname.trim());
      const codexAvatarSpec = { type: "image" as const, value: codexAvatar };
      storeCodexAvatar(codexAvatarSpec);
      setCodexIdentity({ ...(assistantName.trim() && assistantName.trim() !== "Codex" ? { name: assistantName.trim() } : {}), avatar: codexAvatarSpec });
      onUserAvatar?.({ type: "image", value: userAvatar });
      /* 通知已挂载的用户中心/其它资料面板重新回读档案（新用户首次通常还没挂载，但保存后再打开也要一致）。 */
      try { window.dispatchEvent(new CustomEvent("codex-profile-updated")); } catch { /* 忽略 */ }
      setOpen(false);
      onApplied?.(saved as Config);
      rememberGuideChoice(start, expert, finalOccupation, launch);
      onNotice?.("配置已保存，下一条消息起生效");
      if (launch === "expert" && expert) {
        try { await onExpert(expert); } catch { onNotice?.("配置已保存，专家会话未能打开，请从专家列表重试"); }
      } else if (launch === "entry" && start) {
        try { await onStart(start); } catch { onNotice?.("配置已保存，但入口未能打开，请从侧栏重试"); }
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err ?? "保存失败，请重试"));
    } finally {
      setSaving(false);
    }
  }, [assistantName, assistantPersonaId, assistantPersonaTouched, codexAvatar, config, customInstructions, customInterest, habits, interests, nickname, occupation, onApplied, onNotice, onUserAvatar, onStart, expert, launch, onExpert, personaId, replyStyle, saving, start, tone, userAvatar]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) return;
      event.preventDefault();
      void finish(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, saving, finish]);

  if (!checked || !open) return null;

  const selectedPersona = USER_PERSONAS.find((item) => item.id === personaId) ?? null;
  const selectedAssistantPersona = assistants.find(a => a.id === assistantPersonaId) ?? { label: "档案中的自定义搭档", desc: "保留当前设置" };
  const workspace = STARTS.find(s => s.id === start);
  const roles = USER_PERSONAS.filter(p => !start || guideRecommendation(p.id).direction === start);
  const recommended = personaId ? guideRecommendation(personaId).assistant : workspace?.assistant ?? "default";
  const visibleAssistants = !showOtherAssistants ? assistants.filter(a => a.id === recommended || a.id === assistantPersonaId) : assistants;
  const chooseDirection = (id: Start | null) => {
    if (start === id) return;
    setStart(id); setPersonaId(""); setOccupation(""); setExpert(null); setRestoreKey(null);
    setLaunch(id ? "entry" : "save");
    setAssistantPersonaId(STARTS.find(s => s.id === id)?.assistant ?? "default");
    setAssistantPersonaTouched(true); setShowOtherAssistants(false);
  };
  const chooseRole = (id: string, custom = "") => {
    if (personaId === id && occupation === custom) return;
    setPersonaId(id); setOccupation(custom);
    if (id === personaId) return;
    const next = guideRecommendation(id);
    if (next.direction && !start) chooseDirection(next.direction);
    setPersonaId(id); setAssistantPersonaId(id ? next.assistant : workspace?.assistant ?? "default");
    setAssistantPersonaTouched(true); setShowOtherAssistants(false);
  };
  const active = STEPS[step];
  const progress = Math.round(((step + 1) / STEPS.length) * 100);
  const effectiveInterests = [...interests, customInterest.trim()].filter(Boolean).join("、");
  const effectiveReply = replyStyleTitleOf(replyStyle);
  const effectiveTone = TONES.find((item) => item.id === tone)?.label ?? "不指定";

  return createPortal(
    <div className="profile-guide-backdrop" role="dialog" aria-modal="true" aria-label="用户配置引导">
      <div className="profile-guide-card">
        <aside className="profile-guide-rail">
          <div className="profile-guide-brand"><Sparkles size={16} /><strong>Codex Harness</strong></div>
          {/* ⛔ 11-08 用户：「左边上面的字不要换行」——轨宽 236px，原来那句 14 个字必然折成两行。
              ⇒ 标题压成 5 个汉字 + 品牌名（19px 下一行约 150px），细节移到下面那行小字。 */}
          <h2>配置工作空间</h2>
          <ol className="profile-guide-steps">
            {STEPS.map((item, index) => {
              const Icon = item.icon;
              const state = index < step ? "done" : index === step ? "current" : "todo";
              return (
                <li key={item.id} className={state}><button type="button" disabled={index > step || saving} aria-current={index === step ? "step" : undefined} onClick={() => setStep(index)}>
                  <span className="profile-guide-step-icon">{index < step ? <Check size={12} /> : <Icon size={13} />}</span>
                  <span>{item.label}</span></button>
                </li>
              );
            })}
          </ol>
          <dl className="profile-guide-blueprint" aria-label="当前工作配置">
            <dt className="profile-guide-partner-avatar"><img src={codexAvatar} alt="Codex 头像" /></dt><dd className="profile-guide-partner-name"><strong>{assistantName.trim() || "Codex"}</strong><small>{selectedAssistantPersona.label}</small></dd>
            <dt>工作方向</dt><dd>{workspace?.title ?? "自由配置"}</dd>
            <dt>我的身份</dt><dd>{selectedPersona?.label || occupation || "不指定职业"}</dd>
            <dt>协作专家</dt><dd>{expert?.member.name || (restoreKey ? "等待读取" : "未选择")}</dd>
          </dl>
          <div className="profile-guide-progress"><span style={{ width: `${progress}%` }} /></div>
        </aside>

        <section className="profile-guide-main">
          <header className="profile-guide-head">
            <div>
              <span className="profile-guide-kicker">第 {step + 1} / {STEPS.length} 步</span>
              <h3>{active.title}</h3>
              <p>{active.desc}</p>
            </div>
            <button type="button" className="profile-guide-close" title="稍后配置" disabled={saving} onClick={() => void finish(true)}><X size={16} /></button>
          </header>

          <div className="profile-guide-body" key={active.id}>
            {active.id === "preferences" && <details className="profile-guide-fold"><summary><UserRound size={16} />称呼与头像<span>{nickname || "未填写"}</span></summary>
              <div className="profile-guide-hello">
                <div className="profile-guide-avatar"><UserRound size={26} /></div>
                <label className="profile-guide-field"><span>怎么称呼你</span><input autoComplete="off" maxLength={20} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="填写称呼" /></label>
                <label className="profile-guide-field"><span>给 Codex 取个名字 <em>可选</em></span><input autoComplete="off" maxLength={20} value={assistantName} onChange={(event) => setAssistantName(event.target.value)} placeholder="不填就是 Codex" /></label>
                <div className="profile-guide-avatar-picks">
                  <div>
                    <div className="profile-guide-label">你的头像</div>
                    <div className="profile-guide-avatars">
                      {USER_AVATAR_PRESETS.map((preset) => {
                        const value = avatarAsset(preset.file);
                        return <button type="button" key={preset.id} className={userAvatar === value ? "on" : ""} title={preset.label} aria-label={`使用${preset.label}头像`} aria-pressed={userAvatar === value} onClick={() => setUserAvatarState(value)}><img src={value} alt="" /></button>;
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="profile-guide-label">Codex 的形象</div>
                    <div className="profile-guide-avatars">
                      {CODEX_AVATAR_PRESETS.map((preset) => {
                        const value = avatarAsset(preset.file);
                        return <button type="button" key={preset.id} className={codexAvatar === value ? "on" : ""} title={preset.label} aria-label={`使用「${preset.label}」形象`} aria-pressed={codexAvatar === value} onClick={() => setCodexAvatarState(value)}><img src={value} alt="" /></button>;
                      })}
                    </div>
                  </div>
                </div>
                <p className="profile-guide-note">称呼会同步到左下角账户名与消息抬头；头像也可以在用户中心随时换。</p>
              </div>
            </details>}

            {active.id === "work" && (
              <div className="profile-guide-role">
                <fieldset className="profile-guide-starts"><legend>工作方向</legend>
                  <div className="profile-guide-start-grid">{STARTS.map(({ id, title, path, icon: Icon }) => <label key={id} className="profile-guide-start" data-direction={id}>
                    <Icon size={20} /><span><strong>{title}</strong><small>{path}</small></span>
                    <input type="radio" name="guide-direction" value={id} checked={start === id} onChange={() => chooseDirection(id)} />
                  </label>)}</div>
                  <label className="profile-guide-save-only"><input type="radio" name="guide-direction" checked={!start} onChange={() => chooseDirection(null)} /> 自由配置</label>
                </fieldset>
                <div className="profile-guide-section-title"><Briefcase size={15} />我的身份<span>{workspace?.title ?? "全部方向"}</span></div>
                <div className="profile-guide-personas">
                  <button type="button" className={`profile-guide-persona ${!personaId && !occupation ? "on" : ""}`} onClick={() => chooseRole("")}>
                    <span className="profile-guide-persona-mark">通</span>
                    <div><strong>不指定职业</strong><small>按本次任务选择搭档和入口</small></div>
                    {!personaId && !occupation && <Check size={14} className="profile-guide-check" />}
                  </button>
                  {roles.map((persona, index) => (
                    <button type="button" key={persona.id} data-role={persona.id} className={`profile-guide-persona ${personaId === persona.id ? "on" : ""}`} onClick={() => chooseRole(persona.id)}>
                      <span className={`profile-guide-persona-mark tone-${index % 5}`}>{persona.label.slice(0, 1)}</span>
                      <div><strong>{persona.label}</strong><small>{persona.userContext}</small></div>
                      {personaId === persona.id && <Check size={14} className="profile-guide-check" />}
                    </button>
                  ))}
                </div>
                <label className="profile-guide-field"><span>其他职业 <em>可选</em></span><input maxLength={40} value={occupation} onChange={event => chooseRole("", event.target.value)} placeholder="填写你的职业" /></label>
              </div>
            )}

            {active.id === "team" && <ExpertSetup direction={start} restoreKey={restoreKey} value={expert} install={install} onChange={v => {
              setExpert(v); setRestoreKey(null);
              if (!restoreKey && v) setLaunch("expert");
              else if (!v && launch === "expert") setLaunch(start ? "entry" : "save");
            }} />}
            {active.id === "preferences" && (
              <div className="profile-guide-assistant">
                <div className="profile-guide-section-title"><Sparkles size={15} />Codex 人格</div>
                <div className="profile-guide-personas">
                  {visibleAssistants.map((persona, index) => (
                    <button type="button" key={persona.id} className={`profile-guide-persona ${assistantPersonaId === persona.id ? "on" : ""}`} onClick={() => { setAssistantPersonaId(persona.id); setAssistantPersonaTouched(true); }}>
                      <span className={`profile-guide-persona-mark tone-${index % 5}`}>{persona.label.slice(0, 1)}</span>
                      <div><strong>{persona.label}</strong><small>{persona.id === recommended ? "推荐 · " : ""}{persona.desc}</small></div>
                      {assistantPersonaId === persona.id && <Check size={14} className="profile-guide-check" />}
                    </button>
                  ))}
                </div>
                <div className="profile-guide-quote">
                  <Sparkles size={14} />
                  <div>
                    <b>当前 Codex 搭档</b>
                    <span>{selectedAssistantPersona.label}：{selectedAssistantPersona.desc}</span>
                  </div>
                </div>
                <button type="button" className="profile-guide-back" aria-expanded={showOtherAssistants} onClick={() => setShowOtherAssistants(v => !v)}>{showOtherAssistants ? "收起其他搭档" : "选择其他 Codex 搭档"}</button>
              </div>
            )}

            {active.id === "preferences" && <details className="profile-guide-fold"><summary><Heart size={16} />兴趣与沟通习惯<span>{effectiveReply}</span></summary>
              <div className="profile-guide-vibe">
                <div className="profile-guide-group">
                  <div className="profile-guide-label">兴趣</div>
                  <div className="profile-guide-chips">
                    {INTERESTS.map(({ label, icon: Icon }) => {
                      const on = interests.includes(label);
                      return <button type="button" key={label} className={`profile-guide-chip ${on ? "on" : ""}`} onClick={() => setInterests((current) => on ? current.filter((item) => item !== label) : [...current, label])}><Icon size={13} />{label}{on && <Check size={11} />}</button>;
                    })}
                    {/* ⛔ 自定义兴趣做成"跟着 chip 走"的一格输入：原来它单独占一整行虚线框，
                        与上下两排 chip 不是一套视觉语言，第 4 步看起来就散（用户：「排版有点乱」）。 */}
                    <input className="profile-guide-inline-input" maxLength={80} value={customInterest} onChange={(event) => setCustomInterest(event.target.value)} placeholder="其他兴趣（顿号隔开）" />
                  </div>
                </div>
                <div className="profile-guide-group">
                  <div className="profile-guide-label">回复风格</div>
                  <div className="profile-guide-cards three">
                    {REPLY_STYLES.map((item) => <button type="button" key={item.id} className={`profile-guide-choice ${replyStyle === item.id ? "on" : ""}`} onClick={() => setReplyStyle(item.id)}><strong>{item.title}</strong><small>{item.desc}</small></button>)}
                  </div>
                </div>
                <div className="profile-guide-group">
                  <div className="profile-guide-label">语气</div>
                  <div className="profile-guide-chips">
                    {TONES.map((item) => <button type="button" key={item.id} className={`profile-guide-chip ${tone === item.id ? "on" : ""}`} onClick={() => setTone(item.id)} title={item.desc}>{item.label}{tone === item.id && <Check size={11} />}</button>)}
                  </div>
                </div>
                <div className="profile-guide-group">
                  <div className="profile-guide-label">长期习惯 <em>可多选</em></div>
                  <div className="profile-guide-habits">
                    {HABITS.map((habit) => { const on = habits.includes(habit); return <button type="button" key={habit} className={`profile-guide-chip ${on ? "on" : ""}`} onClick={() => setHabits((current) => on ? current.filter((item) => item !== habit) : [...current, habit])}>{habit}{on && <Check size={11} />}</button>; })}
                  </div>
                </div>
              </div>
            </details>}
            {active.id === "review" && (

              <div className="profile-guide-confirm">
                <fieldset className="profile-guide-starts" disabled={saving}>
                  <legend>保存后的第一步</legend>
                  <div className="profile-guide-launch">
                    {expert && <label><input type="radio" name="guide-launch" value="expert" checked={launch === "expert"} onChange={() => setLaunch("expert")} />与{expert.member.name}对话</label>}
                    {workspace && <label><input type="radio" name="guide-launch" value="entry" checked={launch === "entry"} onChange={() => setLaunch("entry")} />打开{workspace.entry}</label>}
                    <label><input type="radio" name="guide-launch" value="save" checked={launch === "save"} onChange={() => setLaunch("save")} />只保存配置</label>
                  </div>
                </fieldset>
                <div className="profile-guide-summary">
                  <SummaryRow label="工作方向" value={workspace?.title ?? "自由配置"} onEdit={() => setStep(0)} />
                  <SummaryRow label="你的身份" value={occupation.trim() || selectedPersona?.label || "不指定职业"} onEdit={() => setStep(0)} />
                  <SummaryRow label="协作专家" value={expert?.member.name ?? "未选择"} onEdit={() => setStep(1)} />
                  <SummaryRow label="称呼" value={`${nickname.trim() || "未指定"} · ${assistantName.trim() || "Codex"}`} onEdit={() => setStep(2)} />
                  <SummaryRow label="Codex 人格" value={selectedAssistantPersona.label} onEdit={() => setStep(2)} />
                  <SummaryRow label="兴趣" value={effectiveInterests || "未填写"} onEdit={() => setStep(2)} />
                  <SummaryRow label="风格" value={`${effectiveReply} · ${effectiveTone}${habits.length ? ` · ${habits.length} 条习惯` : ""}`} onEdit={() => setStep(2)} />
                </div>
                <label className="profile-guide-field"><span>还有什么想让它长期记住 <em>可选</em></span><textarea rows={3} maxLength={2000} value={customInstructions} onChange={(event) => setCustomInstructions(event.target.value)} placeholder="例如：改代码前先说计划；不要主动推荐新功能；回答用中文" /></label>
                <div className="profile-guide-effect"><Lightbulb size={15} /><div><b>保存后立即写入个性化档案</b><span>界面称呼当场更新；对话下一条消息起生效。可在「设置 → 个性化」随时修改。</span></div></div>
                {error ? <div className="profile-guide-error">{error}</div> : null}
              </div>
            )}
          </div>

          <footer className="profile-guide-footer">
            <button type="button" className="profile-guide-back" disabled={step === 0 || saving} onClick={() => setStep((current) => Math.max(0, current - 1))}><ArrowLeft size={14} />上一步</button>
            <div className="profile-guide-footer-right">
              {/* ⛔ 11-08 用户：「几个引导界面，都要加上暂时不设置的选项」——
                  原来只有轨道底部那行灰字（像脚注，基本发现不了）。现在每一步的页脚都有：
                  点它 = 整份引导先不设置（⛔ 不写任何值，只记"看过了"，下次不再打扰）。 */}
              <button type="button" className="profile-guide-skip" disabled={saving} onClick={() => void finish(true)}>暂时不设置</button>
              {step < STEPS.length - 1 ? (
                <button type="button" className="profile-guide-next" disabled={saving || (active.id === "team" && !!restoreKey)} onClick={() => setStep(current => current + 1)}>{STEPS[step + 1].label}<ArrowRight size={14} /></button>
              ) : (
                <button type="button" className="profile-guide-next" disabled={saving} onClick={() => void finish(false)}>{saving ? <><LoaderCircle size={14} className="spin" />保存中…</> : launch === "expert" && expert ? <>保存并开始对话<ArrowRight size={14} /></> : launch === "entry" && workspace ? <>保存并打开{workspace.entry}<ArrowRight size={14} /></> : <>保存配置<Check size={14} /></>}</button>
              )}
            </div>
          </footer>
        </section>
      </div>
    </div>,
    document.body,
  );
}

function SummaryRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="profile-guide-summary-row">
      <span>{label}</span>
      <b>{value}</b>
      <button type="button" onClick={onEdit}>修改</button>
    </div>
  );
}
