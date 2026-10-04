// scripts/guards/11e-topbar-popover.mjs
//
// 【popover】顶栏浮层必须 portal 到 body + position: fixed
//
// ⛔⛔ 2026-10-04 用户报「点调度弹窗展示不出来」。真因不是"忘了 open"，而是：
//   `.topbar` 在 d19c510 被加了 `overflow: hidden`（为修「顶栏图标压到原生窗口钮底下」），
//   而 dispatch-pop / task-menu / ctx-menu 都是 `.topbar` 里的 `position: absolute`
//   ⇒ **被整棵子树裁掉**。按钮点了、state 变了、tsc 与 build 全绿，画面上什么都没有。
//
// ⛔ 为什么这类错只能靠结构判据：
//   · `z-index` 再高也没用 —— overflow 裁剪与层叠次序无关；
//   · tsc / build / 三千多条守卫全部通过（合法 JSX + 合法 CSS）；
//   · 只有"这个弹层在不在被裁的子树里"能判，而那不是运行时错误。
//
// ⚠️ 判据形状（每条都对应一个真实踩过的坑）：
//   ① 三个弹层都必须 portal（`createPortal(..., document.body)`）—— 只改 position 不够；
//   ② 必须有 fixed 变体类，且该类里 `position: fixed` —— 否则 relative 坐标与 JS 坐标叠加；
//   ③ fixed 变体必须清掉 `top/right/bottom/left` 的相对值；
//   ④ fixed 的包含块是视口，但祖先链出现 transform/filter/contain 就被改锚 ⇒ 钉住没有；
//   ⑤ 定位必须按锚点按钮量（getBoundingClientRect），不能写死像素；
//   ⑥ z-index 必须高于 .topbar(30)。

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【popover】${m}`); if (!c) fails++; };

const seg = readFileSync(join(ROOT, "src/features/app-state/parts/part09/02-seg.tsx"), "utf8");
const dispatch = readFileSync(join(ROOT, "src/features/dispatch/DispatchMenu.tsx"), "utf8");
const hook = readFileSync(join(ROOT, "src/features/app-view/hooks/useAnchoredPopover.ts"), "utf8");
const cssTopbar = readFileSync(join(ROOT, "src/styles/02-sidebar-threads.css"), "utf8");
const cssMisc = readFileSync(join(ROOT, "src/styles/19-misc-hints.css"), "utf8");

// ── ① 三个弹层都必须 portal ──
// ⚠️ 判据不能靠"文件里出现 createPortal"（那证明不了是给弹层用的）；
//    也不能靠"在弹层标记附近 N 个字符内找 createPortal"—— 弹层内容有 80 行，
//    固定窗口必然不够（实测 90 行 className 到 document.body 跨了约 4KB）。
//    ✅ 稳定形状：**从该弹层的 createPortal( 往后找配对的 `document.body`**，
//       即"这个 portal 的落点是 body"，与弹层内容多长无关。
const portalTarget = (src, from = 0) => {
  const i = src.indexOf("createPortal(", from);
  if (i < 0) return null;
  // 该 portal 调用结束前必须出现 document.body
  const end = src.indexOf(")}", i);
  return /document\.body/.test(src.slice(i, end < 0 ? i + 20000 : end + 2)) ? i : -1;
};
const portalledAfter = (src, marker) => {
  const m = src.indexOf(marker);
  if (m < 0) return false;
  // 弹层 className 在 portal( 之后或之前都算（写法两种都合法）⇒ 双向找最近的 portal
  const before = src.lastIndexOf("createPortal(", m);
  const after = portalTarget(src, m);
  const viaBefore = before >= 0 && /document\.body/.test(src.slice(before, m));
  return after >= 0 || viaBefore;
};
ok(portalledAfter(seg, '"task-menu ctx-menu'), "ctx-menu 已 portal 到 body");
ok(portalledAfter(seg, '"task-menu task-menu'), "task-menu 已 portal 到 body");
ok(portalledAfter(dispatch, "dispatch-pop"), "dispatch-pop 已 portal 到 body");
// 兜底：三处都真的调了 createPortal（防止上面某个 marker 改名后静默通过）
const portalCount = (src) => (src.match(/createPortal\(/g) || []).length;
ok(portalCount(seg) >= 3, `顶栏段共 ${portalCount(seg)} 处 createPortal（搜索面板 + ctx + task）`);
ok(portalCount(dispatch) >= 1, `DispatchMenu 有 ${portalCount(dispatch)} 处 createPortal`);

// ── ②③ fixed 变体类 ──
// ⚠️ 两个形状陷阱（判据自己踩过）：
//   (a) 选择器**不一定是** `.xxx-fixed` 独立一条，可能写成 `.task-menu.ctx-menu-fixed`（复合）；
//   (b) 同一个类可能**分散在多条规则**里（如 `.ctx-menu-fixed{min-width}` + `.task-menu.ctx-menu-fixed{…}`）
//       —— 只取第一条会漏掉定位声明、判据恒红，看起来像"实现坏了"。
//    ⇒ 合并所有命中规则的声明体再判。
const ruleOf = (css, cls) => {
  const esc = cls.replace(".", "\\.");
  const re = new RegExp(`^[\\s]*[^{}]*${esc}\\s*\\{([^}]*)\\}`, "gm");
  const parts = [...css.matchAll(re)].map((m) => m[1]);
  return parts.join(";");
};
for (const [css, cls] of [
  [cssTopbar, ".ctx-menu-fixed"],
  [cssTopbar, ".task-menu-fixed"],
  [cssMisc, ".dispatch-pop-fixed"],
]) {
  const body = ruleOf(css, cls);
  ok(!!body, `${cls} 有规则（没被合并掉）`);
  ok(/position:\s*fixed/.test(body), `${cls} 是 position: fixed（absolute 会被祖先 overflow 裁掉）`);
  // ── ③ 必须清掉 relative 坐标（否则与 JS 坐标叠加，弹层跑到视口角上）──
  // `.task-menu` 给了 `top:calc(100%+6px); right:0`，`.dispatch-pop-down` 给了 `top/right`。
  const cleared = ["top", "right", "bottom", "left"].filter((k) =>
    new RegExp(`${k}:\\s*auto`).test(body));
  ok(cleared.includes("top") && cleared.includes("right"),
    `${cls} 清掉了相对定位（已清：${cleared.join("/") || "无"}）`);
}

// ── ④ 祖先链不得有 transform/filter/contain（fixed 包含块会被改锚 ⇒ 又被裁）──
{
  // 只查可能包住 .topbar 的容器选择器：带这些属性的规则若命中 topbar 链上的选择器就危险。
  const all = cssTopbar + cssMisc;
  const risky = [...all.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => /(^|[\s,>])\.topbar[\s.>,{:]/.test(m[1]))
    .filter((m) => /(transform|filter|contain|will-change|perspective)\s*:/.test(m[2]))
    .map((m) => m[1].trim().replace(/\s+/g, " ").slice(0, 50));
  ok(risky.length === 0, `.topbar 上无 transform/filter/contain（fixed 才不会被改锚）${risky.length ? `—— 有：${risky.join("/")}` : ""}`);
}

// ── ⑤ 定位必须按锚点量，不能写死像素 ──
ok(/getBoundingClientRect/.test(hook), "定位按锚点 getBoundingClientRect 量（写死像素会在缩放/换主题时错位）");
ok(/useAnchoredPopover/.test(seg), "顶栏弹层共用 useAnchoredPopover（⛔ 三处各写一份坐标算法 = 改一处忘两处）");
ok(/useAnchoredPopover/.test(dispatch), "DispatchMenu 也共用同一个 hook");
ok(/Math\.min\(window\.innerWidth/.test(hook), "坐标夹在视口内（否则窄屏时弹层跑出屏幕）");
ok(/resize/.test(hook), "监听 resize 重算（右侧面板开合/窗口缩放会改按钮位置）");

// ── ⑥ z-index 必须高于 .topbar(30) ──
{
  const topbarZ = /z-index:\s*(\d+)/.exec(/\.topbar\s*\{([^}]*)\}/.exec(cssTopbar)?.[1] ?? "")?.[1] ?? "0";
for (const [css, cls] of [[cssTopbar, ".task-menu-fixed"], [cssMisc, ".dispatch-pop-fixed"]]) {
  const z = Number((/z-index:\s*(\d+)/.exec(ruleOf(css, cls)) ?? [0, "0"])[1]);
  ok(z > Number(topbarZ), `${cls} 的 z-index(${z}) 高于 .topbar(${topbarZ})`);
}
}

// ── ⑦ 反向：`.topbar` 的 overflow 必须还在（它是修另一个真 bug 的，别为了这个 bug 撤掉）──
ok(
  /^\s*\.topbar\s*\{[^}]*overflow\s*:\s*hidden/m.test(cssTopbar),
  "⛔ .topbar 仍有 overflow:hidden（撤掉会让「图标压原生窗口钮」复发 —— 正确做法是改弹层，不是撤裁剪）",
);

console.log(`\n【popover】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
