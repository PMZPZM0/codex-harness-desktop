// scripts/accept.mjs —— 当前版本验收（10-25 起只保留本轮功能，历史项已删除）
//
// 用户 10-25：「你这个验收脚本，老是跑很久之前的内容干嘛，能不能删了，重新写」。
// 因此本文件只保留当前要守的三条链路：
//   ① settings-pages：设置页逐页可打开 + 外观/外观头像 / 布布包 / 用户人格位置
//   ② function-menu：侧栏顶部「新会话 / 搜索任务」+ 两处折叠 + 拖动 + 更多 + 教程
//   ③ plugin-market-gitee：插件市场 Gitee raw / jsDelivr 兜底（403 限流回归）
//
// 用法：
//   node scripts/accept.mjs                 # 跑全部当前项
//   node scripts/accept.mjs --only <id>     # 只跑某一项
//   node scripts/accept.mjs --list
//   node scripts/accept.mjs --keep          # 跑完不关应用
//   node scripts/accept.mjs --profile main  # 换一个持久 profile
//
// 被测 profile：.e2e-profile/<name>/（跨轮复用，含真实历史；勿入库）

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ElectronHarness } from "./e2e/lib/harness.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function enterMain(h) {
  await h.waitFor(
    `(document.body && document.body.innerText.includes("直接进入")) || !!document.querySelector(".app-shell")`,
    { label: "引导页或主界面", timeoutMs: 40000 }
  );
  if (await h.eval(`document.body.innerText.includes("直接进入")`)) {
    await h.clickByText("暂时不登录，直接进入").catch(() => undefined);
  }
  await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "app-shell 挂载", timeoutMs: 30000 });
  await wait(1500);
}

const CHECKS = [
  {
    id: "settings-current",
    name: "设置页（只测当前关键页：用户中心 / 人格市场 / 外观 —— 不再逐页点选项）",
    run: async (h) => {
      await h.eval(`(function(){ document.querySelector(".sidebar-settings")?.click(); return 1; })()`);
      await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置面板", timeoutMs: 8000 });
      await wait(900);
      const nav = async (label) => h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-nav button")].find(function(x){ return (x.textContent||"").trim()===${JSON.stringify(label)}; }); if(!b) return 0; b.click(); return 1; })()`);
      const cur = async () => h.eval(`(function(){ const m=document.querySelector(".settings-modal"); return m ? (m.querySelector(".settings-nav button.active")?.textContent||"").trim() : ""; })()`);

      await nav("用户中心");
      await wait(1000);
      const uc = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const panel=m.querySelector(".bubu-pack-panel");
        const cols=(sel)=>{ const el=m.querySelector(sel); return el?getComputedStyle(el).gridTemplateColumns.split(" ").length:0; };
        return { avatars:[...m.querySelectorAll(".uc-presets button")].map((b)=>b.title),
          codex:[...m.querySelectorAll(".codex-id-preset")].map((b)=>b.title),
          userCols:cols(".uc-presets"), codexCols:cols(".codex-id-preset-grid"),
          bubuAvatars:panel?panel.querySelectorAll(".bubu-pack-avatar").length:0,
          bubuStickers:panel?panel.querySelectorAll(".bubu-pack-stickers img").length:0,
          voiceSelect:panel?panel.querySelectorAll(".bubu-pack-voice").length:0,
          previewBtn:panel?[...panel.querySelectorAll("button")].some((b)=>(b.textContent||"").includes("试听语音")):false,
          userPersonaHere:!!m.querySelector(".user-persona-grid") };
      })()`).catch(() => null);
      h.check("① 用户中心：熊头像双端可选（5 列）+ 布布包头像/贴纸/音色/试听齐全，用户人格已移出",
        Boolean(uc && ["棕熊","白熊","双熊"].every((t)=>uc.avatars.includes(t) && uc.codex.includes(t))
          && uc.userCols===5 && uc.codexCols===5 && uc.bubuAvatars===2 && uc.bubuStickers===5
          && uc.voiceSelect===1 && uc.previewBtn && !uc.userPersonaHere),
        JSON.stringify(uc));

      await nav("人格市场");
      await wait(1500);
      const soul = await h.eval(`(function(){ const m=document.querySelector(".settings-modal"); if(!m) return null;
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          market:!!m.querySelector(".soul-market"), persona:!!m.querySelector(".user-persona-grid") }; })()`).catch(() => null);
      h.check("② 人格市场：用户人格与 Codex 人格同页", Boolean(soul && soul.market && soul.persona), JSON.stringify(soul));

      await nav("外观");
      await wait(1000);
      const look = await h.eval(`(function(){ const m=document.querySelector(".settings-modal"); if(!m) return null;
        const card=[...m.querySelectorAll(".card-reasoning")].find((x)=>(x.textContent||"").includes("思考板块展示"));
        const fn=m.querySelector(".appearance-function-card");
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          has:!!card, above:!!(card&&fn&&card.getBoundingClientRect().top < fn.getBoundingClientRect().top) }; })()`).catch(() => null);
      h.check("③ 外观：思考板块在功能入口上方", Boolean(look && look.has && look.above), JSON.stringify(look));
      await h.pressKey("Escape");
      await wait(300);
    },
  },
  {
    id: "function-menu",
    name: "🧩 功能入口：新建/搜索下面或侧栏底部 + 拖动排序 + 更多 + 首次教程（10-24）",
    run: async (h) => {
      /* 用户 10-24：功能入口菜单要放在「新会话 / 搜索任务」下面（老版位置），也可选侧栏底部；
         支持首次悬停教程、编辑菜单拖动排序、拖进「更多」。两种位置共用同一套配置。 */
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "界面就绪", timeoutMs: 40000 });
      await h.eval(`(function(){ document.querySelector(".office-overlay-close")?.click(); document.querySelector(".function-menu-editor .fm-editor-close")?.click(); return 1; })()`).catch(() => undefined);
      await wait(400);
      await h.waitFor(`!!document.querySelector(".function-menu-sidebar")`, { label: "功能入口就绪", timeoutMs: 15000 }).catch(() => undefined);
      // 先统一重置：位置回顶部、排序/更多恢复默认（上一轮失败可能留下 overflow）
      await h.eval(`document.querySelector(".function-menu-sidebar .function-menu-more")?.click()`).catch(() => undefined);
      await wait(250);
      await h.eval(`[...document.querySelectorAll(".function-menu-popover-item")].find((b) => b.innerText.includes("编辑菜单"))?.click()`).catch(() => undefined);
      await h.waitFor(`!!document.querySelector(".function-menu-editor")`, { timeoutMs: 4000 }).catch(() => undefined);
      await h.eval(`document.querySelectorAll(".fm-location-card")[0]?.click()`).catch(() => undefined);
      await wait(200);
      await h.eval(`[...document.querySelectorAll(".fm-editor-foot button")].find((b) => b.innerText.includes("恢复默认"))?.click()`).catch(() => undefined);
      await wait(250);
      await h.eval(`[...document.querySelectorAll(".fm-editor-foot button")].find((b) => b.innerText.includes("完成"))?.click()`).catch(() => undefined);
      await wait(500);
      // 折叠态跨重启保留：上一轮收起了就先展开，后面要量真实高度/拖动
      if (await h.eval(`document.querySelector(".sidebar-options-top .sidebar-options-body")?.classList.contains("is-collapsed")`).catch(() => false)) {
        await h.eval(`document.querySelector(".sidebar-options-top .sidebar-options-toggle")?.click()`).catch(() => undefined);
        await wait(350);
      }
      // 折叠动画在后台窗口可能被节流：测试里等 React 提交后把 CSS 过渡直接推到终点再量高度。
      const settleAnimations = async () => {
        await h.eval(`(function(){ void document.body.offsetHeight; document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }); return 1; })()`).catch(() => undefined);
        await wait(80);
      };
      // 10-24 用户对照截图：顶部改成整行「新会话」+ 下一行「搜索任务」（不再并排胶囊）
      const quickLayout = await h.eval(`(function(){
        const box=document.querySelector(".sidebar-quick");
        const btns=[...box.querySelectorAll(".sidebar-quick-btn")];
        const a=btns[0]?.getBoundingClientRect(), b=btns[1]?.getBoundingClientRect();
        return { n:btns.length, labels:btns.map((x)=>x.innerText.trim()),
          stacked:!!(a&&b&&b.top>=a.bottom-1), sameWidth:!!(a&&b&&Math.abs(a.width-b.width)<1),
          sameLeft:!!(a&&b&&Math.abs(a.left-b.left)<1), width:a?.width||0,
          searchAlign:btns[1]?getComputedStyle(btns[1]).justifyContent:"" };
      })()`).catch(() => null);
      h.check("⓪ 顶部为整行「新会话」+ 下一行左对齐「搜索任务」（上下堆叠、同宽同左，不再并排胶囊）",
        Boolean(quickLayout && quickLayout.n >= 2 && quickLayout.labels[0] === "新会话" && quickLayout.labels[1] === "搜索任务"
          && quickLayout.stacked && quickLayout.sameWidth && quickLayout.sameLeft && quickLayout.width > 120
          && quickLayout.searchAlign === "flex-start"),
        JSON.stringify(quickLayout));
      const base = await h.eval(`(function(){
        const group = document.querySelector(".sidebar-options-top");
        const quick = document.querySelector(".sidebar-quick")?.getBoundingClientRect();
        const rect = group?.getBoundingClientRect();
        const searchText = document.querySelector(".sidebar-quick-search span")?.getBoundingClientRect().left;
        const headerText = group?.querySelector(".sidebar-options-toggle > span")?.getBoundingClientRect().left;
        return { sidebar: !!document.querySelector(".function-menu-sidebar"), top: !!group,
          underQuick: Boolean(quick && rect && rect.top >= quick.bottom - 1 && rect.top <= quick.bottom + 28),
          gap: quick && rect ? Math.round(rect.top - quick.bottom) : 999,
          toggle: !!group?.querySelector(".sidebar-options-toggle"),
          body: !!group?.querySelector(".sidebar-options-body"),
          icon: !!group?.querySelector(".sidebar-options-toggle svg"),
          textAligned: searchText != null && headerText != null && Math.abs(searchText - headerText) <= 1,
          labels: [...document.querySelectorAll(".function-menu-sidebar .sidebar-cap-row")].map((b) => b.innerText.trim()),
          more: !!document.querySelector(".function-menu-sidebar .function-menu-more") };
      })()`).catch(() => null);
      h.check("① 功能入口在「新会话 / 搜索任务」下面（7 项 + 更多），整个入口组可见",
        Boolean(base && base.sidebar && base.top && base.underQuick && base.labels.length === 8 && base.more
          && ["自动化", "前端开发", "拓展", "团队", "个性化&记忆", "登录管理", "新手教程"].every((label) => base.labels.includes(label))),
        JSON.stringify(base));
      h.check("①b 顶部入口紧贴搜索任务（间距 ≤10px），有图标且文字与「搜索任务」左对齐",
        Boolean(base && base.gap >= 0 && base.gap <= 10 && base.toggle && base.body && base.icon && base.textAligned), JSON.stringify(base));

      // 首次悬停教程：清掉已看标记再 hover
      await h.eval(`localStorage.removeItem("function-menu-tour-seen-v1-top")`).catch(() => undefined);
      await h.hover(".sidebar-options-top");
      await wait(200);
      await h.hover(".sidebar-options-top .sidebar-options-toggle");
      // CDP 鼠标可能本来就在侧栏里 ⇒ mouseenter 不触发；补一次合成 mouseover（React 由它合成 onMouseEnter）
      await wait(200);
      await h.eval(`(function(){ const el=document.querySelector(".sidebar-options-top .sidebar-options-toggle"); el?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); return 1; })()`).catch(() => undefined);
      await h.waitFor(`!!document.querySelector(".function-menu-tour")`, { timeoutMs: 3000 }).catch(() => undefined);
      const tour = await h.eval(`document.querySelector(".function-menu-tour")?.innerText || ""`).catch(() => "");
      h.check("② 首次悬停弹出教程（说明编辑菜单 / 拖进更多 / 设置里切换位置）",
        tour.includes("让功能入口更顺手") && tour.includes("编辑菜单") && tour.includes("拖进") && tour.includes("设置 → 外观"),
        JSON.stringify({ tour: tour.slice(0, 80) }));
      await h.eval(`[...document.querySelectorAll(".function-menu-tour-actions button")].find((b) => b.innerText.includes("知道了"))?.click()`).catch(() => undefined);
      await wait(200);

      // 更多 → 编辑菜单
      await h.eval(`document.querySelector(".function-menu-sidebar .function-menu-more")?.click()`).catch(() => undefined);
      await wait(250);
      await h.eval(`[...document.querySelectorAll(".function-menu-popover-item")].find((b) => b.innerText.includes("编辑菜单"))?.click()`).catch(() => undefined);
      await h.waitFor(`!!document.querySelector(".function-menu-editor")`, { label: "编辑菜单弹窗", timeoutMs: 4000 }).catch(() => undefined);
      const editor = await h.eval(`(function(){
        return { open: !!document.querySelector(".function-menu-editor"),
          cols: [...document.querySelectorAll(".fm-edit-col")].map((c) => c.querySelectorAll(".fm-edit-row").length),
          locations: [...document.querySelectorAll(".fm-location-card")].map((b) => b.innerText.trim().split("\\n")[0]) };
      })()`).catch(() => null);
      h.check("③ 更多 → 编辑菜单：弹窗有显示 / 更多两列 + 顶部/底部两个展示位置",
        Boolean(editor && editor.open && editor.cols[0] >= 1 && editor.locations.length === 2 && editor.locations.includes("侧栏顶部") && editor.locations.includes("侧栏底部")),
        JSON.stringify(editor));

      // 拖动第一项到「更多」列
      const firstLabel = await h.eval(`document.querySelector(".fm-edit-row")?.innerText.trim() || ""`).catch(() => "");
      await h.eval(`(function(){
        const row = document.querySelector(".fm-edit-row"); if (!row) return 0;
        const dt = new DataTransfer(); window.__fmDt = dt;
        row.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
        return 1;
      })()`).catch(() => 0);
      await wait(150);
      await h.eval(`(function(){
        const list = document.querySelectorAll(".fm-edit-col")[1]?.querySelector(".fm-edit-list"); if (!list) return 0;
        list.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: window.__fmDt }));
        list.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: window.__fmDt }));
        return 1;
      })()`).catch(() => 0);
      await wait(250);
      const dragged = await h.eval(`(function(){
        const overflow = [...document.querySelectorAll(".fm-edit-col")[1].querySelectorAll(".fm-edit-label")].map((e) => e.innerText.trim());
        return { first: ${JSON.stringify(firstLabel)}, overflow,
          badge: document.querySelector(".function-menu-sidebar .function-menu-more-badge")?.innerText.trim() || "" };
      })()`).catch(() => null);
      h.check("④ 拖动入口到「更多」：进入更多列并在侧栏「更多」上出现角标",
        Boolean(dragged && dragged.overflow.includes(dragged.first.trim()) && Number(dragged.badge) >= 1),
        JSON.stringify(dragged));

      // 移回（用行尾按钮，与拖动落点同源）
      await h.eval(`(function(){ const row = document.querySelectorAll(".fm-edit-col")[1]?.querySelector(".fm-edit-row"); const btns = row ? row.querySelectorAll("button") : []; btns[2]?.click(); return 1; })()`).catch(() => 0);
      await wait(250);
      const movedBack = await h.eval(`(function(){
        return { overflowCount: document.querySelectorAll(".fm-edit-col")[1]?.querySelectorAll(".fm-edit-row").length || 0,
          badge: document.querySelector(".function-menu-sidebar .function-menu-more-badge")?.innerText.trim() || "" };
      })()`).catch(() => null);
      h.check("⑤ 从「更多」移回菜单：更多列清空、角标消失", Boolean(movedBack && movedBack.overflowCount === 0 && !movedBack.badge), JSON.stringify(movedBack));

      // 切到侧栏底部：入口组消失于顶部、改在账户行之前
      await h.eval(`document.querySelectorAll(".fm-location-card")[1]?.click()`).catch(() => undefined);
      await wait(400);
      await h.eval(`[...document.querySelectorAll(".fm-editor-foot button")].find((b) => b.innerText.includes("完成"))?.click()`).catch(() => undefined);
      await wait(400);
      const bottom = await h.eval(`(function(){
        const group = document.querySelector(".sidebar-options:not(.sidebar-options-top)");
        const rect = group?.getBoundingClientRect();
        const account = document.querySelector(".account-row")?.getBoundingClientRect();
        return { top: !!document.querySelector(".sidebar-options-top"), bottom: !!group,
          aboveAccount: Boolean(rect && account && rect.bottom <= account.top + 1),
          count: group ? group.querySelectorAll(".sidebar-cap-row").length : 0 };
      })()`).catch(() => null);
      h.check("⑥ 切到侧栏底部：入口组移到用户名上方、顶部组消失（共用顺序/更多配置）",
        Boolean(bottom && !bottom.top && bottom.bottom && bottom.aboveAccount && bottom.count === 8),
        JSON.stringify(bottom));
      // ⑦ 底部组折叠/展开：grid 高度过渡到 0，再点恢复（两处位置都支持）
      await h.eval(`document.querySelector(".sidebar-options:not(.sidebar-options-top) .sidebar-options-toggle")?.click()`).catch(() => undefined);
      await wait(150);
      await settleAnimations();
      const bottomCollapsed = await h.eval(`(function(){
        const g=document.querySelector(".sidebar-options:not(.sidebar-options-top)");
        const body=g?.querySelector(".sidebar-options-body");
        const nav=g?.querySelector(".sidebar-nav-bottom");
        return { cls:body?.classList.contains("is-collapsed")||false,
          bodyH:body?Math.round(body.getBoundingClientRect().height):-1,
          navH:nav?Math.round(nav.getBoundingClientRect().height):-1,
          aria:nav?.getAttribute("aria-hidden")||"",
          rows:body?getComputedStyle(body).gridTemplateRows:"",
          display:body?getComputedStyle(body).display:"",
          navOverflow:nav?getComputedStyle(nav).overflowY:"" };
      })()`).catch(() => null);
      h.check("⑦ 底部组可折叠：点击后高度收至 0 且 aria-hidden",
        Boolean(bottomCollapsed && bottomCollapsed.cls && bottomCollapsed.bodyH <= 4 && bottomCollapsed.navH <= 4 && bottomCollapsed.aria === "true"),
        JSON.stringify(bottomCollapsed));
      await h.eval(`document.querySelector(".sidebar-options:not(.sidebar-options-top) .sidebar-options-toggle")?.click()`).catch(() => undefined);
      await wait(150);
      await settleAnimations();
      const bottomExpanded = await h.eval(`(function(){
        const g=document.querySelector(".sidebar-options:not(.sidebar-options-top)");
        const body=g?.querySelector(".sidebar-options-body");
        const nav=g?.querySelector(".sidebar-nav-bottom");
        return { cls:body?.classList.contains("is-collapsed")||false,
          bodyH:body?Math.round(body.getBoundingClientRect().height):-1,
          navH:nav?Math.round(nav.getBoundingClientRect().height):-1,
          aria:nav?.getAttribute("aria-hidden")||"" };
      })()`).catch(() => null);
      h.check("⑦b 底部组再点展开：高度恢复、aria-hidden 复位（无缝动画）",
        Boolean(bottomExpanded && !bottomExpanded.cls && bottomExpanded.bodyH > 80 && bottomExpanded.navH > 80 && bottomExpanded.aria === "false"),
        JSON.stringify(bottomExpanded));

      // ⑧ 切回顶部并恢复默认排序
      await h.eval(`document.querySelector(".sidebar-options:not(.sidebar-options-top) .function-menu-more")?.click()`).catch(() => undefined);
      await wait(250);
      await h.eval(`[...document.querySelectorAll(".function-menu-popover-item")].find((b) => b.innerText.includes("编辑菜单"))?.click()`).catch(() => undefined);
      await h.waitFor(`!!document.querySelector(".function-menu-editor")`, { timeoutMs: 4000 }).catch(() => undefined);
      await h.eval(`document.querySelectorAll(".fm-location-card")[0]?.click()`).catch(() => undefined);
      await wait(250);
      await h.eval(`[...document.querySelectorAll(".fm-editor-foot button")].find((b) => b.innerText.includes("恢复默认"))?.click()`).catch(() => undefined);
      await wait(250);
      await h.eval(`[...document.querySelectorAll(".fm-editor-foot button")].find((b) => b.innerText.includes("完成"))?.click()`).catch(() => undefined);
      await wait(400);
      const restored = await h.eval(`(function(){
        const group = document.querySelector(".sidebar-options-top");
        const quick = document.querySelector(".sidebar-quick")?.getBoundingClientRect();
        const rect = group?.getBoundingClientRect();
        return { top: !!group, bottom: !!document.querySelector(".sidebar-options:not(.sidebar-options-top)"),
          underQuick: Boolean(quick && rect && rect.top >= quick.bottom - 1 && rect.top <= quick.bottom + 28),
          count: group ? group.querySelectorAll(".sidebar-cap-row").length : 0,
          badge: !!group?.querySelector(".function-menu-more-badge") };
      })()`).catch(() => null);
      h.check("⑧ 顶部位置恢复 + 默认排序（不留上一步的位置配置）",
        Boolean(restored && restored.top && !restored.bottom && restored.underQuick && restored.count === 8 && !restored.badge),
        JSON.stringify(restored));

      // ⑨ 顶部组折叠/展开（与底部同款 grid 高度动画）
      await h.eval(`document.querySelector(".sidebar-options-top .sidebar-options-toggle")?.click()`).catch(() => undefined);
      await wait(150);
      await settleAnimations();
      const topCollapsed = await h.eval(`(function(){
        const g=document.querySelector(".sidebar-options-top");
        const body=g?.querySelector(".sidebar-options-body");
        const nav=g?.querySelector(".sidebar-nav-bottom");
        return { cls:body?.classList.contains("is-collapsed")||false,
          bodyH:body?Math.round(body.getBoundingClientRect().height):-1,
          navH:nav?Math.round(nav.getBoundingClientRect().height):-1,
          aria:nav?.getAttribute("aria-hidden")||"" };
      })()`).catch(() => null);
      h.check("⑨ 顶部组可折叠：点击后高度收至 0，搜索任务下方不再占位",
        Boolean(topCollapsed && topCollapsed.cls && topCollapsed.bodyH <= 4 && topCollapsed.navH <= 4 && topCollapsed.aria === "true"),
        JSON.stringify(topCollapsed));
      await h.eval(`document.querySelector(".sidebar-options-top .sidebar-options-toggle")?.click()`).catch(() => undefined);
      await wait(150);
      await settleAnimations();
      const topExpanded = await h.eval(`(function(){
        const g=document.querySelector(".sidebar-options-top");
        const body=g?.querySelector(".sidebar-options-body");
        const nav=g?.querySelector(".sidebar-nav-bottom");
        return { cls:body?.classList.contains("is-collapsed")||false,
          bodyH:body?Math.round(body.getBoundingClientRect().height):-1,
          navH:nav?Math.round(nav.getBoundingClientRect().height):-1,
          aria:nav?.getAttribute("aria-hidden")||"" };
      })()`).catch(() => null);
      h.check("⑨b 顶部组再点展开：高度恢复（与底部同款无缝过渡）",
        Boolean(topExpanded && !topExpanded.cls && topExpanded.bodyH > 80 && topExpanded.navH > 80 && topExpanded.aria === "false"),
        JSON.stringify(topExpanded));
      await h.screenshot("function-menu");

      // ⑩ 侧栏里直接拖动排序：不用打开编辑弹窗，落手即写回配置
      const dragBefore = await h.eval(`(function(){
        const rows=[...document.querySelectorAll(".sidebar-options-top .sidebar-cap-row:not(.function-menu-more)")];
        let stored=null; try { stored=JSON.parse(localStorage.getItem("function-menu-v1") || "null"); } catch {}
        return { labels: rows.map((b)=>b.querySelector("span")?.innerText.trim()), order: stored?.order || [] };
      })()`).catch(() => null);
      await h.eval(`(function(){
        const rows=[...document.querySelectorAll(".sidebar-options-top .sidebar-cap-row:not(.function-menu-more)")];
        if (rows.length < 2) return 0;
        const dt=new DataTransfer(); window.__fmDt=dt;
        rows[1].dispatchEvent(new DragEvent("dragstart", { bubbles:true, cancelable:true, dataTransfer:dt }));
        return 1;
      })()`).catch(() => 0);
      await wait(200);
      await h.eval(`(function(){
        const rows=[...document.querySelectorAll(".sidebar-options-top .sidebar-cap-row:not(.function-menu-more)")];
        if (rows.length < 2) return 0;
        rows[0].dispatchEvent(new DragEvent("dragover", { bubbles:true, cancelable:true, dataTransfer:window.__fmDt }));
        rows[0].dispatchEvent(new DragEvent("drop", { bubbles:true, cancelable:true, dataTransfer:window.__fmDt }));
        return 1;
      })()`).catch(() => 0);
      await wait(350);
      const dragAfter = await h.eval(`(function(){
        const top=document.querySelector(".sidebar-options-top");
        const labels=[...top.querySelectorAll(".sidebar-cap-row:not(.function-menu-more)")].map((b)=>b.querySelector("span")?.innerText.trim());
        let stored=null; try { stored=JSON.parse(localStorage.getItem("function-menu-v1") || "null"); } catch {}
        return { labels, order: stored?.order || [], location: stored?.location || "",
          bottom: !!document.querySelector(".sidebar-options:not(.sidebar-options-top)") };
      })()`).catch(() => null);
      h.check("⑩ 侧栏直接拖动即生效：首两项立即换位、配置同步（无需点完成）",
        Boolean(dragBefore && dragAfter && dragBefore.labels[0] === dragAfter.labels[1] && dragBefore.labels[1] === dragAfter.labels[0]
          && dragAfter.order[0] === dragBefore.order[1] && dragAfter.location === "top" && !dragAfter.bottom),
        JSON.stringify({ before: dragBefore, after: dragAfter }));
      // ⑩b 改动落到主进程 app-settings.json（重启/强杀后的回灌源）
      const persisted = await h.eval(`window.codex.readAppSettings().then((s) => ({ fm: s.functionMenu, collapsed: s.sidebarOptionsCollapsed })).catch((e) => ({ error: String(e) }))`).catch(() => null);
      h.check("⑩b 位置/顺序/折叠态已写入主进程 app-settings（重启后回灌）",
        Boolean(persisted && persisted.fm && persisted.fm.location === "top" && persisted.fm.order && persisted.fm.order[0] === dragBefore?.order[1]
          && persisted.collapsed === false),
        JSON.stringify(persisted));

      // ⑪ 收尾恢复默认排序（不留测试配置）
      await h.eval(`document.querySelector(".sidebar-options-top .function-menu-more")?.click()`).catch(() => undefined);
      await wait(250);
      await h.eval(`[...document.querySelectorAll(".function-menu-popover-item")].find((b) => b.innerText.includes("编辑菜单"))?.click()`).catch(() => undefined);
      await h.waitFor(`!!document.querySelector(".function-menu-editor")`, { timeoutMs: 4000 }).catch(() => undefined);
      await h.eval(`[...document.querySelectorAll(".fm-editor-foot button")].find((b) => b.innerText.includes("恢复默认"))?.click()`).catch(() => undefined);
      await wait(250);
      await h.eval(`[...document.querySelectorAll(".fm-editor-foot button")].find((b) => b.innerText.includes("完成"))?.click()`).catch(() => undefined);
      await wait(400);
      const final = await h.eval(`(function(){
        const group = document.querySelector(".sidebar-options-top");
        return { top: !!group, count: group ? group.querySelectorAll(".sidebar-cap-row").length : 0,
          badge: !!group?.querySelector(".function-menu-more-badge"),
          collapsed: !!group?.querySelector(".sidebar-options-body.is-collapsed") };
      })()`).catch(() => null);
      h.check("⑪ 收尾恢复默认排序、顶部展开（不留测试配置）",
        Boolean(final && final.top && final.count === 8 && !final.badge && !final.collapsed),
        JSON.stringify(final));

      // ⑫ 强杀重启：用户改动后的位置/顺序/折叠态必须原样回来（即使 localStorage 最后写入丢了）
      const persistBefore = await h.eval(`(function(){
        const rows=[...document.querySelectorAll(".sidebar-options-top .sidebar-cap-row:not(.function-menu-more)")];
        let stored=null; try { stored=JSON.parse(localStorage.getItem("function-menu-v1") || "null"); } catch {}
        return { labels: rows.map((b)=>b.querySelector("span")?.innerText.trim()), order: stored?.order || [] };
      })()`).catch(() => null);
      await h.eval(`(function(){
        const rows=[...document.querySelectorAll(".sidebar-options-top .sidebar-cap-row:not(.function-menu-more)")];
        if (rows.length < 2) return 0;
        const dt=new DataTransfer(); window.__fmDt=dt;
        rows[1].dispatchEvent(new DragEvent("dragstart", { bubbles:true, cancelable:true, dataTransfer:dt }));
        return 1;
      })()`).catch(() => 0);
      await wait(200);
      await h.eval(`(function(){
        const rows=[...document.querySelectorAll(".sidebar-options-top .sidebar-cap-row:not(.function-menu-more)")];
        if (rows.length < 2) return 0;
        rows[0].dispatchEvent(new DragEvent("dragover", { bubbles:true, cancelable:true, dataTransfer:window.__fmDt }));
        rows[0].dispatchEvent(new DragEvent("drop", { bubbles:true, cancelable:true, dataTransfer:window.__fmDt }));
        return 1;
      })()`).catch(() => 0);
      await wait(500);
      await h.eval(`document.querySelector(".sidebar-options-top .sidebar-options-toggle")?.click()`).catch(() => undefined);
      await wait(150);
      await settleAnimations();
      const beforeRestart = await h.eval(`(function(){
        const group=document.querySelector(".sidebar-options-top");
        const body=group?.querySelector(".sidebar-options-body");
        const rows=[...group.querySelectorAll(".sidebar-cap-row:not(.function-menu-more)")];
        let stored=null; try { stored=JSON.parse(localStorage.getItem("function-menu-v1") || "null"); } catch {}
        return { labels: rows.map((b)=>b.querySelector("span")?.textContent.trim()), order: stored?.order || [],
          location: stored?.location || "", collapsed: body?.classList.contains("is-collapsed") || false };
      })()`).catch(() => null);
      const persistedBeforeRestart = await h.eval(`window.codex.readAppSettings().then((s)=>({ fm:s.functionMenu, collapsed:s.sidebarOptionsCollapsed })).catch((e)=>({ error:String(e) }))`).catch(() => null);
      h.check("⑫a 重启前：位置/顺序/折叠态已在主进程落盘",
        Boolean(beforeRestart && persistedBeforeRestart?.fm && persistedBeforeRestart.fm.location === "top"
          && persistedBeforeRestart.fm.order?.[0] === beforeRestart.order?.[0]
          && persistedBeforeRestart.collapsed === true && beforeRestart.collapsed), JSON.stringify({ beforeRestart, persistedBeforeRestart }));

      // 模拟强杀时 localStorage 丢/旧：故意写一份错误值，重启后必须以 app-settings 为准回灌
      await h.eval(`(function(){
        try {
          localStorage.setItem("function-menu-v1", JSON.stringify({ location: "bottom", order: ["newbie","login","identity","team","extensions","frontend","schedule"], overflow: [] }));
          localStorage.setItem("sidebar-options-collapsed", "false");
        } catch {}
        return 1;
      })()`).catch(() => undefined);

      await h.restart();
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "重启后界面就绪", timeoutMs: 40000 });
      await wait(1800);
      const afterRestart = await h.eval(`(function(){
        const group=document.querySelector(".sidebar-options-top");
        const body=group?.querySelector(".sidebar-options-body");
        const rows=group ? [...group.querySelectorAll(".sidebar-cap-row:not(.function-menu-more)")] : [];
        let stored=null; try { stored=JSON.parse(localStorage.getItem("function-menu-v1") || "null"); } catch {}
        return { top: !!group, bottom: !!document.querySelector(".sidebar-options:not(.sidebar-options-top)"),
          labels: rows.map((b)=>b.querySelector("span")?.textContent.trim()),
          order: stored?.order || [], location: stored?.location || "",
          collapsed: body?.classList.contains("is-collapsed") || false,
          bodyH: body ? Math.round(body.getBoundingClientRect().height) : -1 };
      })()`).catch(() => null);
      h.check("⑫ 强杀重启后仍是用户改动后的状态（顶部 + 自定义顺序 + 折叠）",
        Boolean(afterRestart && afterRestart.top && !afterRestart.bottom && afterRestart.location === "top"
          && afterRestart.order?.[0] === beforeRestart?.order?.[0]
          && afterRestart.labels?.[0] === beforeRestart?.labels?.[0] && afterRestart.collapsed && afterRestart.bodyH <= 4),
        JSON.stringify({ beforeRestart, afterRestart }));

      // ⑫b 收尾：展开并恢复默认排序
      await h.eval(`document.querySelector(".sidebar-options-top .sidebar-options-toggle")?.click()`).catch(() => undefined);
      await wait(150);
      await settleAnimations();
      await h.eval(`document.querySelector(".sidebar-options-top .function-menu-more")?.click()`).catch(() => undefined);
      await wait(250);
      await h.eval(`[...document.querySelectorAll(".function-menu-popover-item")].find((b) => b.innerText.includes("编辑菜单"))?.click()`).catch(() => undefined);
      await h.waitFor(`!!document.querySelector(".function-menu-editor")`, { timeoutMs: 4000 }).catch(() => undefined);
      await h.eval(`[...document.querySelectorAll(".fm-editor-foot button")].find((b) => b.innerText.includes("恢复默认"))?.click()`).catch(() => undefined);
      await wait(250);
      await h.eval(`[...document.querySelectorAll(".fm-editor-foot button")].find((b) => b.innerText.includes("完成"))?.click()`).catch(() => undefined);
      await wait(400);
      const afterCleanup = await h.eval(`(function(){
        const group=document.querySelector(".sidebar-options-top");
        return { top: !!group, count: group ? group.querySelectorAll(".sidebar-cap-row").length : 0,
          collapsed: !!group?.querySelector(".sidebar-options-body.is-collapsed"),
          first: group?.querySelector(".sidebar-cap-row span")?.innerText.trim() || "" };
      })()`).catch(() => null);
      h.check("⑫b 重启持久性测试收尾：解除折叠并恢复默认顺序",
        Boolean(afterCleanup && afterCleanup.top && afterCleanup.count === 8 && !afterCleanup.collapsed && afterCleanup.first === "自动化"),
        JSON.stringify(afterCleanup));
    },
  },
  {
    id: "plugin-market-gitee",
    name: "⑲ 插件市场换源（Gitee 官方镜像 / 48 个 Codex 兼容插件 / 分类与文案）",
    run: async (h) => {
      // 为什么断言这一条：10-01 用户发现 SkillHub 插件源几乎全为 DeepSeek Harness（DSH）生态
      // 装不上，令换国内兼容源。新源 = Gitee 上的 Claude Code 官方插件市场镜像（48 个，
      // 100% .claude-plugin 兼容）。安装链路已在换源时用真实下载探针验证（10/10 文件成功）。
      // ① 市场清单真拉到：走真实 IPC（Gitee API），条目 ≥40 且全部带 pluginPath（=兼容）
      const list = await h.eval(`window.codex.listMarketPlugins({ page: 1, pageSize: 30 }).then((r) => ({
        total: r.total, first: r.items[0] ? { name: r.items[0].name, path: r.items[0].pluginPath, src: r.items[0].source } : null,
      })).catch((e) => ({ error: String(e) }))`);
      h.check("① 市场清单真拉到（Gitee 源 ≥40 个插件）",
        (list?.total ?? 0) >= 40 && list?.first?.path, JSON.stringify(list).slice(0, 140));
      // ② 条目指向 Gitee 镜像源（不再是 SkillHub / DSH）
      h.check("② 条目标注 Gitee 官方镜像且带兼容插件路径",
        list?.first?.src === "Gitee 官方镜像" && String(list?.first?.path ?? "").startsWith("plugins/"), JSON.stringify(list?.first));
      // ③ UI：打开插件设置页，市场标题换源文案 + 无 DSH 报错文案残留
      await h.eval(`(function(){ document.querySelector('.sidebar-settings')?.click(); return 1; })()`);
      await wait(1400);
      const nav = await h.eval(`(function(){ const items=[...document.querySelectorAll('.settings-nav button')];
        const i=items.findIndex((b)=>(b.textContent||'').trim()==='插件'); if(i>=0) items[i].click(); return i; })()`);
      await wait(1600);
      const ui = await h.eval(`(function(){
        const t=document.querySelector('.settings-modal')?.innerText||'';
        return { hasSource: t.includes('Gitee 官方镜像') || t.includes('Codex 官方'), noSkillhub: !t.includes('skillhub.cn/plugins'),
          cards: document.querySelectorAll('.plugin-market-card, .settings-modal [class*=market] [class*=card]').length }; })()`);
      h.check("③ 插件页市场源文案在位（Gitee / Codex 官方均可）+ 无 skillhub 残留",
        nav >= 0 && ui?.hasSource && ui?.noSkillhub, JSON.stringify(ui).slice(0, 120));
    },
  },
];

if (flag("list")) {
  for (const c of CHECKS) console.log(`  ${c.id.padEnd(20)} ${c.name}`);
  process.exit(0);
}

const only = value("only", "");
const selected = only ? CHECKS.filter((c) => c.id.includes(only)) : CHECKS;
if (!selected.length) {
  console.error(`没有匹配 --only ${only} 的验收项；可用：${CHECKS.map((c) => c.id).join(", ")}`);
  process.exit(1);
}
console.log(`\x1b[90m验收范围：${only ? `--only ${only}` : "当前全部"}（${selected.length} 项：${selected.map((c) => c.id).join(", ")}）\x1b[0m`);

const missing = [
  ["dist/index.html", "npm run build:vite"],
  ["dist-electron/main.js", "npm run build:electron"],
].filter(([file]) => !existsSync(join(ROOT, file)));
if (missing.length) {
  console.error("\x1b[31m验收前置检查失败：构建产物缺失\x1b[0m");
  for (const [file, cmd] of missing) console.error(`  - 缺 ${file} → 先跑 ${cmd}`);
  process.exit(1);
}

const h = new ElectronHarness({
  root: ROOT,
  artifactsDir: join(ROOT, ".e2e-artifacts"),
  profileName: value("profile", "main"),
});

const t0 = Date.now();
const results = [];
try {
  await h.launch();
  console.log("\x1b[90m(应用已启动，CDP 已连接)\x1b[0m\n");
  await enterMain(h);
  for (const check of selected) {
    const startedAt = Date.now();
    console.log(`\x1b[36m── ${check.name}\x1b[0m`);
    try {
      await check.run(h);
      results.push({ id: check.id, ok: true, ms: Date.now() - startedAt });
    } catch (error) {
      console.log(`  \x1b[31m✗ 验收项异常：${error.message}\x1b[0m`);
      try { await h.screenshot(`失败-${check.id}`); } catch { /* 截图失败不影响结论 */ }
      results.push({ id: check.id, ok: false, ms: Date.now() - startedAt, error: error.message });
    }
  }
} catch (error) {
  console.error(`\x1b[31m启动阶段失败：${error.message}\x1b[0m`);
  results.push({ id: "(启动)", ok: false, ms: Date.now() - t0, error: error.message });
} finally {
  if (flag("keep")) console.log("\n\x1b[33m--keep：应用保持运行\x1b[0m");
  else {
    for (let i = 0; i < 300; i++) {
      const busy = await h.eval(`!!document.querySelector(".timeline-bottom-spacer.compact")`).catch(() => false);
      if (!busy) break;
      if (i === 0) console.log("\x1b[90m(还有回合在流式：等它跑完再关应用…)\x1b[0m");
      await wait(1000);
    }
    await h.close();
  }
}

const summary = h.summary("验收");
console.log("\n\x1b[1m验收项耗时：\x1b[0m");
for (const r of results) {
  console.log(`  ${r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${r.id.padEnd(20)} \x1b[90m${r.ms}ms\x1b[0m${r.error ? `  ${r.error}` : ""}`);
}
console.log(`\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s；截图：.e2e-artifacts/shots；被测 profile：${h.userDataDir}\n`);
process.exit(summary.ok && results.every((r) => r.ok) ? 0 : 1);
