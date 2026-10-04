/**
 * 声明式插件的渲染层消费（10-04 B 档）。
 *
 * ⛔ 本模块是**唯一**把「外部 JSON 清单」变成界面的地方。三个设计要点：
 *
 * ① **清单是外部输入** ⇒ 渲染层也必须自己兜底，不能只信主进程校验过。
 *    通道名会经 preload 动态取值（`window.codex[camel]`），所以这里用
 *    `CHANNEL_RE` 收紧成 `域:动作` 形状 —— 主进程也校验，但渲染层是最后一道闸。
 *
 * ② **插槽注册是运行时的**（registerSlot 即时生效 + useSyncExternalStore 刷新），
 *    所以清单变化后 UI 立刻反映、无需重启 —— 这是声明式插件相对功能域的关键差别。
 *
 * ③ **text 一律按纯文本渲染**（React 插值，**不用 dangerouslySetInnerHTML**）——
 *    清单里的字符串永远不会被当 HTML/JS 执行。这条是"这套方案不含代码"的安全前提。
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { registerSlot, slotVersion, subscribeSlots } from "./registry";
import type { DeclaredPlugin } from "../../electron/declared-plugin-types";

/** 通道名必须是 `域:动作` 形状 —— 它会被用来动态取 preload 上的方法。 */
const CHANNEL_RE = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

/** `voice:models-status` → `voiceModelsStatus`（与 preload 的 camel 规则一致）。 */
function bridgeName(channel: string): string {
  const [prefix, action] = channel.split(":");
  return `${prefix}${action.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`;
}

type Loaded = {
  plugins: DeclaredPlugin[];
  issues: { file: string; id: string; reason: string }[];
  userDir: string;
  /** 已登记的插槽位（面板要显示"可挂哪些位置"，它由主进程单一真相源给出） */
  knownSlots: string[];
};

function readList(): Promise<Loaded> {
  const bridge = (window as unknown as { codex?: { declaredPluginsList?: () => Promise<Loaded> } }).codex;
  if (typeof bridge?.declaredPluginsList !== "function") {
    // 老构建没有这条通道 ⇒ 静默为空，绝不让插件面板整页崩
    return Promise.resolve({ plugins: [], issues: [], userDir: "", knownSlots: [] });
  }
  return bridge.declaredPluginsList();
}

/** 读一次清单（带刷新）。 */
export function useDeclaredPlugins(): Loaded | null {
  const [state, setState] = useState<Loaded | null>(null);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    void readList().then((r) => {
      if (alive) setState({ plugins: r?.plugins ?? [], issues: r?.issues ?? [], userDir: r?.userDir ?? "", knownSlots: r?.knownSlots ?? [] });
    });
    return () => {
      alive = false;
    };
  }, [nonce]);
  return state;
}

/** 启停某个声明式插件（改完立即刷新，插槽即时生效、无需重启）。 */
export function useToggleDeclaredPlugin() {
  return useCallback(async (id: string, enabled: boolean) => {
    const bridge = (window as unknown as {
      codex?: { declaredPluginsToggle?: (input: { id: string; enabled: boolean }) => Promise<{ ok: boolean; error?: string }> };
    }).codex;
    const r = await bridge?.declaredPluginsToggle?.({ id, enabled });
    return r ?? { ok: false, error: "通道不可用" };
  }, []);
}

/** 按钮形态：点一下调一条已有通道。 */
function InvokeButton({ label, title, channel, args }: {
  label: string;
  title: string;
  channel: string;
  args?: Record<string, unknown>;
}) {
  const onClick = useCallback(() => {
    const bridge = (window as unknown as { codex?: Record<string, unknown> }).codex;
    const fn = bridge?.[bridgeName(channel)] as ((a?: unknown) => Promise<unknown>) | undefined;
    void fn?.(args ?? {});
  }, [channel, args]);

  // ⛔ 形状不合规就**不渲染**，而不是渲染一个点了报错的按钮（外部输入不可信）
  if (!CHANNEL_RE.test(channel)) return null;
  const [, action] = channel.split(":");
  return (
    <button className="secondary-setting declared-plugin-btn" title={title || label} onClick={onClick}>
      {label || action}
    </button>
  );
}

/** 一个插槽位内的内容片段。 */
function DeclaredSlotBody({ plugin, slot }: { plugin: DeclaredPlugin; slot: string }) {
  const items = useMemo(
    () => plugin.slots.filter((s) => s.slot === slot).sort((a, b) => a.order - b.order),
    [plugin.slots, slot],
  );
  return (
    <>
      {items.map((it, i) => (
        <Fragment key={`${plugin.id}:${slot}:${i}`}>
          {it.invoke ? <InvokeButton label={it.label} title={it.title} channel={it.invoke} args={it.args} /> : null}
          {it.text ? <div className="declared-plugin-text">{it.text}</div> : null}
        </Fragment>
      ))}
    </>
  );
}

/**
 * 把当前已启用的声明式插件注册成插槽内容。
 *
 * ⛔⛔ 必须是**组件**、且在 `useEffect` 里注册 —— 不能在模块顶层调 Hook
 *   （那是 React Hook 规则错误，渲染时必炸；我第一版就是这么写的）。
 *   插槽注册是可逆的，所以 effect 的清理函数逐个退订（与 registerSlot 的返回值对齐）。
 */
export function DeclaredPluginSlots() {
  const state = useDeclaredPlugins();
  useEffect(() => {
    if (!state) return;
    const disposers: (() => void)[] = [];
    for (const plugin of state.plugins) {
      if (!plugin.enabled) continue;
      for (const slotId of new Set(plugin.slots.map((s) => s.slot))) {
        disposers.push(
          registerSlot(
            slotId,
            {
              label: plugin.name,
              pluginId: `declared:${plugin.id}`,
              order: 1000,
              render: () => <DeclaredSlotBody plugin={plugin} slot={slotId} />,
            },
            `declared:${plugin.id}`,
          ),
        );
      }
    }
    return () => {
      for (const d of disposers) d();
    };
  }, [state]);

  // 自身不产出可见内容（它只是把插槽内容注册进去）；订阅一次让启停后立即重注册
  useEffect(() => subscribeSlots(() => slotVersion()), []);
  return null;
}