// 类名样式覆盖率检查：抓出「用了 class 但 styles.css 里没有对应规则」的裸奔类名
// 提取规则：
//   className="a b"          → 直接用字符串
//   className={`x ${expr}`}  → 模板字面量，${} 挖掉后剩下的当类名；尾随 '-' 视为动态前缀
//   className={表达式}        → 只取表达式里的字符串字面量（"active"、'on' 等），
//                               标识符/属性名（如 scheduleDraft.weekdays）不是类名，不取
const fs = require("fs");

const parts = [fs.readFileSync("src/App.tsx", "utf8")];
for (const f of fs.readdirSync("src/components")) {
  if (f.endsWith(".tsx")) parts.push(fs.readFileSync("src/components/" + f, "utf8"));
}
const src = parts.join("\n");
const css = fs.readFileSync("src/styles.css", "utf8");

const used = new Set();      // 完整类名
const prefixes = new Set();  // 模板里以 '-' 结尾的动态前缀（如 `fs-demo-${x}`）
const re = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/g;
let m;
while ((m = re.exec(src))) {
  let raw = "";
  if (m[1] !== undefined) raw = m[1];
  else if (m[2] !== undefined) raw = m[2].replace(/\$\{[^}]*\}/g, " ");
  else {
    // 先剔除 === / !== 等比较里的字符串（那是取值判断，不是类名），再取剩余字符串字面量
    const expr = m[3].replace(/[=!]==?\s*(["'])((?:\\.|(?!\1).)*)\1/g, " ");
    const strRe = /"([^"]*)"|'([^']*)'|`([^`]*)`/g;
    let s;
    while ((s = strRe.exec(expr))) raw += " " + (s[1] ?? s[2] ?? s[3] ?? "").replace(/\$\{[^}]*\}/g, " ");
  }
  for (const tok of raw.split(/[\s`'{}?:+|&.]+/)) {
    if (/^[a-z][a-z0-9-]{2,}$/.test(tok)) {
      if (tok.endsWith("-")) prefixes.add(tok.slice(0, -1));
      else used.add(tok);
    }
  }
}

// 用法: node scripts/check-css-classes.cjs [前缀...]
//   不传前缀 = 检查全部类名；传前缀则只看这几组（例: node ... subagent memory index-）
const args = process.argv.slice(2);
const filter = (c) => args.length === 0 || args.some((p) => c.startsWith(p));
let miss = 0;
for (const c of [...used].filter(filter).sort()) {
  if (!new RegExp("\\." + c + "(?![a-zA-Z0-9_-])").test(css)) {
    console.log("  无样式: ." + c);
    miss++;
  }
}
for (const p of [...prefixes].filter(filter).sort()) {
  // 动态前缀：只要有任何 .p-xxx 规则就算覆盖
  if (!new RegExp("\\." + p + "-[a-zA-Z0-9_-]").test(css)) {
    console.log("  无样式: ." + p + "-*（动态前缀，一条规则都没有）");
    miss++;
  }
}
console.log(`前缀 [${args.join(", ") || "全部"}]：共 ${used.size} 个类名 + ${prefixes.size} 个动态前缀，缺样式 ${miss} 个`);
