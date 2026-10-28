/**
 * 快捷键面板（10-28）。
 *
 * 用户原话：「面板里表情下方新增一个快捷键图标，点击后打开弹窗，集中展示应用内所有快捷键。
 * 弹窗顶部布局依次为：搜索框、筛选分类、批量编辑、保存按钮，下方列出所有应用快捷键列表。
 * 支持在弹窗内修改快捷键并保存，且需与设置界面中的快捷键配置保持双向联动」
 * +「还有截图快捷键，那个单独的一个设置界面，别漏了，也要保存联动性」。
 *
 * 与设置页的关系：设置 → 控制台 →「键盘快捷键」按钮打开的就是**同一个组件**
 * （`bag.setShortcutsOpen(true)`）——两处只有一个实现，所以不存在"两边不一致"。
 *
 * ⛔ 保存必须**分流**写：
 *   · 应用内键（owner=renderer）→ `shortcuts:save`（落 userData/shortcuts.json，渲染层分发器读它）；
 *   · 截图 / 语音键 → 各自的既有通道（它们要先注册成功 globalShortcut 再落盘，
 *     复制一份注册逻辑必然漂移）；
 *   · 因此「设置·截图」里改完，本弹窗下一次打开读到的就是新值（主进程聚合读取），反之亦然。
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, Save, Search, X } from "lucide-react";
import { AppSelect } from "../../components/AppSelect";
import { SHORTCUT_CATALOG, SHORTCUT_GROUPS, bindingLabel, findConflicts, normalizeBinding } from "../../lib/shortcut-catalog.mjs";
import { useShortcuts, type ShortcutBindings } from "./use-shortcuts";

type Entry = (typeof SHORTCUT_CATALOG)[number];

/** 键盘事件 → `Ctrl+Shift+F` 形态（交给 normalizeBinding 收口）。 */
function keyToBinding(event: KeyboardEvent): string {
  if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return "";
  const mods: string[] = [];
  /* mac 的 ⌘ 与 win 的 Ctrl 在数据里都记作 Ctrl（见 catalog 文件头） */
  if (event.ctrlKey || event.metaKey) mods.push("Ctrl");
  if (event.shiftKey) mods.push("Shift");
  if (event.altKey) mods.push("Alt");
  let key = event.key;
  if (key === " " || key === "Spacebar") key = "Space";
  return [...mods, key].join("+");
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { bindings, refresh } = useShortcuts();
  const [draft, setDraft] = useState<ShortcutBindings>(() => ({ ...bindings }));
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  /** 10-29 用户：「快捷键也要支持单独修改，小文字赘述不用」⇒ 去掉「批量编辑」前置开关，
      每条可编辑项**本身就是录制按钮**（点哪条改哪条），说明小字与底部说明一并删掉。 */
  const [recording, setRecording] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  /* 打开时把真实值灌进草稿：上次没保存的改动不跨次残留 */
  useEffect(() => {
    if (!open) { setRecording(null); setMessage(""); setError(""); return; }
    setDraft({ ...bindings });
  }, [open, bindings]);

  /* 录制：capture 阶段吃掉按键，避免 "Ctrl+B" 在录制时顺手把右栏关了 */
  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") { setRecording(null); return; }
      const next = normalizeBinding(keyToBinding(event));
      if (!next) return;                    // 只按了修饰键：继续等主键
      setDraft((current) => ({ ...current, [recording]: [next] }));
      setRecording(null);
      setError("");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);

  /* Esc 关弹窗（录制中时上面那个监听已经吃掉了，不会连关两层） */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || recording) return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, recording, onClose]);

  const conflicts = useMemo(() => findConflicts({ ...bindings, ...draft }) as string[][], [bindings, draft]);
  const conflictIds = useMemo(() => new Set(conflicts.flat()), [conflicts]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return SHORTCUT_CATALOG.filter((entry) => {
      if (group !== "all" && entry.group !== group) return false;
      if (!keyword) return true;
      const haystack = [entry.label, entry.desc, entry.id, ...(draft[entry.id] ?? [])].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [query, group, draft]);

  const dirty = useMemo(() => {
    const ids = new Set([...Object.keys(bindings), ...Object.keys(draft)]);
    for (const id of ids) {
      const a = (bindings[id] ?? []).join("|");
      const b = (draft[id] ?? []).join("|");
      if (a !== b) return true;
    }
    return false;
  }, [bindings, draft]);

  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    const rendererPatch: ShortcutBindings = {};
    for (const entry of SHORTCUT_CATALOG) {
      if (entry.owner !== "renderer" || !entry.editable) continue;
      rendererPatch[entry.id] = draft[entry.id] ?? [];
    }
    try {
      const result = await window.codex.shortcutsSave?.({ bindings: rendererPatch });
      if (result && result.ok === false) throw new Error(result.error || "保存失败");

      /* 截图 / 语音：只有真的改了才写（它们的 setter 会重注册系统级快捷键，别每次保存都重注册） */
      const shotChanges: Array<["full" | "region", string]> = [];
      for (const [id, mode] of [["shot-full", "full"], ["shot-region", "region"]] as const) {
        const next = (draft[id] ?? [])[0] ?? "";
        if (next && next !== (bindings[id] ?? [])[0]) shotChanges.push([mode, next]);
      }
      for (const [mode, accelerator] of shotChanges) {
        const r = await window.codex.screenshotHotkeySet?.({ mode, accelerator, enabled: true });
        if (r && r.ok === false) throw new Error(r.error || `截图快捷键「${accelerator}」注册失败`);
      }
      const nextVoice = (draft["voice-hotkey"] ?? [])[0] ?? "";
      if (nextVoice && nextVoice !== (bindings["voice-hotkey"] ?? [])[0]) {
        const r = await window.codex.voiceHotkeySet?.({ accelerator: nextVoice, enabled: true });
        if (r && r.ok === false) throw new Error(r.error || `语音快捷键「${nextVoice}」注册失败`);
      }

      await refresh();
      setMessage(shotChanges.length || nextVoice !== (bindings["voice-hotkey"] ?? [])[0] ? "已保存并生效" : "已保存");
    } catch (saveError: unknown) {
      setError(String((saveError as Error)?.message ?? saveError));
    } finally {
      setSaving(false);
    }
  }

  async function resetAll() {
    setSaving(true);
    setError("");
    try {
      const result = await window.codex.shortcutsReset?.();
      if (result?.bindings) setDraft({ ...result.bindings });
      await refresh();
      setMessage("已恢复默认快捷键（截图 / 语音请到各自设置页重置）");
    } catch (resetError: unknown) {
      setError(String((resetError as Error)?.message ?? resetError));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const groupOptions = [{ value: "all", label: `全部分类（${SHORTCUT_CATALOG.length}）` },
    ...SHORTCUT_GROUPS.map((item) => ({ value: item.id, label: `${item.label}（${SHORTCUT_CATALOG.filter((e) => e.group === item.id).length}）` }))];

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="shortcuts-modal shortcuts-modal-lg" role="dialog" aria-modal="true" aria-label="键盘快捷键">
        <header>
          <div><strong>键盘快捷键</strong><span className="esc-hint" title="按 ESC 关闭">ESC</span></div>
          <button type="button" className="icon-button" title="关闭" aria-label="关闭" onClick={onClose}><X size={17} /></button>
        </header>

        {/* 顶部顺序：搜索框 → 筛选分类 → 保存（10-29 去掉「批量编辑」：每条直接点着改） */}
        <div className="shortcuts-toolbar">
          <label className="shortcuts-search">
            <Search size={13} />
            <input value={query} placeholder="搜索快捷键或动作" aria-label="搜索快捷键" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <AppSelect className="shortcuts-group-select" value={group} onChange={setGroup} ariaLabel="按分类筛选" options={groupOptions} />
          <button type="button" className="shortcuts-save" disabled={saving || !dirty} onClick={save}>
            <Save size={13} /><span>{saving ? "保存中…" : "保存"}</span>
          </button>
        </div>

        {(message || error) && <p className={`shortcuts-note${error ? " is-error" : ""}`}>{error || message}</p>}
        {conflicts.length > 0 && (
          <p className="shortcuts-note is-error">
            {conflicts.length} 处快捷键冲突：
            {conflicts.slice(0, 3).map(([a, b]) => {
              const label = (id: string) => SHORTCUT_CATALOG.find((entry) => entry.id === id)?.label ?? id;
              return `「${label(a)}」与「${label(b)}」`;
            }).join("、")}
            {conflicts.length > 3 ? " 等" : ""}
          </p>
        )}

        <div className="shortcuts-body">
          {SHORTCUT_GROUPS.map((section) => {
            const rows: Entry[] = visible.filter((entry) => entry.group === section.id);
            if (!rows.length) return null;
            return (
              <section className="shortcuts-group" key={section.id}>
                <h3>{section.label}</h3>
                {rows.map((entry) => {
                  const keys = draft[entry.id] ?? [];
                  const isRecording = recording === entry.id;
                  const hot = conflictIds.has(entry.id);
                  return (
                    <div className={`shortcuts-row${hot ? " is-conflict" : ""}`} key={entry.id}>
                      <span className="shortcut-desc">{entry.label}</span>
                      <span className="shortcut-keys">
                        {entry.editable ? (
                          <button
                            type="button"
                            className={`shortcut-record${isRecording ? " is-recording" : ""}`}
                            onClick={() => { setRecording(entry.id); setError(""); }}
                            title="点击后按下新组合键（Esc 取消）"
                          >
                            {isRecording ? "按下新组合键…" : bindingLabel(keys, false)}
                          </button>
                        ) : (
                          keys.length
                            ? keys.map((binding, index) => <kbd key={index}>{binding}</kbd>)
                            : <kbd className="is-empty">未设置</kbd>
                        )}
                      </span>
                    </div>
                  );
                })}
              </section>
            );
          })}
          {!visible.length && <p className="shortcuts-empty">没有匹配的快捷键</p>}
        </div>

        <footer>
          <button type="button" className="shortcuts-reset" onClick={resetAll} disabled={saving}>
            <RotateCcw size={12} /><span>恢复默认</span>
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
