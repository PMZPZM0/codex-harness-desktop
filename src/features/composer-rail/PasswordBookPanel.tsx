/**
 * 密码本弹层（10-27）。
 *
 * 用户：「第二个密码本，专门给用户记密码的，密码本弹窗界面做好看一点，功能配套齐全」。
 *
 * ⛔ 安全：**渲染层永远拿不到明文密码**（主进程只回 hasSecret）。
 *    「复制密码」走 `vaultCopy` —— 主进程解密后直接写系统剪贴板，明文不进 UI 内存、不进日志。
 * 功能：搜索 / 新增 / 编辑 / 删除（二次确认）/ 复制用户名 / 复制网址 / 复制密码（落剪贴板）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ClipboardCopy, Copy, EyeOff, KeyRound, Pencil, Plus, Search, Shuffle, Trash2, X } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";

type OnToast = (title: string, text?: unknown) => void;
type OnNotice = (text: string) => void;

type Draft = { id?: string; title: string; username: string; password: string; url: string; note: string };
const EMPTY: Draft = { title: "", username: "", password: "", url: "", note: "" };

/** 生成一个可用的强密码（32 位，去掉容易看混的 0/O/1/l/I）。 */
function strongPassword(len = 20): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+";
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}

export function PasswordBookPanel({ onToast, onNotice }: { onToast: OnToast; onNotice: OnNotice }) {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [encrypted, setEncrypted] = useState(true);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await window.codex.vaultList();
      setItems(result.items);
      setEncrypted(result.encrypted);
    } catch (error: any) {
      onNotice(`密码本读取失败：${error?.message ?? error}`);
    }
  }, [onNotice]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.title} ${item.username ?? ""} ${item.url ?? ""} ${item.note ?? ""}`.toLowerCase().includes(q));
  }, [items, query]);

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const result = await window.codex.vaultSave({
        id: draft.id,
        title: draft.title,
        username: draft.username,
        url: draft.url,
        note: draft.note,
        ...(draft.password ? { password: draft.password } : {}),
      });
      setItems(result.items);
      setDraft(null);
      onToast("已保存", draft.password || draft.id ? "密码已加密写回本机" : "这条没有填写密码");
    } catch (error: any) {
      onNotice(`保存失败：${error?.message ?? error}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const result = await window.codex.vaultRemove(id);
      setItems(result.items);
      setConfirmId(null);
      onToast("已删除");
    } catch (error: any) {
      onNotice(`删除失败：${error?.message ?? error}`);
    } finally {
      setBusy(false);
    }
  }

  async function copyPassword(item: VaultItem) {
    try {
      const result = await window.codex.vaultCopy(item.id);
      if (result.ok) onToast("密码已复制", "30 秒后自动清空剪贴板；明文没有经过界面");
      else onNotice(result.reason ?? "复制失败");
    } catch (error: any) {
      onNotice(`复制失败：${error?.message ?? error}`);
    }
  }

  if (draft) {
    return (
      <div className="vault-editor">
        <div className="vault-field"><label htmlFor="vault-title">名称</label><input id="vault-title" value={draft.title} maxLength={120} placeholder="例如：GitHub / 公司 VPN" onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></div>
        <div className="vault-field"><label htmlFor="vault-user">用户名 / 账号</label><input id="vault-user" value={draft.username} maxLength={200} placeholder="登录账号或邮箱" onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></div>
        <div className="vault-field">
          <label htmlFor="vault-password">密码{draft.id ? "（留空 = 不改）" : ""}</label>
          <div className="vault-password-row">
            <input id="vault-password" type="text" value={draft.password} maxLength={400} placeholder={draft.id ? "不改就留空" : "密码"} autoComplete="off" spellCheck={false} onChange={(event) => setDraft({ ...draft, password: event.target.value })} />
            <button type="button" className="icon-button" title="生成一个强密码" aria-label="生成强密码" onClick={() => setDraft({ ...draft, password: strongPassword() })}><Shuffle size={14} /></button>
          </div>
        </div>
        <div className="vault-field"><label htmlFor="vault-url">网址（可选）</label><input id="vault-url" value={draft.url} maxLength={400} placeholder="https://" onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></div>
        <div className="vault-field"><label htmlFor="vault-note">备注（可选）</label><textarea id="vault-note" value={draft.note} maxLength={2000} rows={2} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></div>
        <p className="vault-hint"><EyeOff size={12} />密码用系统钥匙串加密后存本机，界面和日志里都不会出现明文；「复制密码」由主进程直接写系统剪贴板。</p>
        <div className="vault-actions">
          <button type="button" className="secondary-setting" disabled={busy} onClick={() => setDraft(null)}>取消</button>
          <button type="button" className="primary-setting" disabled={busy || !draft.title.trim()} onClick={() => void save()}>{busy ? "保存中…" : <><Check size={13} />保存</>}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="vault">
      <div className="vault-bar">
        <span className="vault-search"><Search size={13} /><input value={query} placeholder="搜索名称 / 账号 / 网址" aria-label="搜索密码本" onChange={(event) => setQuery(event.target.value)} /></span>
        <button type="button" className="primary-setting" onClick={() => setDraft({ ...EMPTY })}><Plus size={13} />新增</button>
      </div>
      {!encrypted && <p className="vault-warn">本机加密不可用（系统钥匙串未就绪）：现在**不能保存密码**，已保存的条目也无法解密。</p>}
      {!filtered.length ? (
        <div className="vault-empty"><KeyRound size={26} /><strong>{items.length ? "没有匹配的条目" : "还没有记过密码"}</strong><p>{items.length ? "换个关键词试试。" : "点右上「新增」记一条：密码会加密存在本机，复制时由主进程直接写剪贴板。"}</p></div>
      ) : (
        <ul className="vault-list">
          {filtered.map((item) => (
            <li key={item.id} className="vault-item">
              <div className="vault-item-main">
                <strong>{item.title}</strong>
                {item.username ? <span className="vault-item-sub">{item.username}</span> : null}
                {item.url ? <span className="vault-item-sub vault-item-url" title={item.url}>{item.url}</span> : null}
                {item.note ? <span className="vault-item-note">{item.note}</span> : null}
              </div>
              <div className="vault-item-actions">
                <button type="button" className="icon-button" title={item.hasSecret ? "复制密码" : "这条没有密码"} aria-label="复制密码" disabled={!item.hasSecret} onClick={() => void copyPassword(item)}><KeyRound size={13} /></button>
                {item.username ? <button type="button" className="icon-button" title="复制用户名" aria-label="复制用户名" onClick={() => void copyTextToClipboard(item.username ?? "").then(() => onToast("用户名已复制")).catch(() => onNotice("复制失败"))}><Copy size={13} /></button> : null}
                {item.url ? <button type="button" className="icon-button" title="复制网址" aria-label="复制网址" onClick={() => void copyTextToClipboard(item.url ?? "").then(() => onToast("网址已复制")).catch(() => onNotice("复制失败"))}><ClipboardCopy size={13} /></button> : null}
                <button type="button" className="icon-button" title="编辑" aria-label="编辑" onClick={() => setDraft({ id: item.id, title: item.title, username: item.username ?? "", password: "", url: item.url ?? "", note: item.note ?? "" })}><Pencil size={13} /></button>
                {confirmId === item.id ? (
                  <>
                    <button type="button" className="secondary-setting vault-danger" disabled={busy} onClick={() => void remove(item.id)}>确认删除</button>
                    <button type="button" className="secondary-setting" onClick={() => setConfirmId(null)}>取消</button>
                  </>
                ) : (
                  <button type="button" className="icon-button vault-danger" title="删除" aria-label="删除" onClick={() => setConfirmId(item.id)}><Trash2 size={13} /></button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="vault-footer"><X size={11} />只存本机：不上传、不同步、不写入任何日志或对话。</p>
    </div>
  );
}
