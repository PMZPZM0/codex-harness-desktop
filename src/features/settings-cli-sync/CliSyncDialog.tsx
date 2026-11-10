/**
 * 「同步给 CLI 智能体」弹窗（11-10 用户令：模型配置界面加一个同步入口，Claude 单独按键，
 * 其它已安装的 CLI 自动识别，弹窗模式）。
 *
 * ⛔ 这个板块**只做展示与触发**：
 *   · 识别「装了哪些 CLI、各自怎么同步」全在主进程 `inspectCliSyncTargets`
 *     （渲染层不自己 where/which，也不自己拼配置）；
 *   · Key 全程不出主进程 —— 这里调用的两个通道都不返回 Key。
 * ⛔ Claude 为什么仍要单独确认：它只认 ANTHROPIC_*，唯一能「本机终端直跑也跟随」的地方是
 *   `~/.claude/settings.json`（明文 Key）⇒ 第一次点只展开警告，第二次才真写，⛔ 不做静默落盘。
 * ⛔ 11-10 二改（用户「现在整体这个同步板块就不好看」）：整块重排成**一张列表卡** ——
 *   行 = 图标 + 名称/标签 + 一句说明 + 右侧状态/按钮；⛔ 不再有顶部结果卡和整段说明文字。
 */
import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, ExternalLink, RefreshCw, Terminal, X } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { useEscapeLayer } from "../../hooks/useEscapeLayer";

type SyncTarget = {
  id: string;
  name: string;
  bin: string;
  installed: boolean;
  kind: "claude" | "keyed" | "config" | "env" | "own";
  action: string;
  status: string;
  /** own 类只能它自己登录 —— 给一个「去哪登录」的出口（官方文档）。 */
  docs?: string;
};

/** 逐 CLI 回执：synced=这次写了 / current=本来就一致 / auto=派活时自动注入 /
 *  manual=只能它自己登录 / failed=写失败。 */
type SyncState = "synced" | "current" | "auto" | "manual" | "failed";
type SyncResult = { id?: string; name: string; ok: boolean; state?: SyncState; detail: string };

type Snapshot = {
  provider: { name: string; model: string; host: string; local: boolean; ready: boolean };
  targets: SyncTarget[];
};

/** catch 里的错误取一句话（⛔ 不用 any：架构守卫按文件记 any 基线）。 */
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

const KIND_LABEL: Record<SyncTarget["kind"], string> = {
  claude: "需单独写 Key",
  keyed: "写配置（含 Key）",
  config: "配置文件",
  env: "环境变量",
  own: "它自己管",
};

/** 单条回执的状态（主进程已给 state；单点同步只有 ok，按文案归一到同一套）。 */
const stateOf = (entry: SyncResult): SyncState =>
  entry.state ?? (!entry.ok ? "failed" : /最新|无需改写/.test(entry.detail) ? "current" : "synced");

/** 一句人话总结：⛔ auto / manual 是说明，不算失败。 */
function summarizeResults(entries: SyncResult[]): string {
  const count = (state: SyncState) => entries.filter((entry) => stateOf(entry) === state).length;
  const parts = [
    count("synced") ? `已同步 ${count("synced")}` : "",
    count("current") ? `已是最新 ${count("current")}` : "",
    count("auto") ? `自动注入 ${count("auto")}` : "",
    count("manual") ? `需自己登录 ${count("manual")}` : "",
    count("failed") ? `失败 ${count("failed")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "没有可同步的 CLI";
}

/** Claude 的落盘状态：它**不会**跟着切换供应商自动改（写它是含明文 Key 的动作），
 *  所以这一行必须把「已同步 / 与当前不一致 / 未同步」直接摆在右边 ——
 *  用户切完供应商一眼就知道要回来手动同步一次。 */
function claudeChip(status: string): { text: string; tone: "ok" | "warn" | "idle" } {
  if (status.startsWith("已同步到当前供应商")) return { text: "已同步", tone: "ok" };
  if (status.startsWith("已同步到其它供应商")) return { text: "与当前不一致", tone: "warn" };
  return { text: "未同步", tone: "idle" };
}

export type CliSyncDialogProps = {
  open: boolean;
  onClose: () => void;
  onNotice?: (message: string) => void;
};

/** 「同步给 CLI 智能体」弹窗：一张列表卡，行内完成「看说明 → 同步 → 看结果」。
 *  ⛔ 只读展示 + 触发同步；识别与写入全在主进程（渲染层不自己探测、不碰 Key）。 */
export function CliSyncDialog({ open, onClose, onNotice }: CliSyncDialogProps) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** Claude 的二次确认（第一次点只展开警告，第二次才真写） */
  const [confirmClaude, setConfirmClaude] = useState(false);
  /** 其它 CLI：哪一个正等着二次确认（keyed 类，含明文 Key） */
  const [confirmKeyed, setConfirmKeyed] = useState("");
  const [busyTarget, setBusyTarget] = useState("");
  const [busy, setBusy] = useState<"claude" | "all" | "">("");
  /** 脚底一句话总结（⛔ 不做顶部结果卡）。 */
  const [summary, setSummary] = useState("");
  /** 行内回执：结果挂这一行**右侧**（失败原因才在行内多一行）。 */
  const [feedback, setFeedback] = useState<Record<string, { ok: boolean; state: SyncState; text: string }>>({});

  useEscapeLayer(open, onClose);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await window.codex.inspectCliSyncTargets();
      setSnapshot(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSummary("");
    setFeedback({});
    setConfirmClaude(false);
    setConfirmKeyed("");
    setBusyTarget("");
    void refresh();
  }, [open, refresh]);

  /* 11-10 用户令「切换了供应商后，这里还可以手动同步一次」：
     · provider-activated（保存 / 启用 / 云端同步都会广播）⇒ 重读供应商与各家状态，
       绝不拿着弹窗打开时那份旧快照让人以为已经同步过了；
     · 窗口重新获得焦点也补一次（用户在别处改完配置回来）。两个都是只读刷新。
     ⛔ 这类「外部变更」回来时要连同旧回执一起清掉 —— 否则 Claude 行还挂着上一家供应商的「已同步」。 */
  useEffect(() => {
    if (!open) return;
    const reload = () => {
      setFeedback({});
      setSummary("");
      void refresh();
    };
    const off = window.codex.onHarnessEvent((event) => {
      if (event?.type === "provider-activated") reload();
    });
    window.addEventListener("focus", reload);
    return () => {
      off?.();
      window.removeEventListener("focus", reload);
    };
  }, [open, refresh]);

  /** 把一批回执落到「行内状态 + 脚底总结」两处（单点与全量共用）。 */
  const publishResults = (entries: SyncResult[]) => {
    const text = summarizeResults(entries);
    setSummary(text);
    setFeedback((current) => {
      const next = { ...current };
      for (const entry of entries) {
        if (!entry.id) continue;
        next[entry.id] = { ok: entry.ok, state: stateOf(entry), text: entry.detail };
      }
      return next;
    });
    return text;
  };

  const targets = snapshot?.targets ?? [];
  const provider = snapshot?.provider;
  const claude = targets.find((target) => target.kind === "claude") ?? null;
  const ownCount = targets.filter((target) => target.kind === "own").length;

  const runClaude = async () => {
    if (!confirmClaude) { setConfirmClaude(true); return; }
    setBusy("claude");
    try {
      const r = await window.codex.applyCliSync({ scope: "claude" });
      const entry: SyncResult = { id: claude?.id, name: "Claude Code", ok: Boolean(r.ok), detail: String(r.detail ?? "") };
      const text = publishResults([entry]);
      onNotice?.(r.ok ? `Claude Code：${text}` : `Claude Code 同步失败：${r.detail ?? ""}`);
      setConfirmClaude(false);
      await refresh();
    } catch (e) {
      publishResults([{ id: claude?.id, name: "Claude Code", ok: false, detail: errorMessage(e) }]);
    } finally {
      setBusy("");
    }
  };

  /** 单点按键：按这个 CLI 自己的方式同步（含 Key 的先要一次确认）。
   *  ⛔ 成败要落在**这一行**上（用户报「没有成功反馈」）——只更新脚底汇总等于没反馈。 */
  const runOne = async (target: SyncTarget, needConfirm: boolean) => {
    if (needConfirm && confirmKeyed !== target.id) { setConfirmKeyed(target.id); return; }
    setBusyTarget(target.id);
    try {
      const r = await window.codex.applyCliSync({ targetId: target.id });
      const entry: SyncResult = { id: target.id, name: r.name ?? target.name, ok: Boolean(r.ok), detail: String(r.detail ?? "") };
      publishResults([entry]);
      onNotice?.(r.ok ? `${target.name}：${entry.detail}` : `${target.name} 同步失败：${entry.detail}`);
      setConfirmKeyed("");
      await refresh();
    } catch (e) {
      publishResults([{ id: target.id, name: target.name, ok: false, detail: errorMessage(e) }]);
    } finally {
      setBusyTarget("");
    }
  };

  const runAll = async () => {
    setBusy("all");
    try {
      const r = await window.codex.applyCliSync({ scope: "all" });
      const entries = (r.results ?? []) as SyncResult[];
      const text = publishResults(entries);
      onNotice?.(r.ok ? `同步完成：${text}` : `部分 CLI 同步失败：${text}`);
      await refresh();
    } catch (e) {
      publishResults([{ name: "同步", ok: false, detail: errorMessage(e) }]);
    } finally {
      setBusy("");
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cli-sync-modal" role="dialog" aria-modal="true" aria-label="同步给 CLI 智能体" data-testid="cli-sync">
        <header className="cli-sync-head">
          <span className="cli-sync-head-icon"><Terminal size={16} /></span>
          <div className="cli-sync-head-copy">
            <b>同步给 CLI 智能体</b>
            <span title={provider ? `${provider.name} · ${provider.model}` : ""}>
              {provider
                ? `当前供应商：${provider.name}${provider.model ? ` · ${provider.model}` : ""}${provider.local ? "（本机中转）" : ""}`
                : "读取中…"}
            </span>
          </div>
          <button className="icon-button" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="cli-sync-body">
          {loading && !snapshot && (
            <div className="cli-sync-empty"><Spinner /> 正在识别本机已安装的 CLI…</div>
          )}
          {error && (
            <div className="cli-sync-warn"><CircleAlert size={13} /> {error}</div>
          )}

          {targets.length > 0 && (
            <>
              <div className="cli-sync-section-bar">
                <span><Terminal size={13} />已安装的 CLI</span>
                <em>{targets.length} 个</em>
              </div>

              <div className="cli-sync-card">
                {targets.map((target) => {
                  /* 每个 CLI 的按键按它自己的跟随方式定制（用户令「定制模型同步按键」）：
                     claude / keyed = 写含 Key 的文件（先要一次确认）/ config = 写不含 Key 的配置 /
                     env = 派活时自动注入（没有文件可写）/ own = 只能用它自己的登录。 */
                  const isClaude = target.kind === "claude";
                  const canWrite = isClaude || target.kind === "keyed" || target.kind === "config";
                  const needConfirm = isClaude || target.kind === "keyed";
                  const confirming = isClaude ? confirmClaude : confirmKeyed === target.id;
                  const busyThis = isClaude ? busy === "claude" : busyTarget === target.id;
                  const entry = feedback[target.id];
                  /* 同步结果优先；还没点过时，Claude 显示它当前落盘状态（切换供应商后靠它提示手动补一次）。 */
                  const claudeState = isClaude && !entry ? claudeChip(target.status) : null;
                  return (
                    <div className="cli-sync-row" key={target.id} data-kind={target.kind}>
                      <span className="cli-sync-avatar">
                        <Terminal size={13} />
                      </span>
                      <div className="cli-sync-row-main">
                        <div className="cli-sync-row-head">
                          <b>{target.name}</b>
                          <span className="cli-sync-kind" data-kind={target.kind}>{KIND_LABEL[target.kind]}</span>
                          <code>{target.bin}</code>
                        </div>
                        <div className="cli-sync-row-note" title={target.status}>{target.action}</div>
                        {confirming && (
                          <div className="cli-sync-confirm">
                            ⚠ 会把当前供应商的 Key 明文写进它自己的配置文件（仅本机）。再点一次确认。
                          </div>
                        )}
                        {entry?.state === "failed" && <div className="cli-sync-row-error">{entry.text}</div>}
                      </div>
                      <div className="cli-sync-row-action">
                        {claudeState && (
                          <span className={`cli-sync-step is-${claudeState.tone}`} title={target.status}>
                            {claudeState.tone === "ok" ? <Check size={11} /> : claudeState.tone === "warn" ? <CircleAlert size={11} /> : null}
                            {claudeState.text}
                          </span>
                        )}
                        {entry && canWrite && (
                          <span
                            className={`cli-sync-step ${entry.state === "failed" ? "is-bad" : "is-ok"}`}
                            title={entry.text}
                            data-state={entry.state}
                          >
                            {entry.state === "failed" ? <CircleAlert size={11} /> : <Check size={11} />}
                            {entry.state === "failed" ? "失败" : entry.state === "current" ? "已是最新" : "已同步"}
                          </span>
                        )}
                        {canWrite ? (
                          <button
                            className={confirming ? "danger-setting" : "secondary-setting"}
                            disabled={busy !== "" || busyTarget !== "" || !provider?.ready}
                            title={needConfirm ? "这一步会把当前供应商的 Key 明文写进它自己的配置文件（仅本机）" : "按当前供应商重写它的配置文件"}
                            onClick={() => void (isClaude ? runClaude() : runOne(target, needConfirm))}
                          >
                            {busyThis
                              ? <><Spinner />写入中…</>
                              : confirming ? "确认写入" : needConfirm && !isClaude ? "同步（含 Key）" : "同步"}
                          </button>
                        ) : target.kind === "env" ? (
                          <span className="cli-sync-step is-idle">自动注入</span>
                        ) : (
                          <>
                            <span className="cli-sync-step is-idle">需自己登录</span>
                            {target.docs && (
                              <button
                                className="cli-sync-doc"
                                title="在浏览器打开它的官方文档（登录方式在里面）"
                                onClick={() => void window.codex.openExternal(String(target.docs))}
                              >
                                <ExternalLink size={11} />官方文档
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {ownCount > 0 && (
                <p className="cli-sync-footnote">
                  「需自己登录」的 CLI 只认它自己的账号：在它的终端登录一次即可，登录后群里就能用；这里的同步只写模型配置，<b>不会代登录</b>。
                </p>
              )}
            </>
          )}

          {snapshot && targets.length === 0 && (
            <div className="cli-sync-empty">本机还没装 CLI —— 到「设置 → 开发工具 → CLI 智能体」安装后再来。</div>
          )}
        </div>

        <footer className="cli-sync-foot">
          <span className="cli-sync-foot-note" title={summary || undefined} data-testid="cli-sync-summary">
            {summary || "启动 / 切换供应商 / 安装完 CLI 时都会自动同步一次，这里只是手动补一次。"}
          </span>
          <div className="cli-sync-foot-actions">
            <button className="secondary-setting" disabled={loading} onClick={() => void refresh()}>
              <RefreshCw size={13} />重新识别
            </button>
            <button className="primary-setting" disabled={busy !== "" || busyTarget !== "" || !provider?.ready} onClick={() => void runAll()}>
              {busy === "all" ? <><Spinner /> 同步中…</> : "全部同步"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
