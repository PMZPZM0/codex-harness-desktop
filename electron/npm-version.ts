/**
 * npm 组件「查最新版本」的**唯一判定层**（11-10 用户令：组件更新通道加官方源兜底）。
 *
 * ⛔ 为什么必须单独一层：npmmirror 是**缓存快照**，不是实时镜像。实测 open-computer-use
 *    1.1.4 于 11-07 发布，11-10 时 registry.npmmirror.com 的 `/latest`、`dist-tags.latest`
 *    仍是 1.1.3、`versions` 里连 1.1.4 都没有。旧实现在两条链路里都是
 *    「候选源按序试，第一个成功就 return」⇒ 镜像**成功但滞后**，官方源永远插不上话，
 *    界面恒显示「已是最新」，且点更新也只会从镜像装回旧版。
 *
 * ⛔ 本层定三条语义，两个消费方（runtime-ipc 的工具链 / engine-updater 的引擎）不得各写一份：
 *    ① **所有候选源都查**，不早退；
 *    ② 取版本号**最大**的那个（平局保留候选序靠前的源，默认镜像 ⇒ 下载快）；
 *    ③ 全部失败才报错，绝不把空版本当「已是最新」。
 *
 * ⛔ 版本比较只认 updates.ts 的 compareVersions（含预发布语义），不手写第二份。
 * ⛔ 本模块不发网络请求：probe 由调用方注入（runtime-ipc 用 fetch + AbortController、
 *    engine-updater 用 fetchText + 代理），传输差异留在各自域里。
 */
import { compareVersions } from "./updates";

export type NpmVersionHit = { version: string; registry: string };
export type NpmLatestResult = NpmVersionHit & {
  /** 每个成功返回的源与版本（供日志 / 守卫核对，不参与胜负判定之外的事） */
  checked: NpmVersionHit[];
  /** 失败源与原因；部分源失败不影响结果，但必须留痕 */
  errors: string[];
};

/** 纯函数：从多个源的响应里挑真正最新的一个。平局保留第一个（候选序即下载优先级）。 */
export function pickNewestVersion(hits: readonly NpmVersionHit[]): NpmVersionHit | null {
  let best: NpmVersionHit | null = null;
  for (const hit of hits) {
    const version = String(hit?.version ?? "").trim();
    if (!version) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { version, registry: hit.registry };
  }
  return best;
}

/**
 * 把每个候选源都查一遍，再挑最新版本。
 *
 * @param registries 候选源（调用方按 downloadSource 排好序；默认镜像在前、官方兜底）
 * @param probe 单源探测，返回该源给出的 latest 版本号；抛错 = 该源不可用
 * @param timeoutMs 单源兜底超时（transport 自己有超时时也无害，只是双保险）
 */
export async function probeNewestNpmVersion(
  registries: readonly string[],
  probe: (registry: string) => Promise<string>,
  timeoutMs = 20000,
): Promise<NpmLatestResult> {
  const checked: NpmVersionHit[] = [];
  const errors: string[] = [];
  for (const registry of registries) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const version = await Promise.race([
        probe(registry),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`请求超时（${timeoutMs}ms）`)), timeoutMs);
        }),
      ]);
      const clean = String(version ?? "").trim();
      if (!clean) { errors.push(`${registry}：响应里没有 dist-tags.latest`); continue; }
      checked.push({ version: clean, registry });
    } catch (error) {
      errors.push(`${registry}：${(error as Error)?.message ?? String(error)}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const best = pickNewestVersion(checked);
  if (!best) {
    throw new Error(`查最新版本失败（所有候选源都试过了）：${errors.join("；") || "无候选源"}`);
  }
  return { ...best, checked, errors };
}
