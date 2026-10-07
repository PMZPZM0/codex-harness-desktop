/**
 * 声明式插件的管理面板（10-04 B 档）。
 *
 * 挂在设置 → 开发工具 → 底部的插槽（零侵入：不改 settings-registry 的结构）。
 *
 * ⛔ 面板存在的理由：**这套方案的安全边界靠"看得见"维持**。
 *   用户往目录里放了 JSON，界面必须告诉他「装了几个、哪些被跳过、为什么跳过、
 *   每个占了哪个插槽」—— 否则就回到了 dsh 生态最常见的抱怨：装了没反应，不知道装哪了。
 */
import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Power, RefreshCw } from "lucide-react";
import { registerSlot } from "../../runtime/registry";
import { useDeclaredPlugins, useToggleDeclaredPlugin } from "../../runtime/declared-plugin-slots";

export default function DeclaredPluginsPanel() {
  const state = useDeclaredPlugins();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [, forceReload] = useState(0);

  const toggle = useToggleDeclaredPlugin();

  // 目录变化（用户刚放了 JSON 进来）⇒ 给一个显式刷新按钮。
  // ⛔ 不做自动轮询：那是无谓的常驻开销，且这个面板本来就只在设置页里打开。
  const refresh = useCallback(() => {
    forceReload((n) => n + 1);
    setNotice("");
  }, []);

  const onToggle = useCallback(
    async (id: string, enabled: boolean) => {
      setBusy(id);
      const r = await toggle(id, enabled);
      setBusy(null);
      setNotice(r.ok ? (enabled ? "已启用，界面已刷新" : "已停用，界面已刷新") : `操作失败：${r.error ?? "未知原因"}`);
      forceReload((n) => n + 1);
    },
    [toggle],
  );

  const openDirs = useCallback(async () => {
    const bridge = (window as unknown as { codex?: { declaredPluginsOpenDirs?: () => Promise<{ ok: boolean; error?: string }> } }).codex;
    const r = await bridge?.declaredPluginsOpenDirs?.();
    setNotice(r?.ok ? "已打开插件目录（放一份 JSON 进里面，再点刷新）" : `打不开：${r?.error ?? "通道不可用"}`);
  }, []);

  // 首次进来读一次
  useEffect(() => {
    forceReload((n) => n + 1);
  }, []);

  if (!state) return <div className="declared-plugins-empty">读取插件清单…</div>;

  const enabled = state.plugins.filter((p) => p.enabled);

  return (
    <section className="declared-plugins">
      <header className="declared-plugins-head">
        <div>
          <strong>声明式插件</strong>
          <p className="declared-plugins-hint">
            插件是一份 JSON，只描述「往哪个插槽挂什么内容、调哪条已有通道」——<strong>不含任何代码</strong>。
            放好 JSON 后点刷新，界面立刻生效（无需重启）。
          </p>
        </div>
        <div className="declared-plugins-actions">
          <button className="secondary-setting" onClick={refresh} title="重新读取两个目录">
            <RefreshCw size={13} />刷新
          </button>
          <button className="secondary-setting" onClick={openDirs} title="打开用户插件目录">
            <FolderOpen size={13} />打开目录
          </button>
        </div>
      </header>

      <div className="declared-plugins-path" title="用户目录（可放自己的 JSON）">
        <code>{state.userDir || "—"}</code>
      </div>

      {state.issues.length > 0 && (
        <div className="declared-plugins-issues">
          <strong>跳过 {state.issues.length} 个无效清单</strong>
          {state.issues.map((it, i) => (
            <div key={`${it.file}:${i}`} className="declared-plugins-issue">
              <code>{it.id}</code> —— {it.reason}
            </div>
          ))}
        </div>
      )}

      {state.plugins.length === 0 ? (
        <div className="declared-plugins-empty">
          还没有插件。往上面的目录放一份 <code>harness-*.json</code> 再点刷新。
        </div>
      ) : (
        <div className="declared-plugins-list">
          {state.plugins.map((p) => (
            <div key={p.id} className={`declared-plugin-row ${p.enabled ? "" : "off"}`}>
              <div className="declared-plugin-main">
                <div className="declared-plugin-title">
                  <strong>{p.name}</strong>
                  <span className="declared-plugin-tag">{p.source === "user" ? "本地" : "内置"}</span>
                  <span className="declared-plugin-version">v{p.version}</span>
                </div>
                {p.description && <div className="declared-plugin-desc">{p.description}</div>}
                <div className="declared-plugin-slots">
                  占位：
                  {p.slots.map((s) => (
                    <code key={s.slot} className="declared-plugin-slot">
                      {s.slot}
                      {s.invoke ? ` → ${s.invoke}` : s.text ? " → 文本" : ""}
                    </code>
                  ))}
                </div>
              </div>
              <button
                className="secondary-setting declared-plugin-toggle"
                disabled={busy === p.id}
                onClick={() => void onToggle(p.id, !p.enabled)}
              >
                <Power size={13} />{p.enabled ? "停用" : "启用"}
              </button>
            </div>
          ))}
        </div>
      )}

      {notice && <div className="declared-plugins-notice">{notice}</div>}
      <div className="declared-plugins-count">
        已启用 {enabled.length} / 共 {state.plugins.length} 个；已登记插槽位 {state.knownSlots?.length ?? 0} 个。
      </div>
    </section>
  );
}

/* ⛔⛔ 必须**自己注册**插槽，否则永远不显示（10-07 实测到的坑）。
 *
 * `Slot` 的 `loader` 只是「把注册方模块拉进来」这一步 —— 它**不会**把模块的 default
 * export 当成内容渲染。模块必须调 `registerSlot(id, …)`，`Slot` 才拿得到 `reg.render`。
 * 本面板此前没注册，消费点又错用了别人的 id（`settings.devtools.bottom`）⇒
 * 用户看到的是「功能域面板画两遍、声明式插件面板一次都没有」。
 *
 * ⛔ 插槽 id 用**自己的**（每个面板一个 id，别共用）：`registerSlot` 按 id 覆盖式登记，
 *   共用 id 就会有且仅有一个组件生效、另一个静默消失，而**两个 <Slot> 会把同一个组件画两遍**。
 * ⛔ order 排在 DomainsPanel(900) 之后 ⇒ 声明式插件面板在功能域面板下方（保持原视觉顺序）。 */
registerSlot("settings.devtools.declared-plugins", {
  label: "声明式插件清单与启停",
  pluginId: "declared-plugins",
  order: 910,
  render: () => <DeclaredPluginsPanel />,
}, "declared-plugins");