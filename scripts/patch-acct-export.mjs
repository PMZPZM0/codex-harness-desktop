import fs from "fs";

let s = fs.readFileSync("src/App.tsx", "utf8").replace(/\r\n/g, "\n");
let n = 0;
function rep(oldStr, newStr) {
  const i = s.indexOf(oldStr);
  if (i === -1) { console.error("NOT FOUND: " + JSON.stringify(oldStr.slice(0, 90))); process.exit(1); }
  s = s.slice(0, i) + newStr + s.slice(i + oldStr.length);
  n++;
}

// ============ 1. 左下角头像同步用户中心 + 点击跳转 ============
// 1a. 读取用户头像 state（挂在 username state 后）
rep(`  const [username, setUsername] = useState(() => localStorage.getItem("username") || "");`,
`  const [username, setUsername] = useState(() => localStorage.getItem("username") || "Codex 用户");
  const [userAvatar, setUserAvatar] = useState(() => { try { const p = JSON.parse(localStorage.getItem("user-profile") || "{}"); return p.avatarType && p.avatar ? { type: p.avatarType, value: p.avatar } : null; } catch { return null; } });
  const [userAvatarVersion, setUserAvatarVersion] = useState(0);`);

// 1b. 左下角头像替换为图片/emoji + 点击进用户中心
rep(`        <div className="account-row">
          <div className="account-avatar" title="点击修改名称" onClick={startAccountEdit}>{username.trim().charAt(0).toUpperCase() || "?"}</div>`,
`        <div className="account-row">
          <button className="account-avatar" title="打开用户中心" onClick={() => { setSettingsPage("user"); setSettingsOpen(true); setMobileNav(false); }}>{userAvatar?.type === "image" && userAvatar.value ? <img src={userAvatar.value} alt="头像" /> : userAvatar?.type === "emoji" && userAvatar.value ? <span className="account-avatar-emoji">{userAvatar.value}</span> : <span className="account-avatar-letter">{username.trim().charAt(0).toUpperCase() || "?"}</span>}</button>`);

// 1c. 名字点击进用户中心（去掉行内改名）
rep(`          ) : (
            <button className="account-name" title="点击修改名称" onClick={startAccountEdit}>{username}</button>
          )}`,
`          ) : (
            <button className="account-name" title="打开用户中心" onClick={() => { setSettingsPage("user"); setSettingsOpen(true); setMobileNav(false); }}>{username}</button>
          )}`);

// 1d. UserCenter 保存后头像回传：给 UserCenterSection 加 onProfileChange 回调
rep(`            {settingsPage === "user" && <UserCenterSection username={username} onUsernameChange={(name) => { setUsername(name); }} personality={personality} onPersonalityChange={(v) => changePersonality(v)} onNotice={(m) => setNotice(m)} />}`,
`            {settingsPage === "user" && <UserCenterSection username={username} onUsernameChange={(name) => { setUsername(name); }} personality={personality} onPersonalityChange={(v) => changePersonality(v)} onNotice={(m) => setNotice(m)} onProfileChange={(p) => { setUserAvatar(p.avatarType && p.avatar ? { type: p.avatarType, value: p.avatar } : null); setUserAvatarVersion((v) => v + 1); }} />}`);

// ============ 2. 任务菜单：导出对话 + 会话接力 ============
// 2a. 导出：把当前会话拼成 markdown 存文件
rep(`                    <button disabled={!thread} onClick={() => { closeTaskMenu(); void runSlashCommand("/queue"); }}>查看消息队列</button>`,
`                    <button disabled={!thread} onClick={() => { closeTaskMenu(); void exportConversation(); }}>导出对话</button>
                    <button disabled={!thread} onClick={() => { closeTaskMenu(); setThread(null); threadRef.current = null; setPrompt(""); }}>会话接力（开新会话）</button>
                    <button disabled={!thread} onClick={() => { closeTaskMenu(); void runSlashCommand("/queue"); }}>查看消息队列</button>`);

// 2b. exportConversation 函数（放 startNewThread 前）
rep(`  function startNewThread() {`,
`  async function exportConversation() {
    if (!thread) return;
    const lines: string[] = [`# ${thread.name || thread.preview || "对话导出"}`, ""];
    for (const turn of thread.turns) {
      for (const item of turn.items) {
        if (item.type === "userMessage") {
          const text = (item.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\\n");
          if (text.trim()) lines.push("## 用户", text, "");
        } else if (item.type === "agentMessage" && item.text) {
          lines.push("## Codex", item.text, "");
        } else if (item.type === "reasoning" && (item.summary?.length || item.content?.length)) {
          const t = [...(item.summary ?? []), ...(item.content ?? [])].join("\\n");
          if (t.trim()) lines.push("> 深度思考", t, "");
        }
      }
    }
    const content = lines.join("\\n");
    const suggested = (thread.name || "codex-conversation").replace(/[\\\\/:*?"<>|]/g, "_");
    try {
      const res = await window.codex.exportConversation({ content, suggested });
      if (res?.canceled !== true && res?.path) setNotice("对话已导出：" + res.path);
    } catch (error: any) { setNotice("导出失败：" + error.message); }
  }

  function startNewThread() {`);

fs.writeFileSync("src/App.tsx", s.replace(/\n/g, "\r\n"), "utf8");
console.log("App.tsx patched: " + n + " replacements");
