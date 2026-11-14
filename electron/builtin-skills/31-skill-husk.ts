/**
 * 内置技能 husk（11-14 立）：在 iPhone 上跑 Android APK（Husk）的完整流程。
 * ⛔ 与 dynamicTool `husk`、开发工具页 Husk 卡同源；工具描述只留一句，流程写在这里。
 * ⛔ 电脑不能替用户装进 iPhone：这一点必须在每次回答里说清楚，不许假装已安装成功。
 */
export const HUSK_SKILL = `---
name: husk
description: 在 iPhone 上运行 Android APK/游戏（Husk，Leviidev/Husk，iOS 15.5+）：电脑侧准备官方 IPA/TIPA、检测 iPhone 连接、给出 SideStore/AltStore/TrollStore 侧载步骤与兼容性边界。
---

# Husk（iPhone 跑 Android）

## 它是什么
- 开源项目 **Leviidev/Husk**（GPL-2.0-or-later），把 Android 应用/游戏跑在 **iPhone** 上：
  - **翻译层**：64 位 Android 代码直接在 iPhone 上执行（C 库/Java/GL/Vulkan/音频/输入由 Husk 补齐），不启动整台 Android，游戏通常秒开；
  - **QEMU 兜底**：翻译层跑不了的应用，用 QEMU 跑完整 LineageOS 客户机；
  - 在 Husk 里**导入 APK**，点一下全屏运行。
- 要求 **iOS 15.5+**；安装必须侧载：**SideStore / AltStore / TrollStore**。
- 部分游戏需要 **JIT**；银行类应用与部分反作弊游戏会检测运行环境而拒绝运行。
- ⛔ 这不是 macOS 上的 Mac 应用，也不是 Android 模拟器；电脑只负责准备安装包。

## 标准流程（用 \`husk\` 工具）
1. \`action="status"\`：看电脑上 \`Husk.ipa\` / \`Husk.tipa\` 是否已下载、版本、路径。
2. \`action="device"\`：看是否连着 iPhone（只检测 USB，不做安装/授权）。
3. 没下载就 \`action="download"\`（\`kind="ipa"\` 给 SideStore/AltStore，\`kind="tipa"\` 给 TrollStore，约 142MB）。
   ⛔ 只在用户明确要求时下载，别自己顺手拉 142MB。
4. \`action="guide"\`：把官方指南与 AltStore 源给用户：
   - 指南 \`https://itslevii.dev/docs/install\`
   - SideStore/AltStore 源 \`https://itslevii.dev/repo.json\`
5. 用户装好后，提醒：打开 Husk → 添加 APK → 点一下全屏运行；需要 JIT 的游戏按指南开启。
6. \`action="reveal"\`：需要用户在电脑上找到 IPA 时，定位文件。

## 必须说清的边界
- ⛔ **电脑侧不能替用户装进 iPhone**：真机侧载需要 iPhone 上确认信任 + SideStore/AltStore/TrollStore 签名安装；本应用没有、也不应该绕过这一步。
- 侧载工具本身不随本应用提供；SideStore/AltStore 需要 Apple ID（免费证书 7 天续签），TrollStore 只支持特定 iOS 版本。
- Husk 是 Alpha 项目，兼容性看上游列表；装完打不开/闪退属于上游兼容问题，不是宿主安装失败。

## 什么时候用
- 用户说「在 iPhone 上跑 Android 应用/游戏」「把 APK 装到苹果手机」「装 Husk」。
- 用户问「Husk 怎么装 / 为什么连不上 / iPhone 侧载」。
- ⛔ 用户要的是 **macOS 上跑 Android** 时不要用本技能（那是 Mac.apk / apk-runner 的范畴）。
`;
