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
import { createPortal } from "react-dom";
import {
  ArrowLeft, ArrowRight, BookOpen, Briefcase, Check, Code2, Dumbbell, Gamepad2, Heart,
  Lightbulb, LoaderCircle, Music, Palette, PenLine, Sparkles, TrendingUp, UserRound, Video, X,
} from "lucide-react";
import { USER_PERSONAS, userPersonaFields } from "../../lib/user-personas.mjs";
import { setCodexIdentity, storeCodexAvatar } from "../../lib/codex-identity.mjs";
import { avatarAsset, CODEX_AVATAR_PRESETS, CODEX_DEFAULT_AVATAR_FILE, USER_AVATAR_PRESETS } from "../../lib/avatar-presets";

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
type ReplyStyle = "pragmatic" | "friendly" | "none";
type Tone = "casual" | "professional" | "none";

const STEPS = [
  { id: "hello", label: "称呼与头像", title: "先认识一下", desc: "怎么称呼你、要不要给 Codex 取个名字，顺手挑两个头像。", icon: UserRound },
  { id: "role", label: "你的角色", title: "你想让 Codex 以什么角色帮你", desc: "选一个最接近你的方向；它决定默认的工作方法与关注点。", icon: Briefcase },
  { id: "persona", label: "Codex 人格", title: "Codex 该是什么性格", desc: "决定它的表达习惯和做事气质；随时能在设置里换。", icon: Sparkles },
  { id: "vibe", label: "兴趣习惯", title: "聊得来，才用得顺", desc: "兴趣会作为长期背景；习惯决定它怎么配合你。", icon: Heart },
  { id: "confirm", label: "确认", title: "确认一下，马上生效", desc: "保存后会写入个性化档案与 AGENTS.md，下一条消息开始生效。", icon: Check },
] as const;

/** Codex 的人格预设：写进 personalization.persona（与人格市场同一注入位），
 *   ⛔ 只用通用性格描述，不引用任何第三方 IP。 */
const ASSISTANT_PERSONAS = [
  { id: "default", label: "默认 Codex", desc: "平衡、直接，按任务切换表达", persona: "" },
  { id: "engineer", label: "严谨工程师", desc: "先验证再下结论，给命令与检查项", persona: "你是严谨的工程搭档：先确认事实与边界，再给可执行的步骤；结论要有依据，不知道就直说；改代码前说明影响面，改完给出验证方式。" },
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

const REPLY_STYLES: { id: ReplyStyle; title: string; desc: string }[] = [
  { id: "pragmatic", title: "务实", desc: "结论先行，直接给做法" },
  { id: "friendly", title: "友好", desc: "多解释思路与取舍" },
  { id: "none", title: "默认", desc: "不额外注入语气" },
];

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

function inferReplyStyle(value?: string): ReplyStyle {
  return value === "友好" ? "friendly" : value === "务实" ? "pragmatic" : "none";
}

function inferTone(value?: string): Tone {
  if (value === "轻松幽默" || value === "轻松") return "casual";
  if (value === "专业中性" || value === "专业") return "professional";
  return "none";
}

export function ProfileOnboardingWizard({ onApplied, onNotice, onUserAvatar }: {
  onApplied?: (config: Config) => void;
  onNotice?: (text: string) => void;
  onUserAvatar?: (avatar: { type: "image" | "emoji" | "none"; value: string }) => void;
}) {
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
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
  const [occupation, setOccupation] = useState("");
  const [customInterest, setCustomInterest] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [replyStyle, setReplyStyle] = useState<ReplyStyle>("pragmatic");
  const [tone, setTone] = useState<Tone>("none");
  const [habits, setHabits] = useState<string[]>([]);
  const [customInstructions, setCustomInstructions] = useState("");

  useEffect(() => {
    let alive = true;
    void window.codex.readPersonalization().then((raw) => {
      const stored = raw as Config;
      if (!alive) return;
      setChecked(true);
      if (stored.onboarded || stored.profileGuideSeen || stored.greeted) return;
      setConfig(stored);
      const cachedName = localStorage.getItem("username") ?? "";
      setNickname(stored.nickname || (cachedName && cachedName !== "Codex 用户" && cachedName !== "Administrator" ? cachedName : ""));
      setAssistantName(stored.assistantName || "");
      const persona = inferPersona(stored);
      setPersonaId(persona);
      setOccupation(persona ? "" : stored.occupation || "");
      const known = new Set(INTERESTS.map((item) => item.label));
      const storedInterests = parseList(stored.interests);
      setInterests(storedInterests.filter((item) => known.has(item)));
      setCustomInterest(storedInterests.filter((item) => !known.has(item)).join("、"));
      setReplyStyle(inferReplyStyle(stored.replyStyle));
      setTone(inferTone(stored.tone));
      setHabits(parseList(stored.habits).filter((item) => HABITS.includes(item)));
      setCustomInstructions(stored.customInstructions || "");
      setOpen(true);
    }).catch(() => { if (alive) setChecked(true); });
    return () => { alive = false; };
  }, []);

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
      const selectedAssistant = ASSISTANT_PERSONAS.find((item) => item.id === assistantPersonaId) ?? ASSISTANT_PERSONAS[0];
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
        ...(finalOccupation ? { occupation: finalOccupation } : {}),
        ...(fields?.userContext ? { userContext: fields.userContext } : {}),
        ...(interestText ? { interests: interestText } : {}),
        ...(replyStyle !== "none" ? { replyStyle: replyStyle === "pragmatic" ? "务实" : "友好" } : {}),
        ...(tone !== "none" ? { tone: tone === "casual" ? "轻松幽默" : "专业中性" } : {}),
        ...(habitText ? { habits: habitText } : {}),
        ...(customInstructions.trim() ? { customInstructions: customInstructions.trim() } : {}),
        persona: selectedAssistant.persona,
        soulSlug: "",
      };
      const saved = (await window.codex.saveIdentity(payload as unknown as Record<string, string>)) as Config;
      try {
        const profile = JSON.parse(localStorage.getItem("user-profile") || "{}");
        localStorage.setItem("user-profile", JSON.stringify({
          ...profile,
          ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
          avatarType: "image",
          avatar: userAvatar,
          occupation: finalOccupation || profile.occupation || "",
          field: selected?.label ?? profile.field ?? "",
          hobby: interestText || profile.hobby || "",
          habit: habitText || profile.habit || "",
          style: replyStyle === "pragmatic" ? "pragmatic" : replyStyle === "friendly" ? "friendly" : "none",
        }));
      } catch { /* localStorage 写失败不影响落盘 */ }
      if (nickname.trim()) localStorage.setItem("username", nickname.trim());
      const codexAvatarSpec = { type: "image" as const, value: codexAvatar };
      storeCodexAvatar(codexAvatarSpec);
      setCodexIdentity({ ...(assistantName.trim() && assistantName.trim() !== "Codex" ? { name: assistantName.trim() } : {}), avatar: codexAvatarSpec });
      onUserAvatar?.({ type: "image", value: userAvatar });
      setOpen(false);
      onApplied?.(saved as Config);
      onNotice?.("配置已保存，下一条消息起生效");
    } catch (err: any) {
      setError(String(err?.message ?? err ?? "保存失败，请重试"));
    } finally {
      setSaving(false);
    }
  }, [assistantName, assistantPersonaId, codexAvatar, config, customInstructions, customInterest, habits, interests, nickname, occupation, onApplied, onNotice, onUserAvatar, personaId, replyStyle, saving, tone, userAvatar]);

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
  const selectedAssistantPersona = ASSISTANT_PERSONAS.find((item) => item.id === assistantPersonaId) ?? ASSISTANT_PERSONAS[0];
  const active = STEPS[step];
  const progress = Math.round(((step + 1) / STEPS.length) * 100);
  const effectiveInterests = [...interests, customInterest.trim()].filter(Boolean).join("、");
  const effectiveReply = REPLY_STYLES.find((item) => item.id === replyStyle)?.title ?? "默认";
  const effectiveTone = TONES.find((item) => item.id === tone)?.label ?? "不指定";

  return createPortal(
    <div className="profile-guide-backdrop" role="dialog" aria-modal="true" aria-label="用户配置引导">
      <div className="profile-guide-card">
        <aside className="profile-guide-rail">
          <div className="profile-guide-brand"><Sparkles size={16} /><strong>Codex Harness</strong></div>
          <h2>用一分钟，把 Codex 调成你的样子</h2>
          <p>只保存在本机；随时能在「设置 → 个性化」里改。</p>
          <ol className="profile-guide-steps">
            {STEPS.map((item, index) => {
              const Icon = item.icon;
              const state = index < step ? "done" : index === step ? "current" : "todo";
              return (
                <li key={item.id} className={state} onClick={() => { if (index <= step) setStep(index); }}>
                  <span className="profile-guide-step-icon">{index < step ? <Check size={12} /> : <Icon size={13} />}</span>
                  <span>{item.label}</span>
                </li>
              );
            })}
          </ol>
          <div className="profile-guide-progress"><span style={{ width: `${progress}%` }} /></div>
          <button type="button" className="profile-guide-skip" disabled={saving} onClick={() => void finish(true)}>稍后配置</button>
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
            {step === 0 && (
              <div className="profile-guide-hello">
                <div className="profile-guide-avatar"><UserRound size={26} /></div>
                <label className="profile-guide-field"><span>怎么称呼你</span><input autoFocus maxLength={20} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="例如：老王 / Alice / 老板" /></label>
                <label className="profile-guide-field"><span>给 Codex 取个名字 <em>可选</em></span><input maxLength={20} value={assistantName} onChange={(event) => setAssistantName(event.target.value)} placeholder="不填就是 Codex" /></label>
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
            )}

            {step === 1 && (
              <div className="profile-guide-role">
                <div className="profile-guide-personas">
                  <button type="button" className={`profile-guide-persona ${personaId === "" ? "on" : ""}`} onClick={() => setPersonaId("")}>
                    <span className="profile-guide-persona-mark">通</span>
                    <div><strong>通用助手</strong><small>不限定行业，按任务临时判断</small></div>
                    {personaId === "" && <Check size={14} className="profile-guide-check" />}
                  </button>
                  {USER_PERSONAS.map((persona, index) => (
                    <button type="button" key={persona.id} className={`profile-guide-persona ${personaId === persona.id ? "on" : ""}`} onClick={() => { setPersonaId(persona.id); setOccupation(""); }}>
                      <span className={`profile-guide-persona-mark tone-${index % 5}`}>{persona.label.slice(0, 1)}</span>
                      <div><strong>{persona.label}</strong><small>{persona.userContext}</small></div>
                      {personaId === persona.id && <Check size={14} className="profile-guide-check" />}
                    </button>
                  ))}
                </div>
                <label className="profile-guide-field"><span>或者直接填你的职业 <em>可选</em></span><input maxLength={40} value={occupation} onChange={(event) => { setOccupation(event.target.value); if (event.target.value.trim()) setPersonaId(""); }} placeholder="例如：后端工程师 / 产品经理 / 教师" /></label>
              </div>
            )}

            {step === 2 && (
              <div className="profile-guide-assistant">
                <div className="profile-guide-personas">
                  {ASSISTANT_PERSONAS.map((persona, index) => (
                    <button type="button" key={persona.id} className={`profile-guide-persona ${assistantPersonaId === persona.id ? "on" : ""}`} onClick={() => setAssistantPersonaId(persona.id)}>
                      <span className={`profile-guide-persona-mark tone-${index % 5}`}>{persona.label.slice(0, 1)}</span>
                      <div><strong>{persona.label}</strong><small>{persona.desc}</small></div>
                      {assistantPersonaId === persona.id && <Check size={14} className="profile-guide-check" />}
                    </button>
                  ))}
                </div>
                <div className="profile-guide-quote">
                  <Sparkles size={14} />
                  <div>
                    <b>它大概会这样说话</b>
                    <span>{assistantPersonaId === "default" ? "保持默认：按任务切换表达，不额外加人设。" : ASSISTANT_PERSONAS.find((item) => item.id === assistantPersonaId)?.persona.split("：")[0] + "：" + ASSISTANT_PERSONAS.find((item) => item.id === assistantPersonaId)?.desc}</span>
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="profile-guide-vibe">
                <div className="profile-guide-group">
                  <div className="profile-guide-label">兴趣</div>
                  <div className="profile-guide-chips">
                    {INTERESTS.map(({ label, icon: Icon }) => {
                      const on = interests.includes(label);
                      return <button type="button" key={label} className={`profile-guide-chip ${on ? "on" : ""}`} onClick={() => setInterests((current) => on ? current.filter((item) => item !== label) : [...current, label])}><Icon size={13} />{label}{on && <Check size={11} />}</button>;
                    })}
                  </div>
                  <input className="profile-guide-inline-input" maxLength={80} value={customInterest} onChange={(event) => setCustomInterest(event.target.value)} placeholder="还有别的兴趣？用顿号隔开" />
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
                    {HABITS.map((habit) => { const on = habits.includes(habit); return <button type="button" key={habit} className={`profile-guide-habit ${on ? "on" : ""}`} onClick={() => setHabits((current) => on ? current.filter((item) => item !== habit) : [...current, habit])}><span className="profile-guide-habit-box">{on && <Check size={11} />}</span>{habit}</button>; })}
                  </div>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="profile-guide-confirm">
                <div className="profile-guide-summary">
                  <SummaryRow label="称呼" value={nickname.trim() || "未指定"} onEdit={() => setStep(0)} />
                  <SummaryRow label="头像" value="已选择你的头像与 Codex 形象" onEdit={() => setStep(0)} />
                  <SummaryRow label="Codex 名字" value={assistantName.trim() || "Codex"} onEdit={() => setStep(0)} />
                  <SummaryRow label="你的角色" value={occupation.trim() || selectedPersona?.label || "通用助手"} onEdit={() => setStep(1)} />
                  <SummaryRow label="Codex 人格" value={selectedAssistantPersona.label} onEdit={() => setStep(2)} />
                  <SummaryRow label="兴趣" value={effectiveInterests || "未填写"} onEdit={() => setStep(3)} />
                  <SummaryRow label="风格" value={`${effectiveReply} · ${effectiveTone}${habits.length ? ` · ${habits.length} 条习惯` : ""}`} onEdit={() => setStep(3)} />
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
              {step < STEPS.length - 1 ? (
                <button type="button" className="profile-guide-next" disabled={saving} onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}>下一步<ArrowRight size={14} /></button>
              ) : (
                <button type="button" className="profile-guide-next" disabled={saving} onClick={() => void finish(false)}>{saving ? <><LoaderCircle size={14} className="spin" />保存中…</> : <>完成并生效<Check size={14} /></>}</button>
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
