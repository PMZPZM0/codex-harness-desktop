/**
 * 运行时分类面板（11-01 改版：一个分类一份内容，只在二级弹窗里渲染）。
 *
 * 一级（开发工具页）= 分类卡片 + 一键安装；本面板是点开卡片后的明细：
 * 每个工具一行，手动下载 / 卸载 / 取消，下载与卸载都有进度条。
 *
 * ⛔ 一键安装/卸载的**批处理状态不放这里**：它挂在页面级（DevtoolsSettingsSection），
 *   否则关掉弹窗组件卸载，批量循环还在跑、卡片上却看不到进度（也点不到取消）。
 * ⛔ 卸载仍走行内二次确认（真删本地文件，不可恢复）；批量卸载同样先确认。
 * ⛔ 取消只对下载/安装显示 —— 主进程的 runtime:cancel 只认安装进程（卸载不可取消）。
 */
import { useState } from "react";
import { AlertTriangle, ArrowDown, CircleCheck, Copy, ExternalLink, TerminalSquare } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { copyTextToClipboard } from "../../lib/clipboard";
import { EgoLiteCard } from "./EgoLiteCard";
import { isRemovable, runtimeGroupItems, type RuntimeBatch, type RuntimeGroup, type RuntimeRow } from "./runtime-groups";

export type RuntimeToolsPanelProps = {
  group: RuntimeGroup;
  devRuntimes: RuntimeRow[];
  runtimeInstalling: string | null;
  runtimeUninstalling: string | null;
  runtimePercent: Record<string, number>;
  runtimeStage: Record<string, string>;
  runtimeSpeed: Record<string, string>;
  runtimeProgress: Record<string, string>;
  installDevRuntime: (id: string) => Promise<void> | void;
  uninstallDevRuntime: (id: string) => Promise<void> | void;
  cancelDevRuntime: (id: string) => Promise<void> | void;
  setNotice: (text: string) => void;
  setRuntimeModal: (modal: { id: string; name: string; mode: "install" | "uninstall"; done: boolean; failed: boolean; error: string } | null) => void;
  batch: RuntimeBatch;
  runBatch: (kind: "install" | "uninstall", list: RuntimeRow[], cardKey: string) => void;
};

export function RuntimeToolsPanel(props: RuntimeToolsPanelProps) {
  const { group, devRuntimes, runtimeInstalling, runtimeUninstalling, runtimePercent, runtimeStage, runtimeSpeed, runtimeProgress, installDevRuntime, uninstallDevRuntime, cancelDevRuntime, setNotice, setRuntimeModal, batch, runBatch } = props;
  // 卸载二次确认（真删本地文件，不可恢复）：行内两步确认，不用原生 confirm。
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const [confirmBatch, setConfirmBatch] = useState(false);

  const items = runtimeGroupItems(group, devRuntimes);
  const removables = items.filter(isRemovable);
  const cardKey = `tools-${group.key}`;
  const batching = batch.kind !== null && batch.card === cardKey;

  return (
    <div className="settings-section stack">
      {/* 浏览器自动化主通道：外部安装的 ego lite（每会话一个 TaskSpace；不随包内置） */}
      {group.key === "auto" ? <EgoLiteCard onNotice={setNotice} /> : null}

      <div className="settings-subhead">
        {group.icon}{group.title}
        <span className="settings-subhead-hint">{group.hint}</span>
      </div>

      <div className="runtime-list">
        {items.map((runtime) => {
          const busy = runtimeInstalling === runtime.id || runtime.installing;
          const done = Boolean(runtime.installed || runtime.installedBySystem);
          const isGuide = runtime.kind === "guide";
          const builtinBadge = runtime.builtIn || (runtime.bundled && done);
          const percent = runtimePercent?.[runtime.id] ?? 0;
          const uninstalling = runtimeUninstalling === runtime.id;
          /* 「这个工具刚装失败了」的判据 = app-state 写进 runtimeProgress 的那一行
             （`安装失败：<原因>`）。⛔ 前缀是**契约**：产出侧写死的字符串在
             01-dev-runtimes-capability.tsx，守卫【287】两边一起钉。 */
          const installFailed = String(runtimeProgress?.[runtime.id] ?? "").startsWith("安装失败");
          const uninstallFailed = String(runtimeProgress?.[runtime.id] ?? "").startsWith("卸载失败");
          const fallbackPrompt = runtime.fallbackPrompt;
          return <div className={`runtime-row devtools-tool-row ${done ? "installed" : "missing"} ${busy ? "busy" : ""}`} key={runtime.id} data-runtime={runtime.id}>
            <span className="runtime-icon">{busy ? <Spinner /> : done ? <CircleCheck size={16} /> : <TerminalSquare size={16} />}</span>
            <span className="runtime-copy"><strong>{runtime.name}</strong><small>{runtime.description}</small></span>
            {busy ? <span className="runtime-install-state devtools-progress-row">
              {/* 进度条：下载 / 安装 / 卸载共用（卸载也按字节发 percent） */}
              <span className="runtime-progress-bar" role="progressbar" aria-label={`${runtime.name}${uninstalling ? "卸载" : "安装"}进度`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${percent}%` }} />
              </span>
              <em className="runtime-progress">
                {uninstalling ? "正在卸载 · " : runtimeStage[runtime.id] ? `${runtimeStage[runtime.id]} · ` : ""}
                {typeof runtimePercent[runtime.id] === "number" ? `${percent}%` : "准备中"}
                {runtimeSpeed[runtime.id] ? ` · ${runtimeSpeed[runtime.id]}` : ""}
                {runtimeProgress[runtime.id] ? ` · ${runtimeProgress[runtime.id]}` : ""}
              </em>
            </span>
              : !done && runtime.bundled ? <em className="runtime-hint">随包内置能力缺失时可点「修复安装」从包内恢复</em>
                : null}
            {installFailed ? (
              <button type="button" className="runtime-failed"
                onClick={() => setRuntimeModal({ id: runtime.id, name: runtime.name, mode: "install", done: true, failed: true, error: String(runtimeProgress?.[runtime.id] ?? "").replace(/^安装失败：/, "") })}>
                <AlertTriangle size={12} />安装失败 · 点开完整报错与备用方案
              </button>
            ) : uninstallFailed ? (
              <button type="button" className="runtime-failed"
                onClick={() => setRuntimeModal({ id: runtime.id, name: runtime.name, mode: "uninstall", done: true, failed: true, error: String(runtimeProgress?.[runtime.id] ?? "").replace(/^卸载失败：/, "") })}>
                <AlertTriangle size={12} />卸载失败 · 点开完整报错
              </button>
            ) : null}
            <span className="runtime-size">{runtime.size}</span>
            <div className="runtime-actions">
              {/* 常驻「复制安装提示词」：网差时的正路 —— 复制给 Codex 让它在这台机器上直接装。
                  ⛔ 提示词正文 = 主进程 runtime:list 下发的 fallbackPrompt（单一真相源）。 */}
              {fallbackPrompt && !isGuide ? (
                <button type="button" className="runtime-prompt-copy"
                  title={`复制「${runtime.name}」的安装提示词 —— 发到任意会话里，Codex 就能帮你装`}
                  aria-label={`复制 ${runtime.name} 的安装提示词`}
                  onClick={() => {
                    void copyTextToClipboard(fallbackPrompt);
                    setNotice(`已复制「${runtime.name}」的安装提示词 —— 到任意会话里发给 Codex 即可`);
                  }}>
                  <Copy size={14} />
                </button>
              ) : null}
              {busy ? (
                uninstalling
                  ? <span className="runtime-badge busy" title={runtimeStage?.[runtime.id] ?? ""}>卸载中… {Math.round(Number(percent))}%</span>
                  : <button className="secondary-setting runtime-cancel" onClick={() => void cancelDevRuntime(runtime.id)}>取消</button>
              ) : (<>
                {builtinBadge ? <span className="runtime-badge">内置</span>
                  : runtime.bundled
                    ? <button className="primary-setting runtime-install" disabled={Boolean(runtimeInstalling)} onClick={() => void installDevRuntime(runtime.id)}><ArrowDown size={14} />修复安装</button>
                    : done ? <>
                      <span className="runtime-badge installed">{runtime.installedBySystem ? "系统已装" : "已安装"}</span>
                      {!runtime.installedBySystem && (confirmUninstall === runtime.id ? (
                        <span className="runtime-confirm">
                          <em>删除本地文件，不可恢复？</em>
                          <button className="danger-setting runtime-uninstall" disabled={Boolean(runtimeInstalling)} onClick={() => { setConfirmUninstall(null); void uninstallDevRuntime(runtime.id); }}>确认卸载</button>
                          <button className="secondary-setting" onClick={() => setConfirmUninstall(null)}>取消</button>
                        </span>
                      ) : (
                        <button className="secondary-setting runtime-uninstall" onClick={() => setConfirmUninstall(runtime.id)}>卸载</button>
                      ))}
                    </>
                    : isGuide
                      ? <button className="secondary-setting runtime-install" onClick={() => void installDevRuntime(runtime.id)}><ExternalLink size={13} />去官网安装</button>
                      : <button className="primary-setting runtime-install" disabled={Boolean(runtimeInstalling)} onClick={() => void installDevRuntime(runtime.id)}><ArrowDown size={14} />下载</button>}
              </>)}
            </div>
          </div>;
        })}
      </div>
      {!devRuntimes.length && <div className="runtime-loading"><Spinner />正在读取开发工具状态…</div>}

      {/* 本组一键卸载：只对「已安装且可真删」的项生效；先确认再动手。 */}
      {removables.length > 0 ? (
        <div className="devtools-batch">
          {confirmBatch ? (
            <>
              <span className="devtools-batch-text">将删除这 {removables.length} 个工具的本地文件，不可恢复。确认卸载？</span>
              <button className="danger-setting runtime-uninstall" disabled={Boolean(batch.kind)} onClick={() => { setConfirmBatch(false); runBatch("uninstall", removables, cardKey); }}>确认卸载</button>
              <button className="secondary-setting" onClick={() => setConfirmBatch(false)}>取消</button>
            </>
          ) : (
            <>
              <span className="devtools-batch-text">本组可卸载 {removables.length} 项</span>
              <button className="secondary-setting" disabled={Boolean(batch.kind)} onClick={() => setConfirmBatch(true)}>本组一键卸载（{removables.length}）</button>
            </>
          )}
        </div>
      ) : null}
      {batching ? (
        <p className="settings-card-hint">
          正在{batch.kind === "install" ? "安装" : "卸载"} {Math.min(batch.done + 1, batch.total)}/{batch.total}：{batch.name}（进度显示在分类卡片上，可关窗继续）
        </p>
      ) : null}
      <p className="settings-card-hint">
        {group.key === "base"
          ? "这些运行时随安装包自带、离线可用；缺失时点「修复安装」从随包资源恢复。"
          : "安装与卸载都真实改动本机文件；下载中可取消，卸载不可取消（会逐文件删除并显示进度）。"}
      </p>
    </div>
  );
}