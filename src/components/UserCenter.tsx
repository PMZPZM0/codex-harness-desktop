import { useEffect, useRef, useState } from "react";
import { Camera, UserRound, Briefcase, GraduationCap, Clock3, Heart, Languages, Lightbulb, Save, Wand2, LogOut } from "lucide-react";

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
  return { nickname: "", avatarType: "none", avatar: "", occupation: "", field: "", hobby: "", habit: "", style: "pragmatic", language: "中文", timezone: "Asia/Shanghai", bio: "" };
}

const AVATAR_PRESETS = [
  "🐼", "🦊", "🐯", "🐱", "🐶", "🦁", "🐨", "🐰", "🦄", "🐳",
  "🚀", "💎", "🔥", "🌊", "🍀", "⭐", "🌈", "🎯", "🎨", "⚡",
];

const STYLE_OPTIONS = [
  { value: "pragmatic", label: "务实" },
  { value: "friendly", label: "友好" },
  { value: "none", label: "默认" },
];

export function UserCenterSection({ username, onUsernameChange, personality, onPersonalityChange, onNotice, onProfileChange, onLogout }: {
  username: string;
  onUsernameChange: (name: string) => void;
  personality: string;
  onPersonalityChange: (v: string) => void;
  onNotice: (m: string) => void;
  onProfileChange?: (p: { avatarType: string; avatar: string }) => void;
  onLogout?: () => void;
}) {
  const [profile, setProfile] = useState<UserProfile>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("user-profile") || "{}");
      // 兼容旧数据：avatar 是纯 emoji 时归为 emoji，是 data:/http 时归为 image
      let avatarType = raw.avatarType || "none";
      if (!avatarType && raw.avatar) avatarType = /^data:|^https?:\/\//.test(raw.avatar) ? "image" : "emoji";
      return { ...defaultProfile(), ...raw, avatarType, nickname: raw.nickname || "" };
    } catch { return defaultProfile(); }
  });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem("user-profile", JSON.stringify(profile));
  }, [profile]);

  // 外部用户名变化（登录页填了 ppz / 主界面改名）时回填昵称
  useEffect(() => {
    if (username && !profile.nickname) setProfile((p) => ({ ...p, nickname: username }));
  }, [username]);

  const save = () => {
    // 昵称是全局权威：主界面用户名 + 引擎称呼 + 用户中心 三处统一
    const name = profile.nickname.trim() || username.trim() || "Codex 用户";
    onUsernameChange(name);
    localStorage.setItem("username", name);
    void window.codex.setNickname(name).catch(() => undefined);
    onPersonalityChange(profile.style);
    onProfileChange?.({ avatarType: profile.avatarType, avatar: profile.avatar });
    onNotice("用户资料已保存，Codex 会称呼你「" + name + "」");
    // 立即落库昵称
    setProfile((p) => ({ ...p, nickname: name }));
  };

  const setField = (key: keyof UserProfile, value: string) => setProfile((p) => ({ ...p, [key]: value }));

  const pickEmoji = (emoji: string) => setProfile((p) => ({ ...p, avatar: emoji, avatarType: "emoji" }));

  const onAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setProfile((p) => ({ ...p, avatar: String(reader.result), avatarType: "image" }));
      onProfileChange?.({ avatarType: "image", avatar: String(reader.result) });
      onNotice("头像已更新");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const avatarRender = profile.avatarType === "image" && profile.avatar
    ? <img src={profile.avatar} alt="头像" />
    : profile.avatarType === "emoji" && profile.avatar
      ? <span className="uc-avatar-emoji">{profile.avatar}</span>
      : <span className="uc-avatar-emoji">{profile.nickname ? profile.nickname.slice(0, 1).toUpperCase() : <UserRound size={26} />}</span>;

  return (
    <section className="settings-section stack user-center">
      <div className="settings-copy"><h2>用户中心</h2><p>你的身份与个性化资料，让 Codex 更懂你。</p></div>

      <div className="uc-card">
        <div className="uc-head">
          <div className="uc-avatar">
            {avatarRender}
            <button className="uc-avatar-edit" title="上传图片头像" onClick={() => fileRef.current?.click()}><Camera size={13} /></button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatarFile} />
          </div>
          <div className="uc-head-info">
            <div className="uc-name">{profile.nickname || username || "未设置昵称"}</div>
            <div className="uc-meta">{profile.occupation || "未填写职业"} · {profile.field || "未填写领域"}</div>
            <div className="uc-preset-hint">或选一个表情头像：</div>
            <div className="uc-presets">
              {AVATAR_PRESETS.slice(0, 10).map((emoji) => <button key={emoji} className={profile.avatarType === "emoji" && profile.avatar === emoji ? "active" : ""} onClick={() => pickEmoji(emoji)}>{emoji}</button>)}
            </div>
          </div>
        </div>

        <div className="uc-grid">
          <label className="se-field"><span>昵称（Codex 怎么称呼你）</span><input value={profile.nickname} onChange={(e) => setField("nickname", e.target.value)} placeholder="保存后同步到界面与引擎称呼" /></label>
          <label className="se-field"><span><Briefcase size={12} />职业</span><input value={profile.occupation} onChange={(e) => setField("occupation", e.target.value)} placeholder="如：后端工程师 / 产品经理" /></label>
          <label className="se-field"><span><GraduationCap size={12} />专业领域</span><input value={profile.field} onChange={(e) => setField("field", e.target.value)} placeholder="如：Web 开发 / 数据分析" /></label>
          <label className="se-field"><span><Heart size={12} />兴趣爱好</span><input value={profile.hobby} onChange={(e) => setField("hobby", e.target.value)} placeholder="如：摄影 / 跑步 / 游戏" /></label>
          <label className="se-field"><span><Clock3 size={12} />生活习惯</span><input value={profile.habit} onChange={(e) => setField("habit", e.target.value)} placeholder="如：早九晚六 / 夜猫子" /></label>
          <label className="se-field"><span><Languages size={12} />常用语言</span><input value={profile.language} onChange={(e) => setField("language", e.target.value)} placeholder="中文" /></label>
          <label className="se-field"><span><Wand2 size={12} />回复风格</span>
            <select value={profile.style} onChange={(e) => setField("style", e.target.value)}>
              {STYLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="se-field"><span><Lightbulb size={12} />自我介绍</span><textarea rows={2} value={profile.bio} onChange={(e) => setField("bio", e.target.value)} placeholder="一句话介绍自己，Codex 会记住" /></label>
        </div>

        <div className="uc-actions">
          <button className="primary-setting" onClick={save}><Save size={14} />保存资料</button>
          {onLogout && <button className="danger-setting" onClick={onLogout}><LogOut size={14} />退出登录</button>}
        </div>
      </div>
    </section>
  );
}
