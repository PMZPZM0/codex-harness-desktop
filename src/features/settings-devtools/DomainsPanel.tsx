/**
 * 功能域清单（10-04 阶段 6）—— 挂在「设置 → 开发工具」底部的宿主域启停面板。
 *
 * ⛔ **它是一个普通插槽消费者**，不是设置页的一部分：devtools 页本身零改动
 *   （靠 `src/runtime/registry.ts` 的插槽机制挂进来）。
 *
 * ── 三态呈现（必须分清，用户最容易误解）────────────────────────────────────
 *   启用   = mounted && !disabled
 *   已停用 = disabled（⚠️ 本次运行里通道**仍在**，要重启才真的不再挂载）
 *   待生效 = 用户刚改的设置与当前运行不一致（disabled ≠ !mounted）
 *
 * ⛔ 为什么把"待生效"单独标出来：停用是**下次启动**生效。如果 UI 只显示"已停用"，
 *   用户会以为功能已经没了、结果发现还能用 ⇒ 那是"界面在说谎"。
 *
 * 10-31 用户：「功能域这个分类卡片展示」⇒ 从单列行改成「分类 + 卡片网格」：
 *   顶部搜索、分类胶囊；每个分类下是功能域卡片（状态点 / 徽标 / 启停按钮）。
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Power, RefreshCw, Search } from "lucide-react";
import { registerSlot } from "../../runtime/registry";
import { refreshWithReceipt } from "../../lib/refresh-receipt.mjs";

type DomainRow = { id: string; mounted: boolean; disabled: boolean; essential: boolean };
type ListResp = { domains: DomainRow[]; essentialDomains: string[]; requiresRestart: boolean };

/** 功能域分类：按 id 关键字归类，未知的进「其他」。
 *  ⛔ 只影响展示分组，不影响启停语义（真相源仍是主进程 domainsList）。 */
const DOMAIN_GROUPS: { id: string; title: string; desc: string; match: (id: string) => boolean }[] = [
  { id: "account", title: "账号与模型", desc: "供应商、云账号、订阅与额度", match: (id) => /model|cloud|openai|relay|provider|auth|account|login|quota|billing/i.test(id) },
  { id: "chat", title: "会话与消息", desc: "会话、消息流、队列、历史与归档", match: (id) => /chat|thread|session|message|queue|history|archive|favorite|task|timeline|goal|compact/i.test(id) },
  { id: "ability", title: "能力与内容", desc: "技能、插件、MCP、创作与宠物", match: (id) => /skill|plugin|mcp|tool|component|uiverse|image|video|voice|music|pet|screenshot|knowledge|memory|prompt|persona|soul/i.test(id) },
  { id: "agent", title: "智能体与调度", desc: "专家、专家团、中枢与委派", match: (id) => /agent|team|boss|delegate|dispatch|expert|subagent/i.test(id) },
  { id: "auto", title: "自动化", desc: "定时任务、钩子与工作流", match: (id) => /schedule|cron|automation|hook|workflow|rpa/i.test(id) },
  { id: "remote", title: "远程与设备", desc: "手机远控、SSH 与桌面自动化", match: (id) => /remote|phone|android|adb|ssh|desktop|uia/i.test(id) },
  { id: "data", title: "数据与存储", desc: "数据目录、备份、日志与导入导出", match: (id) => /data|storage|backup|export|import|log|rollout|sqlite|file/i.test(id) },
  { id: "dev", title: "开发与系统", desc: "开发工具、拓展接口、外观与更新", match: (id) => /dev|extensib|theme|window|update|runtime|ipc|domains|config|settings|tray|shortcut/i.test(id) },
  { id: "other", title: "其他", desc: "未归类的功能域", match: () => true },
];

let cachedRows: DomainRow[] | null = null;

function DomainsPanel({ onNotice }: { onNotice: (m: string) => void }) {
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string>("all");

  const load = useCallback(async () => {
    try {
      setData(await window.codex.domainsList());
    } catch (e: any) {
      onNotice(`读取功能域清单失败：${e?.message ?? e}`);
      return String(e?.message ?? e);
    }
  }, [onNotice]);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (row: DomainRow) => {
    setBusy(row.id);
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
  const essentialCount = data.domains.length - rows.length;
  const keyword = query.trim().toLowerCase();
  const visible = rows.filter((row) => !keyword || row.id.toLowerCase().includes(keyword));
  /* ⛔ 每个域只归**第一个**命中的分类；否则「其他」的 match 恒真会把全部再算一遍（截图里「其他 97」就是这么来的）。 */
  const groupOf = (id: string) => DOMAIN_GROUPS.find((group) => group.match(id))?.id ?? "other";
  const grouped = DOMAIN_GROUPS
    .map((group) => ({ ...group, rows: visible.filter((row) => groupOf(row.id) === group.id) }))
    .filter((group) => group.rows.length > 0);

  return (
    <div className="settings-card domains-card-shell" style={{ marginTop: 12 }}>
      <header className="settings-card-head domains-head">
        <div>
          <strong>功能域</strong>
          <span className="settings-card-sub">
            宿主自身的 {data.domains.length} 个功能域（{rows.length} 个可停用，{essentialCount} 个是应用自身能力不可停用）
          </span>
        </div>
        <label className="domains-search">
          <Search size={13} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索功能域…" aria-label="搜索功能域" />
        </label>
      </header>

      <div className="settings-card-body">
        <div className="voice-resource-note" style={{ marginTop: 0, marginBottom: 10 }}>
          <AlertTriangle size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          停用是「<strong>下次启动</strong>生效」，不是立刻卸载：域的通道是那个功能唯一的调用入口，
          运行时卸载不安全（很多域的内部状态没法安全交还）。停用后请重启应用。
        </div>

        <div className="domains-cats">
          <button type="button" className={"domains-cat" + (cat === "all" ? " active" : "")} onClick={() => setCat("all")}>
            全部<em>{rows.length}</em>
          </button>
          {DOMAIN_GROUPS.map((group) => {
            const count = rows.filter((row) => groupOf(row.id) === group.id).length;
            if (!count) return null;
            return (
              <button key={group.id} type="button" className={"domains-cat" + (cat === group.id ? " active" : "")}
                onClick={() => setCat(cat === group.id ? "all" : group.id)}>
                {group.title}<em>{count}</em>
              </button>
            );
          })}
        </div>

        {grouped.length === 0 ? (
          <p className="settings-card-hint" style={{ margin: "8px 2px" }}>没有匹配的功能域。</p>
        ) : grouped
          .filter((group) => cat === "all" || group.id === cat)
          .map((group) => (
            <section key={group.id} className="domains-section">
              <div className="domains-section-head">
                <b>{group.title}</b>
                <small>{group.desc}</small>
              </div>
              <div className="domains-grid">
                {group.rows.map((row) => {
                  const willApply = pending.has(row.id);
                  return (
                    <article key={row.id} className={"domains-tile" + (row.disabled ? " off" : "")}>
                      <div className="domains-tile-top">
                        <code className="domains-id">{row.id}</code>
                        <span className={"domains-dot" + (row.disabled ? " off" : "")} aria-hidden="true" />
                      </div>
                      <div className="domains-tile-meta">
                        <span className={`voice-devtools-badge ${row.disabled ? "warn" : "ok"}`}>
                          {row.disabled ? "已停用" : willApply ? "待生效" : "已启用"}
                        </span>
                        <button
                          className="secondary-setting domains-toggle"
                          disabled={busy === row.id}
                          onClick={() => void toggle(row)}
                          title={row.disabled ? "启用后重启生效" : "停用后重启生效（文件与配置都不动）"}
                        >
                          <Power size={13} />{row.disabled ? "启用" : "停用"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}

        <button className="secondary-setting" style={{ marginTop: 10 }} onClick={() => void refreshWithReceipt(onNotice, "刷新功能域清单", () => load())}>
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

// ⛔ 同一个面板**注册两个插槽**（10-04 补齐渲染层扩展面时加的侧栏入口）。
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
  if (!off || off.length === 0) return null;
  return (
    <button
      className="secondary-setting domains-sidebar-entry"
      title={"有 " + off.length + " 个功能域已停用，重启后生效：" + off.join("、")}
      onClick={() => onOpenSettings?.("devtools")}
    >
      <Power size={13} />{off.length} 个域已停用
    </button>
  );
}

export default DomainsPanel;
