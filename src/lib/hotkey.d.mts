// src/lib/hotkey.d.mts —— hotkey.mjs 的类型声明（tsconfig 关着 allowJs，渲染层靠这份拿类型）
export declare function macHotkeyLabel(label: string): string;
export declare function hotkeyLabel(label: string, platform: string | null | undefined): string;
/** Electron accelerator → 平台化展示文案（CommandOrControl 在 Windows 写 Ctrl、mac 显示 ⌘）。 */
export declare function acceleratorLabel(accelerator: string | null | undefined, platform: string | null | undefined): string;
