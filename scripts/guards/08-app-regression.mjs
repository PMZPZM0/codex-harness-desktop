/**
 * 预检守卫组：08-app-regression
 * 分节：【91】（原 L7972–L7990）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  C, ROOT, fail, join, ok, readFileSync, readdirSync,
} from "./_ctx.mjs";

export async function run() {

  /* ══ 【91】原 L7972–L7990 ══ */
  {
{
  console.log(C.bold("\n【91】非 main.ts 的 userData 路径必须惰性求值"));
  const offenders = [];
  for (const rel of readdirSync(join(ROOT, "electron"), { recursive: true })) {
    const name = String(rel);
    if (!name.endsWith(".ts") || name.includes("node_modules")) continue;
    if (name === "main.ts") continue; // main.ts 的模块体在 setPath 之后执行，天然安全
    const src = readFileSync(join(ROOT, "electron", name), "utf8");
    src.split(/\r?\n/).forEach((line, i) => {
      // ⛔⛔ 必须排除**箭头函数/函数表达式**：`() => path.join(app.getPath("userData"), …)`
      //   看着像顶层赋值，实际 getPath 在**调用时**才求值 ⇒ 完全惰性、安全。
      //   10-03 壁纸域踩到：守卫按行首正则把 `const recentFile = () => app.getPath(...)` 判成违规，
      //   而 `runtime-refs.ts` 自己的 mainWindow 等惰性助手也是同一形态。
      //   真正要防的是「模块体直接赋值给常量、导入时立刻求值」那一类。
      if (/=>\s*.*app\.getPath\(\s*["']userData["']/.test(line)) return;
      if (/^(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*(?::[^=]+)?=.*app\.getPath\(\s*["']userData["']/.test(line)) {
        offenders.push(`${name}:${i + 1}`);
      }
    });
  }
  (offenders.length === 0 ? ok : fail)(
    `【91】模块顶层 app.getPath("userData") 出现 ${offenders.length} 处` +
      (offenders.length ? `：${offenders.join(", ")}（改成惰性函数，见 electron/personalization.ts）` : "（全部惰性求值）"),
  );
}
  }
}
