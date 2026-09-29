/**
 * 守卫组 19 —— 层叠层级带（【198】）。
 *
 * 背景：09-29 用户截图「项目管理弹窗在 AI 画布弹窗下面」—— 画布里的项目面板 portal 到 body
 * 却没给 z-index（缺省 = 0），被 `z-index:90` 的画布整屏浮层盖住。排查发现同类隐患：
 * `.modal-backdrop`（帮助/插件配置/环境检查/模型引导）只有 30，同样低于画布 90。
 *
 * 层级带（DESIGN.md「层叠层级带」表）：
 *   主界面 <30 < 设置内 backdrop 80~97 < 画布 90 < 全局模态 400 < 轻浮层 1000/1001
 *   < 面板级 9500 < toast 9999~99999 < composer 10000~12000
 *
 * 判据（读 CSS 真值，不做「文件存在」检查）：
 *  ① 全局模态遮罩必须高于画布层（否则画布打开时模态弹不出来）
 *  ② 轻浮层必须高于全局模态（否则模态框里的下拉被遮罩盖住、点不动）
 *  ③ 画布域组件不许 createPortal（portal 出去就落主界面层，与画布 90 比大小必被盖）
 *  ④ 画布内弹层仍用 .drama-canvas-modal-mask（不许自造）
 */
import { C, ROOT, join, ok, fail, readFileSync, readdirSync } from "./_ctx.mjs";

/** 从 CSS 文本里取某选择器块的 z-index 数值（取第一处匹配） */
function zIndexOf(css, selector) {
  const idx = css.indexOf(selector);
  if (idx < 0) return null;
  const block = css.slice(idx, idx + 800);
  const m = /z-index:\s*(-?\d+)/.exec(block);
  return m ? Number(m[1]) : null;
}

export async function run() {
  console.log(C.bold("\n【198】层叠层级带"));

  const base = readFileSync(join(ROOT, "src", "styles", "01-base-and-chrome.css"), "utf8");
  const canvas = readFileSync(join(ROOT, "src", "styles", "21-drama-canvas.css"), "utf8");
  const mcp = readFileSync(join(ROOT, "src", "styles", "07-settings-mcp-connectors.css"), "utf8");

  const canvasLayer = zIndexOf(canvas, ".drama-canvas-backdrop {");
  const modalLayer = zIndexOf(mcp, ".modal-backdrop {");
  const selectOverlay = zIndexOf(base, ".app-select-overlay {");
  const selectList = zIndexOf(base, ".app-select-list {");

  // ① 全局模态必须高于画布
  (canvasLayer !== null && modalLayer !== null && modalLayer > canvasLayer ? ok : fail)(
    `【198】全局模态遮罩（.modal-backdrop=${modalLayer}）高于画布浮层（.drama-canvas-backdrop=${canvasLayer}）—— 否则画布打开时帮助/插件配置等弹不出来`
  );

  // ② 轻浮层（下拉）必须高于模态遮罩，且 list 高于 overlay
  (selectOverlay !== null && modalLayer !== null && selectOverlay > modalLayer ? ok : fail)(
    `【198】AppSelect 弹层（=${selectOverlay}）高于全局模态遮罩（=${modalLayer}）—— 模态框里的下拉被遮罩盖住就点不动`
  );
  (selectOverlay !== null && selectList !== null && selectList > selectOverlay ? ok : fail)(
    `【198】AppSelect 列表高于它自己的遮罩（${selectList} > ${selectOverlay}）`
  );

  // ③ 画布域组件不许 createPortal（唯一例外：无——画布内弹层全走画布内渲染）
  const dir = join(ROOT, "src", "features", "drama-canvas");
  const offenders = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx$/.test(entry.name)) continue;
    const code = readFileSync(join(dir, entry.name), "utf8")
      .split("\n")
      .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l))
      .join("\n");
    if (/\bcreatePortal\s*\(/.test(code)) offenders.push(entry.name);
  }
  (offenders.length === 0 ? ok : fail)(
    `【198】画布域组件不许 portal 到 body（${offenders.length ? "违规：" + offenders.join(", ") : "—— 弹层一律画布内渲染"}）`
  );

  // ④ 画布内弹层仍在用统一遮罩类
  const projects = readFileSync(join(dir, "DramaProjectsPanel.tsx"), "utf8");
  (projects.includes('className="drama-canvas-modal-mask"') ? ok : fail)(
    "【198】项目面板用画布统一遮罩类（.drama-canvas-modal-mask —— 层级由画布 stacking context 决定）"
  );
}
