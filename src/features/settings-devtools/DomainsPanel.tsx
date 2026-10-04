/**
 * 功能域清单（10-04 阶段 6）—— 挂在「设置 → 开发工具」底部的宿主域启停面板。
 *
 * ⛔ **它是一个普通插槽消费者**，不是设置页的一部分：devtools 页本身零改动
 *   （靠 `src/runtime/registry.ts` 的插槽机制挂进来）。这正是阶段 5 那个机制的用处 ——
 *   以后别的插件要往设置页挂东西，模式完全一样。
 *
 * ── 三态呈现（必须分清，用户最容易误解）────────────────────────────────────
 *   启用   = mounted && !disabled
 *   已停用 = disabled（⚠️ 本次运行里通道**仍在**，要重启才真的不再挂载）
 *   待生效 = 用户刚改的设置与当前运行不一致（disabled ≠ !mounted）
 *
 * ⛔ 为什么把"待生效"单独标出来：停用是**下次启动**生效（见 electron/features/domains-ipc.ts
 *   头注的两条理由）。如果 UI 只显示"已停用"，用户会以为功能已经没了、结果发现还能用
 *   ⇒ 那是"界面在说谎"，比不做这个功能更糟。
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Power, RefreshCw } from "lucide-react";
import { registerSlot } from "../../runtime/registry";

type DomainRow = { id: string; mounted: boolean; disabled: boolean; essential: boolean };
type ListResp = { domains: DomainRow[]; essentialDomains: string[]; requiresRestart: boolean };

let cachedRows: DomainRow[] | null = null;

function DomainsPanel({ onNotice }: { onNotice: (m: string) => void }) {
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setData(await window.codex.domainsList());
    } catch (e: any) {
      onNotice(`读取功能域清单失败：${e?.message ?? e}`);
    }
  }, [onNotice]);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (row: DomainRow) => {
    setBusy(row.id);
    // 本地乐观更新 + 记入 pending（"待生效"标记的来源）
    setPending((s) => { const n = new Set(s); n.add(row.id); return n; });
    try {
      const r: any = await window.codex.domainsSetEnabled({ id: row.id, enabled: row.disabled });
      if (!r?.ok) { onNotice(r?.error ?? "操作失败"); setPending((s) => { const n = new Set(s); n.delete(row.id); return n; }); }
      else {
        onNotice(r.enabled ? `已启用「${row.id}」，重启后生效` : `已停用「${row.id}」，重启后生效`);
        void load();
      }
    } catch (e: any) {
      onNotice(`操作失败：${e?.message ?? e}`);
      setPending((s) => { const n = new Set(s); n.delete(row.id); return n; });
    } finally {
      setBusy(null);
    }
  }, [load, onNotice]);

  if (!data) return null;
  const rows = data.domains.filter((d) => !d.essential);

  return (
    <div className="settings-card" style={{ marginTop: 12 }}>
      <header className="settings-card-head">
        <strong>功能域</strong>
        <span className="settings-card-sub">
          宿主自身的 {data.domains.length} 个功能域，可停用不需要的功能（{rows.length} 个可停用，{data.domains.length - rows.length} 个是应用自身能力不可停用）。
        </span>
      </header>

      <div className="settings-card-body">
        <div className="voice-resource-note" style={{ marginTop: 0, marginBottom: 10 }}>
          <AlertTriangle size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          停用是「<strong>下次启动</strong>生效」，不是立刻卸载：域的通道是那个功能唯一的调用入口，
          运行时卸载不安全（很多域的内部状态没法安全交还）。停用后请重启应用。
        </div>

        <div className="domains-list">
          {rows.map((row) => {
            const willApply = pending.has(row.id);
            return (
              <div key={row.id} className="domains-row">
                <code className="domains-id">{row.id}</code>
                <span className={`voice-devtools-badge ${row.disabled ? "warn" : "ok"}`}>
                  {row.disabled ? "已停用" : willApply ? "待生效" : "已启用"}
                </span>
                <button
                  className="secondary-setting"
                  disabled={busy === row.id}
                  onClick={() => void toggle(row)}
                  title={row.disabled ? "启用后重启生效" : "停用后重启生效（文件与配置都不动）"}
                >
                  <Power size={13} />{row.disabled ? "启用" : "停用"}
                </button>
              </div>
            );
          })}
        </div>

        <button className="secondary-setting" style={{ marginTop: 10 }} onClick={() => void load()}>
          <RefreshCw size={13} />刷新
        </button>
      </div>
    </div>
  );
}

// 注册为插槽（模块被 import 时即生效；HMR 下重复注册是覆盖，不报错）。
registerSlot("settings.devtools.bottom", {
  label: "功能域清单与启停",
  pluginId: "domains",
  order: 900,
  render: (props) => <DomainsPanel {...(props as { onNotice: (m: string) => void })} />,
}, "domains");

// ⛔ 同一个面板**注册两个插槽**（10-04 补齐渲染层扩展面时加的侧栏入口）：
//   settings.devtools.bottom —— 设置页里的完整面板
//   sidebar.top             —— 侧栏顶部的入口按钮（点开切到设置页的功能域页）
//   为什么入口按钮要独立组件而不是复用面板：面板是长列表，挂在侧栏会把会话列表挤扁。
registerSlot("sidebar.top", {
  label: "功能域状态",
  pluginId: "domains",
  order: 800,
  render: (props) => <SidebarEntry {...(props as { onOpenSettings?: (page: string) => void })} />,
}, "domains");

/** 侧栏入口：只显示「有被停用的域」时的提醒，正常状态不占空间（返回 null）。 */
function SidebarEntry({ onOpenSettings }: { onOpenSettings?: (page: string) => void }) {
  const [off, setOff] = useState<string[] | null>(null);
  useEffect(() => {
    void window.codex.domainsList().then((r: any) => {
      const disabled = (r?.domains ?? []).filter((d: any) => d.disabled && !d.essential).map((d: any) => d.id);
      setOff(disabled);
    }).catch(() => setOff([]));
  }, []);
  // 一条都没停 ⇒ 什么都不渲染（不占侧栏空间）
  if (!off || off.length === 0) return null;
  return (
    <button
      className="secondary-setting domains-sidebar-entry"
      title={"有 "+off.length+" 个功能域已停用，重启后生效："+off.join("、")}
      onClick={() => onOpenSettings?.("devtools")}
    >
      <Power size={13} />{off.length} 个域已停用
    </button>
  );
}

export default DomainsPanel;
