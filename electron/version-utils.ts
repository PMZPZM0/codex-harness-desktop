/**
 * 版本号工具（11-21 从 `updates.ts` 拆出，更新链重写后仍被 7 个板块复用）。
 *
 * ⛔ 这里只放**纯函数**：不 import electron / node:fs，任何地方都能安全引用。
 * ⛔ 版本比较只有这一份实现（守卫钉着），别在别处手写第二份 —— 字符串比大小会把
 *    `0.0.26-b` 判成大于 `0.0.26`，历史上就是这么误报「有新版本」的。
 */

export type ParsedVersion = { major: number; minor: number; patch: number; pre: string };

/** 解析 `v1.2.3` / `1.2.3` / `0.0.26-b`；不是 semver 时返回 null。 */
export function parseVersion(input: string): ParsedVersion | null {
  const raw = String(input ?? "").trim().replace(/^v/i, "");
  const m = raw.match(/^(\d+)\.(\d+)\.(\d+)(?:[-.]([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? "" };
}

/** 语义化比较：a>b 返回 1，相等 0，a<b 返回 -1；预发布后缀小于同号正式版。 */
export function compareVersions(a: string, b: string): number {
  const A = parseVersion(a);
  const B = parseVersion(b);
  if (!A || !B) return String(a) === String(b) ? 0 : (String(a) > String(b) ? 1 : -1);
  for (const key of ["major", "minor", "patch"] as const) {
    if (A[key] !== B[key]) return A[key] > B[key] ? 1 : -1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  return A.pre > B.pre ? 1 : -1;
}
