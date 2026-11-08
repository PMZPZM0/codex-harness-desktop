/* 批量补注释的第 ④ 步：按「相对路径@函数名=注释」清单，把中文文档注释插到导出函数上方。
   只补缺失：已有中文注释的跳过；目标仓没有那个文件也跳过（三仓结构已分叉，清单是共用资产）。

   用法：
     node scripts/tools/annotate/apply-notes.mjs <清单文件>

   ⛔⛔ 清单本身**必须用 python heredoc 写**，别用会「吞字符」的编辑器/工具：
       `useFilePreview.ts@useFilePreview` 里 `.ts@<与文件名同名的标识符>` 那段会被吃掉，
       症状就是这里报「未命中函数」（11-08 连踩两次）。
   ⛔ 定位一律**重新解析**（不靠外部行号）—— 清单可能是几小时前按旧行号写的，行号早漂了。
   ⛔ 解析分隔符用 indexOf("@")（第一个），不用 lastIndexOf：目录名里也可能带 @（scoped 包）。
*/
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const listFile = process.argv[2];
if (!listFile || !existsSync(listFile)) {
  console.error("用法：node scripts/tools/annotate/apply-notes.mjs <清单文件>");
  process.exit(1);
}

/* ⛔ 末尾的 `[=(<]` 三个都要：`export function f<T>(` 这种泛型声明在 `(` 之前是 `<`，
   只写 `=|\\(` 会把它整类漏掉（11-08 收尾复核发现 4 个泛型导出被漏：slotOf / Slot /
   withNuphusMasks / defineFeature）。 */
const EXPORT_FN = /^\s*export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)\s*(?:[=(<])/;
const CJK = /[\u4e00-\u9fa5]/;

/** 清单行 → 文件相对路径 + 函数名 → 注释。⛔ 空行与 # 开头的说明行跳过。 */
const byFile = new Map();
for (const raw of readFileSync(listFile, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  const at = line.indexOf("@");
  if (eq < 0 || at < 0 || at > eq) continue;
  const rel = line.slice(0, at).trim();
  const name = line.slice(at + 1, eq).trim();
  const text = line.slice(eq + 1).trim();
  if (!rel || !name || !text) continue;
  if (!byFile.has(rel)) byFile.set(rel, new Map());
  byFile.get(rel).set(name, text);
}

let added = 0;
const missingFiles = [];
const missedNames = [];

for (const [rel, nameMap] of byFile) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) { missingFiles.push(rel); continue; }
  const raw = readFileSync(abs, "utf8");
  const crlf = raw.includes("\r\n");
  const src = raw.replace(/\r\n/g, "\n").split("\n");
  let touched = 0;
  for (let i = 0; i < src.length; i += 1) {
    const m = EXPORT_FN.exec(src[i]);
    if (!m || !nameMap.has(m[1])) continue;
    const name = m[1];
    /* 往上找已存在的注释：已经有中文就直接认账（幂等，重复跑不会插两遍）。 */
    let j = i - 1;
    let doc = "";
    while (j >= 0) {
      const t = src[j].trim();
      if (!t) { j -= 1; if (i - j > 3) break; continue; }
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.endsWith("*/")) { doc = t + doc; j -= 1; continue; }
      break;
    }
    if (CJK.test(doc)) { nameMap.delete(name); continue; }
    const indent = /^\s*/.exec(src[i])[0];
    src.splice(i, 0, `${indent}/** ${nameMap.get(name)} */`);
    nameMap.delete(name);
    added += 1;
    touched += 1;
    i += 1;
  }
  for (const left of nameMap.keys()) missedNames.push(`${rel}@${left}`);
  if (touched) writeFileSync(abs, src.join("\n").replace(/\n/g, crlf ? "\r\n" : "\n"));
}

console.log(`已插入 ${added} 条；目标仓无此文件 ${missingFiles.length} 个；未命中函数 ${missedNames.length} 个`);
if (missingFiles.length) console.log(`  缺文件：${missingFiles.slice(0, 5).join("、")}${missingFiles.length > 5 ? " …" : ""}`);
if (missedNames.length) console.log(`  未命中：${missedNames.slice(0, 5).join("、")}${missedNames.length > 5 ? " …" : ""}`);
