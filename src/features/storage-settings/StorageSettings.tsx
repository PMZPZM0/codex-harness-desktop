/** 存储设置 / 复审面板（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { useState, useEffect, useMemo } from "react";
import { PageInfo } from "../../components/SettingsHead";
import { ChevronDown, Check, RefreshCw, FileCode2, FolderOpen, Search, Download, GitBranch, X } from "lucide-react";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { Spinner } from "../../components/CardShell";
import { refreshWithReceipt } from "../../lib/refresh-receipt.mjs";
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
    <section className="settings-section stack is-settings-flow">
      <div className="settings-copy"><h2>数据管理<PageInfo text={<>查看各数据目录占用，并清理可安全的缓存。会话历史（rollout 原档）<strong>不随缓存清理</strong>；要归档或永久删除会话，去「归档管理」页。</>} /></h2><p>看清各类数据占多少空间，按需清理缓存；会话原档不受缓存清理影响。</p></div>
      <div className="settings-exp-group-head"><span>存储占用</span><small>缓存可随手清理；会话记录永远保留</small></div>
      {/* 10-24 用户令「整齐划一」：占用行 + 恢复缓存行收进同一张白卡（每行一行分隔线，操作全部右对齐） */}
      <div className="storage-page-card settings-card">
        {info?.items.map((item) => (
          <div className="storage-row" key={item.key}>
            <div className="storage-meta"><strong>{item.label}</strong><span>{formatBytes(item.bytes)}</span></div>
            {item.deletable
              ? <button className="danger-setting" disabled={busy !== null} onClick={() => void clear(item.key as "engine-log" | "images", item.label)}>{busy === item.key ? "清理中…" : "清理"}</button>
              : <span className="storage-locked" title="会话历史不可在此删除，请用归档 / 备份管理">保留</span>}
          </div>
        ))}
        {!info && <p className="muted">正在统计占用…</p>}
        <div className="storage-row">
          <div className="storage-meta">
            <strong>会话恢复缓存（内存）</strong>
            <span>内存里缓存已打开过的会话用于秒开；清理后下次打开会话会重新从磁盘加载（略慢一瞬）</span>
          </div>
          <div className="settings-actions">
            <button className="secondary-setting" disabled={busy !== null} onClick={() => { onClearMemoryCache(); onNotice("已清理会话恢复缓存"); }}>清理缓存</button>
            <button className="secondary-setting" onClick={() => { window.codex.getUserData().then((p: string) => window.codex.shellReveal(p)).catch(() => undefined); }}>打开数据目录</button>
          </div>
        </div>
      </div>
    </section>
  );
}

const reviewScopes: [ReviewScope, string][] = [["unstaged", "未暂存"], ["staged", "已暂存"], ["head", "全部分支更改"], ["last", "上一轮更改"]];
const reviewScopeHints: Record<ReviewScope, string> = {
  unstaged: "工作区里还没有 git add 的改动（git diff）",
  staged: "已经 git add、还没提交的改动（git diff --cached）",
  head: "当前分支从上游 / 主分支分出来后的全部改动（含已提交 + 未提交；git merge-base → diff）",
  last: "上一轮对话产生的改动（用回合记录，不经过 Git）",
};
/* 10-22 空态文案：原来说「当前范围没有文件改动」——用户看不出「为什么空」「接下来做什么」。
   改成「结论 + 下一步」，并按范围区分（未暂存空 ≠ 分支与起点一致，两件事）。 */
const reviewEmptyCopy: Record<ReviewScope, { title: string; hint: string }> = {
  unstaged: { title: "「未暂存」里还没有改动", hint: "改过文件后点右上角「刷新」；也可以展开下面的 AI 审查，让它先看一遍未提交改动。" },
  staged: { title: "还没有暂存的改动", hint: "git add 之后会出现在这里；没 add 的改动在「未暂存」。" },
  head: { title: "当前分支与起点一致", hint: "从分支起点到现在的改动（含已提交 + 未提交）都会列在这里。" },
  last: { title: "还没有上一轮改动", hint: "先在会话里发一条消息，回合结束后再回来看。" },
};

export function ReviewPanel({ workspace, lastDiff, disabled, busy, report, onReview, onNotice }: { workspace: string; lastDiff: string; disabled: boolean; busy: boolean; report: string; onReview: (instructions: string) => void; onNotice?: (message: string) => void }) {
  const [scope, setScope] = useState<ReviewScope>("unstaged");
  const [menuOpen, setMenuOpen] = useState(false);
  const [output, setOutput] = useState("");
  const [gitMissing, setGitMissing] = useState(false);
  /* ⛔「没选工作区」不是「没装 Git」：原来两者共用 gitMissing ⇒ 面板会顶着「当前环境没有可用的 Git」
     和「一键安装 Git」按钮，用户装了也是白装。这里独立成一个空态。 */
  const [noWorkspace, setNoWorkspace] = useState(false);
  const [gitError, setGitError] = useState("");
  const [installingGit, setInstallingGit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState("");
  /* 10-25 用户：「加一个搜索框可以直接搜索内容」——按文件路径或 diff 内容过滤下面这份清单。 */
  const [query, setQuery] = useState("");
  const refresh = async () => {
    if (scope === "last") { setOutput(lastDiff); setGitMissing(false); setNoWorkspace(false); setGitError(""); return ""; }
    if (!workspace) { setNoWorkspace(true); setGitMissing(false); setGitError(""); setOutput(""); return ""; }
    setNoWorkspace(false);
    setLoading(true);
    try {
      const result = await window.codex.gitDiff(workspace, scope);
      setGitMissing(false);
      setGitError(result.error ?? "");
      setOutput(result.output ?? "");
      return result.error ?? "";
    } catch (error: any) {
      const message = String(error?.message ?? error);
      setGitMissing(/未找到 Git|ENOENT|git.*not found/i.test(message));
      setGitError(message);
      setOutput("");
      return message;
    } finally {
      setLoading(false);
    }
  };
  const installGit = async () => {
    if (installingGit) return;
    setInstallingGit(true);
    try {
      const result: any = await window.codex.installRuntime("git");
      onNotice?.(result?.ok ? "Git 安装完成，正在刷新变更…" : "Git 安装未完成，请到 设置 → 开发工具 查看进度与报错");
      await refresh();
    } catch (error: any) {
      onNotice?.(`Git 安装失败：${String(error?.message ?? error)}`);
    } finally {
      setInstallingGit(false);
    }
  };
  useEffect(() => { void refresh(); }, [scope, workspace]);
  const files = useMemo(() => {
    type DiffRow = { path: string; dir: string; name: string; added: number; deleted: number; content: string };
    if (!output) return [] as DiffRow[];
    const list: DiffRow[] = [];
    let current: DiffRow | null = null;
    for (const line of output.split("\n")) {
      const match = line.match(/^diff --git a\/(.+?) b\//);
      if (match) {
        const path = match[1];
        const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
        current = {
          path,
          dir: cut >= 0 ? path.slice(0, cut) : "",
          name: cut >= 0 ? path.slice(cut + 1) : path,
          added: 0,
          deleted: 0,
          content: "",
        };
        list.push(current);
        continue;
      }
      if (!current) continue;
      current.content += `${line}\n`;
      if (line.startsWith("+") && !line.startsWith("+++")) current.added += 1;
      else if (line.startsWith("-") && !line.startsWith("---")) current.deleted += 1;
    }
    return list;
  }, [output]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleFiles = useMemo(() => {
    if (!normalizedQuery) return files;
    return files.filter((file) => file.path.toLowerCase().includes(normalizedQuery) || file.content.toLowerCase().includes(normalizedQuery));
  }, [files, normalizedQuery]);
  const totals = useMemo(() => files.reduce((acc, file) => ({ added: acc.added + file.added, deleted: acc.deleted + file.deleted }), { added: 0, deleted: 0 }), [files]);
  /* 搜到 diff 内容但路径不匹配时，给一行命中片段，避免「搜到了但界面啥也看不出来」。 */
  const hitSnippet = (file: { path: string; content: string }) => {
    if (!normalizedQuery || file.path.toLowerCase().includes(normalizedQuery)) return "";
    const hit = file.content.split("\n").find((line) => line.toLowerCase().includes(normalizedQuery));
    return hit ? hit.replace(/^[+\-\s]+/, "").trim().slice(0, 160) : "";
  };
  const scopeLabel = reviewScopes.find(([value]) => value === scope)?.[1] ?? "未暂存";
  return (
    <section className="review-panel review-panel-themed">
      {/* 10-25 用户：「右栏展开空唠唠的…设计一个主题界面，加搜索框，内容自适应展示全」
          —— 顶部做成一张总览卡（范围 + 文件数 + 增删 + 搜索），下面文件按卡片整行展示。 */}
      <div className="review-hero">
        <div className="review-hero-main">
          <span className="review-hero-icon"><GitBranch size={15} /></span>
          <div className="review-hero-text">
            <strong>{scopeLabel}改动</strong>
            <small title={workspace}>{workspace ? basename(workspace) : "未选择工作区"}</small>
          </div>
          <button className="review-hero-refresh" title="刷新变更列表" onClick={() => void refreshWithReceipt(onNotice, "刷新变更列表", () => refresh())}>
            {loading ? <Spinner /> : <RefreshCw size={14} />}
          </button>
        </div>
        <div className="review-hero-stats">
          <span><b>{files.length}</b> 个文件</span>
          <span className="is-add">+{totals.added}</span>
          <span className="is-del">-{totals.deleted}</span>
        </div>
        <div className="review-search">
          <Search size={13} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件或改动内容" aria-label="搜索文件或改动内容" />
          {query && <button type="button" title="清空搜索" onClick={() => setQuery("")}><X size={12} /></button>}
        </div>
        <div className="review-scope-row">
          <div className="scope-wrap">
            <button className="scope-btn" title={reviewScopeHints[scope]} onClick={() => setMenuOpen((current) => !current)}>{scopeLabel}<ChevronDown size={13} /></button>
            {menuOpen && <div className="scope-menu">
              {reviewScopes.map(([value, label]) => <button key={value} title={reviewScopeHints[value]} onClick={() => { setScope(value); setMenuOpen(false); }}>{label}{scope === value && <Check size={13} />}</button>)}
            </div>}
          </div>
          <small className="review-scope-hint">{reviewScopeHints[scope]}</small>
        </div>
      </div>
      {noWorkspace ? <div className="git-missing"><FolderOpen size={36} /><strong>还没有选择工作区</strong><p>在会话里选一个项目目录，或从「文件」标签打开项目；选好后这里会列出 Git 改动。</p></div>
        : gitMissing ? <div className="git-missing"><FileCode2 size={36} /><strong>当前环境没有可用的 Git</strong><p>{gitError || "安装后就能查看未暂存 / 已暂存 / 分支起点 / 上一轮的文件改动。"}</p><button className="primary-setting" disabled={installingGit} onClick={() => void installGit()}>{installingGit ? <Spinner /> : <Download size={14} />}{installingGit ? "安装中…" : "一键安装 Git"}</button><small>也可以在「设置 → 开发工具」查看安装进度；装完会自动刷新。</small></div>
        : <>
          {gitError && <div className="git-note">{gitError}</div>}
          {visibleFiles.length ? <div className="review-file-cards">
            {visibleFiles.map((file) => {
              const snippet = hitSnippet(file);
              return (
                <div className="review-file-card" key={file.path}>
                  <span className="review-file-type"><FileTypeIcon path={file.path} size={14} /></span>
                  <div className="review-file-body">
                    <div className="review-file-line">
                      <strong className="review-file-name" title={file.path}>{file.name}</strong>
                      <span className="review-file-counts"><b>+{file.added}</b><i>-{file.deleted}</i></span>
                    </div>
                    <div className="review-file-path" title={file.path}>{file.dir || file.path}</div>
                    {snippet && <code className="review-file-hit" title={snippet}>{snippet}</code>}
                  </div>
                </div>
              );
            })}
          </div>
            /* ⛔ 读不到变更时只说读到的那句：再说「没有改动」是两个互相矛盾的结论（10-22 用户截图里就是两条并存）。 */
            : gitError ? null
            : <div className="git-empty"><p className="muted">{normalizedQuery ? "没有匹配的改动" : reviewEmptyCopy[scope].title}</p><small>{normalizedQuery ? `换个关键词试试；当前共 ${files.length} 个文件。` : reviewEmptyCopy[scope].hint}</small></div>}
        </>}
      <details className="ai-review">
        {/* ⛔ 不再把内部方法名 review/start 写在标题里（用户不需要知道 RPC 名，且看起来像未完成的功能）。 */}
        <summary><Search size={13} />AI 代码审查<ChevronDown size={13} /></summary>
        <div className="ai-review-body">
          <p className="muted ai-review-hint">让模型读一遍未提交改动，列出问题与修改建议；结果直接显示在下方。</p>
          <button className="primary-setting" disabled={disabled || busy} onClick={() => onReview("")}><Search size={14} />{busy ? "审查中…" : "审查未提交改动"}</button>
          <div className="review-custom">
            <textarea value={custom} rows={2} placeholder="补充审查要求（可选），例如：重点检查鉴权与错误处理" onChange={(event) => setCustom(event.target.value)} />
            <button className="secondary-setting" disabled={disabled || busy || !custom.trim()} onClick={() => { const value = custom.trim(); setCustom(""); onReview(value); }}>按说明审查</button>
          </div>
          {report && <div className="review-report"><Markdown>{report}</Markdown></div>}
        </div>
      </details>
    </section>
  );
}
