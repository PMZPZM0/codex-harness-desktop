import test from "node:test";
import assert from "node:assert/strict";

/* P2-6（10-19 复检报告）：IPC 入口的参数前置校验测试。
 *
 * 事故：manifest 里 `paramsImpl` 是「调用方签名」（2 个参数），而 `invokeArgs` 把它们打包成
 * **一个对象**；生成器旧算法按参数个数算 minArgs ⇒ 12 条通道每次调用都被 `__ipc` 拒成
 * ERR_MISSING_ARGS（git:diff / fs:write / ssh:* / connectors:set-enabled …）。
 * 这里直接测生成器的纯函数与**真实 manifest 的生成结果**，防止同类回归。 */
const CORE = "../scripts/lib/gen-ipc-core.mjs";
const MANIFEST = "../electron/ipc-channels.manifest.json";

test("argCountOf：顶层逗号计数（跳过嵌套），单对象实参算 1 个", async () => {
  const { argCountOf } = await import(CORE);
  assert.equal(argCountOf("{ cwd, scope }"), 1);
  assert.equal(argCountOf("id, cols, rows"), 3);
  assert.equal(argCountOf("input"), 1);
  assert.equal(argCountOf(""), 0);
  assert.equal(argCountOf("{ a: [1, 2], b: { c: 3 } }"), 1, "嵌套里的逗号不算");
});

test("minArgsOf：必选参数计数（可选参数/默认值不算）", async () => {
  const { minArgsOf } = await import(CORE);
  assert.equal(minArgsOf("cwd: string, scope: string"), 2);
  assert.equal(minArgsOf("id: string, title?: string"), 1);
  assert.equal(minArgsOf("input?: { id: number }"), 0);
  assert.equal(minArgsOf("id: string, limit = 20"), 1);
});

test("生成产物：git:diff 的 minArgs 必须 ≤ 实传参数个数（单对象 = 1）", async () => {
  const { generatePreloadRegion } = await import(CORE);
  const region = generatePreloadRegion([
    { name: "gitDiff", channel: "git:diff", paramsImpl: "cwd: string, scope: string", returns: "Promise<any>", invokeArgs: "{ cwd, scope }", cast: null },
  ]);
  assert.match(region, /__ipc\("git:diff", 1, \[\{ cwd, scope \}\]\)/);
});

test("真实 manifest：**每一条**生成行都满足 minArgs ≤ 实传参数个数", async () => {
  const { generatePreloadRegion, minArgsOf, argCountOf } = await import(CORE);
  const manifest = JSON.parse((await import("node:fs")).readFileSync(new URL(MANIFEST, import.meta.url), "utf8"));
  const region = generatePreloadRegion(manifest.channels);
  const bad = [];
  for (const match of region.matchAll(/__ipc\("([^"]+)", (\d+), \[(.*?)\]\)/g)) {
    const [, channel, minArgs, args] = match;
    const declared = manifest.channels.find((entry) => entry.channel === channel);
    const allowed = Math.min(minArgsOf(declared?.paramsImpl ?? ""), argCountOf(declared?.invokeArgs ?? ""));
    if (Number(minArgs) > allowed) bad.push(`${channel}: ${minArgs} > ${allowed}`);
    if (Number(minArgs) > argCountOf(declared?.invokeArgs ?? "")) bad.push(`${channel}: ${minArgs} > 实传 ${argCountOf(declared?.invokeArgs ?? "")}`);
  }
  assert.equal(bad.length, 0, bad.slice(0, 6).join("; "));
  assert.ok(region.length > 1000, "生成段非空（断言不是恒真）");
});
