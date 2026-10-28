/**
 * 快捷键数据 hook（10-28）。
 *
 * ⛔ 真相源在主进程（`shortcuts:read`）：这里**不维护第二份默认值**，
 *    首次渲染只有为了让首帧不空白才用 `defaultBindings()` 兜底，
 *    一旦读到真实值就整体替换。
 * ⛔ 订阅 `shortcuts-changed`：设置页 / 弹窗任一处置改后，另一处必须立刻跟上
 *    （用户要求「双向联动」——只写不广播 = 另一处还是旧键）。
 */
import { useCallback, useEffect, useState } from "react";
import { defaultBindings } from "../../lib/shortcut-catalog.mjs";

export type ShortcutBindings = Record<string, string[]>;
export type ShortcutConflict = [string, string];

export function useShortcuts() {
  const [bindings, setBindings] = useState<ShortcutBindings>(() => defaultBindings() as ShortcutBindings);
  const [overrides, setOverrides] = useState<ShortcutBindings>({});
  const [conflicts, setConflicts] = useState<ShortcutConflict[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await window.codex.shortcutsRead?.();
      if (result?.bindings) setBindings(result.bindings as ShortcutBindings);
      setOverrides((result?.overrides ?? {}) as ShortcutBindings);
      setConflicts((result?.conflicts ?? []) as ShortcutConflict[]);
    } catch {
      /* 读不到就继续用默认表：快捷键面板不能因为一次 IPC 失败而白屏 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const off = window.codex.onHarnessEvent?.((event) => {
      if ((event as { type?: string } | null)?.type === "shortcuts-changed") void refresh();
    });
    return () => off?.();
  }, [refresh]);

  return { bindings, overrides, conflicts, loading, refresh };
}
