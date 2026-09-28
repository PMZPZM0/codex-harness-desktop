/**
 * 守卫组 18 —— AppSelect 统一下拉框（【197】）。
 *
 * 背景：全仓曾有 34 处原生 <select>，系统 option 弹层无法样式化（蓝块高亮/无圆角/
 * 长文本不截断，用户 09-28 截图点名「太丑了」）。已统一替换为 AppSelect 组件。
 *
 * 判据：
 *  ① 负向断言：渲染层任何地方不得再写原生 <select（剥注释后匹配，防止说明文字自伤）。
 *  ② AppSelect 实现锚：portal 到 body（弹窗事故同款坑：祖先 transform 让 fixed 退化）、
 *     键盘导航、视口翻转。
 *  ③ 样式只用主题变量。
 */
import { C, ROOT, join, ok, fail, readFileSync, readdirSync } from "./_ctx.mjs";

export async function run() {
  console.log(C.bold("\n【197】AppSelect 统一下拉框"));

  // ① 收集渲染层源码（剥注释后匹配）
  const collected = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx$/.test(entry.name)) collected.push(p);
    }
  };
  walk(join(ROOT, "src"));

  const offenders = [];
  for (const file of collected) {
    const raw = readFileSync(file, "utf8");
    // 逐行剥 // 注释与 /* */ 块注释（简化：行级匹配足够拦回归）
    const code = raw
      .split("\n")
      .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l.replace(/(<!-|->|-->)|\/\*[\s\S]*?\*\//g, "")))
      .join("\n");
    if (/<select[\s>]/.test(code)) offenders.push(file.replace(ROOT, "").replace(/\\/g, "/"));
  }
  (offenders.length === 0 ? ok : fail)(
    `【197】渲染层不再使用原生 <select>（${offenders.length} 处违规${offenders.length ? "：" + offenders.join(", ") : " —— 全部走 AppSelect 统一样式"}）`
  );

  // ② 组件实现锚
  const comp = readFileSync(join(ROOT, "src", "components", "AppSelect.tsx"), "utf8");
  (comp.includes("createPortal(") && comp.includes("document.body") ? ok : fail)(
    "【197】AppSelect 弹层 createPortal 到 body（祖先 transform 会让 fixed 退化 —— 弹窗事故同款坑）"
  );
  (/ArrowDown/.test(comp) && /ArrowUp/.test(comp) && /"Escape"/.test(comp) ? ok : fail)(
    "【197】AppSelect 支持键盘导航（↑↓ 移动 / Esc 关闭 —— 原生 select 的可达性不能退化）"
  );
  (/openUp/.test(comp) ? ok : fail)(
    "【197】AppSelect 弹层支持视口翻转（下方放不下开向上，不裁切）"
  );
  (/stopPropagation/.test(comp) ? ok : fail)(
    "【197】AppSelect 点击防冒泡（画布/卡片内嵌下拉不得触发父级选中或拖拽）"
  );

  // ③ 样式只用主题变量
  const css = readFileSync(join(ROOT, "src", "styles", "01-base-and-chrome.css"), "utf8");
  const block = css.slice(css.indexOf(".app-select-trigger {"));
  (!/#[0-9a-fA-F]{3,8}\b/.test(block.slice(0, block.indexOf("}", block.indexOf(".app-select-check")))) ? ok : fail)(
    "【197】AppSelect 样式只用主题变量（无写死色值 —— 写死会在暗色主题下瞎掉）"
  );
}
