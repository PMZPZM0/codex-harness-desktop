// 扫描 styles.css 里所有 var(--x) 引用，找出未定义的变量（防止新增样式整段失效）
const fs = require("fs");
const css = fs.readFileSync("src/styles.css", "utf8");

const defined = new Set();
const defRe = /(--[a-zA-Z0-9_-]+)\s*:/g;
let m;
while ((m = defRe.exec(css))) defined.add(m[1]);

const used = new Map();
// 找到 var(--x 的位置后，手动数括号到匹配的右括号：
// 逗号出现在闭合前 = 有兜底值，声明不会整条失效，不报。
const useRe = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
while ((m = useRe.exec(css))) {
  const name = m[1];
  let depth = 1;
  let i = m.index + m[0].length;
  let hasFallback = false;
  while (i < css.length && depth > 0) {
    const ch = css[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 1) hasFallback = true;
    i += 1;
  }
  if (defined.has(name) || hasFallback) continue;
  const line = css.slice(0, m.index).split(/\r?\n/).length;
  if (!used.has(name)) used.set(name, []);
  used.get(name).push(line);
}

if (!used.size) {
  console.log(`全部 ${defined.size} 个变量引用正常，无未定义变量`);
} else {
  console.log("未定义的 CSS 变量（这些声明会整条失效）：");
  for (const [name, lines] of used) {
    console.log(`  ${name}  ×${lines.length}  行: ${lines.slice(0, 6).join(", ")}`);
  }
}
