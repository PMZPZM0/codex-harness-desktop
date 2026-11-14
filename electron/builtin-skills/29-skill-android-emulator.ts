/**
 * 内置技能 android-emulator（11-14 立）：在本机 ApkStart 模拟器里安装 / 启动 / 验证 Android 应用。
 * ⛔ 与 dynamicTool `apkstart`、开发工具页 ApkStart 卡同源；工具描述只留一句，详细流程在这里。
 */
export const ANDROID_EMULATOR_SKILL = `---
name: android-emulator
description: 在 Windows 本机的 ApkStart 安卓模拟器里测试 APK：安装、启动、截屏、读 logcat、执行 adb 命令（点按/输入/授权/dumpsys）。讲清完整测试流程、首启运行时下载的等待口径与失败自检。
---

# Android 模拟器测试（ApkStart）

## 前提
- 用户先在「设置 → 开发工具 → ApkStart 安卓运行器」安装（约 119MB，仅 Windows 10/11 x64）。
- **首次启动**会由 ApkStart 自己下载约 1GB Android 运行时（adb / emulator / 系统镜像，来自 dl.google.com）。
- 用 \`apkstart\` 工具前先 \`action="status"\`：看 \`installed\` / \`runtimeReady\` / \`device\` / \`apps\`。

## 标准测试流程
1. **status** —— 确认已安装、运行时已备齐、当前有没有可用模拟器。
2. **install** —— 传本地 \`.apk\` 绝对路径；要装完立刻打开就传 \`launch=true\`。
   返回 \`ok=true\` 才算装上（宿主读的是 ApkStart 自己的 apps.json，不是猜的）。
3. **screenshot** —— 返回本地 PNG 路径；需要给用户看就用图像查看（\`image_view\`）打开它。
4. **logcat** —— 查崩溃：\`packageName\` 会保留 \`FATAL EXCEPTION\` / \`ANR in\` 行；也可加 \`filter\` 关键字。
5. **adb** —— 需要交互时透传命令（宿主自动补 \`-s <当前模拟器>\`）：
   - 点按：\`["shell","input","tap","540","960"]\`
   - 输入：\`["shell","input","text","hello%sworld"]\`（空格用 %s）
   - 返回键：\`["shell","input","keyevent","4"]\`
   - 授权：\`["shell","pm","grant","com.example.app","android.permission.CAMERA"]\`
   - 看当前界面：\`["shell","dumpsys","window","windows"]\`
6. **launch** —— 按包名重新打开已装应用（包名必须在 ApkStart 应用清单里）。
7. **open** —— 需要用户自己操作（登录、验证码、看安装进度）时打开 ApkStart 主界面。

## 失败自检
- \`install\` 返回 \`pending\`（或「未确认完成」）**不是成功**：多半是首启还在下运行时，或 APK 安装失败。
  先 \`status\` 看 \`runtimeReady\`；仍是 false 就告诉用户在下载 / 在 ApkStart 主界面看进度，**不要循环重试**。
- \`device=null\`：模拟器没启动。让用户 \`open\` 后装/启一个应用，或稍等再试。
- adb 报 \`unauthorized\`：在模拟器里点「允许 USB 调试」（ApkStart 一般已自动授权）。
- 应用能装但闪退：先 \`logcat\`（带 packageName）拿崩溃栈，再修代码/换 ABI；⛔ 别只说「装好了」。

## 边界
- 只支持 Windows；mac / Linux 上工具会回「仅 Windows」。
- \`adb\` 是用户本机的模拟器，不要执行破坏性命令（清用户数据、卸载系统包）除非用户明确要求。
`;
