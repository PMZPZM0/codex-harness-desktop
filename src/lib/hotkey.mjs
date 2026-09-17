// src/lib/hotkey.mjs
//
// 快捷键**标签**的平台化转换（纯函数，跟平台探测解耦）。
//
// 为什么单独放 .mjs：tsconfig 关着 allowJs —— 渲染层 import 走同名 .d.mts 拿类型，
// 预检（纯 node）能直接 import 真实现跑行为断言。这样「mac 上会显示成什么」不必依赖
// 一台 mac 才能验证（本机就是 Windows，mac 分支永远跑不到 —— 纯函数断言是唯一确定性证据）。
// 与 src/lib/model-scope.mjs、src/lib/send-anim.mjs 是同一套做法。
//
// 由来（09-17 用户报「mac 的不使用项目地址功能用不了，没有适配」）：
//   ① 功能层：欢迎页发送路径的条件写成了裸 `!workspace`，mac 全新机器从没设过项目地址
//      → 用户明确选了「不使用项目地址」也被清掉 + 强制弹目录选择框，该选项等于无效。
//   ② 快捷键层：全局 keydown 里 `if (!event.ctrlKey || event.altKey || event.metaKey) return;`
//      —— mac 的命令键是 ⌘(metaKey)，这句把 mac 的**所有**快捷键 return 掉了（⌘O 打开工作区…）。
//   ③ 展示层：快捷键提示写死 "Ctrl+X"，mac 上应显示 ⌘。

/** 把 Windows 风格的快捷键标签转成 macOS 写法：
 *  - `Ctrl+Shift+F` → `⌘⇧F`（Apple 惯例：修饰键连写，不带 `+`）
 *  - 单独出现的 `Ctrl`（自然语言里的「Ctrl + 逗号」）也一起换
 *  - `Enter` / `Esc` / `,` 等键名不变
 *
 *  ⛔ 09-17 审计补充：语音快捷键存的是 **Electron accelerator 原文**（如 `CommandOrControl+Shift+M`），
 *  在 mac 上也得显示成 `⌘⇧M`。所以这里先吃掉 `CommandOrControl` / `CmdOrCtrl` 这类**整词**，
 *  再映射 `Command|Cmd|Super|Meta` → ⌘、`Option` → ⌥。顺序不能反：`/Ctrl\+?/` 会先匹配到
 *  `CommandOrControl+` 里的 `Ctrl+`，把整词切碎成 `CommandOr⌘`。 */
export function macHotkeyLabel(label) {
  return String(label ?? "")
    // ⛔ 修饰键替换必须**连它后面的 `+` 一起吃**：只换名字会留下「⌘+⇧M」这种半成品
    //    （accelerator 原文是 `CommandOrControl+Shift+M`）。
    .replace(/(?:CommandOrControl|CmdOrCtrl)\+?/gi, "⌘")
    .replace(/(?:Command|Cmd|Super|Meta)\+?/gi, "⌘")
    .replace(/Option\+?/gi, "⌥")
    .replace(/Ctrl\+?/g, "⌘")
    .replace(/Shift\+?/g, "⇧")
    .replace(/Alt\+?/g, "⌥");
}

/** 按平台取标签：darwin 走 mac 写法，其余原样。 */
export function hotkeyLabel(label, platform) {
  return platform === "darwin" ? macHotkeyLabel(label) : String(label ?? "");
}
