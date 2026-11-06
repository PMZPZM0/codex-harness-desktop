/**
 * 12az —— config.toml 一律原子写（11-05 用户现场「先把 Bug 修好」）
 *
 * 现场：引擎报 `failed to load configuration: …\codex-home\config.toml:219:8: key with no value,
 * expected `=``，文件尾部躺着一行半截的 `source = "…"` 碎片。根因不是模型、不是网络，而是
 * **非原子覆盖写**：`fs.writeFile(整份)` 直接覆盖目标，进程在写的中途被强杀时，新内容只落了一半、
 * 旧内容更长的那截还留在后面 ⇒ 拿到一份语法都不合法的配置 ⇒ 引擎整份拒载 ⇒ 之后每一个
 * `codex:request` 都失败，界面看着就是「应用坏了」。
 * `fs.appendFile` 更糟：半截段落直接追加在文件尾。
 *
 * 同型事故 10-24 在 model-catalog.json 上已经吃过一次（当时只修了那一处，没成纪律 ⇒ 这次补上）：
 * 写侧纪律集中在 `electron/config-toml.ts` 的 writeTextFileAtomic / appendSectionAtomic，
 * 先写 `*.tmp-<pid>-<ts>` 再 rename 换上（同目录 rename 是原子的）。
 *
 * 判据两半：临时目录里**真跑**三个写函数（含"新内容比旧内容短"这个出事的形状）+
 * 全仓**负向**扫描「不许再有直接 writeFile/appendFile 打 config.toml」。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require_ = createRequire(import.meta.url);
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/[^'"`]*$/, "")).join("\n");
let checks = 0;
let fails = 0;
const ok = (cond, msg) => { checks += 1; console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails += 1; };

console.log("【12az】config.toml 原子写");

const artifact = join(ROOT, "dist-electron", "config-toml.js");
if (!existsSync(artifact)) {
  ok(false, "构建产物存在（缺 dist-electron/config-toml.js —— 先 npm run build:electron）");
} else {
  const mod = require_(artifact);
  const dir = mkdtempSync(join(ROOT, ".workbuddy", "tmp", "cfg-atomic-"));
  try {
    const file = join(dir, "config.toml");

    /* ① 出事的那个形状：新内容比旧内容短 —— 非原子覆盖会留下旧尾巴（用户现场正是这样） */
    writeFileSync(file, 'model = "old-old-old"\n[projects.\'d:\\long-long-long\']\ntrust_level = "trusted"\n', "utf8");
    await mod.writeTextFileAtomic(file, 'model = "new"\n');
    const after = readFileSync(file, "utf8");
    ok(after === 'model = "new"\n',
      "真跑：新内容比旧内容短时，结果**逐字节等于新内容**（旧写法会留下旧尾巴 ⇒ TOML 语法废掉）", after.replace(/\n/g, "\\n"));
    ok(readdirSync(dir).filter((n) => n.includes(".tmp-")).length === 0,
      "真跑：写完不留临时文件（残留 = rename 没走到，那份配置其实没换上）");

    /* ② 目标目录不存在时要能建出来（首次启动 / 换数据目录的形态） */
    const nested = join(dir, "sub", "config.toml");
    await mod.writeTextFileAtomic(nested, "a = 1\n");
    ok(readFileSync(nested, "utf8") === "a = 1\n", "真跑：目录不存在也会先建，再原子换上");

    /* ③ 段落追加：幂等 + 只出现一次 */
    const cfg = join(dir, "market.toml");
    writeFileSync(cfg, 'model = "x"\n', "utf8");
    const section = '[marketplaces.expert-skills]\nsource_type = "local"\nsource = "D:/a b/expert-skills"';
    const re = /\[marketplaces\.expert-skills\]/;
    const first = await mod.appendSectionAtomic(cfg, section, re);
    const second = await mod.appendSectionAtomic(cfg, section, re);
    const text = readFileSync(cfg, "utf8");
    ok(first === true && second === false && (text.match(/\[marketplaces\.expert-skills\]/g) ?? []).length === 1,
      "真跑：同一段落只写一次（第二次幂等跳过）—— 重复段落 = 引擎 duplicate key 整份拒载");
    ok(/^model = "x"\n\n\[marketplaces\.expert-skills\]/.test(text), "真跑：追加保留原有内容，中间空一行分隔", text.slice(0, 60));
    ok(readFileSync(cfg, "utf8").includes('source = "D:/a b/expert-skills"'), "真跑：带空格的路径原样写进去（引号段不能被截断）");

    /* ④ 空文件也要能写（首次启动没有 config.toml 的形态） */
    const fresh = join(dir, "fresh.toml");
    ok(await mod.appendSectionAtomic(fresh, section, re) === true && readFileSync(fresh, "utf8").startsWith("[marketplaces."),
      "真跑：文件不存在时直接落段落，不抛错");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  /* ── 写侧纪律：整个 electron/** 扫一遍，不许再有直接打 config.toml 的非原子写 ──
     ⛔ 不能用「固定文件清单」：11-05 那轮就是按名单扫的，结果 `custom-model-apply.ts` 里
     **保存/启用供应商的主写路径**（`fs.writeFile(\n path.join(codexHome,"config.toml")`）
     因为「跨了行 + 不在名单里」漏了两轮。现在按调用形态扫、跨行取窗口。 */
  const electronFiles = [];
  const collect = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, item.name);
      if (item.isDirectory()) { if (!/^(node_modules|dist|dist-electron)$/.test(item.name)) collect(full); continue; }
      if (!/\.(ts|mts|js|mjs)$/.test(item.name) || item.name.endsWith(".gen.ts")) continue;
      electronFiles.push(full);
    }
  };
  collect(join(ROOT, "electron"));
  /* 取「调用括号里的第一个实参」——⛔ 不能只看调用点后面 260 字符的窗口：
     相邻函数的 configPath / config.toml 会被窗口误伤（实测 4 处假红），跨行的真违规又可能被漏掉。 */
  const firstArgOf = (src, openIdx) => {
    let depth = 0;
    for (let i = openIdx; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") {
        depth -= 1;
        if (depth === 0) return src.slice(openIdx + 1, i);
      } else if (ch === "," && depth === 1) return src.slice(openIdx + 1, i);
    }
    return src.slice(openIdx + 1, openIdx + 260);
  };
  const offenders = [];
  for (const file of electronFiles) {
    const src = stripComments(readFileSync(file, "utf8"));
    const call = /(writeFileSync|appendFileSync|writeFile|appendFile)\s*\(/g;
    let hit;
    while ((hit = call.exec(src))) {
      const openIdx = hit.index + hit[0].length - 1;
      /* `configPath` 必须不是一次调用：video-gen / poll-config 里各有一个
         `configPath()` 返回自己的 JSON 路径（实测两处假红）。 */
      if (!/config\.toml|engineConfigFile|cfgPath|\bconfigPath\b(?!\s*\()/.test(firstArgOf(src, openIdx))) continue;
      offenders.push(`${file.replace(ROOT, "").replace(/\\/g, "/")}:${src.slice(0, hit.index).split("\n").length}`);
      break;
    }
  }
  ok(electronFiles.length > 40,
    `扫描面覆盖整个 electron/（实测 ${electronFiles.length} 个源文件）—— 固定名单漏过 custom-model-apply 那条主写路径`);
  ok(offenders.length === 0,
    `没有一处直接 writeFile/appendFile 打 config.toml（违规：${offenders.length ? offenders.join("、") : "无"}）—— 一律走 config-toml.ts 的原子写`);

  const helper = stripComments(read("electron/config-toml.ts"));
  ok(/export async function writeTextFileAtomic[\s\S]{0,700}?writeFile\(tmp, text, "utf8"\)[\s\S]{0,300}?rename\(tmp, file\)/.test(helper)
    && !/async function writeTextFileAtomic[\s\S]{0,900}?writeFile\(file, text/.test(helper),
    "原子写实现正确：先写临时文件再 rename 换上，且函数体内不许出现「直接写目标文件」那条路（少了 rename = 还是原地覆盖，等于没修）");
  /* ⛔ 回退路径不许删真文件：删掉之后第二次 rename 再失败，配置文件就整份消失（比旧内容糟得多）。
     正确形态 = 把真文件挪到旁边，成功再删旁路，失败把旁路挪回来。 */
  const atomicBody = helper.slice(helper.indexOf("export async function writeTextFileAtomic"), helper.indexOf("appendSectionAtomic"));
  ok(/rename\(file, aside\)/.test(atomicBody) && /rename\(aside, file\)/.test(atomicBody)
    && !/rm\(file[,)]/.test(atomicBody),
    "回退路径不删真文件（挪到旁边 + 失败挪回来；⛔ 删了再换 = 两次都失败时配置整份消失）");
  /* `ensureTrustedProject` 是同步的，而且 data-dir.ts 必须保持**叶子模块**（守卫【152】/【91】：
     不 import 项目内模块，否则被拖进依赖环）⇒ 它不能复用上面的 helper，只能就地展开同一条纪律。
     这里钉的是「同一条纪律在这一处也成立」，不是"必须 import helper"。 */
  const dataDir = stripComments(read("electron/data-dir.ts"));
  ok(/const tmp = `\$\{engineConfigFile\}\.tmp-\$\{process\.pid\}-\$\{Date\.now\(\)\}`;/.test(dataDir)
    && /fs\.writeFileSync\(tmp, nextText, "utf8"\)/.test(dataDir)
    && /fs\.renameSync\(tmp, engineConfigFile\)/.test(dataDir)
    && !/appendFileSync\(/.test(dataDir),
    "data-dir 的信任段追加同样 tmp + renameSync，且不再有 appendFileSync（就地展开：本文件是叶子模块，不许 import 项目内模块）");
  ok(/export async function appendSectionAtomic[\s\S]{0,600}?alreadyThere\.test\(existing\)[\s\S]{0,400}?writeTextFileAtomic\(file, next\)/.test(helper)
    && !/function appendSectionAtomic[\s\S]{0,700}?appendFile\(/.test(helper),
    "追加段落的唯一入口是「读全 → 拼好 → 原子写回」，不是 appendFile");

  const modelCatalog = stripComments(read("electron/main/01-model-catalog.ts"));
  ok(/\.tmp-\$\{process\.pid\}-\$\{Date\.now\(\)\}/.test(modelCatalog)
    && /await fs\.rename\(tmp, modelCatalogFile\)/.test(modelCatalog)
    && !/fs\.writeFile\(modelCatalogFile/.test(modelCatalog),
    "10-24 那次 model-catalog.json 的原子写没有被改回去（同型事故的第一次修复，两处口径要一致）");
}

console.log(fails ? `\n【config-atomic】失败 ${fails} 项` : `\n【config-atomic】通过 ${checks} 项`);
process.exit(fails ? 1 : 0);
