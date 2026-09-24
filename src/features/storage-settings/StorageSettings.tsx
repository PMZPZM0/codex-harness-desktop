/** 存储设置 / 复审面板（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { useState, useEffect, useMemo } from "react";
import { PageInfo } from "../../components/SettingsHead";
import { Database, ChevronDown, Check, RefreshCw, FileCode2, Search } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { basename } from "../../lib/basename";
import { Markdown } from "../markdown";
import { ReviewScope } from "../../lib/review-scope";

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function StorageSection({ onNotice, onClearMemoryCache, openAppConfirm }: {
  onNotice: (message: string) => void;
  onClearMemoryCache: () => void;
  openAppConfirm: (title: string, text: string, confirmLabel?: string) => Promise<boolean>;
}) {
  const [info, setInfo] = useState<{ items: { key: string; label: string; bytes: number; deletable: boolean }[]; userData: string; engineLog: string; imagesDir: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => { window.codex.storageInfo().then(setInfo).catch((error: any) => onNotice("读取数据占用失败：" + (error?.message ?? error))); };
  useEffect(() => { refresh(); }, []);
  const clear = async (target: "engine-log" | "images", label: string) => {
    const ok = await openAppConfirm("清理缓存", `确认清空「${label}」？此操作不可撤销。\n（会话历史记录不会被删除，仅清理诊断日志与图片缓存。）`, "清理");
    if (!ok) return;
    setBusy(target);
    try {
      const res = await window.codex.storageClear(target);
      if (res?.ok) { onNotice(`已清理：${label}`); refresh(); }
      else onNotice("清理失败：" + (res?.error ?? "未知错误"));
    } catch (error: any) {
      onNotice("清理失败：" + (error?.message ?? error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="settings-section stack">
      <div className="settings-copy"><h2>数据管理<PageInfo text={<>查看各数据目录占用，并清理可安全的缓存。会话历史（rollout 原档）是你的全部对话记录，<strong>不在清理范围内</strong>，请通过归档 / 备份管理。</>} /></h2></div>
      <div className="storage-list">
        {info?.items.map((item) => (
          <div className="storage-row" key={item.key}>
            <div className="storage-meta"><strong>{item.label}</strong><span>{formatBytes(item.bytes)}</span></div>
            {item.deletable
              ? <button className="danger-setting" disabled={busy !== null} onClick={() => void clear(item.key as "engine-log" | "images", item.label)}>{busy === item.key ? "清理中…" : "清理"}</button>
              : <span className="storage-locked" title="会话历史不可在此删除，请用归档 / 备份管理">保留</span>}
          </div>
        ))}
        {!info && <p className="muted">正在统计占用…</p>}
      </div>
      <div className="settings-subhead"><Database size={13} />会话恢复缓存（内存）</div>
      <p className="muted">应用会在内存里缓存已打开过的会话用于秒开；长时间运行、切换过大量会话后可能占用可观内存。清理后下次打开会话会重新从磁盘加载（略慢一瞬）。</p>
      <div className="settings-actions">
        <button className="secondary-setting" disabled={busy !== null} onClick={() => { onClearMemoryCache(); onNotice("已清理会话恢复缓存"); }}>清理会话恢复缓存</button>
        <button className="secondary-setting" onClick={() => { window.codex.getUserData().then((p: string) => window.codex.shellReveal(p)).catch(() => undefined); }}>打开数据目录</button>
      </div>
    </section>
  );
}

const reviewScopes: [ReviewScope, string][] = [["unstaged", "未暂存"], ["staged", "已暂存"], ["head", "全部分支更改"], ["last", "上一轮更改"]];

export function ReviewPanel({ workspace, lastDiff, disabled, busy, report, onReview }: { workspace: string; lastDiff: string; disabled: boolean; busy: boolean; report: string; onReview: (instructions: string) => void }) {
  const [scope, setScope] = useState<ReviewScope>("unstaged");
  const [menuOpen, setMenuOpen] = useState(false);
  const [output, setOutput] = useState("");
  const [gitMissing, setGitMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState("");
  const refresh = async () => {
    if (scope === "last") { setOutput(lastDiff); setGitMissing(false); return; }
    if (!workspace) { setGitMissing(true); setOutput(""); return; }
    setLoading(true);
    try {
      const result = await window.codex.gitDiff(workspace, scope);
      setGitMissing(false);
      setOutput(result.output ?? "");
    } catch {
      setGitMissing(true);
      setOutput("");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, [scope, workspace]);
  const files = useMemo(() => {
    if (!output) return [] as { path: string; added: number; deleted: number }[];
    const list: { path: string; added: number; deleted: number }[] = [];
    let current: { path: string; added: number; deleted: number } | null = null;
    for (const line of output.split("\n")) {
      const match = line.match(/^diff --git a\/(.+?) b\//);
      if (match) { current = { path: match[1], added: 0, deleted: 0 }; list.push(current); continue; }
      if (!current) continue;
      if (line.startsWith("+") && !line.startsWith("+++")) current.added += 1;
      else if (line.startsWith("-") && !line.startsWith("---")) current.deleted += 1;
    }
    return list;
  }, [output]);
  const scopeLabel = reviewScopes.find(([value]) => value === scope)?.[1] ?? "未暂存";
  return (
    <section className="review-panel">
      <div className="review-bar">
        <div className="scope-wrap">
          <button className="scope-btn" onClick={() => setMenuOpen((current) => !current)}>{scopeLabel}<ChevronDown size={13} /></button>
          {menuOpen && <div className="scope-menu">
            {reviewScopes.map(([value, label]) => <button key={value} onClick={() => { setScope(value); setMenuOpen(false); }}>{label}{scope === value && <Check size={13} />}</button>)}
          </div>}
        </div>
        <button className="review-refresh" title="刷新" onClick={() => void refresh()}>{loading ? <Spinner /> : <RefreshCw size={14} />}<span>刷新</span></button>
      </div>
      {gitMissing ? <div className="git-missing"><FileCode2 size={36} /><strong>当前环境没有可用的 Git</strong><p>请先安装 Git，或确认当前运行环境里可以执行 git 命令。</p></div>
        : files.length ? <div className="diff-file-list">{files.map((file) => <div key={file.path}><code title={file.path}>{basename(file.path)}</code><span><b>+{file.added}</b> <i>-{file.deleted}</i></span></div>)}</div>
        : <div className="git-empty"><p className="muted">当前范围没有文件改动</p></div>}
      <details className="ai-review">
        <summary><Search size={13} />AI 审查（review/start）<ChevronDown size={13} /></summary>
        <div className="ai-review-body">
          <button className="primary-setting" disabled={disabled || busy} onClick={() => onReview("")}><Search size={14} />{busy ? "审查中…" : "审查未提交改动"}</button>
          <div className="review-custom">
            <textarea value={custom} rows={2} placeholder="或输入自定义审查说明，例如：重点检查鉴权逻辑" onChange={(event) => setCustom(event.target.value)} />
            <button className="secondary-setting" disabled={disabled || busy || !custom.trim()} onClick={() => { const value = custom.trim(); setCustom(""); onReview(value); }}>按说明审查</button>
          </div>
          {report && <div className="review-report"><Markdown>{report}</Markdown></div>}
        </div>
      </details>
    </section>
  );
}
