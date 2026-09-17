/** 运行平台（渲染层没有 node 的 process.platform；优先 userAgentData，回落 navigator.platform）。 */
function isMacRuntime(): boolean {
  if (typeof navigator === "undefined") return false;
  const anyNav = navigator as any;
  const fromUaData = anyNav.userAgentData?.platform;
  if (fromUaData) return String(fromUaData).toLowerCase().includes("mac");
  return String(anyNav.platform ?? "").toLowerCase().includes("mac");
}

/** 把 KeyboardEvent 规范成与 Electron accelerator 一致的组合，用于「按住听写」快捷键。 */
export function matchesVoiceAccelerator(event: KeyboardEvent, accelerator: string): boolean {
  const parts = String(accelerator || "").split("+").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return false;
  // ⛔ mac 适配（09-17 审计）：Electron 的 CommandOrControl 在 macOS 上代表 ⌘（metaKey），
  //    Windows/Linux 上才是 Ctrl。旧实现把它一律折成 ctrlKey ⇒ 默认键改成
  //    "CommandOrControl+Shift+M" 后，mac 上按 ⌘⇧M 永远匹配不上（识别不了、像"快捷键没反应"）。
  const mac = isMacRuntime();
  const cmdOrCtrl = parts.includes("cmdorctrl");
  const needsCtrl = cmdOrCtrl ? !mac : parts.some((x) => x === "ctrl" || x === "control");
  const needsShift = parts.includes("shift");
  const needsAlt = parts.some((x) => x === "alt" || x === "option");
  const needsMeta = (cmdOrCtrl && mac)
    || parts.some((x) => x === "super" || x === "meta" || x === "cmd" || x === "win");
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
