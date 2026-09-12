/** 把 KeyboardEvent 规范成与 Electron accelerator 一致的组合，用于「按住听写」快捷键。 */
export function matchesVoiceAccelerator(event: KeyboardEvent, accelerator: string): boolean {
  const parts = String(accelerator || "").split("+").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return false;
  const needsCtrl = parts.some((x) => x === "ctrl" || x === "control" || x === "cmdorctrl");
  const needsShift = parts.includes("shift");
  const needsAlt = parts.some((x) => x === "alt" || x === "option");
  const needsMeta = parts.some((x) => x === "super" || x === "meta" || x === "cmd" || x === "win");
  if (Boolean(event.ctrlKey) !== needsCtrl) return false;
  if (Boolean(event.shiftKey) !== needsShift) return false;
  if (Boolean(event.altKey) !== needsAlt) return false;
  if (Boolean(event.metaKey) !== needsMeta) return false;

  const key = parts[parts.length - 1];
  const actual = event.code.startsWith("Key") ? event.code.slice(3).toLowerCase()
    : event.code.startsWith("Digit") ? event.code.slice(5).toLowerCase()
    : event.code === "Space" ? "space"
    : event.key.toLowerCase();
  return actual === key;
}
