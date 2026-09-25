/**
 * 预检（聚合入口，~20 行）：按域顺序跑 guards/ 下的守卫组，然后汇总退出。
 *
 * 09-22 结构：原单文件 8,997 行 → guards/_ctx.mjs（共享上下文 + 汇总）+ guards/NN-*.mjs（按域分组）
 *   + 本文件。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生过一次）。
 * ⛔ 加新守卫请改 guards/ 下对应域的文件；新建组时在本文件 MODULES 登记。
 */
import { finish, warn } from "./guards/_ctx.mjs";

/** 仓库根（自检用；与守卫一致的取法：cwd 就是仓库根 —— 预检约定在仓库根跑）。 */
const ROOT_FOR_AUDIT = process.cwd();

/* ⛔ 守卫自检：**负向结构断言必须过 `codeOnly()` 剥注释**（09-25 立）。
   `guards/_ctx.mjs` 早就把这条写成纪律（「任何『不许出现 X』的结构断言，匹配前都要先过这一层」，
   并记了当天三次注释命中造成的假红/假绿），但实测 **143/144 条**没遵守 —— 因为没人看得见。
   为什么必须可见：在注释里引用代码片段是本项目的常态（讲清「旧写法长什么样」最有效），
   于是 `!/xxx/.test(src)` 型断言随时可能被注释顶成假红（09-25 我在注释里写「按时间分组」
   就把【156】的负向断言顶红了），或被误判成"注释误伤"而放宽成假绿。
   ⚠️ 这里只**报告不失败**：历史债要逐条迁移（过 codeOnly 后才能确认它真在守代码），
      硬失败会让预检立刻全红。约定：变量名以 `Code` 结尾 = 已过 codeOnly（如 appUiCode2）。 */
async function auditNegativeAsserts() {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(ROOT_FOR_AUDIT, "scripts", "guards");
    let total = 0;
    const offenders = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mjs") && x !== "_ctx.mjs")) {
      const lines = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/);
      /* ⛔ 判定「这条断言对应的源码变量有没有剥过注释」**看赋值来源，不看变量名**
         （09-25 审查：`hardCode` 是「hard-coded」缩写、不是 codeOnly 产物，靠名字猜会误判；
         实际它是手写剥注释版 `src.replace(/\/\*…\/g,"").replace(/\/\/…/g,"")` ⇒ 结论正确纯属侥幸）。
         判据：赋值表达式含 `codeOnly(`，或含剥块注释的特征片段 `[\s\S]*?\*\/`。 */
      const peeled = new Set();
      for (const line of lines) {
        const m = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/.exec(line);
        if (!m) continue;
        if (m[2].includes("codeOnly(") || m[2].includes("[\\s\\S]*?\\*\\/")) peeled.add(m[1]);
      }
      lines.forEach((line, i) => {
        if (!/\(\s*!/.test(line) || !/ok\s*:\s*fail/.test(line)) return;
        if (!/includes\(|\.test\(/.test(line)) return;
        total++;
        if (/codeOnly\(/.test(line)) return;                      // 当场剥的
        const ids = line.match(/\b[A-Za-z_$][\w$]*\b/g) || [];
        if (ids.some((id) => peeled.has(id))) return;             // 用的是已剥过的变量
        offenders.push(`${f}:${i + 1}`);
      });
    }
    if (offenders.length) {
      warn(
        `守卫自检：${offenders.length}/${total} 条负向结构断言未经 codeOnly 剥注释（注释里引用代码片段就会把它顶成假红/假绿）—— ` +
        `样例 ${offenders.slice(0, 4).join("、")}${offenders.length > 4 ? " …" : ""}；改到哪条就顺手过 codeOnly，逐步收敛`
      );
    }
  } catch (error) {
    warn(`守卫自检跑不起来（不影响预检结果）：${error?.message ?? error}`);
  }
}

const MODULES = [
  "01-build-ipc-css",
  "02-session-logic",
  "03-runtime-boot",
  "04-misc-and-tools",
  "05-ipc-contract",
  "06-app-behavior",
  "07-turn-fold",
  "08-app-regression",
  "09-structural",
  "10-memory-audit",
];

for (const name of MODULES) {
  const mod = await import(`./guards/${name}.mjs`);
  await mod.run();
}

await auditNegativeAsserts();

finish();
