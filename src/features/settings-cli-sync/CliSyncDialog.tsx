/**
 * 「同步给 CLI 智能体」弹窗（11-10 用户令：模型配置界面加一个同步入口，Claude 单独按键，
 * 其它已安装的 CLI 自动识别，弹窗模式）。
 *
 * ⛔ 这个板块**只做展示与触发**：
 *   · 识别「装了哪些 CLI、各自怎么同步」全在主进程 `inspectCliSyncTargets`
 *     （渲染层不自己 where/which，也不自己拼配置）；
 *   · Key 全程不出主进程 —— 这里调用的两个通道都不返回 Key。
 * ⛔ Claude 单独一块的原因写在卡片里（它只认 ANTHROPIC_*，唯一能让「本机终端直跑也跟随」的
 *   地方是 ~/.claude/settings.json，而那里是**明文 Key**）⇒ 按钮要二次确认，⛔ 不做静默落盘。
 */
import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, RefreshCw, Sparkles, Terminal, X } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { useEscapeLayer } from "../../hooks/useEscapeLayer";

type SyncTarget = {
  id: string;
  name: string;
  bin: string;
  installed: boolean;
  kind: "claude" | "config" | "env" | "own";
  action: string;
  status: string;
};

type Snapshot = {
  provider: { name: string; model: string; host: string; local: boolean; ready: boolean };
  targets: SyncTarget[];
};

/** catch 里的错误取一句话（⛔ 不用 any：架构守卫按文件记 any 基线）。 */
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

const KIND_LABEL: Record<SyncTarget["kind"], string> = {
  claude: "单独配置",
  config: "配置文件",
  env: "环境变量",
  own: "它自己管",
};

export type CliSyncDialogProps = {
  open: boolean;
  onClose: () => void;
  onNotice?: (message: string) => void;
};

/** 「同步给 CLI 智能体」弹窗：展示当前供应商 → Claude 单独一块 → 其它已安装 CLI 列表。
 *  ⛔ 只读展示 + 触发同步；识别与写入全在主进程（渲染层不自己探测、不碰 Key）。 */
export function CliSyncDialog({ open, onClose, onNotice }: CliSyncDialogProps) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** Claude 的二次确认（第一次点只展开警告，第二次才真写） */
  const [confirmClaude, setConfirmClaude] = useState(false);
  const [busy, setBusy] = useState<"claude" | "all" | "">("");
  const [result, setResult] = useState<Array<{ name: string; ok: boolean; detail: string }>>([]);

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
    setResult([]);
    setConfirmClaude(false);
    void refresh();
  }, [open, refresh]);

  const runClaude = async () => {
    if (!confirmClaude) { setConfirmClaude(true); return; }
    setBusy("claude");
    try {
      const r = await window.codex.applyCliSync({ scope: "claude" });
      setResult([{ name: "Claude Code", ok: Boolean(r.ok), detail: String(r.detail ?? "") }]);
      onNotice?.(r.ok ? "Claude Code 已同步当前供应商" : `Claude Code 同步失败：${r.detail ?? ""}`);
      setConfirmClaude(false);
      await refresh();
    } catch (e) {
      setResult([{ name: "Claude Code", ok: false, detail: errorMessage(e) }]);
    } finally {
      setBusy("");
    }
  };

  const runAll = async () => {
    setBusy("all");
    try {
      const r = await window.codex.applyCliSync({ scope: "all" });
      setResult(r.results ?? []);
      onNotice?.(r.ok ? "已同步给 CLI 智能体" : "部分 CLI 同步失败，见弹窗明细");
      await refresh();
    } catch (e) {
      setResult([{ name: "同步", ok: false, detail: errorMessage(e) }]);
    } finally {
      setBusy("");
    }
  };

  if (!open) return null;

  const claude = snapshot?.targets.find((t) => t.kind === "claude") ?? null;
  const others = (snapshot?.targets ?? []).filter((t) => t.kind !== "claude");
  const provider = snapshot?.provider;

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

          {claude && (
            <section className="cli-sync-claude">
              <div className="cli-sync-claude-top">
                <Sparkles size={14} />
                <b>Claude Code</b>
                <span className="cli-sync-tag">需要单独同步</span>
              </div>
              <p>
                它不认 OpenAI 那一套变量，只认 <code>ANTHROPIC_*</code>。别处是把配置写进各自的
                config.toml；Claude 只能写 <code>~/.claude/settings.json</code> 的 <code>env</code> 段，
                这样你在本机终端直接跑 <code>claude</code> 也会跟随当前供应商（群里派活本来就会自动注入）。
              </p>
              {confirmClaude && (
                <p className="cli-sync-warn">
                  ⚠ 这一步会把当前供应商的 <b>Key 明文</b>写进本机 <code>~/.claude/settings.json</code>
                  （只在这台机器生效）。确认再点一次。
                </p>
              )}
              <div className="cli-sync-claude-actions">
                <button className={confirmClaude ? "danger-setting" : "primary-setting"} disabled={busy !== "" || !provider?.ready} onClick={() => void runClaude()}>
                  {busy === "claude" ? <><Spinner /> 写入中…</> : confirmClaude ? "确认写入（含 Key）" : "同步 Claude Code"}
                </button>
                <span className="cli-sync-row-status">{claude.status}</span>
              </div>
            </section>
          )}

          <div className="cli-sync-section-title">
            <Terminal size={13} />
            <span>其它已安装的 CLI</span>
            <em>（自动识别；装了才出现在这里）</em>
          </div>

          {others.length === 0 ? (
            <div className="cli-sync-empty">本机还没装其它 CLI —— 到「设置 → 开发工具 → CLI 智能体」安装后再来。</div>
          ) : (
            <div className="cli-sync-list">
              {others.map((target) => (
                <div className="cli-sync-row" key={target.id}>
                  <div className="cli-sync-row-main">
                    <div className="cli-sync-row-head">
                      <b>{target.name}</b>
                      <span className="cli-sync-kind" data-kind={target.kind}>{KIND_LABEL[target.kind]}</span>
                      <code>{target.bin}</code>
                    </div>
                    <div className="cli-sync-row-note">{target.action}</div>
                    <div className="cli-sync-row-status">{target.status}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {result.length > 0 && (
            <div className="cli-sync-list">
              {result.map((entry, index) => (
                <div className="cli-sync-row" key={`${entry.name}-${index}`}>
                  <div className="cli-sync-row-main">
                    <div className="cli-sync-row-head">
                      {entry.ok ? <Check size={13} /> : <CircleAlert size={13} />}
                      <b>{entry.name}</b>
                    </div>
                    <div className="cli-sync-row-status">{entry.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="cli-sync-foot">
          <span className="cli-sync-foot-note">
            启动 / 切换供应商 / 安装完 CLI 时都会自动同步一次，这里只是手动补一次。
          </span>
          <div className="cli-sync-foot-actions">
            <button className="secondary-setting" disabled={loading} onClick={() => void refresh()}>
              <RefreshCw size={13} />重新识别
            </button>
            <button className="primary-setting" disabled={busy !== "" || !provider?.ready} onClick={() => void runAll()}>
              {busy === "all" ? <><Spinner /> 同步中…</> : "全部同步"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
