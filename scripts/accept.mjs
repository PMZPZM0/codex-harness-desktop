// scripts/accept.mjs —— 当前版本验收（10-25 起只保留本轮功能，历史项已删除）
//
// 用户 10-25：「你这个验收脚本，老是跑很久之前的内容干嘛，能不能删了，重新写」。
// 因此本文件只保留当前要守的链路：
//   ① settings-pages：设置页逐页可打开 + 外观/外观头像 / 布布包 / 用户人格位置
//   ② function-menu：侧栏顶部「新会话 / 搜索任务」+ 两处折叠 + 拖动 + 更多 + 教程
//   ③ plugin-market-gitee：插件市场 Gitee raw / jsDelivr 兜底（403 限流回归）
//   ④ voice-ball-reactions：悬浮球眼睛跟鼠标 + 打字弹迷你键盘（10-26）
//   ⑤ sidebar-adaptive：「功能入口」是侧栏右侧浮层，不占纵向空间；Esc 收起
//   ⑥ file-preview-controls：右栏文件树/预览可拖动分栏 + 预览向上拉满（按钮/Alt+↑↓）
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
        const cols=(sel)=>{ const el=m.querySelector(sel); return el?getComputedStyle(el).gridTemplateColumns.split(" ").length:0; };
        return { avatars:[...m.querySelectorAll(".uc-presets button")].map((b)=>b.title),
          codex:[...m.querySelectorAll(".codex-id-preset")].map((b)=>b.title),
          userCols:cols(".uc-presets"), codexCols:cols(".codex-id-preset-grid"),
          userPersonaHere:!!m.querySelector(".user-persona-grid") };
      })()`).catch(() => null);
      h.check("① 用户中心：常规头像双端可选（5 列）、用户人格已移出",
        Boolean(uc && uc.avatars.length >= 8 && uc.codex.length >= 6 && uc.userCols === 5 && uc.codexCols === 5
          && !uc.userPersonaHere),
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

      await nav("中转站");
      await wait(1200);
      const relay = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const page=m.querySelector(".relay-center"); if(!page) return null;
        const banner=page.querySelector(".relay-sub-banner");
        const add=page.querySelector(".relay-add-card");
        const addStyle=add?getComputedStyle(add):null;
        const strong=banner?banner.querySelector(".relay-sub-banner-main > strong"):null;
        const state=banner?(banner.dataset.state||""):"";
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          hasInfo:!!page.querySelector(".page-info"),
          hasFoot:!!page.querySelector(".relay-center-foot"),
          state,
          guestParas: state==="guest" && banner ? banner.querySelectorAll(".relay-sub-banner-main > p").length : 0,
          strongBig: strong ? parseFloat(getComputedStyle(strong).fontSize) : 0,
          addSmall: add ? add.querySelectorAll("small").length : 0,
          addDir: addStyle ? addStyle.flexDirection : "",
          addHeight: add ? Math.round(add.getBoundingClientRect().height) : 0 };
      })()`).catch(() => null);
      h.check("④ 中转站：无问号/无页脚赘述，未登录只留大字，添加卡横向单行",
        Boolean(relay && relay.page === "中转站" && !relay.hasInfo && !relay.hasFoot && relay.guestParas === 0
          && (relay.state !== "guest" || relay.strongBig >= 15)
          && relay.addSmall === 0 && relay.addDir === "row" && relay.addHeight >= 60),
        JSON.stringify(relay));

      await nav("OpenAI 订阅");
      await wait(1000);
      const oa = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const page=m.querySelector(".relay-center"); if(!page) return null;
        const grid=page.querySelector(".openai-account-grid");
        const cards=[...page.querySelectorAll(".relay-add-card")];
        const rects=cards.map(function(c){ const r=c.getBoundingClientRect(); return { top:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height), small:c.querySelectorAll("small").length }; });
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          hasInfo:!!page.querySelector(".page-info"),
          hasCopy:!!page.querySelector(".settings-copy"),
          gridW: grid ? Math.round(grid.getBoundingClientRect().width) : 0,
          twoPerRow: rects.length === 2 && rects[0].top === rects[1].top,
          rects };
      })()`).catch(() => null);
      h.check("⑤ OpenAI 订阅：无问号/无说明，添加卡两列矩形卡不拉满整行",
        Boolean(oa && oa.page === "OpenAI 订阅" && !oa.hasInfo && !oa.hasCopy && oa.twoPerRow
          && oa.rects.every(function(r){ return r.small === 0 && r.h <= 80 && r.w < oa.gridW - 20; })),
        JSON.stringify(oa));

      await nav("模型");
      await wait(1000);
      const modelDock = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const page=m.querySelector(".model-settings-page"); if(!page) return null;
        const toolbar=page.querySelector(".provider-page-toolbar");
        const compact=toolbar?toolbar.querySelector(".model-compact-control"):null;
        const actions=toolbar?toolbar.querySelector(".provider-page-actions"):null;
        if(!toolbar||!compact||!actions) return null;
        const cr=compact.getBoundingClientRect(), ar=actions.getBoundingClientRect();
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          head:!!page.querySelector(".provider-list-head"),
          dock:!!page.querySelector(".model-page-dock"),
          compactText:(compact.textContent||"").trim(),
          sameRow:Math.abs((cr.top+cr.bottom)/2-(ar.top+ar.bottom)/2) <= 10,
          left:cr.left < ar.left,
          labels:[...actions.querySelectorAll("button")].map((b)=>(b.textContent||"").trim()),
          classes:[...actions.querySelectorAll("button")].map((b)=>b.className) };
      })()`).catch(() => null);
      h.check("⑥ 模型页：小字与底部条已删；压缩靠左、三个按钮靠右同一行",
        Boolean(modelDock && modelDock.page === "模型" && !modelDock.head && !modelDock.dock
          && modelDock.compactText.includes("自动压缩") && modelDock.sameRow && modelDock.left
          && modelDock.labels.some((x)=>x.includes("自动配置"))
          && modelDock.labels.some((x)=>x.includes("自定义供应商"))
          && modelDock.labels.some((x)=>x.includes("保存重启"))
          && modelDock.classes.length === 3 && modelDock.classes[0].includes("primary-setting")
          && modelDock.classes[1].includes("secondary-setting") && !modelDock.classes[1].includes("primary-setting")
          && modelDock.classes[2].includes("danger-setting")),
        JSON.stringify(modelDock));

      await nav("控制台");
      await wait(900);
      const ctrl = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const page=m.querySelector(".general-page");
        const seg=[...m.querySelectorAll(".perm-seg-btn")];
        const cs=seg[0]?getComputedStyle(seg[0]):null;
        const toneRow=[...m.querySelectorAll(".card-reply .settings-toggle-row")].find((x)=>(x.textContent||"").includes("语气自适应"));
        const toneSw=toneRow?toneRow.querySelector('[role="switch"]'):null;
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          groups:m.querySelectorAll(".settings-exp-group-head").length,
          cards:seg.length,
          align:cs?cs.alignItems:"", ta:cs?cs.textAlign:"",
          toneInReply:!!toneRow, toneOn:toneSw?toneSw.getAttribute("aria-checked"):null };
      })()`).catch(() => null);
      await nav("外观");
      await wait(800);
      const appGroups = await h.eval(`document.querySelectorAll(".settings-modal .settings-exp-group-head").length`).catch(() => -1);
      h.check("⑦ 控制台：分组小字已删、权限卡文字居中；外观页同样无分组小字",
        Boolean(ctrl && ctrl.page === "控制台" && ctrl.groups === 0 && ctrl.cards === 3
          && ctrl.align === "center" && ctrl.ta === "center" && appGroups === 0),
        JSON.stringify({ ctrl, appGroups }));

      /* 10-27 用户令：「个性化里面的用户称呼可以删了，还有语气自适应也删了，
         跟用户中心和控制台的ahd重复了」⇒ 个性化页不再有这两块，语气开关改到控制台。 */
      await nav("个性化");
      await wait(900);
      const per = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const page=m.querySelector(".personalization-page"); if(!page) return null;
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          hasNickInput:!!page.querySelector('input[aria-label="称呼"]'),
          hasNickText:(page.textContent||"").includes("称呼"),
          hasTone:(page.textContent||"").includes("语气自适应"),
          hasStyle:!!page.querySelector(".personalization-style-grid"),
          hasInstructions:!!page.querySelector(".personalization-instructions") };
      })()`).catch(() => null);
      h.check("⑧ 个性化：无称呼输入、无语气自适应；回复风格与自定义指令仍在",
        Boolean(per && per.page === "个性化" && !per.hasNickInput && !per.hasNickText && !per.hasTone
          && per.hasStyle && per.hasInstructions),
        JSON.stringify(per));
      h.check("⑨ 控制台回复风格卡：语气自适应开关在位（挪来这儿，不是删功能）",
        Boolean(ctrl && ctrl.toneInReply && ctrl.toneOn !== null),
        JSON.stringify({ toneInReply: ctrl && ctrl.toneInReply, toneOn: ctrl && ctrl.toneOn }));

      await nav("MCP");
      await wait(1000);
      await h.eval(`(function(){ document.querySelector(".settings-modal .mcp-category-select")?.click(); return 1; })()`);
      await wait(300);
      const mcp = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const sel=m.querySelector(".mcp-category-select");
        const list=document.querySelector(".app-select-list");
        const labels=[...m.querySelectorAll("button")].map((b)=>(b.textContent||"").trim());
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          hasSelect:!!sel, options:list?list.querySelectorAll(".app-select-option").length:0,
          tabs:m.querySelectorAll(".mcp-market-toolbar .skill-tabs").length,
          hasInfo:!!m.querySelector(".page-info"),
          hasCopy:!!m.querySelector(".settings-copy"),
          toolbarTop:(()=>{ const t=m.querySelector(".mcp-market-toolbar"); return t?Math.round(t.getBoundingClientRect().top):0; })(),
          labelWrap:(()=>{ const el=m.querySelector(".mcp-category-filter > span"); return el?getComputedStyle(el).whiteSpace:""; })(),
          jumps:labels.filter((x)=>x.includes("广场")) };
      })()`).catch(() => null);
      h.check("⑧ MCP：分类改成筛选下拉，市场跳转按钮已删",
        Boolean(mcp && mcp.page === "MCP" && mcp.hasSelect && mcp.options >= 5 && mcp.tabs === 0
          && mcp.labelWrap === "nowrap" && mcp.jumps.length === 0),
        JSON.stringify(mcp));
      /* 10-27 用户（MCP 页截图）：「右上角问号删了」⇒ 页头整块撤掉，
         进页第一屏就是工具条（没有 ? 占的那一行）。 */
      h.check("⑩ MCP：右上角问号与页头说明已删，工具条顶到页面上沿",
        Boolean(mcp && !mcp.hasInfo && !mcp.hasCopy && mcp.toolbarTop > 0 && mcp.toolbarTop < 190),
        JSON.stringify({ hasInfo: mcp && mcp.hasInfo, hasCopy: mcp && mcp.hasCopy, toolbarTop: mcp && mcp.toolbarTop }));

      /* 10-27 用户（语音页截图）：「把必须放到基础模型里面…首个卡片内容布局调一下…上面一块空白删除，
         右上角帮助❓号…放到基础模型卡片右上角」⇒ 页头整块删掉（不留空行）、
         必需标签与帮助 ? 都进基础模型卡的卡头、副标题与路径下沉正文区。 */
      await nav("语音通话");
      await wait(1200);
      const voice = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const page=m.querySelector(".voice-settings"); if(!page) return null;
        const card=page.querySelector(".voice-devtools-card");
        const head=card?card.querySelector(".voice-devtools-card-head"):null;
        const body=card?card.querySelector(".voice-devtools-body"):null;
        const pi=head?head.querySelector(".page-info"):null;
        const tag=head?head.querySelector(".voice-group-tag.is-required"):null;
        const pr=page.getBoundingClientRect(), cr=card?card.getBoundingClientRect():null;
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          hasHeaderCopy:!!page.querySelector(".settings-copy"),
          tagInHead:!!tag, helpInHead:!!pi,
          subInBody:!!(body&&body.querySelector(":scope > .voice-devtools-sub")),
          pathInBody:!!(body&&body.querySelector(":scope > .voice-devtools-path")),
          gapToTop: cr ? Math.round(cr.top - pr.top) : 999,
          headRows: head?getComputedStyle(head).flexDirection:"" };
      })()`).catch(() => null);
      h.check("⑪ 语音页：页头空行已删，必需标签与帮助 ? 在基础模型卡卡头，路径下沉正文",
        Boolean(voice && voice.page === "语音通话" && !voice.hasHeaderCopy && voice.tagInHead
          && voice.helpInHead && voice.subInBody && voice.pathInBody
          && voice.gapToTop >= 0 && voice.gapToTop < 40 && voice.headRows === "row"),
        JSON.stringify(voice));

      await nav("技能");
      await wait(1000);
      const skillsBar = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const page=m.querySelector(".skill-center"); if(!page) return null;
        const row=page.querySelector(".skill-filter-row");
        const line=page.querySelector(".skill-actions-line");
        const search=page.querySelector(".skill-filter-row .search-field");
        const cat=page.querySelector(".skill-category-select");
        if(!row||!line||!search) return null;
        const btns=[...line.querySelectorAll("button")];
        const r=line.getBoundingClientRect(), rr=row.getBoundingClientRect(), s=search.getBoundingClientRect();
        const cr=cat?cat.getBoundingClientRect():null;
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          buttons:btns.map((b)=>(b.textContent||"").trim()),
          heights:btns.map((b)=>Math.round(b.getBoundingClientRect().height)),
          categoryText:cat?(cat.textContent||"").trim():"",
          categoryRow:cr?Math.abs((cr.top+cr.bottom)/2-(s.top+s.bottom)/2) <= 10:false,
          sameRow:Math.abs((r.top+r.bottom)/2-(s.top+s.bottom)/2) <= 10,
          inRow:line.closest(".skill-filter-row") === row,
          rightGap:Math.round(rr.right-r.right),
          pageInfo:!!page.querySelector(".page-info"),
          tabs:page.querySelectorAll(".skill-tabs").length,
          count:!!page.querySelector(".skill-filter-count"),
          oldRow:!!page.querySelector(".skill-market-toolbar") };
      })()`).catch(() => null);
      h.check("⑨ 技能页：按键与搜索同一排，分类小字与右上角问号已删",
        Boolean(skillsBar && skillsBar.page === "技能" && !skillsBar.oldRow && !skillsBar.pageInfo
          && skillsBar.categoryText.includes("全部分类") && skillsBar.categoryRow
          && skillsBar.tabs === 0 && !skillsBar.count && skillsBar.buttons.length === 3
          && skillsBar.buttons.some((x)=>x.includes("我的技能"))
          && skillsBar.buttons.some((x)=>x.includes("导入技能"))
          && skillsBar.heights.every((h)=>h <= 30) && skillsBar.sameRow && skillsBar.inRow
          && skillsBar.rightGap <= 40
          && !skillsBar.buttons.some((x)=>x.includes("SkillHub 市场"))),
        JSON.stringify(skillsBar));

      await nav("命令");
      await wait(900);
      const commandBar = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const page=m.querySelector(".command-center"); if(!page) return null;
        const bar=page.querySelector(".command-toolbar");
        const line=page.querySelector(".command-actions-line");
        const search=page.querySelector(".command-search");
        const sel=page.querySelector(".command-filter-select");
        if(!bar||!line||!search||!sel) return null;
        const btns=[...line.querySelectorAll("button")];
        const r=line.getBoundingClientRect(), br=bar.getBoundingClientRect(), s=search.getBoundingClientRect(), sr=sel.getBoundingClientRect();
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          buttons:btns.map((b)=>(b.textContent||"").trim()),
          heights:btns.map((b)=>Math.round(b.getBoundingClientRect().height)),
          selectText:(sel.textContent||"").trim(),
          sameRow:Math.abs((r.top+r.bottom)/2-(s.top+s.bottom)/2) <= 10,
          selectRow:Math.abs((sr.top+sr.bottom)/2-(s.top+s.bottom)/2) <= 10,
          inRow:line.closest(".command-toolbar") === bar,
          rightGap:Math.round(br.right-r.right),
          stats:!!page.querySelector(".command-stats"),
          tabs:page.querySelectorAll(".command-tabs").length,
          groupSmall:page.querySelectorAll(".command-group > header small").length,
          emptyNote:(page.textContent||"").includes("还没有自定义命令"),
          pageInfo:!!page.querySelector(".page-info"),
          headingActions:!!page.querySelector(".settings-heading-actions") };
      })()`).catch(() => null);
      h.check("⑫ 命令页：分类收成下拉，新建/刷新与搜索同一排",
        Boolean(commandBar && commandBar.page === "命令" && !commandBar.pageInfo && !commandBar.headingActions
          && commandBar.selectText.includes("全部") && commandBar.selectRow && !commandBar.stats
          && commandBar.tabs === 0 && commandBar.groupSmall === 0 && !commandBar.emptyNote
          && commandBar.buttons.length === 2 && commandBar.buttons.some((x)=>x.includes("新建命令"))
          && commandBar.heights.every((h)=>h <= 30) && commandBar.sameRow && commandBar.inRow
          && commandBar.rightGap <= 30),
        JSON.stringify(commandBar));

      await nav("插件");
      await wait(1200);
      const pluginMarket = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const page=m.querySelector(".plugin-center"); if(!page) return null;
        const block=page.querySelector(".plugin-market-block");
        const sel=block?block.querySelector(".market-category-select"):null;
        const search=block?block.querySelector(".search-field"):null;
        if(!block||!sel||!search) return null;
        const sr=sel.getBoundingClientRect(), ir=search.getBoundingClientRect();
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          selectText:(sel.textContent||"").trim(),
          sameRow:Math.abs((sr.top+sr.bottom)/2-(ir.top+ir.bottom)/2) <= 10,
          tabs:block.querySelectorAll(".skill-tabs").length,
          jumps:[...page.querySelectorAll("button")].map((b)=>(b.textContent||"").trim()).filter((x)=>x.includes("在线市场")) };
      })()`).catch(() => null);
      h.check("⑬ 插件市场：分类下拉与搜索同一行，在线市场跳转已删",
        Boolean(pluginMarket && pluginMarket.page === "插件" && pluginMarket.selectText.includes("全部分类")
          && pluginMarket.sameRow && pluginMarket.tabs === 0 && pluginMarket.jumps.length === 0),
        JSON.stringify(pluginMarket));

      await nav("组件库");
      await wait(600);
      await h.waitFor(`!!document.querySelector(".comp-lib-cat-select")`, { label: "组件库筛选下拉", timeoutMs: 5000 }).catch(() => undefined);
      await wait(300);
      const compLib = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const page=m.querySelector(".comp-lib"); if(!page) return null;
        const search=page.querySelector(".ui-skin-search");
        const sel=page.querySelector(".comp-lib-cat-select");
        const grid=page.querySelector(".comp-lib-grid");
        if(!search||!sel) return null;
        const sr=sel.getBoundingClientRect(), ir=search.getBoundingClientRect();
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          selectText:(sel.textContent||"").trim(),
          sameRow:Math.abs((sr.top+sr.bottom)/2-(ir.top+ir.bottom)/2) <= 10,
          searchWidth:Math.round(ir.width),
          gridHeight:grid?Math.round(grid.getBoundingClientRect().height):0,
          cats:page.querySelectorAll(".ui-skin-cat").length };
      })()`).catch(() => null);
      h.check("⑭ 组件库：分类收成搜索行右侧下拉，搜索框不再拉满",
        Boolean(compLib && compLib.page === "组件库" && compLib.selectText.length > 0
          && compLib.sameRow && compLib.searchWidth <= 400 && compLib.gridHeight >= 500 && compLib.cats === 0),
        JSON.stringify(compLib));
      await h.pressKey("Escape");
      await wait(300);
    },
  },
  {
    id: "model-menu",
    name: "模型下拉：居中于输入框 + 倍率右列 + 当前项只用底色",
    run: async (h) => {
      await h.waitFor(`!!document.querySelector(".model-controls .composer-menu .composer-setting")`, { label: "模型按钮", timeoutMs: 15000 });
      await h.eval(`(function(){ document.querySelector(".model-controls .composer-menu .composer-setting")?.click(); return 1; })()`);
      await wait(500);
      const menu = await h.eval(`(function(){
        const pop=document.querySelector(".model-controls .composer-menu-pop");
        const btn=document.querySelector(".model-controls .composer-menu .composer-setting");
        if(!pop||!btn) return null;
        const r=pop.getBoundingClientRect(), b=btn.getBoundingClientRect();
        return { width:r.width, centerDelta:Math.abs((r.left+r.right)/2-(b.left+b.right)/2), gap:Math.round(b.top-r.bottom),
          rows:pop.querySelectorAll("button").length,
          checks:pop.querySelectorAll(".menu-item-check").length,
          credits:[...pop.querySelectorAll(".menu-item-credit")].map((x)=>x.textContent) };
      })()`).catch(() => null);
      h.check("④ 模型下拉：贴着「模型」按钮居中、当前项无右侧勾选、倍率独立右列",
        Boolean(menu && menu.width >= 360 && menu.centerDelta <= 2 && menu.gap >= 4 && menu.gap <= 12 && menu.rows >= 2 && menu.checks === 0
          && menu.credits.every((text) => /^\d+(?:\.\d+)?x$/.test(text))),
        JSON.stringify(menu));
      await h.pressKey("Escape");
      await wait(200);
      const hasCtxBadge = await h.eval(`!!document.querySelector(".ctx-badge-btn")`);
      if (hasCtxBadge) {
        await h.eval(`(function(){ document.querySelector(".ctx-badge-btn")?.click(); return 1; })()`);
        await wait(400);
        const ctx = await h.eval(`(function(){
          const pop=document.querySelector(".ctx-pop"), btn=document.querySelector(".ctx-badge-btn");
          if(!pop||!btn) return null;
          const r=pop.getBoundingClientRect(), b=btn.getBoundingClientRect();
          return { centerDelta:Math.abs((r.left+r.right)/2-(b.left+b.right)/2), gap:Math.round(b.top-r.bottom) };
        })()`).catch(() => null);
        await h.pressKey("Escape");
        await wait(250);
        const closed = await h.eval(`!document.querySelector(".ctx-pop")`);
        h.check("⑤ 上下文弹窗：贴按钮居中 + Esc 自动关闭", Boolean(ctx && ctx.centerDelta <= 2 && ctx.gap >= 4 && ctx.gap <= 12 && closed), JSON.stringify({ ...ctx, closed }));
      } else {
        h.check("⑤ 上下文弹窗：贴按钮居中 + Esc 自动关闭", true, '{"skipped":"no-context-badge"}');
      }
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
      await wait(2600);
      const ui = await h.eval(`(function(){
        const t=document.querySelector('.settings-modal')?.innerText||'';
        return { hasSource: t.includes('Gitee 官方镜像') || t.includes('Codex 官方'), noSkillhub: !t.includes('skillhub.cn/plugins'),
          cards: document.querySelectorAll('.plugin-market-card, .settings-modal [class*=market] [class*=card]').length }; })()`);
      h.check("③ 插件页市场源文案在位（Gitee / Codex 官方均可）+ 无 skillhub 残留",
        nav >= 0 && ui?.hasSource && ui?.noSkillhub, JSON.stringify(ui).slice(0, 120));
    },
  },
  {
    id: "voice-ball-reactions",
    name: "🫧 悬浮球互动：眼睛跟鼠标 + 打字弹迷你键盘（10-26）",
    run: async (h) => {
      await h.waitFor(`!!document.querySelector(".voice-ball")`, { label: "悬浮球", timeoutMs: 12000 });
      /* 首帧/设置读取有先后：监听可能比球晚一拍，允许多推几次指针（真实产品里鼠标本来就会持续移动）。 */
      let gaze = { x: 0, y: 0 };
      for (let i = 0; i < 8 && gaze.x === 0 && gaze.y === 0; i++) {
        await h.eval(`(function(){
          const r=document.querySelector(".voice-ball").getBoundingClientRect();
          window.dispatchEvent(new PointerEvent("pointermove",{clientX:r.left+r.width*0.15,clientY:r.top+r.height*0.15,bubbles:true}));
          return 1;
        })()`);
        await wait(300);
        gaze = await h.eval(`(function(){ const b=document.querySelector(".voice-ball");
          return { x:parseFloat(b.style.getPropertyValue("--bot-gaze-x"))||0, y:parseFloat(b.style.getPropertyValue("--bot-gaze-y"))||0 }; })()`);
      }
      h.check("① 指针在左上时眼球往左上偏（真读 CSS 变量，不是只看类名）",
        gaze.x < -1 && gaze.y < -1, JSON.stringify(gaze));

      await h.eval(`(function(){
        const r=document.querySelector(".voice-ball").getBoundingClientRect();
        window.dispatchEvent(new PointerEvent("pointermove",{clientX:r.left+r.width*0.85,clientY:r.top+r.height*0.85,bubbles:true}));
        return 1;
      })()`);
      await wait(40);
      const pupil = await h.eval(`parseFloat(document.querySelector(".voice-ball").style.getPropertyValue("--bot-eye-scale"))||1`);
      h.check("② 鼠标快速划过 → 瞳孔按速度放大(>1.03)", pupil > 1.03, JSON.stringify({ pupil }));
      let pupilBack = pupil;
      for (let i = 0; i < 8 && pupilBack > 1.01; i++) {
        await wait(350);
        pupilBack = await h.eval(`parseFloat(document.querySelector(".voice-ball").style.getPropertyValue("--bot-eye-scale"))||1`);
      }
      h.check("③ 停手后瞳孔回落到 1x", pupilBack <= 1.01, JSON.stringify({ pupilBack }));

      const typed = await h.eval(`(function(){
        const ed=document.querySelector(".composer-editor"); if(!ed) return 0;
        ed.focus();
        ed.dispatchEvent(new KeyboardEvent("keydown",{key:"a",bubbles:true}));
        return 1;
      })()`);
      await wait(220);
      const keyboard = await h.eval(`({
        kb: !!document.querySelector(".voice-ball-keyboard"),
        rows: document.querySelectorAll(".voice-keyboard-row").length,
        keys: document.querySelectorAll(".voice-keyboard-key").length,
        hint: !!document.querySelector(".voice-hint-bubble"),
      })`);
      h.check("④ 输入框敲字 → 球上方弹出 3 排迷你键盘，提示气泡让位",
        typed === 1 && keyboard.kb && keyboard.rows === 3 && keyboard.keys === 16 && !keyboard.hint,
        JSON.stringify(keyboard));

      await wait(2200);
      const closed = await h.eval(`!document.querySelector(".voice-ball-keyboard")`);
      h.check("⑤ 停手 1.1 秒后键盘自动收起（含后台节流余量）", closed, JSON.stringify({ closed }));
    },
  },
  {
    id: "sidebar-adaptive",
    name: "🧱 侧栏「功能入口」改为右侧浮层，不占纵向空间（10-26）",
    run: async (h) => {
      /* 10-26 用户：「向右边展示会不会更好，这样不占用上下空间」。
         侧栏只留一行「功能入口」，入口组 portal 到 body 停在侧栏右缘：
         ① 默认不弹；② 点开后不改变会话列表高度；③ 始终落在视口内；④ Esc 收起。 */
      await h.eval(`window.codex.saveAppSettings({functionMenu:{location:"bottom"}})`).catch(() => undefined);
      await wait(500);
      await h.reload({ waitMs: 2200 });
      await wait(1800);
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "界面就绪", timeoutMs: 30000 });
      await wait(800);
      await h.pressKey("Escape").catch(() => undefined);
      await wait(250);

      const geo = () => h.eval(`(function(){
        const r=(sel)=>{const e=document.querySelector(sel); if(!e)return null; const b=e.getBoundingClientRect(); return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,w:b.width,h:b.height};};
        return {win:{w:innerWidth,h:innerHeight}, sidebar:r(".sidebar"), list:r(".thread-list"), toggle:r(".sidebar-options-toggle"), account:r(".account-row"),
          flyout:r(".sidebar-options-flyout"), rows:document.querySelectorAll(".sidebar-options-flyout .sidebar-cap-row").length,
          top:!!document.querySelector(".sidebar-options-top")};
      })()`);

      const closed = await geo();
      h.check("① 默认收起：功能入口只占侧栏一行，列表拿到全部剩余高度",
        Boolean(closed && !closed.top && !closed.flyout && closed.list && closed.list.h > 320),
        JSON.stringify({ flyout: closed?.flyout, listH: closed?.list?.h }));

      await h.eval(`document.querySelector(".sidebar-options-toggle")?.click()`);
      await wait(350);
      const opened = await geo();
      const flyout = opened?.flyout;
      h.check("② 点开后浮层在侧栏右侧，且不与列表抢占纵向空间",
        Boolean(flyout && opened.sidebar && flyout.left >= opened.sidebar.right - 1
          && Math.abs((opened.list?.h ?? 0) - (closed.list?.h ?? 0)) <= 1
          && flyout.w >= 200 && opened.rows >= 5),
        JSON.stringify({ left: flyout?.left, sidebarRight: opened?.sidebar?.right, listH: opened?.list?.h, closedListH: closed?.list?.h, rows: opened?.rows }));
      h.check("③ 浮层完整落在视口内",
        Boolean(flyout && flyout.top >= 0 && flyout.bottom <= (opened?.win?.h ?? 0) + 1),
        JSON.stringify({ top: flyout?.top, bottom: flyout?.bottom, winH: opened?.win?.h }));

      await h.pressKey("Escape");
      await wait(250);
      const afterEsc = await geo();
      h.check("④ Esc 收起浮层，侧栏恢复一行", !afterEsc?.flyout, JSON.stringify({ flyout: afterEsc?.flyout }));

      await h._send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 620, deviceScaleFactor: 1, mobile: false });
      await wait(600);
      await h.eval(`document.querySelector(".sidebar-options-toggle")?.click()`);
      await wait(350);
      const short = await geo();
      h.check("⑤ 620 高：列表仍 >200px，浮层不被裁出视口",
        Boolean(short?.flyout && (short.list?.h ?? 0) > 200 && short.flyout.top >= 0
          && short.flyout.bottom <= (short.win?.h ?? 0) + 1 && short.account && short.account.bottom <= (short.win?.h ?? 0) + 1),
        JSON.stringify({ listH: short?.list?.h, flyout: short?.flyout, winH: short?.win?.h, accountBottom: short?.account?.bottom }));
      await h.pressKey("Escape").catch(() => undefined);
      await h._send("Emulation.clearDeviceMetricsOverride");
      await wait(300);

      /* 10-26 用户实测「功能都点不动」：曾用 onClickCapture 先关浮层 ⇒ 按钮在 click 前被卸载。
         这里真点一次具体入口 + 一次「更多 → 编辑菜单」，确保动作真的触发。 */
      await h.eval(`document.querySelector(".sidebar-options-toggle")?.click()`);
      await wait(300);
      const rowClicked = await h.eval(`(function(){
        const b=document.querySelector(".sidebar-options-flyout .sidebar-cap-row:not(.function-menu-more)");
        if(!b) return 0; b.click(); return 1;
      })()`);
      await wait(500);
      const afterRow = await h.eval(`({ flyout: !!document.querySelector(".sidebar-options-flyout"), settings: !!document.querySelector(".settings-modal") })`);
      h.check("⑥ 点具体入口：浮层收起，且目标页真的打开（不是只关浮层）",
        rowClicked === 1 && !afterRow.flyout && afterRow.settings, JSON.stringify(afterRow));
      await h.pressKey("Escape").catch(() => undefined);
      await wait(350);

      await h.eval(`document.querySelector(".sidebar-options-toggle")?.click()`);
      await wait(300);
      await h.eval(`document.querySelector(".sidebar-options-flyout .function-menu-more")?.click()`);
      await wait(300);
      const moreOpened = await h.eval(`!!document.querySelector(".function-menu-popover")`);
      const moreClicked = await h.eval(`(function(){
        const b=[...document.querySelectorAll(".function-menu-popover-item")].find((x)=>x.textContent.includes("编辑菜单"));
        if(!b) return 0; b.click(); return 1;
      })()`);
      await wait(500);
      const afterMore = await h.eval(`({ flyout: !!document.querySelector(".sidebar-options-flyout"), editor: !!document.querySelector(".function-menu-editor") })`);
      h.check("⑦ 「更多 → 编辑菜单」可点：弹层不被浮层卸载，编辑弹窗打开",
        moreOpened && moreClicked === 1 && !afterMore.flyout && afterMore.editor, JSON.stringify({ moreOpened, moreClicked, ...afterMore }));
      await h.eval(`document.querySelector(".fm-editor-foot button:last-child")?.click()`).catch(() => undefined);
      await wait(250);
    },
  },
  {
    id: "file-preview-controls",
    name: "🗂 右栏文件预览：拖动分栏 + 向上拉满（按钮 / Alt+↑↓）",
    run: async (h) => {
      /* 10-26 用户：「右边加一下，上下可以…展示，下面也可以往上展示的功能和对应按键」。 */
      await h.eval(`localStorage.setItem("right-panel-open","true")`).catch(() => undefined);
      await h.reload({ waitMs: 2200 });
      await wait(1600);
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "界面就绪", timeoutMs: 30000 });
      await wait(700);
      await h.eval(`(function(){const b=[...document.querySelectorAll(".panel-tab")].find((x)=>(x.textContent||"").includes("文件")); if(b)b.click(); return !!b})()`);
      await h.waitFor(`document.querySelectorAll(".tree-entry").length > 0`, { label: "文件树", timeoutMs: 15000 });
      await wait(500);

      const pick = await h.eval(`(function(){
        const rows=[...document.querySelectorAll(".tree-entry")].filter((x)=>!x.querySelector(".tree-chevron"));
        const b=rows.find((x)=>(x.getAttribute("data-tree-path")||"").endsWith("package.json"))||rows.find((x)=>(x.getAttribute("data-tree-path")||"").match(/\\.[a-z0-9]{1,5}$/i));
        if(!b) return 0; b.click(); return 1;
      })()`);
      await h.waitFor(`(document.querySelector(".workspace-file-preview-path")?.textContent||"").trim().length > 0`, { label: "文件预览路径", timeoutMs: 8000 }).catch(() => undefined);
      await wait(600);

      const geo = () => h.eval(`(function(){
        const t=document.querySelector(".workspace-files-tree")?.getBoundingClientRect();
        const p=document.querySelector(".workspace-file-preview")?.getBoundingClientRect();
        return { treeH:t?Math.round(t.height):0, previewH:p?Math.round(p.height):0,
          splitter:!!document.querySelector(".workspace-files-splitter"),
          expanded:!!document.querySelector(".workspace-files.is-preview-expanded"),
          path:(document.querySelector(".workspace-file-preview-path")?.textContent||"").trim(),
          body:!!document.querySelector(".workspace-file-preview-body") };
      })()`);

      const base = await geo();
      h.check("① 文件树与预览上下分栏，分栏条在位且预览已加载文件",
        pick === 1 && Boolean(base.splitter) && base.treeH > 120 && base.previewH > 120 && base.body && base.path,
        JSON.stringify(base));

      await h.eval(`document.querySelector(".workspace-file-preview-expand")?.click()`);
      await wait(400);
      const expanded = await geo();
      h.check("② 点「展开」：文件树完全收起（无残条）、预览向上拉满",
        expanded.expanded && expanded.treeH < 2 && expanded.previewH > base.previewH + 100,
        JSON.stringify(expanded));

      await h.eval(`document.querySelector(".workspace-file-preview-expand")?.click()`);
      await wait(400);
      const restored = await geo();
      h.check("③ 点「恢复」：分栏回到原来的高度",
        !restored.expanded && Math.abs(restored.treeH - base.treeH) <= 4 && Math.abs(restored.previewH - base.previewH) <= 4,
        JSON.stringify(restored));

      await h.eval(`window.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",altKey:true,bubbles:true}))`);
      await wait(350);
      const altUp = await geo();
      await h.eval(`window.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",altKey:true,bubbles:true}))`);
      await wait(350);
      const altDown = await geo();
      h.check("④ Alt+↑ 拉满 / Alt+↓ 恢复（按键与按钮同效）",
        altUp.expanded && !altDown.expanded, JSON.stringify({ altUp, altDown }));
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
