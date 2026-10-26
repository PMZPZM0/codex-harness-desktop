import { useEffect, useRef, useState } from "react";
import { Camera, UserRound, Briefcase, GraduationCap, Clock3, Heart, Languages, Lightbulb, Save, Wand2, LogOut, RotateCcw, Check, Sparkles } from "lucide-react";
import { DefaultCodexAvatar } from "./DefaultCodexAvatar";
import { CODEX_DEFAULT_NAME, type CodexAvatarSpec } from "../lib/codex-identity.mjs";
import { avatarAsset, CODEX_AVATAR_PRESETS, CODEX_DEFAULT_AVATAR_FILE, USER_AVATAR_PRESETS } from "../lib/avatar-presets";

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

export function defaultProfile(): UserProfile {
  /* 10-21：没有头像时不再只显示名字首字母 —— 默认发一只熊猫插画头像（用户可选其它或上传）。
     旧档案里 avatarType=none 的也在下面初始化时补成同一个默认，避免「看起来还是 A」。 */
  return { nickname: "", avatarType: "image", avatar: avatarAsset("user-panda.png"), occupation: "", field: "", hobby: "", habit: "", style: "pragmatic", language: "中文", timezone: "Asia/Shanghai", bio: "" };
}

const STYLE_OPTIONS = [
  { value: "inquiry", label: "需求询问", desc: "先问清需求再动手（个性化页可选）" },
  { value: "pragmatic", label: "务实", desc: "直接给结论和代码" },
  { value: "friendly", label: "友好", desc: "多解释思路与取舍" },
  { value: "none", label: "默认", desc: "不额外注入语气" },
];

export function UserCenterSection({ username, onUsernameChange, personality, onPersonalityChange, onNotice, onProfileChange, onLogout, assistantName = CODEX_DEFAULT_NAME, onAssistantNameChange, codexAvatar, onCodexAvatarChange }: {
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
            field: p.field && p.field !== occupation ? p.field : "",
            hobby: cfg.interests || p.hobby,
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

  return (
    <section className="settings-section stack user-center">
      <div className="settings-copy uc-page-head"><h2>用户中心</h2><p>你的身份与个性化资料，让 Codex 更懂你。</p></div>

      <div className="uc-hero">
        <div className="uc-hero-main">
          <div className="uc-avatar uc-avatar-hero">
            {avatarRender}
            <button className="uc-avatar-edit" title="上传图片头像" onClick={() => fileRef.current?.click()}><Camera size={14} /></button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatarFile} />
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
          <div className="uc-avatar-side">
            <div className="uc-avatar-side-head"><strong>换个头像</strong><span>点一下立即生效</span></div>
            <div className="uc-presets uc-presets-images">
              {USER_AVATAR_PRESETS.map((preset) => {
                const value = avatarAsset(preset.file);
                const active = profile.avatarType === "image" && profile.avatar === value;
                return (
                  <button
                    type="button"
                    key={preset.id}
                    className={active ? "active" : ""}
                    title={preset.label}
                    aria-label={`使用${preset.label}头像`}
                    aria-pressed={active}
                    onClick={() => pickPresetAvatar(preset.file)}
                  >
                    <img src={value} alt="" loading="lazy" />
                  </button>
                );
              })}
            </div>
            <button type="button" className="uc-upload-link" onClick={() => fileRef.current?.click()}>
              <Camera size={12} />上传自己的照片
            </button>
          </div>
        </div>
      </div>

      <div className="uc-layout">
        <section className="uc-panel">
          <div className="uc-panel-head">
            <span className="uc-panel-icon"><UserRound size={14} /></span>
            <div><strong>基本资料</strong><small>Codex 怎么称呼你、你做什么</small></div>
          </div>
          <div className="uc-grid uc-grid-2">
            <label className="se-field"><span>昵称（Codex 怎么称呼你）</span><input value={profile.nickname} onChange={(e) => setField("nickname", e.target.value)} placeholder="保存后同步到界面与引擎称呼" /></label>
            <label className="se-field"><span><Briefcase size={12} />职业</span><input value={profile.occupation} onChange={(e) => setField("occupation", e.target.value)} placeholder="如：后端工程师 / 产品经理" /></label>
            <label className="se-field"><span><GraduationCap size={12} />专业领域</span><input value={profile.field} onChange={(e) => setField("field", e.target.value)} placeholder="如：Web 开发 / 数据分析" /></label>
          </div>
        </section>

        <section className="uc-panel">
          <div className="uc-panel-head">
            <span className="uc-panel-icon"><Heart size={14} /></span>
            <div><strong>关于我</strong><small>让回答更贴近你的生活</small></div>
          </div>
          <div className="uc-grid uc-grid-2">
            <label className="se-field"><span><Heart size={12} />兴趣爱好</span><input value={profile.hobby} onChange={(e) => setField("hobby", e.target.value)} placeholder="如：摄影 / 跑步 / 游戏" /></label>
            <label className="se-field"><span><Clock3 size={12} />生活习惯</span><input value={profile.habit} onChange={(e) => setField("habit", e.target.value)} placeholder="如：早九晚六 / 夜猫子" /></label>
            <label className="se-field"><span><Languages size={12} />常用语言</span><input value={profile.language} onChange={(e) => setField("language", e.target.value)} placeholder="中文" /></label>
            <label className="se-field uc-field-full"><span><Lightbulb size={12} />自我介绍</span><textarea rows={2} value={profile.bio} onChange={(e) => setField("bio", e.target.value)} placeholder="一句话介绍自己，Codex 会记住" /></label>
          </div>
        </section>
      </div>

      {/* 10-27 用户令：「这个回复风格跟用户中心重复了，那边前端删除这个选项，但不能影响新手引导生效」
          ⇒ 「交流偏好」这一块整块从用户中心移除（回复风格只在「设置 → 个性化」调一次）。
          ⛔ 只删界面：下面这些一条都不能删 —— 新手引导把 replyStyle 写进 personalization，
             本页仍要读它并回显（hero 上的风格 chip），保存时也仍同步 profile.style。 */}
      <div className="uc-savebar">
        <span className="uc-savebar-note"><Sparkles size={13} />资料会同步到侧栏与 Codex 的称呼</span>
        <div className="uc-savebar-actions">
          {onLogout && <button type="button" className="danger-setting" onClick={onLogout}><LogOut size={14} />退出登录</button>}
          <button type="button" className="primary-setting" onClick={save}><Save size={14} />保存资料</button>
        </div>
      </div>

      {/* Codex 的身份（09-17 用户要求）：名字 + 头像。与上方"你自己"的资料分开成卡，避免混淆。
          ⛔ 这里必须用**独立类名**（codex-id-*），不能复用上面那些 .uc-*：
          复用它会把「用默认名」按钮压成 30px 宽、文字竖排断行（用户截图实测就是这么坏的）；
          `.uc-avatar` 的圆形底 + 尺寸还会把方形默认头像裁圆。 */}
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
            <div className="codex-id-desc">这里的名字与头像会显示在每条回复的上方</div>
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
            <span>点选即时生效，也可点头像右下角相机上传自己的图片</span>
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

    </section>
  );
}
