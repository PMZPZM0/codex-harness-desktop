/**
 * 内置技能 photocraft（11-15）：用 PhotoCraft（开源 Photoshop 重写）做专业图像后期。
 * ⛔ 与工具 `photocraft`、开发工具卡、MCP 连接器同源；工具描述只留一句，流程写在这里。
 * ⛔ 体积/版本边界、路径边界、不覆盖原图三条必须每次说清。
 */
export const PHOTOCRAFT_SKILL = `---
name: photocraft
description: 专业图像后期（PhotoCraft，storytold/photocraft，MIT/Apache-2.0）：曲线/色阶/调色/锐化/蒙版/文字图层/PSD 导出/批量处理；用 photocraft 工具（commands → run / convert / batch），或打开原生窗口让用户手工改。
---

# PhotoCraft（开源 Photoshop 重写）

## 它是什么
- 纯 Rust 写的 Photoshop 兼容编辑器（约 69 个工具、图层/蒙版/调整层/图层样式/文字/矢量、PSD/PSB 读写）。
- 引擎与命令注册表（500+ 命令）同时驱动 GUI、CLI、MCP —— 同一件事在界面和自动化里行为一致。
- 安装由 Craft 全家桶的 Launcher 负责（跟其它 App 一样），本应用只识别并接入 CLI / GUI；Windows 含 CLI + GUI，mac 版只随 CLI。

## 工具用法（\`photocraft\`）
1. \`action="status"\`：看装没装、版本、CLI/GUI、MCP 段、体积。没装就引导用户去「设置 → 开发工具 → Craft 全家桶 → PhotoCraft」。
2. \`action="commands"\` + \`filter\`：查命令 id（如 curves / levels / vibrance / unsharp / text / export）。
3. \`action="run"\`：\`path\` 输入、\`out\` 输出（⛔ 必须不同，绝不覆盖原图）、\`commands=[{id,params}]\` 按序执行，最多 20 条。
4. \`action="convert"\`：换格式（PNG/JPEG/WebP/PSD/TIFF…，可给 quality）。
5. \`action="batch"\`：\`input\` 目录 + \`outDir\` + 同一组 commands，可递归、可指定 format。
6. \`action="info"\`：读尺寸/模式/位深/图层树（判断是不是 PSD、有多少层）。
7. \`action="open"\`：用 PhotoCraft 原生窗口打开一张图，让用户手工精修。

## 典型流程
- 生成图精修：\`commands filter="curves|vibrance"\` → \`run\` 到新文件 → 用 image_view / 图片灯箱给用户看。
- 电商批量：\`batch\`（同一组调色/锐化 + 输出 webp）→ 报告输出目录。
- 交付分层：\`convert\` 成 PSD / TIFF；后续要改图层时再 \`open\` 给用户。
- 文字/水印：查 \`text.*\` 命令，用 run 加文字图层（坐标/字体/颜色由命令参数决定），输出新文件。

## 必须遵守
- ⛔ 不覆盖原图：\`out\` / \`outDir\` 必须与输入不同；原图要保留。
- ⛔ 文件必须落在会话工作目录或应用数据目录内（IPC 层会拒绝越界路径）。
- ⛔ 不要自己 shell 调 \`photocraft-cli\`：走 \`photocraft\` 工具（参数校验、超时、输出上限都在宿主侧）。
- ⛔ 未安装时不要尝试自动安装：让用户到「设置 → 开发工具 → Craft 全家桶 → PhotoCraft」用 Launcher 安装。
- MCP 连接器 \`photocraft\` 在安装后会写进 config.toml（roots 限 \`userData/photocraft-io\`），但引擎可能延迟暴露 MCP 工具 ⇒ 主路径永远是本工具。

## 什么时候用
- 用户说「这张图调一下色 / 加曲线 / 局部提亮 / 锐化 / 去灰 / 转 PSD / 批量处理」。
- 生成了图片、用户要求「再精修 / 更像摄影 / 统一色调」。
- 用户要在 PhotoCraft 里自己改：用 \`open\` 打开窗口，别在对话里模拟。

## 什么时候别用
- 只要基础裁剪/缩放/转格式且 PhotoCraft 没装：先用现有 image_edit / filee_convert，别为一张小图让用户去装整套 Launcher App。
- 用户要的是生成新图（文生图/改图），不是后期：走 image_generate / image_edit。
`;
