/**
 * 侧栏「任务运行中」spinner 的形态守卫（2026-10-04）
 *
 * ⛔ 起因：用户把三点弹跳换成 Uiverse「serious-mule-65」8 点旋转 spinner。
 *   形态从**3 个 `<i>` 元素**变成**1 个元素 + 7 层 box-shadow** ⇒ **CSS 与 JSX 必须同步改**，
 *   少改一边就either「点挤成一坨」或「只转半圈」，而**两边都是合法代码，tsc/预检全绿**。
 *
 * ⛔ 因此钉的不是"好不好看"，而是**两边的元素数与动画形态是否一致**：
 *   ① JSX 只有一个 `<i />`（多一个就叠影）
 *   ② CSS 用 box-shadow 画点阵（不是逐点 animation-delay）
 *   ③ 动画是 steps(8) 旋转（不是弹跳关键帧）
 *   ④ 旧关键帧 `thread-dot-bounce` 不得残留
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【spin】${m}`); if (!c) fails++; };

// ── 源码层：JSX 的元素数 ──
//⛔ 查**源码**而不是产物：产物里 JSX 已编译成 createElement，"几个子元素"要数函数调用，
//   极易写错判据（判据本身错了比没判据更糟）。
const ROW = join(ROOT, "src", "features", "app-state", "parts", "part02",
  "02-goal-browser-notice", "01-goal-review-file-browser", "02-thread-attention-rows.tsx");
const row = readFileSync(ROW, "utf8");
const m = /thread-running-indicator[\s\S]{0,200}?<\/span>/.exec(row);
ok(Boolean(m), "找得到 thread-running-indicator 的 JSX");
if (m) {
  const inner = m[0].replace(/^[\s\S]*?>/, "").replace(/<\/span>$/, "");
  const count = (inner.match(/<i\b/g) || []).length;
  ok(count === 1, `JSX 里恰好 1 个 <i />（实际 ${count} 个）—— 多个会让 box-shadow 的点叠影`);
}

// ── 产物层：CSS 的形态（box-shadow 点阵 + steps(8) 旋转） ──
const cssFile = readdirSync(join(ROOT, "dist", "assets")).find((f) => f.endsWith(".css"));
ok(Boolean(cssFile), "找得到产物 CSS");
if (cssFile) {
  const css = readFileSync(join(ROOT, "dist", "assets", cssFile), "utf8");
  const block = /\.thread-running-indicator i\s*\{[\s\S]*?\}/.exec(css);
  ok(Boolean(block), "产物里有 .thread-running-indicator i 规则");
  if (block) {
    const shadows = (block[0].match(/var\(--d\)/g) || []).length;
    // 7 层box-shadow，每层 2 个 var(--d) ⇒ 14 次引用；宽松点只要求 >= 10（双x 偏移）
    ok(shadows >= 10, `用 box-shadow 画点阵（var(--d) 引用 ${shadows} 次，期望 ≥10）`);
    // ⛔⚠️ 判据不能写死 `steps(8)`：lightningcss 会把它规范化成 `steps(8,end)`
    //   并重排 animation 简写（`animation:1.1s steps(8,end) infinite thread-dot-spin`），
    //   写死就会恒红。⇒ 只查「steps(」这个**语义**（必须分步）+ 不含 linear。
    const anim = (/animation:[^;}]*/.exec(block[0]) || [""])[0];
    ok(/steps\(\s*8\s*(,|\))/.test(anim), `动画用 steps(8) 分步旋转（产物：${anim.slice(0, 60)}）`);
    ok(!/\blinear\b/.test(anim), "不是 linear（线性旋转能看出点间有缝）");
    ok(/@keyframes thread-dot-spin/.test(css), "有关键帧 thread-dot-spin");
  }
  // ⛔ 旧实现不得残留（两处任一残留都会与新形态打架）
  ok(!/thread-dot-bounce/.test(css), "旧关键帧 thread-dot-bounce 已从产物清除");
  ok(!/thread-running-indicator i:nth-child/.test(css), "旧的 :nth-child 逐点 delay 规则已清除");

  /* ── 判据组 B：**点阵必须"完整可见"**（2026-10-04 第二版，用户反馈"不像原版转圈"）──
     ⛔ 病根一：我在 `i` 上加了 `clip-path: inset(-8px -8px 0 -8px)`。
        inset 第四值是"下边界"，写 0 =不向外扩 ⇒ 裁在元素自身盒子下沿（3.4px）
        ⇒ 圆心 y=+--d 的那颗（下半个圆）被**整颗切掉** ⇒ 根本不是一圈。
     ⛔ 病根二：容器只开 16px，而点阵实测要 **33×33px**（半宽 = 9.4 + 1.7 + 5.4 = 16.5）。
        当前解法 = `i` 绝对定位 + 容器不裁 ⇒ 溢出但完整可见。 */
  const iBlock = (/\.thread-running-indicator i\s*\{([\s\S]*?)\}/.exec(css) || [, ""])[1];
  ok(!/clip-path/.test(iBlock),
    "⛔ i 上不许 clip-path（inset 底部不外扩会把下半个圆整颗切掉 —— 这是「不像一圈」的真凶）");
  ok(!/overflow\s*:\s*hidden/.test(iBlock), "⛔ i 上不许 overflow:hidden（会把 box-shadow 整体裁掉，八个点全没）");
  ok(/position:\s*absolute/.test(iBlock),
    "i 是绝对定位（点阵要溢出到16px 容器之外，不裁也不撑布局）");
  ok(/spread|box-shadow/.test(iBlock), "点阵由 box-shadow 画出");

  // ⛔ 祖先链不得有 overflow:hidden —— 那会真的裁掉溢出的点（改容器尺寸也没用）
  {
    const src = readFileSync(join(ROOT, "src", "styles", "02-sidebar-threads.css"), "utf8");
    const family = [...src.matchAll(/^\.(thread-row[a-z-]*|thread-actions)\s*\{([^}]*)\}/gm)];
    const bad = family
      .filter((m) => /overflow\s*:\s*(hidden|clip)/.test(m[2]))
      .map((m) => m[1]);
    ok(bad.length === 0, `class 型祖先规则无 overflow:hidden（当前 ${family.length} 条）${bad.length ? `—— 有：${bad.join("/")}` : ""}`);

    /*⛔⛔ 标签型选择器才是真陷阱（2026-10-04 用户反馈"空间留少了"= 形状缺一角）：
       `.thread-row span { overflow: hidden }` 是**标题省略号**规则，而 spinner 外层
       **正好是 `<span>`** ⇒ 直接吃到裁剪。class 命名再规范也躲不掉宽泛标签选择器。
       ⇒ 判据形状：不只扫 `\.xxx {`，还要扫 `.thread-row <标签> {` 这类**标签型**规则。 */
    const tagRules = [...src.matchAll(/^\.(thread-row[a-z-]*)\s+(span|small|div|em|strong)\s*\{([^}]*)\}/gm)];
    const tagBad = tagRules
      .filter((m) => /overflow\s*:\s*(hidden|clip)/.test(m[3]))
      .map((m) => `${m[1]} ${m[2]}`);
    ok(tagBad.length > 0, `扫到了 ${tagRules.length} 条标签型规则（如 .thread-row span）`);

    //⇒ spinner 必须有一条高特异性豁免
    const exempt = /\.thread-row\s+span\.thread-running-indicator\s*\{[^}]*overflow\s*:\s*visible/.test(src);
    ok(exempt, "⛔ spinner 有 `.thread-row span.thread-running-indicator`豁免规则（否则被标题省略号规则裁掉）");
  }
}

console.log(`\n【spin】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
