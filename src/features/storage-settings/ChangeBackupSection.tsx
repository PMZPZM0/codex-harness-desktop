/**
 * 改动备份设置块（10-13）—— 挂在「设置 → 数据管理」页内。
 *
 * ⛔ **独立板块**：新增功能一律独立成块 + 留拓展接口，不往既有 `StorageSection` 里顺手加字段
 *   （项目规则：ARCHITECTURE-RULES §2.2，样板 = AI 画布板块）。本页只多渲染一个 `<ChangeBackupSection/>`。
 *
 * ⛔ **不自己判断"目录合不合法"**：规范化与回退都在主进程
 *   （`change-backup.ts` 的 `normalizeBackupDir`）。渲染层拿 `fallback` 标志显示警示即可 ——
 *   两处各判一次必然漂移。
 * ⛔ **配置回显**：`useEffect` 挂载时读一次 `backupConfigGet`，之后由保存结果覆盖
 *   （不在本地另存一份 state 真值）。
 */
import { useCallback, useEffect, useState } from "react";
import { Archive, FolderOpen, ShieldCheck } from "lucide-react";
import { ToggleSwitch } from "../../components/SettingsWidgets";

type BackupConfig = {
  enabled: boolean;
  rawDir: string;
  dir: string;
  fallback: boolean;
  dirExists: boolean;
};

type BackupSummary = { root: string; conversations: number; changes: number; bytes: number };

function formatBytes(bytes: number): string {
  const b = Math.max(0, Number(bytes) || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

export function ChangeBackupSection({ onNotice, openAppConfirm }: {
  onNotice: (message: string) => void;
  openAppConfirm: (title: string, text: string, confirmLabel?: string) => Promise<boolean>;
}) {
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [dirDraft, setDirDraft] = useState("");
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void window.codex.backupConfigGet?.().then((r: any) => {
      if (r?.ok && r.config) {
        setConfig(r.config);
        // ⛔ 只在「用户没在编辑」时才回填草稿：否则每轮保存都会把用户正在敲的字冲掉。
        setDirDraft((draft) => (draft ? draft : r.config.rawDir || ""));
      }
    }).catch((error: any) => onNotice("读取改动备份配置失败：" + (error?.message ?? error)));
    void window.codex.backupSummary?.().then((r: any) => { if (r?.ok) setSummary(r.summary); }).catch(() => undefined);
  }, [onNotice]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async (patch: { enabled?: boolean; dir?: string }) => {
    setBusy(true);
    try {
      const r: any = await window.codex.backupConfigSet?.(patch);
      if (!r?.ok) { onNotice("保存失败：" + (r?.error ?? "未知错误")); return; }
      if (r.config) setConfig(r.config);
      // ⛔ 目录建不出来时**如实告知**，不能让用户以为"开了就有备份"（表现为开了却没产物，最难自查）。
      if (r.dirReady === false) onNotice(`目录无法创建：${r.config?.dir ?? ""}（请检查路径是否可写，或换个目录）`);
      void window.codex.backupSummary?.().then((x: any) => { if (x?.ok) setSummary(x.summary); }).catch(() => undefined);
    } catch (error: any) {
      onNotice("保存失败：" + (error?.message ?? error));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    const ok = await openAppConfirm(
      "清空改动备份",
      `确认清空全部改动备份？\n\n将删除：\n${config?.dir ?? ""}\n下的 changes-index 与 changes-detail。\n\n此操作不可恢复。`,
      "清空备份",
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r: any = await window.codex.backupClear?.();
      if (r?.ok) { onNotice("已清空改动备份"); refresh(); }
      else onNotice("清空失败：" + (r?.error ?? "未知错误"));
    } catch (error: any) {
      onNotice("清空失败：" + (error?.message ?? error));
    } finally {
      setBusy(false);
    }
  };

  if (!config) {
    return (
      <section className="settings-section stack is-settings-flow">
        <div className="settings-subhead"><Archive size={13} />改动备份</div>
        <p className="muted">正在读取配置…</p>
      </section>
    );
  }

  return (
    <section className="settings-section stack is-settings-flow">
      <div className="settings-subhead"><Archive size={13} />改动备份</div>

      {/* 功能开关 —— 默认关（用户没主动开之前不产生任何磁盘产物） */}
      <div className="storage-row">
        <div className="storage-meta">
          <strong>启用改动自动备份</strong>
          <span>每个回合结束后，记录这一回合改过的文件（新增 / 修改 / 删除）与变更内容</span>
        </div>
        {/* ⛔ 用共享的 ToggleSwitch（SettingsWidgets），不要手搓 checkbox：
             皮肤约定是 `<button role="switch" class="toggle-switch on|off">`，
             手搓 checkbox 会因为样式只认 `.toggle-switch.on` 而渲染成一个不动的原生开关
             （且暗色下原生控件按浅色 UA 绘制，见全站 appearance 纪律）。 */}
        <ToggleSwitch
          checked={config.enabled}
          disabled={busy}
          label="启用改动自动备份"
          onChange={(next) => void save({ enabled: next })}
        />
      </div>

      {/* 备份目录 —— 空 = 默认；非法路径会被主进程回退并在此显示警示 */}
      <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
        <div className="storage-meta">
          <strong>备份目录</strong>
          <span>留空则使用默认目录（应用数据目录下 change-backups）；目录不存在会在启用时自动创建</span>
        </div>
        <div className="settings-actions" style={{ flexWrap: "nowrap", gap: 8 }}>
          <input
            className="account-menu-input"
            type="text"
            spellCheck={false}
            placeholder={config.dir}
            value={dirDraft}
            onChange={(e) => setDirDraft(e.target.value)}
          />
          <button
            className="secondary-setting"
            disabled={busy || dirDraft === (config.rawDir || "")}
            onClick={() => void save({ dir: dirDraft })}
          >
            保存路径
          </button>
          <button
            className="secondary-setting"
            title="在文件管理器中打开"
            onClick={() => { window.codex.shellReveal?.(config.dir).catch(() => undefined); }}
          >
            <FolderOpen size={13} />
          </button>
        </div>
      </div>

      {/* 生效目录 + 回退警示 */}
      <p className="muted mono" style={{ wordBreak: "break-all" }}>
        实际生效：{config.dir}{config.dirExists ? "" : "（尚未创建）"}
      </p>
      {config.fallback ? (
        <p className="muted" style={{ color: "var(--warn, #d08700)" }}>
          ⚠ 你填的路径无效（需为绝对路径，且不能是磁盘根目录），已回退到默认目录。
        </p>
      ) : null}

      {/* 产物概览 */}
      <div className="settings-subhead"><ShieldCheck size={13} />已备份</div>
      <div className="storage-row">
        <div className="storage-meta">
          <strong>{summary?.conversations ?? 0} 个会话 · {summary?.changes ?? 0} 条变更</strong>
          <span>{formatBytes(summary?.bytes ?? 0)}（索引 + 明细）</span>
        </div>
        <button className="danger-setting" disabled={busy} onClick={() => void clear()}>
          {busy ? "处理中…" : "清空备份"}
        </button>
      </div>
      <p className="muted">
        与 WorkBuddy 的改动备份同构：索引在 <span className="mono">changes-index/&lt;会话 id&gt;.json</span>，
        含变更块全文的明细在 <span className="mono">changes-detail/&lt;会话 id&gt;/</span>。
      </p>
    </section>
  );
}