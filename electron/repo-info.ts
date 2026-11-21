/**
 * 仓库与发布通道常量（11-21 从 `updates.ts` 拆出）。
 *
 * ⛔ 品牌面：本仓 = `PMZPZM0/codex-harness-desktop`；⛔ PPcode 同步时这一行必须保持
 *   `PMZPZM0/PPcode`（两仓 Release 互不复用资产）。
 * ⛔ 只写常量，不写逻辑 —— 需要行为的放 `update-service.ts`。
 */

/** 本仓 GitHub 仓库（发布源唯一真相）。 */
export const GITHUB_REPO = "PMZPZM0/codex-harness-desktop";

/** Release 目录（不含版本号）。 */
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

/** 发布侧由 electron-builder 生成的更新元数据；不带版本号，永远指向最新一版。 */
export const RELEASE_FEED_URL = `${GITHUB_RELEASES_URL}/latest/download/latest.yml`;

/** 桌面版 tag 前缀（`v0.0.73`）。 */
export const DESKTOP_TAG_PREFIX = "v";

/** 更新通道（固定 stable；保留字段是为了状态对象里能如实回显）。 */
export const UPDATE_CHANNEL = "stable";
