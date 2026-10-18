/**
 * WAL 定期 checkpoint 的判据（10-19 复检报告 P1-4）
 *
 * 事故背景：`state_5.sqlite` 的 `-wal` 长到主库 5.7 倍（4.3MB vs 753KB），清完又长回来 ——
 * 没有任何自动 checkpoint。修法 = 启动一次 + 每 6 小时 `PRAGMA wal_checkpoint(TRUNCATE)`。
 *
 * 失效方式：① boot 没接（等于没做）；② 接到 server.start 之后（首启那段仍不生效）；
 *          ③ `new DatabaseSync` 前不判存在（会凭空创建空库）；④ 用了 PASSIVE（WAL 不缩）。
 * 行为由 tests/sqlite-wal.test.mjs 真跑（临时库 → WAL > 0 → checkpoint → WAL === 0 且数据完好）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【wal-checkpoint】${message}`);
  if (!condition) fails++;
};

const boot = codeOnly(read("electron/features/boot.ts"));
const mod = codeOnly(read("electron/sqlite-wal.ts"));

ok(/import \{ startWalCheckpointWatch \} from "\.\.\/sqlite-wal"/.test(boot) && /startWalCheckpointWatch\(\[/.test(boot),
  "boot 已接 `startWalCheckpointWatch`（三个引擎库：state / thread_history / logs）");
const injectAt = boot.indexOf("startWalCheckpointWatch([");
const startAt = boot.indexOf("server.start(");
ok(injectAt >= 0 && startAt > injectAt, `checkpoint 挂在 server.start() 之前（${injectAt} < ${startAt}）`);
ok(/app\.once\("will-quit", stopWalWatch\)/.test(boot), "退出时清定时器（will-quit）");
ok(/try \{[\s\S]{0,200}startWalCheckpointWatch[\s\S]{0,300}\} catch/.test(boot),
  "启动失败只记日志（try/catch）—— checkpoint 坏了不能把启动链带崩");

ok(/wal_checkpoint\(TRUNCATE\)/.test(mod), "用的是 `TRUNCATE`（PASSIVE 不会把 WAL 文件缩回 0）");
ok(/if \(!fs\.existsSync\(file\)\) return \{ file, ok: false, error: "数据库不存在" \}/.test(mod),
  "先判文件存在再开库（⛔ `new DatabaseSync` 默认会创建文件，漏判 = 凭空造库）");
ok(/busy_timeout/.test(mod), "有 busy_timeout（引擎同时持有连接，拿不到锁就跳过）");
ok(/return \(\) => clearInterval\(timer\)/.test(mod) && /timer\.unref/.test(mod),
  "返回停止函数且定时器 unref（不阻止进程退出）");

console.log(`\n【wal-checkpoint】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
