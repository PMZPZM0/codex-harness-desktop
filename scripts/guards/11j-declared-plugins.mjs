// 声明式插件示范件守卫（10-05）：内置 `electron/declared-plugins/*.json` 一律**默认停用**。
//
// 起因（用户 10-05 报「这个关于怎么又出来了」）：10-04 做「声明式插件」机制时给每个新插槽配了
// 一个**示范件**，其余 5 个都收了、唯独最早写的 `harness-welcome.json` 留成 `enabled: true`
// ⇒ 它一直挂在用户侧栏顶部（点它走 `updates:check`），用户以为是 bug。
//
// ⛔ 判据为什么是「全部默认停用」而不是「只有 welcome 停用」：
//   下一个示范件大概率会重复这个疏漏（"加了插槽 ⇒ 顺手加个 demo ⇒ 顺手 enabled:true"）。
//   要启用某个内置插件，必须是**显式改这一条**并在这里写清理由 —— 让"泄漏到用户界面"变成需要解释的动作。
// ⛔ 空集合不算通过：文件数为 0 时直接判红（否则目录被改名/搬走会静默恒真）。
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(ROOT, "electron", "declared-plugins");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log("  " + (c ? "✓" : "✗") + " 【plugins】" + m); if (!c) fails++; };

const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
ok(files.length >= 5, `内置声明式插件目录有内容（实得 ${files.length} 个 json）—— 否则下面的断言会空过`);

const enabled = [];
const broken = [];
for (const f of files) {
  let parsed = null;
  try { parsed = JSON.parse(readFileSync(join(DIR, f), "utf8")); } catch { broken.push(f); continue; }
  if (parsed?.enabled === true) enabled.push(f);
}
ok(broken.length === 0, `全部示范件是合法 JSON${broken.length ? `（坏文件：${broken.join(", ")}）` : ""}`);
ok(enabled.length === 0,
  `⛔ 内置示范件一律默认停用（仍启用的：${enabled.join(", ") || "无"}）—— 想启用必须显式改它并在此写明理由`);

console.log("\n【plugins】" + (checks - fails) + "/" + checks + " 通过" + (fails ? " —— " + fails + " 条红" : ""));
process.exit(fails ? 1 : 0);
