/**
 * builtin-skills 的「skill-desktop」部分（09-22 从同目录 builtin-skills.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
export const DESKTOP_SKILL = `---
name: desktop-automation
description: 用 nuphus-mcp 的 desktop_* 工具操控本机桌面：截屏、列窗口、激活窗口、定位界面元素、鼠标点击、键盘输入。当任务需要操作真实屏幕、窗口或原生应用时使用。
---

# 桌面自动化

本机已内置 Nuphus 桌面自动化 MCP（服务器名 \`nuphus\`），工具已直接注册在你的工具列表中（\`desktop_*\` 前缀），**直接调用即可，无需写脚本**。

## 判存在（必做的第一步）

**工具列表里有 \`desktop_windows_list\` 才走本技能**。没有就是「桌面自动化当前不可用」，最常见的原因是用户在
「设置 → 自动化」里关掉了桌面总闸 —— 这时那一组工具是**被硬摘除**的（不是坏掉）。
- ⛔ 不要硬着头皮调 \`desktop_*\`；
- ⛔ 也**不要**改用 \`nuphus-call\` 命令行去绕总闸（那等于绕过用户的开关；总闸关闭时该说明已被下发为禁止项）；
- ✅ 直接告诉用户「桌面自动化当前关闭，需要的话去『设置 → 自动化』打开」。

同理，**工具列表里没有 \`browser_*\` 时**不要假设浏览器能力可用（浏览器侧另有 \`playwright-cli\` 兜底通道，见 browser-skill）。

## 0. 三段循环：先看 → 再做 → 再验

| 段 | 工具 | 要点 |
|---|---|---|
| 观察 | \`desktop_windows_list\` → \`desktop_window_activate\` → \`desktop_screenshot\` / \`desktop_perceive\` | 先拿 hwnd 再激活；**不激活，键鼠会打到别的窗口** |
| 动作 | \`desktop_mouse\` / \`desktop_input\` / \`desktop_mouse_drag\` | 写操作必须带 \`confirm=true\` |
| 验证 | 动作后**再截屏确认结果** | 不要假定成功 |

## 1. 定位元素：\`desktop_perceive\` 优先，别用 \`desktop_vision\` 的坐标

- **\`desktop_perceive\`** —— 本地 OCR + 可选 YOLO，**在本机跑、零 API 成本**，返回精确元素坐标。**要点击，就用它拿坐标。**
- **\`desktop_vision\`** —— 调视觉模型（BYOK）描述画面。它的工具描述里明确写着 *"Coords imprecise — never click with them"* ⇒ **绝不能拿它给的坐标去点**，只用来「看懂画面 / 读文字」。

⚠️ **Intel Mac 上本地 OCR 不可用**（上游 ONNX Runtime 已放弃 osx-x64，非本应用问题）：
\`desktop_perceive\` 会失败。这**不是故障**、不要上报为 bug —— 改用 \`desktop_vision\`（需先配视觉模型），或截图后请用户确认坐标。

## 2. 常用工具

| 工具 | 用途 | 关键参数 |
|---|---|---|
| \`desktop_windows_list\` | 列出所有可见窗口（拿 hwnd） | 无 |
| \`desktop_window_activate\` | 目标窗口置前（**操作前必做**） | hwnd |
| \`desktop_window_info\` | 窗口详情（标题/可见性/状态/矩形/进程/类名） | hwnd |
| \`desktop_screenshot\` | 截全屏或区域 | region:{x,y,width,height}（可选） |
| \`desktop_window_screenshot\` | 按 hwnd 或标题截单个窗口 | hwnd 或 title |
| \`desktop_perceive\` | 本地 OCR 定位界面元素 → 精确坐标（见第 1 节） | 无 |
| \`desktop_mouse\` | 点击/双击/悬停/滚动/移动 | action, x, y, confirm=true |
| \`desktop_mouse_drag\` | 拖拽 | 起点与终点坐标, confirm=true |
| \`desktop_input\` | 输入文本或按组合键 | mode=type/hotkey, hwnd, text/keys, confirm=true |
| \`desktop_clipboard_write\` | 长文本（>500 字）写剪贴板 | 配合 Ctrl+V 粘贴 |
| \`desktop_clipboard_clean\` | 清空剪贴板 | 会丢用户原有剪贴板内容 |
| \`desktop_screen_size\` | 屏幕分辨率 | 无 |

## 3. 硬约束

- **不可逆动作先问用户**：发送、支付、删除、发布、覆盖保存 —— 先说清你要点什么、然后等确认。
- **别赖在用户的键鼠上**：只在任务确实需要时激活窗口操作，做完把焦点还回去。
- **大段文本走剪贴板**：\`desktop_clipboard_write\` + 粘贴快捷键比逐字输入快且稳（中文尤其可靠）。
  ⛔ 按键**按平台写**：Windows 是 \`Ctrl+V\`，macOS 是 \`Cmd+V\` —— 别写死一个平台（写错就是「粘贴没反应」）。
- **UAC / 提权窗口无法自动化**（系统安全边界）：遇到就停下，让用户自己点。
- **窗口动过就要重新定位**：移动/改尺寸后坐标全部失效，重新截屏或 \`desktop_perceive\`。
`;
