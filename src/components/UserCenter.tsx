import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, UserRound, Briefcase, GraduationCap, Clock3, Heart, Languages, Lightbulb, Save, Wand2, LogOut, RotateCcw, Check, Sparkles, ChevronRight } from "lucide-react";
import { DefaultCodexAvatar } from "./DefaultCodexAvatar";
import { CODEX_DEFAULT_NAME, type CodexAvatarSpec } from "../lib/codex-identity.mjs";
import { avatarAsset, CODEX_AVATAR_PRESETS, CODEX_DEFAULT_AVATAR_FILE, USER_AVATAR_PRESETS } from "../lib/avatar-presets";
import { USER_PERSONAS, COMBO_PACKS, userPersonaFields } from "../lib/user-personas.mjs";
import { SettingsDialog } from "./SettingsDialog";

export type UserProfile = {
  nickname: string;
  avatarType: "emoji" | "image" | "none";
  avatar: string;
  occupation: string;
  field: string;
  hobby: string;
  habit: string;
  style: string;
  language: string;
  timezone: string;
  bio: string;
};

/** 用户资料的默认值：默认熊猫插画头像（旧档案里 avatarType=none 也补成同一份，避免看起来没生效）。 */
export function defaultProfile(): UserProfile {
  /* 10-21：没有头像时不再只显示名字首字母 —— 默认发一只熊猫插画头像（用户可选其它或上传）。
     旧档案里 avatarType=none 的也在下面初始化时补成同一个默认，避免「看起来还是 A」。 */
  return { nickname: "", avatarType: "image", avatar: avatarAsset("user-panda.png"), occupation: "", field: "", hobby: "", habit: "", style: "pragmatic", language: "中文", timezone: "Asia/Shanghai", bio: "" };
}

const STYLE_OPTIONS = [
  { value: "inquiry", label: "需求询问", desc: "先问清需求再动手（个性化页可选）" },
  { value: "challenge", label: "敢于反驳", desc: "需求有错先指出，给依据与更优方案" },
  { value: "essence", label: "直击本质", desc: "点名的手段若绕路，先给更上游的做法" },
  { value: "pragmatic", label: "务实", desc: "直接给结论和代码" },
  { value: "friendly", label: "友好", desc: "多解释思路与取舍" },
  { value: "none", label: "默认", desc: "不额外注入语气" },
];

/** 用户中心：昵称、头像、职业与画像，改动即时保存并回写宿主。 */
export function UserCenterSection({ username, onUsernameChange, personality, onPersonalityChange, onNotice, onProfileChange, onLogout, assistantName = CODEX_DEFAULT_NAME, onAssistantNameChange, codexAvatar, onCodexAvatarChange, onOpenPersonaMarket }: {
  username: string;
  onUsernameChange: (name: string) => void;
  personality: string;
  onPersonalityChange: (v: string) => void;
  onNotice: (m: string) => void;
  /** ⛔ 这里必须是 UserProfile["avatarType"]（联合类型），不能放宽成 string ——
   *  放宽后 App 侧 setUserIdentity 只能靠 `as` 硬转回来（09-18 修：cast 会掩盖类型洞）。 */
  onProfileChange?: (p: { avatarType: UserProfile["avatarType"]; avatar: string }) => void;
  onLogout?: () => void;
  /** Codex 自己的名字（09-17 用户要求）：默认 Codex，改名后显示在每条回复上方。 */
  assistantName?: string;
  onAssistantNameChange?: (name: string) => void;
  /** Codex 的头像：默认内置矢量头像，可上传替换。 */
  codexAvatar?: CodexAvatarSpec;
  onCodexAvatarChange?: (spec: CodexAvatarSpec) => void;
  /** 跳「设置 → 个性化 → 人格市场」（11-01 用户令：人格市场跳转入口） */
  onOpenPersonaMarket?: () => void;
}) {
  const [profile, setProfile] = useState<UserProfile>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("user-profile") || "{}");
      // 兼容旧数据：avatar 是纯 emoji 时归为 emoji，是 data:/http 时归为 image
      let avatarType = raw.avatarType || "none";
      if (!avatarType && raw.avatar) avatarType = /^data:|^https?:\/\//.test(raw.avatar) ? "image" : "emoji";
      const merged = { ...defaultProfile(), ...raw, avatarType, nickname: raw.nickname || "" };
      // 10-21：老档案没头像（none/空）时补默认插画，避免仍是名字首字母的大 A。
      if (avatarType === "none" || !raw.avatar) {
        merged.avatarType = "image";
        merged.avatar = avatarAsset("user-panda.png");
      }
      return merged;
    } catch { return defaultProfile(); }
  });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem("user-profile", JSON.stringify(profile));
  }, [profile]);

  /* 昵称的真相源在外部（`username` = personalization.nickname，由「让 Codex 改名」的工具、
     左下角账户名、启动回读三处写）。⛔⛔ 旧写法带 `!profile.nickname` 条件 —— 只有本地缓存
     为空时才回填，于是模型**实时**改完称呼后：聊天区已经显示「小潘总」，这里输入框还写着
     Administrator（10-24 用户截图点名「联动性太弱，名字生效就该是一个地方」）。
     ⇒ 外部一改就无条件跟随；与下面 Codex 名字那栏的 `[assistantName]` 同步保持同一口径。 */
  useEffect(() => {
    if (!username) return;
    setProfile((p) => (p.nickname === username ? p : { ...p, nickname: username }));
  }, [username]);

  /* 回复风格与「设置 → 个性化 → 回复风格」是**同一份设置**（personality）：
     用户在任意一边切换，另一边和 Codex 的 thread/start personality 都要跟着变。
     ⛔ 不要以 localStorage user-profile.style 为准 —— 那是旧字段，只做兼容缓存。 */
  useEffect(() => {
    if (!personality) return;
    setProfile((p) => (p.style === personality ? p : { ...p, style: personality }));
  }, [personality]);

  /* 10-26：新人引导写的是 personalization；用户中心此前只读自己的 user-profile 缓存，
     会出现「引导里选了职业/兴趣/头像，进来还是旧值」。这里在挂载与引导保存事件后回读，
     人物档案以 personalization 为准，头像以 user-profile 为准（两者都由引导同轮写入）。 */
  useEffect(() => {
    let alive = true;
    const applyStored = () => {
      try {
        const raw = JSON.parse(localStorage.getItem("user-profile") || "{}");
        if (raw && typeof raw === "object") {
          /* 整份回读：只挑昵称/头像会让「职业/领域/兴趣/习惯」继续用旧 state，
             随后本组件的 localStorage 回写又把引导刚写的新值覆盖掉（10-26 实测）。 */
          setProfile((p) => {
            const next = {
              ...p,
              ...raw,
              ...(raw.nickname ? { nickname: raw.nickname } : {}),
              ...(raw.avatarType ? { avatarType: raw.avatarType } : {}),
              ...(raw.avatar ? { avatar: raw.avatar } : {}),
            };
            /* 旧档案把「职业」复制进了「领域」，引导/用户中心展示会出现产品经理 · 产品经理。 */
            if (next.field && next.field === next.occupation) next.field = "";
            return next;
          });
        }
      } catch { /* 坏缓存忽略 */ }
      void window.codex.readPersonalization().then((cfg) => {
        if (!alive) return;
        setProfile((p) => {
          const occupation = cfg.occupation || p.occupation;
          return {
            ...p,
            nickname: cfg.nickname || p.nickname,
            occupation,
            /* ⛔ 11-01：专业领域来自档案的 about（不是本地缓存的 field）—— 原来只认缓存，
               所以选人格/存过之后重进必空。 */
            field: String(cfg.about || "").trim() || (p.field && p.field !== occupation ? p.field : ""),
            hobby: cfg.interests || p.hobby,
            /* ⛔ 11-01：自我介绍来自档案的 userContext —— 同上，以前压根没读。 */
            bio: String(cfg.userContext || "").trim() || p.bio,
            habit: cfg.habits || p.habit,
          };
        });
      }).catch(() => undefined);
    };
    applyStored();
    window.addEventListener("codex-profile-updated", applyStored);
    return () => { alive = false; window.removeEventListener("codex-profile-updated", applyStored); };
  }, []);

  const save = () => {
    // 昵称是全局权威：主界面用户名 + 引擎称呼 + 用户中心 三处统一
    const name = profile.nickname.trim() || username.trim() || "Codex 用户";
    onUsernameChange(name);
    localStorage.setItem("username", name);
    /* 10-26：这里以前只落昵称，职业/兴趣/习惯只写 localStorage ⇒ 引擎根本不知道。
       统一写进个性化档案（partial 合并，不会清掉引导里的其它字段）。 */
    void window.codex.saveIdentity({
      nickname: name,
      occupation: profile.occupation,
      interests: profile.hobby,
      habits: profile.habit,
      /* ⛔⛔ 11-01 用户实测「专业领域、自我介绍永远是空的」：
         这两个输入框绑的是 field / bio，而保存时**只提交了 nickname/occupation/interests/habits**，
         它们从来没被写进档案 ⇒ 存不住、重进必空。档案 schema 里对应的是 about / userContext。 */
      about: profile.field,
      userContext: profile.bio,
    }).then(() => {
      try { window.dispatchEvent(new Event("codex-profile-updated")); } catch { /* 忽略 */ }
    }).catch(() => undefined);
    onPersonalityChange(personality);
    onProfileChange?.({ avatarType: profile.avatarType, avatar: profile.avatar });
    onNotice("用户资料已保存，Codex 会称呼你「" + name + "」");
    // 立即落库昵称
    setProfile((p) => ({ ...p, nickname: name }));
  };

  const setField = (key: keyof UserProfile, value: string) => setProfile((p) => ({ ...p, [key]: value }));

  /** 选内置头像：立即同步到侧栏/消息头（与上传头像同一套回调；资料里的其它字段仍点保存）。 */
  const pickPresetAvatar = (file: string) => {
    const value = avatarAsset(file);
    setProfile((p) => ({ ...p, avatar: value, avatarType: "image" }));
    onProfileChange?.({ avatarType: "image", avatar: value });
  };

  /** 头像统一压到 128×128（居中裁正方形）再转 dataURL。
   *  ⛔ 为什么必须压：原来直接 readAsDataURL 原图 —— 用户传一张 3MB 照片就是 4MB+ 的 base64，
   *  localStorage 配额（通常 5MB）很容易写失败，而 storeCodeAvatar / user-profile 的写入是
   *  **静默** catch 的：当次会话看着正常、重启后头像没了 —— 09-17 用户报「Codex 头像又不见了」
   *  正是这条链路（磁盘上根本没有 codex-avatar 键）。压完通常只剩几十 KB，写得进、渲染也快。
   *  解码失败就返回原始 dataURL —— 渲染侧（CodexAvatar / UserAvatar）有 onError 兜回默认头像。 */
  const fileToAvatarDataUrl = async (file: File, size = 128): Promise<string> => {
    const raw = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsDataURL(file);
    });
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("图片解码失败"));
        el.src = raw;
      });
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return raw;
      // 居中裁正方形：头像容器是正方形，直接拉伸会把人脸/图标压变形
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      return canvas.toDataURL("image/png");
    } catch {
      return raw;
    }
  };

  const onAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";   // 先清：下面 await 之后 file input 可能已被复用
    const dataUrl = await fileToAvatarDataUrl(file);
    setProfile((p) => ({ ...p, avatar: dataUrl, avatarType: "image" }));
    onProfileChange?.({ avatarType: "image", avatar: dataUrl });
    onNotice("头像已更新");
  };

  // ── Codex 的身份（09-17 用户要求）：名字 + 头像 ──
  // 名字走「失焦/回车即时保存」（与左下角账户名同一交互），不依赖下方"保存资料"按钮
  // —— 否则用户改完名字没点保存就会以为设置成功了。
  const codexFileRef = useRef<HTMLInputElement>(null);
  const [assistantDraft, setAssistantDraft] = useState(assistantName);
  useEffect(() => { setAssistantDraft(assistantName); }, [assistantName]);
  /** Esc 取消编辑时必须**跳过**随后的 blur 提交 —— blur 里读到的 assistantDraft 还是编辑中的值
   *  （setState 异步、DOM 事件同步），否则"取消"反而会把改动存下去（code review 发现）。 */
  const skipNameCommitRef = useRef(false);
  const commitAssistantName = () => {
    if (skipNameCommitRef.current) { skipNameCommitRef.current = false; return; }
    const next = assistantDraft.trim() || CODEX_DEFAULT_NAME;
    setAssistantDraft(next);
    if (next === assistantName) return;
    onAssistantNameChange?.(next);
    onNotice(`Codex 的名字已改为「${next}」，之后的回复都会用它`);
  };
  const onCodexAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";   // 先清：下面 await 之后 file input 可能已被复用
    const dataUrl = await fileToAvatarDataUrl(file);
    onCodexAvatarChange?.({ type: "image", value: dataUrl });
    onNotice("Codex 头像已更新");
  };

  const avatarRender = profile.avatarType === "image" && profile.avatar
    ? <img src={profile.avatar} alt="头像" />
    : profile.avatarType === "emoji" && profile.avatar
      ? <span className="uc-avatar-emoji">{profile.avatar}</span>
      : <span className="uc-avatar-emoji">{profile.nickname ? profile.nickname.slice(0, 1).toUpperCase() : <UserRound size={26} />}</span>;

  const styleLabel = STYLE_OPTIONS.find((option) => option.value === personality)?.label ?? "务实";
  const displayName = profile.nickname || username || "未设置昵称";

  /* 11-01：一级卡/二级弹窗的开关（照开发工具页模式）；avatarStat 给「头像」卡显示当前头像小图。 */
  const [openCard, setOpenCard] = useState<null | "identity" | "avatar" | "about" | "codex" | "persona">(null);
  /* 套餐应用中标记：⛔ 必须在组件顶层 —— 原先写在条件渲染的 IIFE 里是非法 Hook 调用（React 抛错，弹窗打不开） */
  const [busyPack, setBusyPack] = useState("");
  /* ⛔ 状态是异步的：同一帧连点两下时两个 applyCombo 都会通过 busyPack 判断 ⇒ 用 ref 做同步闸。 */
  const busyPackRef = useRef("");
  const close = () => setOpenCard(null);
  const avatarStat = profile.avatarType === "image" && profile.avatar
    ? <img src={profile.avatar} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }} />
    : <span>{profile.avatarType === "emoji" ? "Emoji 头像" : "默认形象"}</span>;
  /* 11-01 人格卡：当前生效人格（persona 字段被两类人格共用 —— 值 ∈ USER_PERSONAS = 用户人格 id；
     否则 soulSlug 非空 = Codex 人格（内置 slug 本地可显名）。读 currentSoulMarket 一处拿全。 */
  const [personaInfo, setPersonaInfo] = useState<{ soulSlug: string; persona: string; displayName: string } | null>(null);
  const refreshPersona = useCallback(() => {
    window.codex.currentSoulMarket?.().then((info: any) => setPersonaInfo(info ?? null)).catch(() => undefined);
  }, []);
  useEffect(() => { refreshPersona(); }, [refreshPersona]);
  useEffect(() => {
    const off = window.codex.onHarnessEvent?.((payload: any) => {
      if (payload?.type === "codex-profile-updated") refreshPersona();
    });
    return off;
  }, [refreshPersona]);
  const personaSummary = (() => {
    const persona = personaInfo?.persona ?? "";
    const hit = persona ? USER_PERSONAS.find((p) => p.id === persona) : null;
    if (hit) return "用户人格 · " + hit.label;
    if (personaInfo?.soulSlug) return "Codex 人格 · " + (personaInfo.displayName || personaInfo.soulSlug.replace(/^built-in:/, ""));
    return "默认（未安装人格）";
  })();
  /** 摘要里截长文本（顶栏 truncateThreadTitle 同款：展开防代理对，⛔ 不用 slice 劈 emoji） */
  const truncateText = (value: string, max: number) => ([...value].length > max ? [...value].slice(0, max).join("") + "…" : value);

  return (
    <section className="settings-section stack user-center">
      {/* 11-01 v3（用户「不太好看」）：恢复原 hero 作身份视觉锚点（头像+名字+chips），
          下方编辑入口改**两张紧凑行卡**（专属 .uc-row-card，不蹭 devtools-card 的撑高网格）。
          ⛔ 状态/联动/保存逻辑仍全部原位不动。 */}
      <div className="uc-hero">
        <div className="uc-hero-main">
          <div className="uc-avatar uc-avatar-hero">
            {avatarRender}
            <button className="uc-avatar-edit" title="上传图片头像" onClick={() => setOpenCard("avatar")}><Camera size={14} /></button>
          </div>
          <div className="uc-hero-copy">
            <div className="uc-hero-kicker">你的身份</div>
            <div className="uc-name">{displayName}</div>
            <div className="uc-meta">{[profile.occupation || "未填写职业", profile.field && profile.field !== profile.occupation ? profile.field : ""].filter(Boolean).join(" · ")}</div>
            <div className="uc-hero-chips">
              <span className="uc-chip"><Wand2 size={12} />{styleLabel}</span>
              <span className="uc-chip"><Languages size={12} />{profile.language || "中文"}</span>
              <button type="button" className="uc-chip uc-chip-button" title="重新走一遍称呼/头像/职业/Codex 人格/兴趣配置" onClick={() => { try { window.dispatchEvent(new Event("codex-open-profile-guide")); } catch { /* 忽略 */ } }}><Wand2 size={12} />重新配置引导</button>
            </div>
          </div>
          <button type="button" className="uc-row-card uc-row-side" onClick={() => setOpenCard("avatar")} title="换个头像">
            <span className="uc-row-icon"><Camera size={15} /></span>
            <span className="uc-row-copy"><strong>换个头像</strong><small>点一下立即生效</small></span>
            <ChevronRight size={14} className="uc-row-arrow" />
          </button>
        </div>
      </div>

      {/* 11-01 v6：四行资料收进一张清单卡（行间细线），不再四张独立飘卡。 */}
      <div className="uc-row-list">
        <button type="button" className="uc-row-card" onClick={() => setOpenCard("identity")}>
          <span className="uc-row-icon"><UserRound size={15} /></span>
          <span className="uc-row-copy">
            <strong>我的身份</strong>
            <small>{[profile.nickname ? `称呼「${profile.nickname}」` : "未设置称呼", profile.occupation, profile.field].filter(Boolean).join(" · ") || "Codex 怎么称呼你、你做什么"}</small>
          </span>
          <ChevronRight size={14} className="uc-row-arrow" />
        </button>

        <button type="button" className="uc-row-card" onClick={() => setOpenCard("about")}>
          <span className="uc-row-icon"><Heart size={15} /></span>
          <span className="uc-row-copy">
            <strong>关于我</strong>
            <small>{[profile.hobby ? `兴趣：${profile.hobby}` : "", profile.habit ? `习惯：${profile.habit}` : "", profile.bio ? truncateText(profile.bio, 24) : ""].filter(Boolean).join(" · ") || "兴趣 / 习惯 / 语言 / 自我介绍"}</small>
          </span>
          <ChevronRight size={14} className="uc-row-arrow" />
        </button>

        <button type="button" className="uc-row-card" onClick={() => setOpenCard("codex")}>
          <span className="uc-row-icon">
            {codexAvatar?.type === "image" && codexAvatar.value
              ? <img src={codexAvatar.value} alt="" style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover" }} />
              : <Sparkles size={15} />}
          </span>
          <span className="uc-row-copy">
            <strong>Codex 的身份</strong>
            <small>{assistantName || CODEX_DEFAULT_NAME} · 名字与形象改完立即生效</small>
          </span>
          <ChevronRight size={14} className="uc-row-arrow" />
        </button>

        <button type="button" className="uc-row-card" onClick={() => setOpenCard("persona")}>
          <span className="uc-row-icon"><Wand2 size={15} /></span>
          <span className="uc-row-copy">
            <strong>人格</strong>
            <small>{personaSummary} · 用户人格与 Codex 人格成套搭配</small>
          </span>
          <ChevronRight size={14} className="uc-row-arrow" />
        </button>
      </div>

      {onLogout && (
        <div className="uc-savebar">
          <span className="uc-savebar-note"><Sparkles size={13} />资料会同步到侧栏与 Codex 的称呼</span>
          <div className="uc-savebar-actions">
            <button type="button" className="danger-setting" onClick={onLogout}><LogOut size={14} />退出登录</button>
          </div>
        </div>
      )}

      {/* ── 二级弹窗：我的身份 ── */}
      {openCard === "identity" && (
        <SettingsDialog title="我的身份" icon={<UserRound size={15} />} hint="Codex 怎么称呼你、你做什么" onClose={close}>
          <section className="uc-panel">
            <div className="uc-grid uc-grid-2">
              <label className="se-field"><span>昵称（Codex 怎么称呼你）</span><input value={profile.nickname} onChange={(e) => setField("nickname", e.target.value)} placeholder="保存后同步到界面与引擎称呼" /></label>
              <label className="se-field"><span><Briefcase size={12} />职业</span><input value={profile.occupation} onChange={(e) => setField("occupation", e.target.value)} placeholder="如：后端工程师 / 产品经理" /></label>
              <label className="se-field"><span><GraduationCap size={12} />专业领域</span><input value={profile.field} onChange={(e) => setField("field", e.target.value)} placeholder="如：Web 开发 / 数据分析" /></label>
            </div>
          </section>
          <div className="uc-savebar">
            <button type="button" className="uc-chip uc-chip-button" title="重新走一遍称呼/头像/职业/Codex 人格/兴趣配置" onClick={() => { try { window.dispatchEvent(new Event("codex-open-profile-guide")); } catch { /* 忽略 */ } }}><Wand2 size={12} />重新配置引导</button>
            <button type="button" className="primary-setting" onClick={save}><Save size={14} />保存资料</button>
          </div>
        </SettingsDialog>
      )}

      {/* ── 二级弹窗：头像（点一下立即生效，无保存按钮） ── */}
      {openCard === "avatar" && (
        <SettingsDialog title="头像" icon={<Camera size={15} />} hint="点一下立即生效" onClose={close}>
          <div className="uc-avatar-side">
            <div className="uc-avatar-side-head"><strong>换个头像</strong><span>点一下立即生效</span></div>
            <div className="uc-presets uc-presets-images">
              {USER_AVATAR_PRESETS.map((preset) => (
                <button key={preset.file} type="button" className={`uc-preset ${profile.avatarType === "image" && profile.avatar === avatarAsset(preset.file) ? "active" : ""}`} title={preset.label || preset.file} onClick={() => pickPresetAvatar(preset.file)}>
                  <img src={avatarAsset(preset.file)} alt="" draggable={false} />
                </button>
              ))}
            </div>
            <button type="button" className="uc-upload-link" onClick={() => fileRef.current?.click()}>
              <Camera size={13} />上传自己的照片
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatarFile} />
          </div>
        </SettingsDialog>
      )}

      {/* ── 二级弹窗：关于我 ── */}
      {openCard === "about" && (
        <SettingsDialog title="关于我" icon={<Heart size={15} />} hint="让回答更贴近你的生活" onClose={close}>
          <section className="uc-panel">
            <div className="uc-grid uc-grid-2">
              <label className="se-field"><span><Heart size={12} />兴趣爱好</span><input value={profile.hobby} onChange={(e) => setField("hobby", e.target.value)} placeholder="如：摄影 / 跑步 / 游戏" /></label>
              <label className="se-field"><span><Clock3 size={12} />生活习惯</span><input value={profile.habit} onChange={(e) => setField("habit", e.target.value)} placeholder="如：早九晚六 / 夜猫子" /></label>
              <label className="se-field"><span><Languages size={12} />常用语言</span><input value={profile.language} onChange={(e) => setField("language", e.target.value)} placeholder="中文" /></label>
              <label className="se-field uc-field-full"><span><Lightbulb size={12} />自我介绍</span><textarea rows={2} value={profile.bio} onChange={(e) => setField("bio", e.target.value)} placeholder="一句话介绍自己，Codex 会记住" /></label>
            </div>
          </section>
          <div className="uc-savebar">
            <button type="button" className="primary-setting" onClick={save}><Save size={14} />保存资料</button>
          </div>
        </SettingsDialog>
      )}

      {/* ── 二级弹窗：Codex 的身份 ──
          ⛔ 这里必须用**独立类名**（codex-id-*），不能复用上面那些 .uc-*：
          复用它会把「用默认名」按钮压成 30px 宽、文字竖排断行（用户截图实测就是这么坏的）；
          `.uc-avatar` 的圆形底 + 尺寸还会把方形默认头像裁圆。 */}
      {openCard === "codex" && (
        <SettingsDialog title="Codex 的身份" icon={<Sparkles size={15} />} hint="AI 助手的名字与形象，改完立即生效" onClose={close}>
          <section className="uc-panel codex-id-panel">
            <div className="codex-id-head">
              <div className="codex-id-avatar">
                {codexAvatar?.type === "image" && codexAvatar.value
                  ? <img src={codexAvatar.value} alt="Codex 头像" />
                  : <DefaultCodexAvatar size={60} />}
                <button className="codex-id-avatar-btn" title="上传 Codex 头像（建议用正方形图片）" onClick={() => codexFileRef.current?.click()}><Camera size={12} /></button>
                {codexAvatar?.type === "image" && (
                  <button className="codex-id-avatar-btn reset" title="恢复到默认头像" onClick={() => { onCodexAvatarChange?.({ type: "default", value: "" }); onNotice("已恢复默认头像"); }}><RotateCcw size={12} /></button>
                )}
                <input ref={codexFileRef} type="file" accept="image/*" hidden onChange={onCodexAvatarFile} />
              </div>
              <div className="codex-id-info">
                <div className="codex-id-title">Codex 的身份 <span className="codex-id-badge"><Sparkles size={11} />AI 助手</span></div>
                <label className="codex-id-label" htmlFor="codex-name-input">它的名字</label>
                <div className="codex-id-row">
                  <input
                    id="codex-name-input"
                    className="codex-name-input"
                    value={assistantDraft}
                    maxLength={24}
                    placeholder={CODEX_DEFAULT_NAME}
                    onChange={(e) => setAssistantDraft(e.target.value)}
                    onBlur={commitAssistantName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                      if (e.key === "Escape") { skipNameCommitRef.current = true; setAssistantDraft(assistantName); e.currentTarget.blur(); }
                    }}
                  />
                  <button className="codex-name-reset" onClick={() => { setAssistantDraft(CODEX_DEFAULT_NAME); onAssistantNameChange?.(CODEX_DEFAULT_NAME); onNotice("名字已恢复为 Codex"); }}>用默认名</button>
                </div>
                <div className="codex-id-hint">回车或点别处即时保存</div>
              </div>
            </div>
            <div className="codex-id-presets">
              <div className="codex-id-presets-head">
                <strong>内置形象</strong>
              </div>
              <div className="codex-id-preset-grid" role="group" aria-label="Codex 内置形象">
                {CODEX_AVATAR_PRESETS.map((preset) => {
                  const isDefault = preset.file === CODEX_DEFAULT_AVATAR_FILE;
                  const active = isDefault
                    ? !codexAvatar || codexAvatar.type !== "image"
                    : codexAvatar?.type === "image" && codexAvatar.value === avatarAsset(preset.file);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`codex-id-preset ${active ? "active" : ""}`}
                      aria-pressed={active}
                      aria-label={`使用「${preset.label}」形象`}
                      title={preset.label}
                      onClick={() => {
                        onCodexAvatarChange?.(isDefault ? { type: "default", value: "" } : { type: "image", value: avatarAsset(preset.file) });
                        onNotice(isDefault ? "已切换为默认形象" : `已切换为「${preset.label}」形象`);
                      }}
                    >
                      <img src={avatarAsset(preset.file)} alt="" draggable={false} />
                      {active ? <span className="codex-id-preset-check"><Check size={10} /></span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </SettingsDialog>
      )}

      {/* ── 二级弹窗：人格（用户人格 / Codex 人格 / 联动套餐 / 跳人格市场） ──
          ⛔ 套餐一键应用 = 用户档案字段（userPersonaFields）+ Codex persona（内置 soul content）同时落档；
             两个字段都可视、可各自再改（应用后派发 codex-profile-updated 让个性化页同步刷新）。 */}
      {openCard === "persona" && (() => {
        const applyCombo = async (packId: string) => {
          const pack = COMBO_PACKS.find((c: any) => c.id === packId);
          if (!pack || busyPackRef.current) return;
          busyPackRef.current = packId;
          setBusyPack(packId);
          try {
            const detail: any = await window.codex.getSoulMarket({ slug: pack.soulSlug });
            const fields = userPersonaFields(pack.userPersonaId) as any;
            if (!fields || !detail?.content) throw new Error("套餐数据读取失败");
            await window.codex.saveIdentity({ ...fields, persona: detail.content, soulSlug: pack.soulSlug, onboarded: true, profileGuideSeen: true });
            try { window.dispatchEvent(new Event("codex-profile-updated")); } catch { /* 忽略 */ }
            refreshPersona();
            onNotice?.("已应用套餐「" + pack.label + "」—— 下一新会话生效，两个身份都能在人格市场里单独改");
          } catch (error: any) {
            onNotice?.("套餐应用失败：" + (error?.message ?? error));
          } finally { busyPackRef.current = ""; setBusyPack(""); }
        };
        return (
          <SettingsDialog title="人格" icon={<Wand2 size={15} />} hint="用户人格 × Codex 人格，成套搭配" onClose={close}>
            <section className="uc-panel">
              <div className="uc-hero-kicker" style={{ marginBottom: 6 }}>当前生效</div>
              <p className="settings-card-hint">{personaSummary}{personaInfo?.persona ? "（已写入档案，下一新会话生效）" : ""}</p>
              <div className="uc-hero-kicker" style={{ margin: "10px 0 6px" }}>联动套餐（点卡片立即生效：用户人格 + Codex 人格 同套）</div>
              <div className="uc-combo-grid">
                {COMBO_PACKS.map((pack: any) => {
                  const on = personaInfo?.soulSlug === pack.soulSlug;
                  /* ⛔ 任一套餐应用中就禁点其它卡：两个 saveIdentity 并发会把 persona/soulSlug 交错写。
                     但「应用中…」只挂在正在应用的那张卡上，不能让所有卡都显示成加载中。 */
                  const busy = busyPack === pack.id;
                  const locked = Boolean(busyPack);
                  return (
                    <button type="button" key={pack.id} className={`uc-combo ${on ? "on" : ""} ${busy ? "busy" : ""}`} disabled={locked} title={pack.desc}
                      aria-pressed={on} onClick={() => void applyCombo(pack.id)}>
                      <span className="uc-combo-head">
                        <strong>{pack.label}</strong>
                        {on && <span className="uc-combo-check" aria-hidden><Check size={11} /></span>}
                      </span>
                      <small>{pack.desc}</small>
                      <span className="uc-combo-foot">
                        <span className="uc-combo-state">{busy ? "应用中…" : on ? "已生效 · 下一新会话起用" : "点一下应用"}</span>
                        {!on && !locked && <span className="uc-combo-cta">应用<ChevronRight size={12} /></span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
            <div className="uc-savebar">
              <span className="uc-savebar-note"><Sparkles size={13} />想自由搭配（16 种用户人格 / 22 种 Codex 人格）？</span>
              <button type="button" className="primary-setting" onClick={() => { close(); onOpenPersonaMarket?.(); }}>打开人格市场</button>
            </div>
          </SettingsDialog>
        );
      })()}

    </section>
  );
}