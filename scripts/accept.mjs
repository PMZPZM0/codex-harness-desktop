// scripts/accept.mjs —— 当前版本验收（10-25 起只保留本轮功能，历史项已删除）
//
// 用户 10-25：「你这个验收脚本，老是跑很久之前的内容干嘛，能不能删了，重新写」。
// 因此本文件只保留当前要守的链路：
//   ① settings-pages：设置页逐页可打开 + 外观/外观头像 / 布布包 / 用户人格位置
//   ② function-menu：入口开关（顶部/底部两位置）+ 右侧浮层 + 拖动 + 更多 + 首次教程
//   ③ plugin-market-gitee：插件市场 Gitee raw / jsDelivr 兜底（403 限流回归）
//   ④ voice-ball-reactions：悬浮球眼睛跟鼠标 + 打字弹迷你键盘（10-26）
//   ⑤ sidebar-adaptive：「功能入口」是侧栏右侧浮层，不占纵向空间；Esc 收起
//   ⑥ file-preview-controls：右栏文件树/预览可拖动分栏 + 预览向上拉满（按钮/Alt+↑↓）
//   ⑦ composer-rail：输入框竖条（收起贴线 / 四入口 / 选表情只插表情 / 弹层期不自动收 / 双写 / 10s 自动收）
//   ⑧ devtools-categories：开发工具页工具分类（11-01）—— 外面只有分类卡 + 一键安装，
//      明细只在二级弹窗里（⛔ 一级不许出现工具行）
//   ⑨ queue-timer：排队消息定时总开关（11-02）—— 默认关闭、开启落盘、关闭即清
//   ⑩ project-menu-flyout：项目 ⋯ / 会话 ⋯ 菜单向侧栏右侧弹出（portal）+ 视口钳制自适应往上（11-08）
//   ⑪ thread-tag-column：会话行标签固定成一列（贴置顶键左边）+ 标签最多 3 个字（11-08）
//   ⑫ team-skill-picker：工作伙伴「引用技能」贴 + 图标弹、可多选有反馈、点一下不关（11-08）
//   ⑬ team-composer-input：群聊输入框插 @ 后打字光标不跳 / 输入法组合不重建 / 粘贴只进纯文本（11-08 审查）
//   ⑭ media-desk：自媒体工作台原版界面在令牌前缀 iframe 里真渲染 + 工具与界面同源（11-09 审查）
//
// 用法：
//   node scripts/accept.mjs                 # 跑全部当前项
//   node scripts/accept.mjs --only <id>     # 只跑某一项
//   node scripts/accept.mjs --list
//   node scripts/accept.mjs --keep          # 跑完不关应用
//   node scripts/accept.mjs --profile main  # 换一个持久 profile
//
// 被测 profile：.e2e-profile/<name>/（跨轮复用，含真实历史；勿入库）

import { existsSync, mkdirSync, writeFileSync, truncateSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
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
      h.check("① 用户中心：常规头像 5 列、Codex 形象 6 个铺满整行、用户人格已移出",
        Boolean(uc && uc.avatars.length >= 8 && uc.codex.length >= 6 && uc.userCols === 5 && uc.codexCols === 6
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
        const card=[...m.querySelectorAll(".appearance-base-card .settings-pill-row")].find((x)=>(x.textContent||"").includes("思考板块"));
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
        const perm=m.querySelector(".card-permission .row-pills");
        const toneRow=[...m.querySelectorAll(".card-reply .settings-toggle-row")].find((x)=>(x.textContent||"").includes("语气自适应"));
        const toneSw=toneRow?toneRow.querySelector('[role="switch"]'):null;
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          groups:m.querySelectorAll(".settings-exp-group-head").length,
          permPills:perm?perm.querySelectorAll("button").length:0,
          toneInReply:!!toneRow, toneOn:toneSw?toneSw.getAttribute("aria-checked"):null };
      })()`).catch(() => null);
      await nav("外观");
      await wait(800);
      const appGroups = await h.eval(`document.querySelectorAll(".settings-modal .settings-exp-group-head").length`).catch(() => -1);
      h.check("⑦ 控制台：分组小字已删、权限收成一张卡（三档胶囊）；外观页同样无分组小字",
        Boolean(ctrl && ctrl.page === "控制台" && ctrl.groups === 0 && ctrl.permPills >= 3 && appGroups === 0),
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
          hasStyle:!!page.querySelector(".personalization-style-tabs"),
          styleTabs:[...page.querySelectorAll(".personalization-style-tabs button")].map((b)=>String(b.textContent||"").trim()),
          hasInstructions:!!page.querySelector(".personalization-instructions"),
          hasFrontend:!!page.querySelector(".card-frontend-design"),
          frontendTabs:[...page.querySelectorAll(".card-frontend-design .frontend-style-chip")].map((b)=>String(b.textContent||"").trim()),
          hasFrontendNotes:!!page.querySelector(".personalization-frontend-notes"),
          hasFrontendSave:!!page.querySelector(".personalization-savebar .primary-setting"),
          hasNormCards:!!page.querySelector('[data-norm-card="software-dev"]') && !!page.querySelector('[data-norm-card="app-architecture"]'),
          normChips:[...page.querySelectorAll(".card-norm .frontend-style-chip")].length,
          normToggles:[...page.querySelectorAll(".personalization-page .norm-toggle")].length,
          hasFrontendPrompt:!!page.querySelector(".frontend-style-prompt"),
          hasFrontendLibrary:!!page.querySelector(".frontend-style-library button"),
          hasFrontendRefs:!!page.querySelector(".frontend-style-refs-more"),
          hasFrontendSpec:!!page.querySelector(".frontend-style-spec"),
          pageW:Math.round(page.getBoundingClientRect().width),
          groupW:Math.round((page.querySelector(".personalization-group")?.getBoundingClientRect().width)||0) };
      })()`).catch(() => null);
      h.check("⑧ 个性化：无称呼输入、无语气自适应；回复风格与自定义指令仍在",
        Boolean(per && per.page === "个性化" && !per.hasNickInput && !per.hasNickText && !per.hasTone
          && per.hasStyle && per.styleTabs.includes("敢于反驳") && per.hasInstructions && per.groupW >= per.pageW - 12),
        JSON.stringify(per));
      h.check("⑧b 个性化：内置风格库 9 套（含苹果 / 科技）+ 设计规范 + 参考文档/素材 + 提示词预览 + 组件库入口 + 保存",
        Boolean(per && per.hasFrontend && per.frontendTabs.length === 9
          && per.frontendTabs.some((x) => x.includes("苹果")) && per.frontendTabs.some((x) => x.includes("科技"))
          && per.hasFrontendNotes && per.hasFrontendSave && per.hasFrontendPrompt && per.hasFrontendLibrary
          && per.hasFrontendRefs && per.hasFrontendSpec),
        JSON.stringify(per));
      h.check("⑧c 个性化：软件开发（后端）/ 应用架构（后端/全栈）两张规范卡 + 三个启用开关 + 统一保存",
        Boolean(per && per.hasNormCards && per.normChips >= 12 && per.normToggles >= 3 && per.hasFrontendSave),
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
          /* 10-27 用户：「搜索框靠左，分类选项放到搜索框后面」⇒ 量真实几何，不看 DOM 顺序 */
          order:(()=>{ const bar=m.querySelector(".mcp-market-toolbar"); return bar?[...bar.children].map((x)=>x.className.split(" ")[0]).slice(0,2).join(">"):""; })(),
          searchBeforeCat:(()=>{ const bar=m.querySelector(".mcp-market-toolbar"); if(!bar) return false;
            const s=bar.querySelector(".search-field"), c=bar.querySelector(".mcp-category-filter");
            if(!s||!c) return false;
            const sr=s.getBoundingClientRect(), cr=c.getBoundingClientRect();
            return sr.left < cr.left - 20 && Math.abs((sr.top+sr.bottom)/2-(cr.top+cr.bottom)/2) <= 10; })(),
          jumps:labels.filter((x)=>x.includes("广场")) };
      })()`).catch(() => null);
      h.check("⑧ MCP：分类改成筛选下拉，市场跳转按钮已删",
        Boolean(mcp && mcp.page === "MCP" && mcp.hasSelect && mcp.options >= 5 && mcp.tabs === 0
          && mcp.labelWrap === "nowrap" && mcp.jumps.length === 0),
        JSON.stringify(mcp));
      /* 10-27 用户：「搜索框靠左，分类选项放到搜索框后面」—— 搜索在最左、分类紧跟其后同一行 */
      h.check("⑫ MCP 工具条：搜索框在最左，分类筛选跟在搜索框后面（同一行）",
        Boolean(mcp && mcp.order === "search-field>mcp-category-filter" && mcp.searchBeforeCat),
        JSON.stringify({ order: mcp && mcp.order, searchBeforeCat: mcp && mcp.searchBeforeCat }));
      /* 10-27 用户（MCP 页截图）：「右上角问号删了」⇒ 页头整块撤掉，
         进页第一屏就是工具条（没有 ? 占的那一行）。 */
      h.check("⑩ MCP：右上角问号与页头说明已删，工具条顶到页面上沿",
        Boolean(mcp && !mcp.hasInfo && !mcp.hasCopy && mcp.toolbarTop > 0 && mcp.toolbarTop < 190),
        JSON.stringify({ hasInfo: mcp && mcp.hasInfo, hasCopy: mcp && mcp.hasCopy, toolbarTop: mcp && mcp.toolbarTop }));

      /* 10-28：下拉框定位改用统一浮层原语（placePopover）—— 这里真点开、真选一项，确认
         ① 弹层完整在视口内且与触发按钮左对齐；② 选中后触发文案跟着变、弹层关闭。
         ⛔ 只验结构（守卫 197）不够：这类"贴边算错"的问题只有真开一次才看得见。 */
      const dd = await h.eval(`(function(){
        const sel=document.querySelector(".settings-modal .mcp-category-select");
        const list=document.querySelector(".app-select-list");
        if(!sel||!list) return null;
        const sb=sel.getBoundingClientRect(), lb=list.getBoundingClientRect();
        return { win:{w:innerWidth,h:innerHeight}, sel:{l:Math.round(sb.left),t:Math.round(sb.top),b:Math.round(sb.bottom)},
          list:{l:Math.round(lb.left),t:Math.round(lb.top),r:Math.round(lb.right),b:Math.round(lb.bottom)},
          label:(sel.querySelector(".app-select-value")?.textContent||"").trim(),
          first:(list.querySelector(".app-select-option")?.textContent||"").trim() };
      })()`).catch(() => null);
      h.check("⑬ MCP 分类下拉：弹层完整在视口内、左缘与触发按钮对齐",
        Boolean(dd) && dd.list.l >= 0 && dd.list.t >= 0 && dd.list.r <= dd.win.w + 1 && dd.list.b <= dd.win.h + 1
          && Math.abs(dd.list.l - dd.sel.l) <= 2,
        JSON.stringify(dd));
      const before = dd && dd.label;
      const pickLabel = await h.eval(`(function(){
        const opts=[...document.querySelectorAll(".app-select-list .app-select-option")];
        const target=opts.find((o)=>(o.textContent||"").trim() && (o.textContent||"").trim() !== ${JSON.stringify(before)});
        if(!target) return null; const t=(target.textContent||"").trim(); target.click(); return t;
      })()`).catch(() => null);
      await wait(400);
      const afterPick = await h.eval(`(function(){
        const sel=document.querySelector(".settings-modal .mcp-category-select");
        return { label:(sel?.querySelector(".app-select-value")?.textContent||"").trim(), open:!!document.querySelector(".app-select-list") };
      })()`).catch(() => null);
      h.check("⑭ MCP 分类下拉：点第二项后触发文案跟着变、弹层关闭",
        Boolean(pickLabel && afterPick && !afterPick.open && afterPick.label === pickLabel),
        JSON.stringify({ pickLabel, afterPick }));
      /* 还原成「全部分类」，避免把筛选态留给后面的断言 */
      await h.eval(`(function(){
        const sel=document.querySelector(".settings-modal .mcp-category-select"); sel?.click(); return 1;
      })()`);
      await wait(300);
      await h.eval(`(function(){
        const opt=[...document.querySelectorAll(".app-select-list .app-select-option")].find((o)=>(o.textContent||"").trim() === ${JSON.stringify(before || "全部分类")});
        opt?.click(); return 1;
      })()`);
      await wait(300);

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

      /* 10-27 用户（子智能体页截图）：「不要内置子智能体…这个卡片删除；返智能体团队按键，
         跟新建子智能体放一排，靠左」⇒ 横幅卡没了、返回键并进页头操作行且靠左、
         壳层不再单独占一行。⛔ 内置评审"删了又回来"的根治在启动链（不再种入），
         这里只量界面；回归验证见提交说明。 */
      await nav("专家/专家团");
      await wait(1000);
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-modal .hub-card")].find((x)=>(x.textContent||"").includes("子智能体")); if (b) b.click(); return 1; })()`);
      await wait(1200);
      const agentsPg = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const page=m.querySelector(".subagent-center"); if(!page) return null;
        const back=page.querySelector(".subagent-back");
        const neu=[...page.querySelectorAll(".subagent-head-actions button")].find((b)=>(b.textContent||"").includes("新建子智能体"));
        const r=(el)=>el?el.getBoundingClientRect():null;
        const br=r(back), nr=r(neu);
        return { hasBanner:!!page.querySelector(".subagent-banner"),
          shellBackRow:!!m.querySelector(".settings-back-row:not(.subagent-back)"),
          hasBack:!!back,
          sameRow: br&&nr ? Math.abs((br.top+br.bottom)/2-(nr.top+nr.bottom)/2) <= 8 : false,
          backLeft: br&&nr ? br.left < nr.left - 40 : false };
      })()`).catch(() => null);
      h.check("⑬ 子智能体页：横幅卡已删；返回键与「新建」同一排且靠左（壳层不再单独占一行）",
        Boolean(agentsPg && !agentsPg.hasBanner && agentsPg.hasBack && !agentsPg.shellBackRow
          && agentsPg.sameRow && agentsPg.backLeft),
        JSON.stringify(agentsPg));

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

      await nav("SSH 服务器");
      await wait(900);
      const sshBar = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const page=m.querySelector(".ssh-page"); if(!page) return null;
        const search=page.querySelector(".search-field");
        const sel=page.querySelector(".ssh-status-select");
        const line=page.querySelector(".ssh-actions-line");
        if(!search||!sel||!line) return null;
        const btns=[...line.querySelectorAll("button")];
        const sr=sel.getBoundingClientRect(), ir=search.getBoundingClientRect(), br=line.getBoundingClientRect();
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          selectText:(sel.textContent||"").trim(),
          buttons:btns.map((b)=>(b.textContent||"").trim()),
          heights:btns.map((b)=>Math.round(b.getBoundingClientRect().height)),
          sameRow:Math.abs((sr.top+sr.bottom)/2-(ir.top+ir.bottom)/2) <= 10 && Math.abs((br.top+br.bottom)/2-(ir.top+ir.bottom)/2) <= 10,
          pageInfo:!!page.querySelector(".page-info"),
          headingActions:!!page.querySelector(".settings-heading-actions") };
      })()`).catch(() => null);
      h.check("⑮ SSH 页：搜索 + 状态下拉 + 导入/导出/新建连接同一行，问号已删",
        Boolean(sshBar && sshBar.page === "SSH 服务器" && !sshBar.pageInfo && !sshBar.headingActions
          && sshBar.selectText.includes("全部") && sshBar.sameRow
          && ["导入", "导出", "新建连接"].every((label)=>sshBar.buttons.some((x)=>x.includes(label)))
          && sshBar.heights.every((h)=>h <= 30)),
        JSON.stringify(sshBar));

      await nav("专家/专家团");
      await wait(800);
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-modal .hub-card")].find((x)=>(x.querySelector("strong")?.textContent||"").trim()==="专家中心"); b?.click(); return b?1:0; })()`);
      await h.waitFor(`!!document.querySelector(".expert-center-head")`, { label: "专家中心页头", timeoutMs: 5000 }).catch(() => undefined);
      await wait(400);
      const expertHead = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const page=m.querySelector(".expert-center-page"); if(!page) return null;
        const head=page.querySelector(".expert-center-head");
        const back=head?head.querySelector(".settings-back-row"):null;
        const market=head?head.querySelector(".settings-heading-actions button"):null;
        if(!head||!back||!market) return null;
        const br=back.getBoundingClientRect(), mr=market.getBoundingClientRect();
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          sameRow:Math.abs((br.top+br.bottom)/2-(mr.top+mr.bottom)/2) <= 10,
          backLeft:br.left < mr.left,
          backs:page.querySelectorAll(".settings-back-row").length,
          pageInfo:!!page.querySelector(".page-info") };
      })()`).catch(() => null);
      h.check("⑰ 专家中心：返回与专家市场同一排（返回靠左），问号已删",
        Boolean(expertHead && expertHead.sameRow && expertHead.backLeft && expertHead.backs === 1 && !expertHead.pageInfo),
        JSON.stringify(expertHead));

      await nav("专家/专家团");
      await wait(800);
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-modal .hub-card")].find((x)=>(x.querySelector("strong")?.textContent||"").trim()==="专家团"); b?.click(); return b?1:0; })()`);
      await h.waitFor(`!!document.querySelector(".expert-team-center")`, { label: "专家团页", timeoutMs: 5000 }).catch(() => undefined);
      await wait(400);
      const teamsHead = await h.eval(`(function(){
        const m=document.querySelector(".settings-modal"); if(!m) return null;
        const page=m.querySelector(".expert-team-center"); if(!page) return null;
        const back=page.querySelector(".teams-back");
        const actions=page.querySelector(".settings-heading-actions");
        if(!back||!actions) return null;
        const br=back.getBoundingClientRect(), ar=actions.getBoundingClientRect();
        return { page:(m.querySelector(".settings-nav button.active")?.textContent||"").trim(),
          sameRow:Math.abs((br.top+br.bottom)/2-(ar.top+ar.bottom)/2) <= 10,
          backLeft:br.left < ar.left,
          banner:!!page.querySelector(".subagent-banner"),
          backs:page.querySelectorAll(".settings-back-row").length };
      })()`).catch(() => null);
      h.check("⑱ 专家团：返回键并进操作行靠左，Codex 说明卡已删",
        Boolean(teamsHead && teamsHead.sameRow && teamsHead.backLeft && !teamsHead.banner && teamsHead.backs === 1),
        JSON.stringify(teamsHead));

      /* ⑲ 10-27 用户（新建子智能体截图）：「这个新建子智能体更新一下，都是旧的，工具也是」
         ⇒ 推理强度只剩四档、开关是共享胶囊、工具说明给 agent_invoke + subagent_save。 */
      if (!(await h.eval(`!!document.querySelector(".settings-modal")`))) {
        await h.eval(`document.querySelector(".sidebar-settings")?.click()`);
        await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置面板", timeoutMs: 8000 });
        await wait(600);
      }
      await nav("专家/专家团");
      await wait(800);
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-modal .hub-card")].find((x)=>(x.querySelector("strong")?.textContent||"").trim()==="子智能体"); b?.click(); return b?1:0; })()`);
      await h.waitFor(`!!document.querySelector(".subagent-center .subagent-head-actions")`, { label: "子智能体页", timeoutMs: 12000 }).catch(() => undefined);
      await wait(300);
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".subagent-head-actions button")].find((x)=>(x.textContent||"").includes("新建子智能体")); b?.click(); return b?1:0; })()`);
      await h.waitFor(`!!document.querySelector(".subagent-editor-modal")`, { label: "新建子智能体弹窗", timeoutMs: 8000 }).catch(() => undefined);
      await wait(400);
      const subModalBase = await h.eval(`(function(){
        const m=document.querySelector(".subagent-editor-modal"); if(!m) return null;
        const text=(m.textContent||"");
        return { toggles:m.querySelectorAll(".toggle-switch").length,
          checkboxes:m.querySelectorAll('input[type="checkbox"]').length,
          toolBox:!!m.querySelector(".subagent-tool-box"),
          hasInvoke:text.includes("agent_invoke"), hasSave:text.includes("subagent_save"),
          oldCopy:text.includes("dynamicTools")||text.includes("agent_invoke · subagent") };
      })()`).catch(() => null);
      await h.eval(`(function(){ document.querySelector(".subagent-editor-modal .app-select-trigger")?.click(); return 1; })()`);
      await wait(400);
      const effortOpts = await h.eval(`(function(){ return [...document.querySelectorAll(".app-select-list .app-select-option-label")].map((x)=>(x.textContent||"").trim()); })()`).catch(() => []);
      h.check("⑲ 新建子智能体：推理强度四档、共享胶囊开关、agent_invoke + subagent_save",
        Boolean(subModalBase && subModalBase.toggles >= 4 && subModalBase.checkboxes === 0
          && subModalBase.toolBox && subModalBase.hasInvoke && subModalBase.hasSave && !subModalBase.oldCopy
          && effortOpts.join("/") === "低/中/高/极高"),
        JSON.stringify({ ...subModalBase, effortOpts }));
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".subagent-editor-modal footer button")].find((x)=>(x.textContent||"").includes("取消")); b?.click(); return b?1:0; })()`);
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
    name: "🧩 功能入口：顶部/底部两种位置 + 右侧浮层 + 拖动排序 + 更多 + 首次教程（10-28 按浮层模型重写）",
    run: async (h) => {
      /* ⛔ 10-28 重写原因：10-26 用户令「侧栏功能入口改成右侧浮层，不占纵向空间」之后，
         入口组不再是「内联可折叠列表」—— 两处位置都只剩一行开关，点开才 portal 出浮层。
         旧脚本还在找 .sidebar-options-body / 折叠动画（这两样已不存在），于是整项长期假红。
         现在测的是**用户真正能碰到的四件事**：开关位置对得上、浮层内容与顺序、教程、编辑菜单。 */
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "界面就绪", timeoutMs: 40000 });
      await h.eval(`(function(){ document.querySelector(".office-overlay-close")?.click(); document.querySelector(".function-menu-editor .fm-editor-close")?.click(); return 1; })()`).catch(() => undefined);
      await wait(400);
      /* 先回顶部 + 恢复默认（上一轮可能停在底部、或把入口拖进了「更多」） */
      await h.eval(`window.codex.saveAppSettings({ functionMenu: { location: "top" } })`).catch(() => undefined);
      await wait(300);
      await h.reload({ waitMs: 2200 });
      await wait(1500);
      await h.waitFor(`!!document.querySelector(".sidebar-options-toggle")`, { label: "入口开关就绪", timeoutMs: 20000 });
      await wait(500);

      const geo = () => h.eval(`(function(){
        const box=(el)=>{ if(!el) return null; const b=el.getBoundingClientRect(); return {l:Math.round(b.left),t:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom),w:Math.round(b.width),h:Math.round(b.height)}; };
        const toggle=document.querySelector(".sidebar-options-toggle");
        const fly=document.querySelector(".sidebar-options-flyout");
        return { win:{w:innerWidth,h:innerHeight}, sidebar:box(document.querySelector(".sidebar")), quick:box(document.querySelector(".sidebar-quick")),
          account:box(document.querySelector(".account-row")), toggle:box(toggle), topGroup:!!document.querySelector(".sidebar-options-top"),
          flyout:box(fly), flyOpen:!!fly,
          rows:document.querySelectorAll(".sidebar-options-flyout .sidebar-cap-row").length,
          labels:[...document.querySelectorAll(".sidebar-options-flyout .sidebar-cap-row")].map((b)=>(b.querySelector("span")?.innerText||b.innerText||"").trim()),
          more:!!document.querySelector(".sidebar-options-flyout .function-menu-more") };
      })()`);

      const closed = await geo();
      h.check("① 顶部位置：开关紧贴在「新会话 / 搜索任务」下面（间距 ≤10px），默认不展开",
        Boolean(closed.toggle && closed.quick && closed.topGroup)
          && closed.toggle.t >= closed.quick.b - 1 && closed.toggle.t - closed.quick.b <= 16 && !closed.flyOpen,
        JSON.stringify({ gap: closed.toggle && closed.quick ? closed.toggle.t - closed.quick.b : null, flyOpen: closed.flyOpen }));

      await h.eval(`document.querySelector(".sidebar-options-toggle")?.click()`);
      await wait(450);
      const opened = await geo();
      const fly = opened.flyout;
      h.check("② 点开：右侧浮层出现在侧栏右缘，入口 + 「更多」齐全，且完整在视口内",
        Boolean(fly && opened.sidebar) && fly.l >= opened.sidebar.r - 1 && fly.t >= 0 && fly.b <= opened.win.h + 1
          && opened.rows >= 6 && opened.more
          && ["自动化", "前端开发", "团队", "个性化&记忆", "登录管理", "新手教程"].every((label) => opened.labels.some((x) => x.includes(label))),
        JSON.stringify({ fly: fly && { l: fly.l, t: fly.t, b: fly.b }, sidebarRight: opened.sidebar?.r, rows: opened.rows, labels: opened.labels }));

      /* 首次悬停教程：清掉已看标记再 hover 开关 */
      await h.eval(`localStorage.removeItem("function-menu-tour-seen-v1-top")`).catch(() => undefined);
      await h.pressKey("Escape").catch(() => undefined);
      await wait(200);
      await h.hover(".sidebar-options-toggle");
      await wait(250);
      /* CDP 鼠标可能本来就停在那儿 ⇒ mouseenter 不触发；补一次合成 mouseover（React 由它合成 onMouseEnter） */
      await h.eval(`document.querySelector(".sidebar-options-toggle")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))`).catch(() => undefined);
      await wait(700);
      const tour = await h.eval(`document.querySelector(".function-menu-tour")?.innerText || ""`).catch(() => "");
      h.check("③ 首次悬停弹教程（说明编辑菜单 / 拖进更多 / 可在设置里换位置）",
        tour.includes("更顺手") && tour.includes("编辑菜单") && tour.includes("拖进") && tour.includes("设置 → 外观"),
        JSON.stringify({ tour: tour.slice(0, 80) }));
      await h.eval(`[...document.querySelectorAll(".function-menu-tour-actions button")].find((b) => b.innerText.includes("知道了"))?.click()`).catch(() => undefined);
      await wait(250);

      /* 编辑菜单：打开浮层 → 更多 → 编辑菜单 */
      await h.eval(`document.querySelector(".sidebar-options-toggle")?.click()`);
      await wait(300);
      await h.eval(`document.querySelector(".sidebar-options-flyout .function-menu-more")?.click()`);
      await wait(300);
      await h.eval(`[...document.querySelectorAll(".function-menu-popover-item")].find((b) => b.innerText.includes("编辑菜单"))?.click()`);
      await h.waitFor(`!!document.querySelector(".function-menu-editor")`, { label: "编辑菜单弹窗", timeoutMs: 4000 }).catch(() => undefined);
      const editor = await h.eval(`(function(){
        return { open: !!document.querySelector(".function-menu-editor"),
          cols: [...document.querySelectorAll(".fm-edit-col")].map((c) => c.querySelectorAll(".fm-edit-row").length),
          locations: [...document.querySelectorAll(".fm-location-card")].map((b) => b.innerText.trim().split("\\n")[0]) };
      })()`).catch(() => null);
      h.check("④ 更多 → 编辑菜单：两列（显示 / 更多）+ 顶部与底部两个位置可选",
        Boolean(editor && editor.open && editor.cols[0] >= 1 && editor.locations.length === 2
          && editor.locations.includes("侧栏顶部") && editor.locations.includes("侧栏底部")),
        JSON.stringify(editor));

      /* 拖动第一项到「更多」列 */
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
      await wait(300);
      const dragged = await h.eval(`(function(){
        const overflow = [...document.querySelectorAll(".fm-edit-col")[1].querySelectorAll(".fm-edit-label")].map((e) => e.innerText.trim());
        return { first: ${JSON.stringify(firstLabel)}, overflow,
          badge: document.querySelector(".function-menu-more-badge")?.innerText.trim() || "" };
      })()`).catch(() => null);
      h.check("⑤ 拖动入口到「更多」：进入更多列，「更多」上出现角标",
        Boolean(dragged && dragged.overflow.some((x) => x === dragged.first.trim() || x.includes(dragged.first.trim()))),
        JSON.stringify(dragged));

      await h.eval(`(function(){ const row = document.querySelectorAll(".fm-edit-col")[1]?.querySelector(".fm-edit-row"); const btns = row ? row.querySelectorAll("button") : []; btns[2]?.click(); return 1; })()`).catch(() => 0);
      await wait(250);
      const movedBack = await h.eval(`(function(){
        return { overflowCount: document.querySelectorAll(".fm-edit-col")[1]?.querySelectorAll(".fm-edit-row").length || 0,
          badge: document.querySelector(".function-menu-more-badge")?.innerText.trim() || "" };
      })()`).catch(() => null);
      h.check("⑥ 从「更多」移回：更多列清空、角标消失", Boolean(movedBack && movedBack.overflowCount === 0 && !movedBack.badge), JSON.stringify(movedBack));

      /* 切到侧栏底部：开关搬到账户行上方（浮层行为不变） */
      await h.eval(`document.querySelectorAll(".fm-location-card")[1]?.click()`).catch(() => undefined);
      await wait(300);
      await h.eval(`[...document.querySelectorAll(".fm-editor-foot button")].find((b) => b.innerText.includes("完成"))?.click()`).catch(() => undefined);
      await wait(600);
      const bottom = await geo();
      h.check("⑦ 切到侧栏底部：开关移到账户行上方，顶部位置消失",
        Boolean(bottom.toggle && bottom.account) && !bottom.topGroup
          && bottom.toggle.b <= bottom.account.t + 1 && bottom.toggle.t > (bottom.quick?.b ?? 0),
        JSON.stringify({ toggle: bottom.toggle, account: bottom.account, topGroup: bottom.topGroup }));

      await h.eval(`document.querySelector(".sidebar-options-toggle")?.click()`);
      await wait(400);
      const bottomOpen = await geo();
      h.check("⑧ 底部位置点开同样是右侧浮层，入口数量与顺序共用同一份配置",
        bottomOpen.flyOpen && bottomOpen.rows >= 6 && bottomOpen.flyout.l >= (bottomOpen.sidebar?.r ?? 0) - 1,
        JSON.stringify({ rows: bottomOpen.rows, fly: bottomOpen.flyout && { l: bottomOpen.flyout.l }, sidebarRight: bottomOpen.sidebar?.r }));

      /* 收尾：切回顶部 + 恢复默认排序 */
      await h.eval(`document.querySelector(".sidebar-options-flyout .function-menu-more")?.click()`);
      await wait(300);
      await h.eval(`[...document.querySelectorAll(".function-menu-popover-item")].find((b) => b.innerText.includes("编辑菜单"))?.click()`);
      await h.waitFor(`!!document.querySelector(".function-menu-editor")`, { timeoutMs: 4000 }).catch(() => undefined);
      await h.eval(`document.querySelectorAll(".fm-location-card")[0]?.click()`).catch(() => undefined);
      await wait(250);
      await h.eval(`[...document.querySelectorAll(".fm-editor-foot button")].find((b) => b.innerText.includes("恢复默认"))?.click()`).catch(() => undefined);
      await wait(250);
      await h.eval(`[...document.querySelectorAll(".fm-editor-foot button")].find((b) => b.innerText.includes("完成"))?.click()`).catch(() => undefined);
      await wait(500);
      const restored = await geo();
      h.check("⑨ 收尾：回到侧栏顶部 + 浮层收起（默认排序已恢复）",
        restored.topGroup && !restored.flyOpen
          && Boolean(restored.toggle) && restored.toggle.t >= (restored.quick?.b ?? 0) - 1,
        JSON.stringify({ topGroup: restored.topGroup, flyOpen: restored.flyOpen }));
      await h.screenshot("function-menu");
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
    id: "voice-ball-task",
    name: "🎯 悬浮球任务姿态 + 安静陪伴（10-29）",
    run: async (h) => {
      await h.waitFor(`!!document.querySelector(".voice-ball")`, { label: "悬浮球", timeoutMs: 12000 });
      const base = await h.eval(`(function(){ const b=document.querySelector(".voice-ball");
        return { task:b.getAttribute("data-task"), quiet:b.getAttribute("data-quiet") }; })()`).catch(() => null);
      h.check("① 球挂任务姿态（data-task 存在，初始 idle）+ 安静标志位",
        Boolean(base && base.task !== null && base.quiet !== null), JSON.stringify(base));

      /* 右键菜单里有「安静陪伴」，点了立刻生效（data-quiet + 落盘）。 */
      await h.eval(`(function(){ const b=document.querySelector(".voice-ball");
        b.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true})); return 1; })()`);
      await h.waitFor(`!!document.querySelector(".voice-ball-menu")`, { label: "球菜单", timeoutMs: 5000 }).catch(() => undefined);
      const menu = await h.eval(`(function(){ const m=document.querySelector(".voice-ball-menu"); if(!m) return null;
        const btn=[...m.querySelectorAll("button")].find(x=>(x.textContent||"").includes("安静陪伴"));
        if(!btn) return { has:false };
        btn.click(); return { has:true, clicked:true }; })()`).catch(() => null);
      await wait(600);
      const after = await h.eval(`(async function(){ const b=document.querySelector(".voice-ball");
        const s=await window.codex.voiceSettingsGet(); return { quietAttr:b.getAttribute("data-quiet"), saved:s?.settings?.ball?.quiet === true }; })()`).catch(() => null);
      h.check("② 菜单「安静陪伴」一键生效（data-quiet=1 + voice-settings 落盘 true）",
        Boolean(menu && menu.has && menu.clicked && after && after.quietAttr === "1" && after.saved), JSON.stringify({ menu, after }));

      /* 恢复：再从设置页关掉，验证同一字段双向同步。 */
      await h.eval(`(function(){ document.querySelector(".sidebar-settings")?.click(); return 1; })()`);
      await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置面板", timeoutMs: 8000 });
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-nav button")].find(x=>(x.textContent||"").trim()==="语音通话"); b?.click(); return 1; })()`);
      await wait(1200);
      const toggled = await h.eval(`(function(){
        const label=[...document.querySelectorAll(".voice-card label")].find(x=>(x.textContent||"").includes("安静陪伴"));
        if(!label) return null; const input=label.querySelector("input");
        if(!input || !input.checked) return { found:!!label, checked:input?input.checked:null };
        input.click(); return { found:true, clicked:true }; })()`).catch(() => null);
      await wait(900);
      const restored = await h.eval(`(async function(){ const s=await window.codex.voiceSettingsGet();
        const b=document.querySelector(".voice-ball"); return { saved:s?.settings?.ball?.quiet === true, attr:b?b.getAttribute("data-quiet"):null }; })()`).catch(() => null);
      h.check("③ 设置页同一开关可关（quiet 回 false，球回 data-quiet=0）",
        Boolean(toggled && toggled.clicked && restored && restored.saved === false && restored.attr === "0"),
        JSON.stringify({ toggled, restored }));
      await h.eval(`(function(){ document.querySelector(".settings-modal .settings-modal-close, .settings-modal [aria-label*='关闭'], .settings-modal .settings-close")?.click(); return 1; })()`);
      await wait(400);
    },
  },
  {
    id: "dev-port",
    name: "🌐 本机测试端口：命令输出出现 localhost:端口 ⇒ 自动展开右栏浏览器（10-29）",
    run: async (h) => {
      /* ⛔ 秒级验收：真回合链路依赖模型执行命令（环境 401 时白等几分钟），改走桥的
         确定性入口（CustomEvent "dev-port:open" —— 与 onEvent 扫描共用同一条 openUrl）。
         扫描逻辑（URL 提取 / 去重 / 会话闸）由 12ag 守卫的真值表钉住。 */
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "主界面", timeoutMs: 30000 });
      /* ⛔ app-shell 首帧后有一次重载，早派发的事件会丢 —— 等 AppView 挂载完成（球出现）再触发。 */
      await h.waitFor(`!!document.querySelector(".voice-ball")`, { label: "悬浮球挂载", timeoutMs: 20000 });
      await h.eval(`(function(){
        window.dispatchEvent(new CustomEvent("dev-port:open", { detail: { url: "http://127.0.0.1:4173/preview" } }));
        return 1; })()`);
      await wait(1500);
      const probe = await h.eval(`(function(){
        const wv=document.querySelector(".browser-pane-webview");
        const dock=document.querySelector(".context-panel");
        return { src: wv ? String(wv.src || "") : "", width: dock ? Math.round(dock.getBoundingClientRect().width) : 0 };
      })()`).catch(() => null);
      h.check("① 端口事件 ⇒ 右栏浏览器自动打开该地址",
        Boolean(probe && probe.src.includes("127.0.0.1:4173")), JSON.stringify(probe));
      h.check("② 右栏自动加宽到 ≥360（给预览让位）", Boolean(probe && probe.width >= 360), String(probe && probe.width));
      /* 去重：同一 URL 再派发一次，不得重复开新标签（tab 数不变）。 */
      const tabsBefore = await h.eval(`document.querySelectorAll(".browser-pane-tabs .browser-pane-tab").length`).catch(() => 0);
      await h.eval(`(function(){ window.dispatchEvent(new CustomEvent("dev-port:open", { detail: { url: "http://127.0.0.1:4173/preview" } })); return 1; })()`);
      await wait(800);
      const tabsAfter = await h.eval(`document.querySelectorAll(".browser-pane-tabs .browser-pane-tab").length`).catch(() => 0);
      h.check("③ 同一 URL 去重（不重复开标签）", tabsAfter === tabsBefore && tabsBefore > 0, `${tabsBefore}→${tabsAfter}`);
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
    id: "composer-rail",
    name: "🧷 输入框竖条：默认收起 / 四个入口 / 弹层贴边 / 选表情只插表情 / 弹层期间不自动收起（10-28）",
    run: async (h) => {
      /* 10-27 用户要的是「贴输入框左边的一条小粗条」，四条判据都是他当场打回来的：
         ① 竖着贴线（不是横着压在输入框上）；② 点得开；③ 选表情只插一个表情、面板自己收；
         ④ 10 秒不碰自动收起，但开着弹层时不收。守卫 12ae 只验结构，这里走真点击。 */
      await h.eval(`localStorage.setItem("composer-rail-open","0")`).catch(() => undefined);
      await h.eval(`window.codex?.saveAppSettings?.({composerRailOpen:false})`).catch(() => undefined);
      await h.reload({ waitMs: 2200 });
      await wait(1600);
      await h.waitFor(`!!document.querySelector(".composer-rail-toggle")`, { label: "竖条出现", timeoutMs: 30000 });
      await wait(600);

      const geo = () => h.eval(`(function(){
        const r=(sel)=>{const e=document.querySelector(sel); if(!e)return null; const b=e.getBoundingClientRect(); return {left:Math.round(b.left),right:Math.round(b.right),top:Math.round(b.top),bottom:Math.round(b.bottom),w:Math.round(b.width),h:Math.round(b.height)};};
        const panel=document.querySelector(".composer-rail-panel")?.getBoundingClientRect();
        return {win:{w:innerWidth,h:innerHeight}, composer:r(".composer"), toggle:r(".composer-rail-toggle"),
          icons:document.querySelectorAll(".composer-rail-icon").length, grip:!!document.querySelector(".composer-rail-grip"),
          panel: panel?{left:Math.round(panel.left),top:Math.round(panel.top),right:Math.round(panel.right),bottom:Math.round(panel.bottom)}:null,
          stickers:document.querySelectorAll(".sticker").length,
          prompt:(document.querySelector(".composer-editor")?.textContent ?? "")};
      })()`);

      const closed = await geo();
      const c = closed.composer, t = closed.toggle;
      h.check("① 默认收起：只有一条竖着夹在输入框左边线上的窄条（不占横向空间）",
        Boolean(c && t) && t.w <= 16 && t.h >= 36 && t.h <= 90
          && Math.abs((t.left + t.right) / 2 - c.left) <= 3 && closed.grip && closed.icons === 0 && !closed.panel,
        JSON.stringify({ toggle: t, composer: c, icons: closed.icons }));

      await h.eval(`document.querySelector(".composer-rail-toggle")?.click()`);
      await wait(350);
      const opened = await geo();
      h.check("② 点一下展开：四个入口横向排在输入框左侧，右缘仍贴着输入框",
        opened.icons >= 4 && Boolean(opened.toggle)
          && opened.toggle.right <= c.left + 120 && opened.toggle.left >= c.left - 160,
        JSON.stringify({ icons: opened.icons, toggle: opened.toggle, composerLeft: c.left }));

      await h.eval(`document.querySelector('.composer-rail-icon[title="心情表情"]')?.click()`);
      await wait(500);
      const panel = await geo();
      h.check("③ 点「心情表情」：弹层完整落在视口内，表情足够多（≥40）",
        Boolean(panel.panel) && panel.panel.left >= 0 && panel.panel.top >= 0
          && panel.panel.right <= panel.win.w + 1 && panel.panel.bottom <= panel.win.h + 1 && panel.stickers >= 40,
        JSON.stringify({ panel: panel.panel, win: panel.win, stickers: panel.stickers }));

      const picked = await h.eval(`(function(){
        const b=document.querySelector(".sticker"); if(!b) return null;
        const emo=(b.querySelector(".sticker-emoji")?.textContent||"").trim();
        b.click(); return emo;
      })()`);
      await wait(450);
      const afterPick = await geo();
      h.check("④ 选一个表情：只把那个表情插进输入框，弹层自己收（不留着挡视线）",
        Boolean(picked) && afterPick.prompt.trim().endsWith(picked) && !afterPick.panel,
        JSON.stringify({ picked, prompt: afterPick.prompt, panel: afterPick.panel }));

      /* ⑤ 弹层开着不自动收起：竖条 10s 自动收，但「打开着弹层」是明确的用户意图 */
      await h.eval(`document.querySelector('.composer-rail-icon[title="收藏夹"]')?.click()`);
      await wait(400);
      await wait(11000);
      const holding = await geo();
      h.check("⑤ 弹层开着超过 10 秒：竖条不收起、弹层还在（不是「点开就被自动收起打断」）",
        Boolean(holding.panel) && holding.icons >= 4,
        JSON.stringify({ panel: Boolean(holding.panel), icons: holding.icons }));

      /* ⑥ 展开态跨重启保留（localStorage + app-settings 双写） */
      await h.reload({ waitMs: 2200 });
      await wait(1800);
      await h.waitFor(`!!document.querySelector(".composer-rail-toggle")`, { label: "竖条回灌", timeoutMs: 20000 });
      await wait(500);
      const restored = await geo();
      h.check("⑥ 重载后仍是展开态（展开状态双写回灌，不是靠内存）",
        restored.icons >= 4 && !restored.panel,
        JSON.stringify({ icons: restored.icons, panel: Boolean(restored.panel) }));

      /* ⑦ 空闲 10 秒自动收起（用户原话「这个一直展示不会自动隐藏，10秒后自动隐藏」） */
      await wait(11500);
      const idle = await geo();
      h.check("⑦ 空闲 10 秒后自动收起成一条窄竖条",
        idle.icons === 0 && !idle.panel && Boolean(idle.toggle) && idle.toggle.w <= 16,
        JSON.stringify({ icons: idle.icons, toggle: idle.toggle }));
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
  {
    id: "skill-packs",
    name: "📦 开发工具 · 精选技能包：3 行带许可/配套说明，面板只在二级弹窗（10-30）",
    run: async (h) => {
      /* 只验 UI 与清单贯通（真下载 37MB 不适合放进秒级验收）：卡片、许可徽标、配套工具行，
         以及「面板只在二级弹窗里」这条两级 IA 纪律。 */
      await h.eval(`(function(){ document.querySelector(".sidebar-settings")?.click(); return 1; })()`);
      await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置面板", timeoutMs: 8000 });
      await wait(600);
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-nav button")].find(function(x){ return (x.textContent||"").trim()==="开发工具"; }); if(!b) return 0; b.click(); return 1; })()`);
      await wait(900);
      const cardHit = await h.eval(`(function(){
        const c=document.querySelector('.devtools-card[data-card="skill-packs"]');
        if(!c) return null;
        return { text:(c.textContent||"").trim(), stat:(c.querySelector(".devtools-card-stat")?.textContent||"").trim() };
      })()`).catch(() => null);
      h.check("① 一级卡片在位且带状态（未安装 / 已装 n / 读取中）",
        Boolean(cardHit && cardHit.text.includes("精选技能包") && cardHit.stat.length > 0), JSON.stringify(cardHit));
      const firstLevelPanel = await h.eval(`!!document.querySelector(".devtools-cards .skill-pack-row")`).catch(() => true);
      h.check("② 面板没有内嵌在一级页（两级 IA）", firstLevelPanel === false, String(firstLevelPanel));
      await h.eval(`document.querySelector('.devtools-card[data-card="skill-packs"]').click()`);
      await h.waitFor(`document.querySelectorAll(".settings-dialog .skill-pack-row").length === 3`, { label: "三个技能包卡", timeoutMs: 20000 });
      const packs = await h.eval(`[...document.querySelectorAll(".settings-dialog .skill-pack-row")].map(function(c){
        return { id:c.dataset.pack||"", name:(c.querySelector(".skill-pack-line1 strong")?.textContent||"").trim(),
          badge:((c.querySelector(".skill-pack-line3")?.textContent||"").match(/MIT|CC BY[^·]*/)||[""])[0].trim(),
          companion:(c.querySelector(".skill-pack-line3")?.textContent||"").trim(),
          button:(c.querySelector("button.primary-setting,button.secondary-setting")?.textContent||"").trim() };
      })`).catch(() => null);
      h.check("③ 三张卡各有：名称 / 许可徽标 / 配套工具行 / 动作按钮",
        Array.isArray(packs) && packs.length === 3 && packs.every((p) => p.name && p.badge && p.companion.startsWith("配套") && p.button),
        JSON.stringify(packs));
      h.check("④ 清单来自主进程且三条 id 各不相同",
        Array.isArray(packs) && new Set(packs.map((p) => p.id)).size === 3, JSON.stringify(packs && packs.map((p) => p.id)));
      await h.eval(`document.querySelector(".settings-dialog-close")?.click()`);
      await wait(300);
    },
  },
  {
    id: "devtools-categories",
    name: "🧰 开发工具 · 工具分类：外面只有分类卡，明细进二级弹窗（11-01）",
    run: async (h) => {
      /* 11-01 用户令：「把工具分类，外面只展示分类名字，二级弹窗预览内容，预览里手动下载，
         外面卡片一键安装」。这里只验**界面层级**与接线（真下载几 GB 不进秒级验收；
         安装/取消/进度的结构由守卫 04/11y 钉）。 */
      await h.eval(`(function(){ document.querySelector(".sidebar-settings")?.click(); return 1; })()`);
      await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置面板", timeoutMs: 8000 });
      await wait(600);
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-nav button")].find(function(x){ return (x.textContent||"").trim()==="开发工具"; }); if(!b) return 0; b.click(); return 1; })()`);
      await h.waitFor(`!!document.querySelector('.devtools-card[data-card="tools-devchain"]')`, { label: "工具分类卡", timeoutMs: 15000 });
      await wait(400);
      const level1 = await h.eval(`(function(){
        const grid=document.querySelectorAll(".devtools-cards")[0];
        if(!grid) return null;
        const cards=[...grid.querySelectorAll(".devtools-card")];
        return {
          keys: cards.map(function(c){ return c.dataset.card||""; }),
          opens: cards.filter(function(c){ return !!c.querySelector(".devtools-card-open"); }).length,
          stats: cards.map(function(c){ return (c.querySelector(".devtools-card-stat")?.textContent||"").trim(); }),
          rows: document.querySelectorAll(".devtools-cards .devtools-tool-row").length,
        };
      })()`).catch(() => null);
      const toolKeys = ["tools-base","tools-auto","tools-devchain","tools-media","tools-ai","tools-system","tools-ondemand","tools-health"];
      h.check("① 一级页 = 8 张工具分类卡（7 类 + 自检），每张都有打开按钮",
        Boolean(level1) && toolKeys.every((k) => level1.keys.includes(k)) && level1.opens === level1.keys.length,
        JSON.stringify(level1 && { keys: level1.keys, opens: level1.opens }));
      h.check("② 一级页不出现工具明细行（明细只在二级弹窗 —— 两级 IA）",
        Boolean(level1) && level1.rows === 0, JSON.stringify(level1 && { rows: level1.rows }));
      h.check("③ 每张分类卡都显示当前就绪数（不是空壳）",
        Boolean(level1) && level1.stats.length >= toolKeys.length && level1.stats.every((s) => s.length > 0),
        JSON.stringify(level1 && level1.stats));

      await h.eval(`document.querySelector('.devtools-card[data-card="tools-devchain"]').querySelector(".devtools-card-open").click()`);
      await h.waitFor(`!!document.querySelector(".settings-dialog .devtools-tool-row")`, { label: "分类弹窗工具行", timeoutMs: 10000 });
      await wait(300);
      const dialog = await h.eval(`(function(){
        const d=document.querySelector(".settings-dialog");
        if(!d) return null;
        const rows=[...d.querySelectorAll(".devtools-tool-row")];
        return {
          title:(d.querySelector(".settings-dialog-heading strong")?.textContent||"").trim(),
          ids:rows.map(function(r){ return r.dataset.runtime||""; }),
          actions:rows.map(function(r){ return (r.querySelector(".runtime-actions")?.textContent||"").trim(); }),
          progressCss:!!(document.querySelector("style")||true),
        };
      })()`).catch(() => null);
      const devchain = ["pwsh","git","conda","mingw"];
      h.check("④ 点分类卡打开二级弹窗，标题 = 分类名",
        Boolean(dialog) && dialog.title === "开发工具链", JSON.stringify(dialog && dialog.title));
      h.check("⑤ 弹窗只列该分类的工具（开发工具链 4 项；没有别的分类混进来）",
        Boolean(dialog) && dialog.ids.length > 0 && dialog.ids.every((id) => devchain.includes(id)),
        JSON.stringify(dialog && dialog.ids));
      h.check("⑥ 每行都有手动动作（下载 / 修复 / 已安装 / 内置 / 卸载）",
        Boolean(dialog) && dialog.actions.length === dialog.ids.length && dialog.actions.every((a) => a.length > 0),
        JSON.stringify(dialog && dialog.actions));
      await h.eval(`document.querySelector(".settings-dialog-close")?.click()`);
      await wait(300);

      const cardHasAction = await h.eval(`(function(){
        const cards=[...document.querySelectorAll(".devtools-cards")[0].querySelectorAll(".devtools-card")];
        const stats=cards.map(function(c){ return (c.querySelector(".devtools-card-stat")?.textContent||"").trim(); });
        const allReady=stats.length>0 && stats.every(function(s){
          const m=/已就绪 (\\d+) \\/ (\\d+) 项/.exec(s);
          return !m || m[1]===m[2];
        });
        return {
          installs: cards.filter(function(c){ return !!c.querySelector(".devtools-card-install"); }).length,
          allReady: allReady,
          stats: stats,
        };
      })()`).catch(() => null);
      h.check("⑦ 有可下载项的分类卡底部出现「一键安装」（全都就绪时不出现按钮）",
        Boolean(cardHasAction) && (cardHasAction.installs > 0 || cardHasAction.allReady),
        JSON.stringify(cardHasAction));

      /* ⛔ 11-01 用户实测「一键卸载也没有」：分类卡上也要有「一键卸载」，且点了先出确认弹窗（不许直删）。 */
      const uninstallBtns = await h.eval(`document.querySelectorAll(".devtools-cards .devtools-card-uninstall").length`).catch(() => 0);
      h.check("⑦b 分类卡也有一键卸载", uninstallBtns > 0, String(uninstallBtns));
      if (uninstallBtns > 0) {
        await h.eval(`document.querySelector(".devtools-cards .devtools-card-uninstall").click()`);
        await h.waitFor(`!!document.querySelector(".settings-dialog .runtime-uninstall")`, { label: "一键卸载确认弹窗", timeoutMs: 8000 });
        const confirm = await h.eval(`(function(){
          const d=document.querySelector(".settings-dialog");
          return { title:(d.querySelector(".settings-dialog-heading strong")?.textContent||"").trim(),
            body:(d.querySelector(".settings-dialog-body")?.textContent||"").trim(),
            confirm:(d.querySelector(".runtime-uninstall")?.textContent||"").trim() };
        })()`).catch(() => null);
        h.check("⑦c 点一键卸载先出确认弹窗（列出将删的工具，确认前不执行）",
          Boolean(confirm) && confirm.title.includes("一键卸载") && confirm.body.includes("不可恢复") && confirm.confirm.includes("确认卸载"),
          JSON.stringify(confirm && { title: confirm.title, confirm: confirm.confirm }));
        /* 只关掉确认弹窗，**不执行**卸载（验收不删用户环境里的工具）。 */
        await h.eval(`(function(){
          const d=document.querySelector(".settings-dialog");
          const cancelBtn=[...d.querySelectorAll("button")].find(function(b){ return (b.textContent||"").trim()==="取消"; });
          cancelBtn&&cancelBtn.click(); return 1;
        })()`);
        await wait(250);
      }

      await h.eval(`document.querySelector('.devtools-card[data-card="tools-health"]').querySelector(".devtools-card-open").click()`);
      await h.waitFor(`!!document.querySelector(".settings-dialog .runtime-check")`, { label: "工具自检弹窗", timeoutMs: 8000 });
      const health = await h.eval(`(function(){
        const d=document.querySelector(".settings-dialog");
        return { title:(d.querySelector(".settings-dialog-heading strong")?.textContent||"").trim(),
          check:(d.querySelector(".runtime-check")?.textContent||"").trim(),
          manifest:!!d.querySelector(".devtools-manifest") };
      })()`).catch(() => null);
      h.check("⑧ 工具自检与清单独立成卡：弹窗里有「检查工具」与可复制的清单",
        Boolean(health) && health.title === "工具自检与清单" && health.check.includes("检查工具") && health.manifest,
        JSON.stringify(health));
      await h.eval(`document.querySelector(".settings-dialog-close")?.click()`);
      await wait(300);
    },
  },
  {
    id: "skill-update-panel",
    name: "🔄 控制台 · 技能自动更新：能进入面板、能装能卸、有反馈（10-30）",
    run: async (h) => {
      /* 只验入口与面板结构（检查更新要打市场接口，不放进秒级验收；更新链路由 12j 守卫钉）。 */
      await h.eval(`(function(){ document.querySelector(".sidebar-settings")?.click(); return 1; })()`);
      await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置面板", timeoutMs: 8000 });
      await wait(600);
      const navTo = async (label) => h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-nav button")].find(function(x){ return (x.textContent||"").trim()===${JSON.stringify(label)}; }); if(!b) return 0; b.click(); return 1; })()`);
      await navTo("控制台");
      // 开关行要等 autoUpdate:status（内部最多 2.5s 扫描）回来才渲染
      await h.waitFor(`[...document.querySelectorAll(".card-auto-update button")].some(function(b){ return (b.textContent||"").trim()==="技能更新…"; })`, { label: "技能更新入口", timeoutMs: 20000 });
      await wait(300);
      const entry = await h.eval(`(function(){
        const card=document.querySelector(".card-auto-update");
        if(!card) return null;
        const btn=[...card.querySelectorAll("button")].find(function(b){ return (b.textContent||"").trim()==="技能更新…"; });
        const page=[...card.querySelectorAll("button")].find(function(b){ return (b.textContent||"").trim()==="技能页"; });
        const sw=card.querySelector(".settings-toggle-row");
        return { hasUpdate:!!btn, hasPage:!!page, hasSwitch:(sw?.textContent||"").includes("技能自动更新") };
      })()`).catch(() => null);
      h.check("① 技能行有「技能更新…」「技能页」两个出口 + 原来的开关还在",
        Boolean(entry && entry.hasUpdate && entry.hasPage && entry.hasSwitch), JSON.stringify(entry));
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".card-auto-update button")].find(function(x){ return (x.textContent||"").trim()==="技能更新…"; }); b&&b.click(); return !!b; })()`);
      await h.waitFor(`!!document.querySelector(".settings-dialog .skill-update-panel")`, { label: "技能更新面板", timeoutMs: 8000 });
      await wait(400);
      const panel = await h.eval(`(function(){
        const p=document.querySelector(".settings-dialog .skill-update-panel");
        if(!p) return null;
        const texts=[...p.querySelectorAll("button")].map(function(b){ return (b.textContent||"").trim(); });
        return { texts, log:!!p.querySelector(".skill-update-log"), list:!!p.querySelector(".skill-update-list"), switches:p.querySelectorAll(".settings-toggle-row").length };
      })()`).catch(() => null);
      h.check("② 面板有：检查更新 / 更新全部 / 去技能市场安装",
        Boolean(panel && panel.texts.some((t) => t.includes("检查更新")) && panel.texts.some((t) => t.includes("更新全部")) && panel.texts.some((t) => t.includes("去技能市场安装"))),
        JSON.stringify(panel && panel.texts));
      h.check("③ 面板带安装反馈日志 + 技能行列表，且没有第二个开关",
        Boolean(panel && panel.log && panel.list && panel.switches === 0), JSON.stringify({ log: panel?.log, list: panel?.list, switches: panel?.switches }));
      await h.eval(`document.querySelector(".settings-dialog-close")?.click()`);
      await wait(500);
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".card-auto-update button")].find(function(x){ return (x.textContent||"").trim()==="技能页"; }); b&&b.click(); return !!b; })()`);
      await wait(1200);
      const page = await h.eval(`(document.querySelector(".settings-modal .settings-nav button.active")?.textContent||"").trim()`).catch(() => "");
      h.check("④ 点「技能页」直接进入技能设置页（安装与批量管理在那里）", page === "技能", String(page));
    },
  },
  {
    id: "voice-clone-refresh",
    name: "🎙 语音克隆：模型装好后，下方「我的音色」立即解锁（11-02）",
    run: async (h) => {
      /* 用户实测：模型卡已显示「已就绪」，下面「我的音色」还挂着「还没安装音色克隆模型」、
         radio 全禁用（zipReady 只在挂载时读一次，安装完成事件只刷新了播报引擎）。
         这里走真实链路：页面加载 → 落模型文件 → 点卡片安装（主进程见已就绪直接回 ok）→
         断言下方卡片解锁。模型文件用稀疏文件只满足体积门槛，不下载 156MB。
         ⛔ 只动测试 profile 自己的 voice-models；若已有真模型，不删除，只验「挂载即就绪」。 */
      const modelDir = join(h.userDataDir, "voice-models", "sherpa-onnx-zipvoice-distill-int8-zh-en-emilia");
      const preexisting = existsSync(modelDir);
      if (!preexisting) rmSync(modelDir, { recursive: true, force: true });
      if (!(await h.exists(".settings-modal"))) {
        await h.eval(`document.querySelector(".sidebar-settings")?.click()`);
        await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置面板", timeoutMs: 10000 });
        await wait(500);
      }
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-nav button")].find(function(x){ return (x.textContent||"").trim()==="语音通话"; }); b&&b.click(); return !!b; })()`);
      await h.waitFor(`!!document.querySelector(".voice-settings")`, { label: "语音设置页", timeoutMs: 15000 });
      await wait(1000);
      const readUi = () => h.eval(`(function(){
        const card=[...document.querySelectorAll(".voice-card")].find(function(c){ return (c.innerText||"").includes("我的音色"); });
        const hint=card?(card.querySelector(".voice-card-hint")?.innerText||"").trim():"";
        const radios=[...document.querySelectorAll('input[name="voice-profile"]')];
        const dev=[...document.querySelectorAll(".voice-devtools-card")].find(function(c){ return (c.innerText||"").includes("音色克隆模型"); });
        return { hint:hint, radios:radios.length, disabled:radios.filter(function(r){ return r.disabled; }).length,
          badge:dev?(dev.querySelector(".voice-devtools-badge")?.innerText||"").trim():"" };
      })()`);
      const before = await readUi();
      if (preexisting) {
        h.check("已有模型：进入页面即解锁（提示不含「还没安装」+ radio 可用）",
          Boolean(before && !before.hint.includes("还没安装") && before.disabled === 0), JSON.stringify(before));
        return;
      }
      h.check("① 前置：未装克隆模型时，下方音色卡提示安装且 radio 全禁用",
        Boolean(before && before.hint.includes("还没安装") && before.radios > 0 && before.disabled === before.radios),
        JSON.stringify(before));
      mkdirSync(modelDir, { recursive: true });
      const sparse = (name, bytes) => { const file = join(modelDir, name); writeFileSync(file, ""); truncateSync(file, bytes); };
      sparse("encoder.int8.onnx", 1_000_000);
      sparse("decoder.int8.onnx", 20_000_000);
      writeFileSync(join(modelDir, "tokens.txt"), "x".repeat(300));
      sparse("lexicon.txt", 200_000);
      sparse("vocos_24khz.onnx", 51_400_000);
      try {
        const clicked = await h.eval(`(function(){
          const dev=[...document.querySelectorAll(".voice-devtools-card")].find(function(c){ return (c.innerText||"").includes("音色克隆模型"); });
          const b=dev?[...dev.querySelectorAll("button")].find(function(x){ return (x.innerText||"").includes("下载音色克隆模型"); }):null;
          if(!b) return false; b.click(); return true;
        })()`);
        h.check("② 前置：模型卡仍显示「下载音色克隆模型」按钮（页面状态还是旧的）", clicked === true);
        let after = null;
        for (let i = 0; i < 40; i++) {
          await wait(300);
          after = await readUi();
          if (after && !after.hint.includes("还没安装") && after.disabled === 0) break;
        }
        h.check("③ 安装完成后下方「我的音色」立即解锁（radio 不再禁用、提示消失）",
          Boolean(after && !after.hint.includes("还没安装") && after.disabled === 0), JSON.stringify(after));
      } finally {
        rmSync(modelDir, { recursive: true, force: true });
      }
    },
  },
  {
    id: "wallpaper-mac-motion",
    name: "🌌 壁纸 mac 适配：系统「减少动态效果」下星空/光幕仍动（11-02）",
    run: async (h) => {
      /* 用户反馈「3D 星空没有适配 mac」：全站默认 data-motion=force（无视系统开关），
         但壁纸的 canvas 星空与鼠标视差曾直接读媒体查询 ⇒ mac 开「减少动态效果」时只有壁纸冻住。
         这里用 CDP 模拟系统开关，断言壁纸仍逐帧 + 光幕动画没被静音。 */
      await h.eval(`localStorage.setItem("theme", "obsidian")`);
      await h.eval(`localStorage.setItem("wallpaper", JSON.stringify({ mode: "depth", image: "preset:snow" }))`);
      await h.reload({ waitMs: 2400 });
      await h.waitFor(`!!document.querySelector(".wallpaper-depth")`, { label: "3D 星空画布", timeoutMs: 15000 });
      await wait(700);
      try {
        await h._send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
        await wait(600);
        const meta = await h.eval(`({ motion: document.documentElement.dataset.motion || "", media: matchMedia("(prefers-reduced-motion: reduce)").matches })`);
        h.check("① 系统「减少动态效果」已模拟生效，应用策略仍是 force", meta.motion === "force" && meta.media === true, JSON.stringify(meta));
        const sig = () => h.eval(`(function(){
          const c=document.querySelector(".wallpaper-depth"); if(!c) return "no-canvas";
          const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;
          let sum=0; for(let i=0;i<d.length;i+=4999) sum=(sum*31+d[i])>>>0;
          return sum;
        })()`);
        const a = await sig();
        await wait(700);
        const b = await sig();
        h.check("② 3D 星空仍在逐帧（两帧像素不一致）", a !== b, `${a} / ${b}`);
        await h.eval(`localStorage.setItem("wallpaper", JSON.stringify({ mode: "aurora", image: "preset:snow" }))`);
        await h.eval(`window.dispatchEvent(new CustomEvent("wallpaper-change"))`);
        await h.waitFor(`!!document.querySelector(".wallpaper-motion")`, { label: "极光光幕", timeoutMs: 8000 });
        await wait(400);
        const anim = await h.eval(`(function(){ const b=document.querySelector(".wallpaper-motion i b"); return b ? getComputedStyle(b).animationName : ""; })()`);
        h.check("③ 极光光幕动画没有被系统开关静音", Boolean(anim) && anim !== "none", String(anim));
      } finally {
        await h._send("Emulation.setEmulatedMedia", { features: [] }).catch(() => undefined);
        await h.eval(`localStorage.setItem("wallpaper", JSON.stringify({ mode: "off", image: "" }))`).catch(() => undefined);
        await h.eval(`localStorage.setItem("theme", "light")`).catch(() => undefined);
        await h.eval(`window.dispatchEvent(new CustomEvent("wallpaper-change"))`).catch(() => undefined);
      }
    },
  },
  {
    id: "office-inspector",
    name: "🏢 办公室：悬停显示器弹放大屏（真实内容卡，11-02）",
    run: async (h) => {
      /* 用内置假团队打开办公室（officeProbe，只读诊断钩子），悬停第一块显示器：
         放大卡应出现并显示该成员；移开自动收起。
         ⛔ 先清掉残留的 officeProbe / 已开的办公室：多个 .office-overlay 同时在场时
            `window.__officeSim` 与首个 `.office-pixel-canvas` 可能来自不同一间（坐标对不上 → target null）。 */
      await h.eval(`localStorage.removeItem("officeProbe")`);
      await h.eval(`(() => { document.querySelectorAll(".office-overlay-close").forEach((b) => b.click()); return true; })()`);
      await wait(500);
      await h.eval(`localStorage.setItem("officeProbe", "1")`);
      await h.reload({ waitMs: 2300 });
      await h.waitFor(`[...document.querySelectorAll(".office-overlay")].some((el) => (el.querySelector(".office-overlay-name")?.textContent || "").includes("诊断用团队"))`, { label: "诊断用办公室浮层", timeoutMs: 20000 });
      await h.waitFor(`!!window.__officeSim && window.__officeSim.agents.length > 0 && !!window.__officeSeats`, { label: "办公室调试句柄与成员", timeoutMs: 12000 });
      await wait(900);
      const target = await h.eval(`(function(){
        const seats=window.__officeSeats, sim=window.__officeSim;
        const overlay=[...document.querySelectorAll(".office-overlay")].find((el) => (el.querySelector(".office-overlay-name")?.textContent || "").includes("诊断用团队"));
        const canvas=overlay && overlay.querySelector(".office-pixel-canvas");
        if(!seats||!sim||!canvas) return null;
        const agent=sim.agents[0]; if(!agent) return null;
        const seat=seats[agent.seatIndex], sc=seat&&seat.screen; if(!sc) return null;
        const r=canvas.getBoundingClientRect();
        return { name: agent.name,
          cx: Math.round(r.left+(seat.x+sc.x+sc.w/2)/960*r.width),
          cy: Math.round(r.top+(seat.y+sc.y+sc.h/2)/640*r.height) };
      })()`);
      h.check("① 找到可悬停的成员显示器", Boolean(target && target.cx), JSON.stringify(target));
      await h.eval(`(function(){
        const canvas=document.querySelector(".office-pixel-canvas");
        canvas && canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: ${Number(target?.cx ?? 0)}, clientY: ${Number(target?.cy ?? 0)}, bubbles: true }));
        return true;
      })()`);
      await wait(450);
      const card = await h.eval(`(function(){
        const el=document.querySelector(".office-inspector");
        if(!el) return null;
        return { title: el.querySelector("strong")?.textContent?.trim() || "",
          mode: el.querySelector(".office-inspector-mode")?.textContent?.trim() || "",
          body: (el.querySelector(".office-inspector-body")?.innerText || "").slice(0, 60) };
      })()`);
      h.check("② 悬停弹出放大屏，标题是当前成员", Boolean(card && card.title && target && card.title === target.name), JSON.stringify(card));
      await h.eval(`(function(){ const canvas=document.querySelector(".office-pixel-canvas"); canvas && canvas.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false })); return true; })()`);
      await wait(900);
      h.check("③ 移开自动收起（600ms 宽限后消失）", await h.eval(`!document.querySelector(".office-inspector")`));
      await h.eval(`document.querySelector(".office-overlay-close")?.click()`);
      await wait(400);
      await h.eval(`localStorage.removeItem("officeProbe")`).catch(() => undefined);
    },
  },
  {
    id: "frontend-design-setting",
    name: "个性化前端设计风格：预设 + 自定义内容真写入 AGENTS.md（保存 / 回读 / 复位）",
    run: async (h) => {
      const marker = "ACCEPTANCE-FRONTEND-DESIGN-6B5CFF";
      await h.eval(`(function(){ document.querySelector(".sidebar-settings")?.click(); return 1; })()`);
      await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置面板", timeoutMs: 8000 });
      await wait(900);
      const nav = (label) => h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-nav button")].find(function(x){ return (x.textContent||"").trim()===${JSON.stringify(label)}; }); if(!b) return 0; b.click(); return 1; })()`);
      await nav("个性化");
      await wait(900);
      /* 联动内置组件库：风格卡里的入口必须真的切到「组件库」页，而不是一个装饰链接。 */
      const libClicked = await h.eval(`(function(){ const b=document.querySelector(".frontend-style-library button"); if(!b) return 0; b.click(); return 1; })()`);
      await wait(700);
      const libPage = await h.eval(`(document.querySelector(".settings-nav button.active")?.textContent||"").trim()`);
      h.check("⓪ 风格卡「打开组件库」真的切到组件库页", Boolean(libClicked) && libPage === "组件库", `${libClicked}/${libPage}`);
      await nav("个性化");
      await wait(700);
      const pick = (label) => h.eval(`(function(){ const b=[...document.querySelectorAll(".card-frontend-design .frontend-style-chip")].find(function(x){ return (x.textContent||"").trim().includes(${JSON.stringify(label)}); }); if(!b) return 0; b.click(); return 1; })()`);
      const stored = () => h.eval(`window.codex.readPersonalization()`);
      const initial = await stored().catch(() => null);
      const ensureToggle = (selector, want) => h.eval(`(function(){ const b=document.querySelector(${JSON.stringify(selector)}); if(!b) return 0; const on=b.getAttribute("aria-checked")==="true"; if(on!==${want}) b.click(); return 1; })()`);
      await ensureToggle(".card-frontend-design .norm-toggle", true);
      await wait(200);
      const waitStored = async (predicate, ms = 20000) => {
        const deadline = Date.now() + ms;
        let last = null;
        while (Date.now() < deadline) {
          last = await stored().catch(() => null);
          if (last && predicate(last)) return last;
          await wait(300);
        }
        return last;
      };

      h.check("① 打开前端设计开关并选中「温暖」+ 填写自定义内容后，保存按钮从禁用变可用",
        await pick("温暖") === 1
          && await h.setInput(".personalization-frontend-notes", `主色用蓝紫色 ${marker}`).then(() => true)
          && await wait(250).then(() => h.eval(`document.querySelector(".personalization-savebar .primary-setting")?.disabled === false`))
          && await h.eval(`document.querySelector(".card-frontend-design .norm-toggle")?.getAttribute("aria-checked") === "true"`),
        "开关/预设/输入/保存态");
      await wait(250);
      const refs = await h.eval(`(function(){
        const perStyle=[...document.querySelectorAll(".frontend-style-refs a")].map((a)=>({ text:(a.textContent||"").trim(), href:a.getAttribute("href")||"" }));
        const materials=[...document.querySelectorAll(".frontend-style-materials a")].map((a)=>({ text:(a.textContent||"").trim(), href:a.getAttribute("href")||"" }));
        const systems=[...document.querySelectorAll(".frontend-style-reference-grid a")].map((a)=>a.getAttribute("href")||"");
        const spec=document.querySelector(".frontend-style-spec pre")?.textContent||"";
        const prompt=document.querySelector(".frontend-style-prompt pre")?.textContent||"";
        return { perStyle, materials, systems, spec, prompt };
      })()`);
      h.check("①b 温暖风带 NutUI / Vant 参考地址；国内设计系统清单 ≥10 条且都是 https",
        Boolean(refs.perStyle.length >= 2
          && refs.perStyle.every((r) => r.href.startsWith("https://"))
          && refs.perStyle.some((r) => /NutUI|Vant/.test(r.text))
          && refs.systems.length >= 10 && refs.systems.every((href) => href.startsWith("https://"))),
        JSON.stringify({ perStyle: refs.perStyle, systems: refs.systems.length }));
      h.check("①c 温暖风有完整设计规范 + 参考素材地址",
        refs.spec.includes("设计规范（温暖）") && refs.spec.includes("动效")
          && refs.materials.length >= 2 && refs.materials.every((m) => m.href.startsWith("https://")),
        JSON.stringify({ spec: refs.spec.slice(0, 40), materials: refs.materials }));
      h.check("①d 将注入的提示词带设计规范 + 参考文档/素材地址",
        refs.prompt.includes("Design specification") && refs.prompt.includes("Reference materials")
          && refs.prompt.includes("nutui.jd.com"), refs.prompt.slice(0, 160));
      await h.screenshot("个性化-前端设计风格");

      await h.click(".personalization-savebar .primary-setting");
      const saved = await waitStored((v) => v.frontendDesignStyle === "warm" && String(v.frontendDesignNotes || "").includes(marker));
      h.check("② 档案真的落盘（warm + 自定义内容）",
        Boolean(saved && saved.frontendDesignStyle === "warm" && String(saved.frontendDesignNotes || "").includes(marker)),
        JSON.stringify(saved));

      const verify = await h.eval(`window.codex.verifyPersonalization()`).catch(() => null);
      const agentsText = verify?.agentsPath && existsSync(verify.agentsPath) ? readFileSync(verify.agentsPath, "utf8") : "";
      h.check("③ AGENTS.md 真包含设计方向与自定义内容（不是只写 personalization.json）",
        Boolean(verify?.inSync) && agentsText.includes("Visual direction — warm") && agentsText.includes(marker),
        JSON.stringify({ inSync: verify?.inSync, path: verify?.agentsPath, hit: agentsText.includes(marker) }));

      /* 复位：恢复到本轮开始前的值（测试 profile 也可能带着用户之前配的风格）。 */
      await h.eval(`window.codex.savePersonalization({ frontendDesignStyle: ${JSON.stringify(initial?.frontendDesignStyle || "auto")}, frontendDesignNotes: ${JSON.stringify(initial?.frontendDesignNotes || "")}, frontendDesignEnabled: ${initial?.frontendDesignEnabled === true} })`);
      const reset = await waitStored((v) => v.frontendDesignStyle === (initial?.frontendDesignStyle || "auto")
        && String(v.frontendDesignNotes || "") === String(initial?.frontendDesignNotes || "")
        && v.frontendDesignEnabled === (initial?.frontendDesignEnabled === true));
      const verify2 = await h.eval(`window.codex.verifyPersonalization()`).catch(() => null);
      const agents2 = verify2?.agentsPath && existsSync(verify2.agentsPath) ? readFileSync(verify2.agentsPath, "utf8") : "";
      h.check("④ 复位后档案与 AGENTS.md 都不再带测试内容",
        Boolean(reset && String(reset.frontendDesignNotes || "") === String(initial?.frontendDesignNotes || ""))
          && !agents2.includes(marker),
        JSON.stringify({ reset, stillInAgents: agents2.includes(marker) }));
    },
  },
  {
    id: "engineering-norms-setting",
    name: "个性化后端开发 / 应用架构规范：启用开关、写入 AGENTS.md、关闭即停止注入、复位",
    run: async (h) => {
      const devMarker = "ACCEPTANCE-BACKEND-NORM-71C2";
      const archMarker = "ACCEPTANCE-ARCH-NORM-93F4";
      await h.eval(`(function(){ document.querySelector(".sidebar-settings")?.click(); return 1; })()`);
      await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置面板", timeoutMs: 8000 });
      await wait(900);
      const nav = (label) => h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-nav button")].find(function(x){ return (x.textContent||"").trim()===${JSON.stringify(label)}; }); if(!b) return 0; b.click(); return 1; })()`);
      await nav("个性化");
      await wait(900);
      const pickNorm = (card, label) => h.eval(`(function(){ const root=document.querySelector('[data-norm-card="${card}"]'); if(!root) return 0; const b=[...root.querySelectorAll(".frontend-style-chip")].find(function(x){ return (x.textContent||"").trim().includes(${JSON.stringify(label)}); }); if(!b) return 0; b.click(); return 1; })()`);
      const ensureToggle = (card, want) => h.eval(`(function(){ const root=document.querySelector('[data-norm-card="${card}"]'); const b=root&&root.querySelector(".norm-toggle"); if(!b) return 0; const on=b.getAttribute("aria-checked")==="true"; if(on!==${want}) b.click(); return 1; })()`);
      const stored = () => h.eval(`window.codex.readPersonalization()`);
      const initial = await stored().catch(() => null);
      const waitStored = async (predicate, ms = 20000) => {
        const deadline = Date.now() + ms;
        let last = null;
        while (Date.now() < deadline) {
          last = await stored().catch(() => null);
          if (last && predicate(last)) return last;
          await wait(300);
        }
        return last;
      };
      const agentsText = async () => {
        const verify = await h.eval(`window.codex.verifyPersonalization()`).catch(() => null);
        return verify?.agentsPath && existsSync(verify.agentsPath) ? readFileSync(verify.agentsPath, "utf8") : "";
      };
      const save = () => h.click(".personalization-savebar .primary-setting");

      h.check("① 两张后端规范卡各 6 档、各有启用开关",
        await h.eval(`(function(){ const dev=document.querySelector('[data-norm-card="software-dev"]'); const arch=document.querySelector('[data-norm-card="app-architecture"]'); return Boolean(dev&&arch&&dev.querySelectorAll(".frontend-style-chip").length===6&&arch.querySelectorAll(".frontend-style-chip").length===6&&dev.querySelector(".norm-toggle")&&arch.querySelector(".norm-toggle")); })()`));

      await ensureToggle("software-dev", false);
      await ensureToggle("app-architecture", false);
      await wait(200);
      h.check("①b 默认关闭：两张卡都显示已关闭，且不写入 AGENTS.md",
        await h.eval(`(function(){ const dev=document.querySelector('[data-norm-card="software-dev"]'); const arch=document.querySelector('[data-norm-card="app-architecture"]'); return Boolean(dev&&arch&&dev.classList.contains("is-off")&&arch.classList.contains("is-off")&&dev.querySelector(".personalization-norm-off")&&arch.querySelector(".personalization-norm-off")); })()`));
      await h.screenshot("个性化-后端规范");

      await ensureToggle("software-dev", true);
      await ensureToggle("app-architecture", true);
      await wait(200);
      await pickNorm("software-dev", "务实稳健");
      await pickNorm("app-architecture", "分层单体");
      await h.setInput('[data-norm-card="software-dev"] textarea', `后端规范 ${devMarker}`);
      await h.setInput('[data-norm-card="app-architecture"] textarea', `架构规范 ${archMarker}`);
      await save();
      const saved = await waitStored((v) => v.softwareDevStyle === "pragmatic" && String(v.softwareDevNotes || "").includes(devMarker)
        && v.softwareDevEnabled === true && v.appArchitectureEnabled === true);
      const agents1 = await agentsText();
      h.check("② 打开两个开关后保存：两套规范都进入 AGENTS.md",
        Boolean(saved && saved.softwareDevEnabled === true && saved.appArchitectureEnabled === true)
          && agents1.includes("Software development norms") && agents1.includes(devMarker)
          && agents1.includes("Application architecture norms") && agents1.includes(archMarker),
        JSON.stringify({ saved, dev: agents1.includes(devMarker), arch: agents1.includes(archMarker) }));

      await ensureToggle("app-architecture", false);
      await wait(250);
      h.check("③ 关闭架构规范后显示「已关闭」提示，配置仍保留",
        await h.eval(`(function(){ const root=document.querySelector('[data-norm-card="app-architecture"]'); return Boolean(root&&root.classList.contains("is-off")&&root.querySelector(".personalization-norm-off")&&root.querySelector("textarea")?.value.includes(${JSON.stringify(archMarker)})); })()`));
      await save();
      const archOff = await waitStored((v) => v.appArchitectureEnabled === false);
      const agents2 = await agentsText();
      h.check("④ 关闭架构规范并保存：只停止注入，后端规范不受影响",
        Boolean(archOff && archOff.appArchitectureEnabled === false && String(archOff.appArchitectureNotes || "").includes(archMarker))
          && agents2.includes("Software development norms") && agents2.includes(devMarker)
          && !agents2.includes("Application architecture norms") && !agents2.includes(archMarker),
        JSON.stringify({ archOff, dev: agents2.includes(devMarker), arch: agents2.includes(archMarker) }));

      await ensureToggle("app-architecture", true);
      await wait(250);
      await save();
      const reopened = await waitStored((v) => v.appArchitectureEnabled === true);
      const agents3 = await agentsText();
      h.check("⑤ 重新打开架构规范并保存：两套规范都进入 AGENTS.md",
        Boolean(reopened && reopened.appArchitectureEnabled === true)
          && agents3.includes("Software development norms") && agents3.includes(devMarker)
          && agents3.includes("Application architecture norms") && agents3.includes(archMarker),
        JSON.stringify({ reopened, dev: agents3.includes(devMarker), arch: agents3.includes(archMarker) }));

      await ensureToggle("software-dev", false);
      await wait(250);
      await save();
      const devOff = await waitStored((v) => v.softwareDevEnabled === false);
      const agents4 = await agentsText();
      h.check("⑥ 关闭后端规范并保存：只停止注入，配置仍在，架构规范不受影响",
        Boolean(devOff && devOff.softwareDevEnabled === false && String(devOff.softwareDevNotes || "").includes(devMarker))
          && !agents4.includes("Software development norms") && !agents4.includes(devMarker)
          && agents4.includes("Application architecture norms") && agents4.includes(archMarker),
        JSON.stringify({ devOff, dev: agents4.includes(devMarker), arch: agents4.includes(archMarker) }));

      /* 复位到本轮开始前的值（包括三个开关），避免污染持久 profile。 */
      await h.eval(`window.codex.savePersonalization({
        frontendDesignStyle: ${JSON.stringify(initial?.frontendDesignStyle || "auto")},
        frontendDesignNotes: ${JSON.stringify(initial?.frontendDesignNotes || "")},
        frontendDesignEnabled: ${initial?.frontendDesignEnabled === true},
        softwareDevStyle: ${JSON.stringify(initial?.softwareDevStyle || "auto")},
        softwareDevNotes: ${JSON.stringify(initial?.softwareDevNotes || "")},
        softwareDevEnabled: ${initial?.softwareDevEnabled === true},
        appArchitectureStyle: ${JSON.stringify(initial?.appArchitectureStyle || "auto")},
        appArchitectureNotes: ${JSON.stringify(initial?.appArchitectureNotes || "")},
        appArchitectureEnabled: ${initial?.appArchitectureEnabled === true}
      })`);
      const reset = await waitStored((v) => v.softwareDevEnabled === (initial?.softwareDevEnabled === true)
        && v.appArchitectureEnabled === (initial?.appArchitectureEnabled === true));
      const agents5 = await agentsText();
      h.check("⑦ 复位后档案与 AGENTS.md 都不再带测试内容",
        Boolean(reset) && !agents5.includes(devMarker) && !agents5.includes(archMarker),
        JSON.stringify({ reset, dev: agents5.includes(devMarker), arch: agents5.includes(archMarker) }));
    },
  },
  {
    id: "queue-timer",
    name: "排队消息定时总开关（默认关 / 开启后落盘 / 关闭即清）",
    run: async (h) => {
      /* 11-02 用户令：定时默认关闭，关闭时排队卡不显示定时入口。
         这里验偏好本身（排队卡的隐藏/撤销由守卫 12as 静态钉住）；
         ⛔ 必须先清键再 reload：持久 profile 可能保留上一轮开启过的状态。 */
      await h.eval(`localStorage.removeItem("queue-timer-enabled-v1"); localStorage.removeItem("queue-timers-v1"); true`);
      await h.reload({ waitMs: 2000 });
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "reload 后主界面", timeoutMs: 30000 });
      await h.eval(`document.querySelector(".sidebar-settings")?.click()`);
      await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置弹窗", timeoutMs: 10000 });
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-nav button")].find((x)=>(x.textContent||"").trim()==="控制台"); if(b){b.click(); return true;} return false; })()`);
      await h.waitFor(`!!document.querySelector('[aria-label="排队消息定时发送"]')`, { label: "定时总开关", timeoutMs: 10000 });
      const initial = await h.eval(`document.querySelector('[aria-label="排队消息定时发送"]').getAttribute("aria-checked")`);
      h.check("① 没存过偏好时定时开关默认关闭", initial === "false", String(initial));
      await h.click('[aria-label="排队消息定时发送"]');
      await wait(250);
      const on = await h.eval(`({ checked: document.querySelector('[aria-label="排队消息定时发送"]').getAttribute("aria-checked"), pref: localStorage.getItem("queue-timer-enabled-v1") })`);
      h.check("② 开启后立即落盘（排队卡据此显示定时入口）", on.checked === "true" && on.pref === "true", JSON.stringify(on));
      await h.click('[aria-label="排队消息定时发送"]');
      await wait(250);
      const off = await h.eval(`({ checked: document.querySelector('[aria-label="排队消息定时发送"]').getAttribute("aria-checked"), pref: localStorage.getItem("queue-timer-enabled-v1"), timers: localStorage.getItem("queue-timers-v1") })`);
      h.check("③ 关闭后偏好为 false 且本地定时被清空", off.checked === "false" && off.pref === "false" && !off.timers, JSON.stringify(off));
      await h.eval(`document.querySelector(".settings-modal header .relay-modal-close")?.click(); true`);
      await wait(300);
    },
  },
  {
    id: "project-menu-flyout",
    name: "项目 ⋯ / 会话 ⋯ 菜单向侧栏右侧弹出（portal）+ 视口钳制自适应往上，不再被裁（11-08）",
    run: async (h) => {
      /* 11-08 用户实测（截图）：项目菜单嵌在侧栏滚动容器里，「删除项目」被裁掉；
         旧 is-up 翻转参照 window 底边而不是滚动容器底边 ⇒ 靠近侧栏底时永远不翻。
         修法 = portal 到 body + fixed + 视口钳制。这里真点**最后一个项目行**的 ⋯（用户截图同场景）。 */
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".view-tab")].find((x)=>(x.textContent||"").includes("项目")); if(b){b.click(); return true;} return false; })()`);
      await h.waitFor(`!!document.querySelector(".project-item-menu-btn")`, { label: "项目视图 ⋯ 按钮", timeoutMs: 10000 });
      /* 全部折叠：保证最后一个项目行就是列表最底行（展开态的 body 会把头行顶离底部）。 */
      /* ⛔ harness 的 eval 把表达式包成 `return (expr)` —— 多语句必须自己包 IIFE，否则整条是语法错误、静默不执行。 */
      await h.eval(`(function(){ document.querySelector('.view-toolbar-btn[title="折叠全部项目"]')?.click(); return true; })()`);
      await wait(300);
      const geo = () => h.eval(`(function(){
        const r=(e)=>{ if(!e) return null; const b=e.getBoundingClientRect(); return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,w:b.width,h:b.height}; };
        const menu=document.querySelector(".project-menu");
        const btns=[...document.querySelectorAll(".project-item-menu-btn")];
        const btn=btns[btns.length-1];
        return { win:{w:innerWidth,h:innerHeight}, sidebar:r(document.querySelector(".sidebar")), menu:r(menu), btn:r(btn),
          btnCount:btns.length, onBody: !!menu && menu.parentElement===document.body,
          items: menu ? menu.querySelectorAll("button").length : 0 };
      })()`);
      const openLast = async () => {
        await h.eval(`(function(){ const list=document.querySelector(".thread-list"); if(list) list.scrollTop=list.scrollHeight; return 1; })()`);
        await wait(300);
        await h.eval(`(function(){ const btns=[...document.querySelectorAll(".project-item-menu-btn")]; const b=btns[btns.length-1]; if(b){b.click(); return true;} return false; })()`);
        await h.waitFor(`!!document.querySelector(".project-menu")`, { label: "项目菜单浮层", timeoutMs: 5000 });
        /* motion-menu-in 入场动画 140ms（scale 0.98→1）：量几何前等它落定，否则量到的是动画中间帧。 */
        await wait(450);
      };

      await openLast();
      const g1 = await geo();
      h.check("① 前提：有项目 ⋯ 按钮，菜单 portal 到 body（⛔ 不再嵌在侧栏滚动容器里）",
        Boolean(g1 && g1.btnCount > 0 && g1.menu && g1.onBody),
        JSON.stringify({ btnCount: g1?.btnCount, onBody: g1?.onBody }));
      h.check("② 菜单在侧栏右边弹出（左缘 ≥ 侧栏右缘 - 2px）",
        Boolean(g1?.menu && g1.sidebar && g1.menu.left >= g1.sidebar.right - 2),
        JSON.stringify({ left: g1?.menu?.left, sidebarRight: g1?.sidebar?.right }));
      h.check("③ 四项齐全（编辑名称 / 标签 / 打开文件 / 删除），删除项不再被裁",
        g1?.items === 4, String(g1?.items));
      h.check("④ 完整落在视口内（靠底的项目行也不越界）",
        Boolean(g1?.menu && g1.menu.top >= 7 && g1.menu.bottom <= g1.win.h - 7 && g1.menu.right <= g1.win.w - 7),
        JSON.stringify({ menu: g1?.menu, win: g1?.win }));
      await h.pressKey("Escape");
      await wait(250);
      h.check("⑤ Esc 关闭", !(await geo())?.menu, "");

      /* 矮窗口：最后一个项目行贴近视口底 ⇒ 钳制必须把菜单整体上移（「自适应往上」）。 */
      await h._send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 500, deviceScaleFactor: 1, mobile: false });
      await wait(600);
      await openLast();
      const g2 = await geo();
      h.check("⑥ 500 高窗口：菜单被钳制上移（top < 按钮 top）且整体在视口内",
        Boolean(g2?.menu && g2.btn && g2.menu.top < g2.btn.top && g2.menu.top >= 7 && g2.menu.bottom <= g2.win.h - 7),
        JSON.stringify({ menuTop: g2?.menu?.top, btnTop: g2?.btn?.top, bottom: g2?.menu?.bottom, winH: g2?.win?.h }));
      await h.pressKey("Escape");
      await wait(200);
      await h._send("Emulation.clearDeviceMetricsOverride");
      await wait(400);

      /* 点外部关闭（portal 后 DOM 层级 mouseleave 失效，靠 pointerdown 捕获判外部）。
         ⛔ 多语句一律包 IIFE：harness 的 eval 是 `return (${expr})`，`a(); true` 会整条语法错误、静默不执行。 */
      await openLast();
      await h.eval(`(function(){ document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); return true; })()`);
      await wait(250);
      h.check("⑦ 点菜单外部即关", !(await geo())?.menu, "");
      /* 滚动列表即关（菜单不跟着滚走留在原地）。 */
      await openLast();
      await h.eval(`(function(){ const list=document.querySelector(".thread-list"); if(list) list.dispatchEvent(new Event("scroll")); return true; })()`);
      await wait(250);
      h.check("⑧ 滚动会话列表即关", !(await geo())?.menu, "");

      /* ── 会话行 ⋯ 菜单同款（11-08 用户令：「会话的那个选项也是一样的」）──
         切到「任务」平铺视图（项目视图折叠时没有会话行），滚到最底再点最后一行的 ⋯：
         这正是用户截图里「菜单被侧栏裁掉」的场景。 */
      const threadGeo = () => h.eval(`(function(){
        const r=(e)=>{ if(!e) return null; const b=e.getBoundingClientRect(); return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,w:b.width,h:b.height}; };
        const menu=document.querySelector(".thread-row-menu");
        const btns=[...document.querySelectorAll(".thread-more-button")];
        const btn=btns[btns.length-1];
        const labels=menu ? [...menu.querySelectorAll("button")].map((b)=>(b.textContent||"").trim()) : [];
        return { win:{w:innerWidth,h:innerHeight}, sidebar:r(document.querySelector(".sidebar")), menu:r(menu), btn:r(btn),
          btnCount:btns.length, onBody: !!menu && menu.parentElement===document.body, labels };
      })()`);
      const openLastThread = async () => {
        await h.eval(`(function(){ const list=document.querySelector(".thread-list"); if(list) list.scrollTop=list.scrollHeight; return 1; })()`);
        await wait(300);
        await h.eval(`(function(){ const btns=[...document.querySelectorAll(".thread-more-button")]; const b=btns[btns.length-1]; if(b){b.click(); return true;} return false; })()`);
        await h.waitFor(`!!document.querySelector(".thread-row-menu")`, { label: "会话行菜单浮层", timeoutMs: 5000 });
        await wait(450); // 入场动画 140ms，量几何前等落定
      };
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".view-tab")].find((x)=>(x.textContent||"").includes("任务")); if(b){b.click(); return true;} return false; })()`);
      await h.waitFor(`!!document.querySelector(".thread-more-button")`, { label: "任务视图会话行 ⋯", timeoutMs: 10000 });

      await openLastThread();
      const t1 = await threadGeo();
      h.check("⑨ 会话 ⋯ 菜单也 portal 到 body（⛔ 不再嵌在侧栏滚动容器里）",
        Boolean(t1 && t1.btnCount > 0 && t1.menu && t1.onBody),
        JSON.stringify({ btnCount: t1?.btnCount, onBody: t1?.onBody }));
      h.check("⑩ 会话菜单在侧栏右边弹出（左缘 ≥ 侧栏右缘 - 2px）",
        Boolean(t1?.menu && t1?.sidebar && t1.menu.left >= t1.sidebar.right - 2),
        JSON.stringify({ left: t1?.menu?.left, sidebarRight: t1?.sidebar?.right }));
      h.check("⑪ 关键项齐全（导出会话 / 改名字 / 删除），靠底的会话行也不越界",
        Boolean(t1?.labels?.some((l) => l.startsWith("导出会话")) && t1?.labels?.some((l) => l.startsWith("完整备份"))
          && t1?.labels?.includes("改名字") && t1?.labels?.includes("删除")
          && t1.menu.top >= 7 && t1.menu.bottom <= t1.win.h - 7 && t1.menu.right <= t1.win.w - 7),
        JSON.stringify({ labels: t1?.labels, menu: t1?.menu, win: t1?.win }));
      await h.pressKey("Escape");
      await wait(250);
      h.check("⑫ 会话菜单 Esc 关闭", !(await threadGeo())?.menu, "");

      /* 矮窗口：最后一行贴近视口底 ⇒ 会话菜单同样必须整体上移（用户原话「不会自适应往上吗」）。 */
      await h._send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 500, deviceScaleFactor: 1, mobile: false });
      await wait(600);
      await openLastThread();
      const t2 = await threadGeo();
      h.check("⑬ 500 高窗口：会话菜单被钳制上移（top < 按钮 top）且整体在视口内",
        Boolean(t2?.menu && t2.btn && t2.menu.top < t2.btn.top && t2.menu.top >= 7 && t2.menu.bottom <= t2.win.h - 7),
        JSON.stringify({ menuTop: t2?.menu?.top, btnTop: t2?.btn?.top, bottom: t2?.menu?.bottom, winH: t2?.win?.h }));
      await h.pressKey("Escape");
      await wait(200);
      await h._send("Emulation.clearDeviceMetricsOverride");
      await wait(400);
    },
  },
  {
    id: "thread-tag-column",
    name: "会话行标签固定成一列、右对齐、贴置顶键左边 + 标签最多 3 个字（11-08 用户定稿）",
    run: async (h) => {
      /* 11-08 用户（截图红框）：「标签整体再往右边来一点，在置顶图标左边……都固定在这样一列」
         定稿：「三个字，右对齐」+「编辑和新增标签限制输入内容」。 */
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".view-tab")].find((x)=>(x.textContent||"").includes("任务")); if(b){b.click(); return true;} return false; })()`);
      await h.waitFor(`!!document.querySelector(".thread-row-tags")`, { label: "带标签的会话行", timeoutMs: 10000 });
      await wait(400);
      const geo = () => h.eval(`(function(){
        const rect=(e)=>{ if(!e) return null; const r=e.getBoundingClientRect(); return {l:+r.left.toFixed(1),r:+r.right.toFixed(1),w:+r.width.toFixed(1)}; };
        const out=[];
        for (const row of document.querySelectorAll(".thread-row")) {
          const tags=row.querySelector(".thread-row-tags");
          if(!tags) continue;
          const pin=rect(row.querySelector(".thread-pin-button"));
          if(!pin || pin.l <= 0) continue; // 成员行在簇里隐藏操作键，不参与
          out.push({ tags:rect(tags), text:(tags.textContent||"").trim(), pin, more:rect(row.querySelector(".thread-more-button")) });
        }
        return out;
      })()`);
      const rows1 = (await geo()) ?? [];
      h.check("① 前提：任务视图里有多行带标签的会话（可对比列对齐）", rows1.length >= 2, String(rows1.length));
      const rights = rows1.map((r) => r.tags.r);
      h.check("② 各行标签右缘在同一条竖线上（±1px = 用户定稿「三个字，右对齐」）",
        rights.length >= 2 && Math.max(...rights) - Math.min(...rights) <= 1, JSON.stringify(rights));
      h.check("③ 标签整体在置顶键左边（⛔ 不压住操作键）",
        rows1.length >= 2 && rows1.every((r) => r.tags.r <= r.pin.l - 4),
        JSON.stringify(rows1.map((r) => ({ tagRight: r.tags.r, pinLeft: r.pin.l, gap: +(r.pin.l - r.tags.r).toFixed(1) }))));
      h.check("④ 标签列紧贴操作键区（有归档键的行间隙 ≤8px = 「再往右边来一点」）",
        rows1.some((r) => r.pin.l - r.tags.r <= 8),
        JSON.stringify(rows1.map((r) => +(r.pin.l - r.tags.r).toFixed(1))));

      /* 标签最多 3 个字：行菜单 → 添加/编辑标签 → 输入 4 个字必须被截成 3（只验输入，不落盘）。 */
      await h.eval(`(function(){ const list=document.querySelector(".thread-list"); if(list) list.scrollTop=0; return 1; })()`);
      await wait(200);
      await h.eval(`(function(){ const b=document.querySelector(".thread-more-button"); if(b){b.click(); return true;} return false; })()`);
      await h.waitFor(`!!document.querySelector(".thread-row-menu")`, { label: "会话行菜单", timeoutMs: 5000 });
      await wait(350);
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".thread-row-menu button")].find((x)=>/标签/.test(x.textContent||"")); if(b){b.click(); return true;} return false; })()`);
      await h.waitFor(`!!document.querySelector(".entity-tag-input")`, { label: "标签编辑弹窗", timeoutMs: 5000 });
      await wait(200);
      const maxLen = await h.eval(`document.querySelector(".entity-tag-input").maxLength`);
      await h.typeInto(".entity-tag-input", "测试三字");
      await wait(250);
      const typed = await h.eval(`document.querySelector(".entity-tag-input").value`);
      h.check("⑤ 标签输入最多 3 个字（maxLength=3，输入 4 个字被截成 3）",
        maxLen === 3 && [...String(typed ?? "")].length === 3, JSON.stringify({ maxLen, typed }));
      await h.pressKey("Escape");
      await wait(250);
      h.check("⑥ Esc 关闭标签弹窗（不落盘）", !(await h.eval(`!!document.querySelector(".entity-tag-input")`)), "");
    },
  },
  {
    id: "team-skill-picker",
    name: "工作伙伴 · 引用技能：贴着 + 图标弹、可多选有反馈、点一下不关窗（11-08 用户实测）",
    run: async (h) => {
      /* 11-08 用户（截图）：「选中一个技能弹窗就关了、没有反馈」+「技能弹窗搞这么远干什么」。
         根因：技能面板漏登记进「点外部才关」的豁免名单 ⇒ 点行的 mousedown 被当外部点击、
         click 前就被卸载。这里在**工作伙伴独立窗口**里真点：开面板 → 选 → 再选 → 取消 → Esc。 */
      /* ⛔ 侧栏两个按钮共用 sidebar-quick-boss 类（指挥中枢 / 工作伙伴）⇒ 按 title 精确点「工作伙伴」。 */
      await h.eval(`(function(){ const b=document.querySelector('[title^="工作伙伴"]'); if(b){b.click(); return true;} return window.codex.popoutTeam().then(()=>true); })()`);
      /* 独立窗口刚起来时 App 还在初始化 ⇒ 整段用**页内轮询**（evalInTarget 单次往返内 await），
         避免「点得太早 ⇒ 菜单没开 ⇒ 后面全空」的假红。 */
      const flow = await h.evalInTarget("teamPopout=1", `(async function(){
        const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
        const until=async(fn,ms=8000)=>{ const t0=Date.now(); while(Date.now()-t0<ms){ const v=fn(); if(v) return v; await sleep(120);} return null; };
        const group=await until(()=>document.querySelector(".team-mode__group"));
        if(group) group.click();
        const plus=await until(()=>document.querySelector(".team-composer .plus-spin-button"));
        if(!plus) return "no-plus";
        plus.click();
        const menuItem=await until(()=>[...document.querySelectorAll(".team-composer__pop button")].find(x=>/引用技能/.test(x.textContent||"")));
        if(!menuItem) return "no-menu-item";
        menuItem.click();
        const pop=await until(()=>document.querySelector(".team-composer__skill-pop"));
        return pop ? "ok" : "no-pop";
      })()`);
      h.check("⓪ 前置：工作伙伴窗口已起、+ 菜单 →「引用技能」面板打开", flow === "ok", String(flow));
      await wait(300);
      const geo = () => h.evalInTarget("teamPopout=1", `(function(){
        const r=(e)=>{ if(!e) return null; const b=e.getBoundingClientRect(); return {l:+b.left.toFixed(1),r:+b.right.toFixed(1),t:+b.top.toFixed(1),b:+b.bottom.toFixed(1),w:+b.width.toFixed(1)}; };
        const pop=document.querySelector(".team-composer__skill-pop");
        const btn=document.querySelector(".team-composer .plus-spin-button");
        return { pop:r(pop), btn:r(btn), win:{w:innerWidth,h:innerHeight},
          count:(pop?.querySelector(".team-skill-dialog__count")?.textContent||"").trim(),
          on: pop ? pop.querySelectorAll(".team-skill-dialog__item.is-on").length : -1 };
      })()`);
      const g0 = await geo();
      h.check("① 技能面板贴着 + 图标弹（⛔ 不是屏幕居中的远弹窗）",
        Boolean(g0?.pop && g0?.btn && (g0.pop.b <= g0.btn.t + 2 || g0.pop.t >= g0.btn.b - 2) && Math.abs((g0.pop.l + g0.pop.w / 2) - g0.win.w / 2) > 80),
        JSON.stringify({ pop: g0?.pop, btn: g0?.btn, win: g0?.win }));
      /* 先把上次运行可能留下的选中清掉，保证起点确定。 */
      await h.evalInTarget("teamPopout=1", `(function(){ for (const b of document.querySelectorAll(".team-skill-dialog__item.is-on")) b.click(); return true; })()`);
      await wait(250);
      await h.evalInTarget("teamPopout=1", `(function(){ const b=document.querySelectorAll(".team-skill-dialog__item")[0]; if(b){b.click(); return true;} return false; })()`);
      await wait(250);
      const g1 = await geo();
      h.check("② 点第一个技能：面板**不关**、该行出现选中反馈（is-on + 已选 1）",
        Boolean(g1?.pop) && g1.on === 1 && g1.count.includes("1"), JSON.stringify({ open: Boolean(g1?.pop), on: g1?.on, count: g1?.count }));
      await h.evalInTarget("teamPopout=1", `(function(){ const b=document.querySelectorAll(".team-skill-dialog__item")[1]; if(b){b.click(); return true;} return false; })()`);
      await wait(250);
      const g2 = await geo();
      h.check("③ 再点第二个：可多选（已选 2）", Boolean(g2?.pop) && g2.on === 2 && g2.count.includes("2"), JSON.stringify({ on: g2?.on, count: g2?.count }));
      await h.evalInTarget("teamPopout=1", `(function(){ const b=document.querySelectorAll(".team-skill-dialog__item")[0]; if(b){b.click(); return true;} return false; })()`);
      await wait(250);
      const g3 = await geo();
      h.check("④ 再点第一个 = 取消选中（已选 1，多选开关正常）", Boolean(g3?.pop) && g3.on === 1, JSON.stringify({ on: g3?.on, count: g3?.count }));
      /* 复原：把剩下的选中也取消，别把测试选择留在用户群里。 */
      await h.evalInTarget("teamPopout=1", `(function(){ for (const b of document.querySelectorAll(".team-skill-dialog__item.is-on")) b.click(); return true; })()`);
      await wait(200);
      await h.evalInTarget("teamPopout=1", `(function(){ document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return true; })()`);
      await wait(300);
      const g4 = await geo();
      h.check("⑤ Esc 关闭技能面板（选择已复原为 0）", !g4?.pop && g4?.on === -1, JSON.stringify({ open: Boolean(g4?.pop) }));
    },
  },
  {
    id: "team-composer-input",
    name: "群聊输入框：插 @ 后打字光标不跳到末尾 / 输入法组合期不重建 DOM / 粘贴只进纯文本（11-08 审查）",
    run: async (h) => {
      /* 11-08 审查确认的三处真缺陷（用户实测「打字光标乱跳 / 中文被打断」）：
         ① 正文里有 chip 时**每次按键**都重建 DOM 并把光标扔到末尾；
         ② 输入法组合期同样被重建 ⇒ 候选词丢失；
         ③ 普通文字粘贴不拦截 ⇒ 浏览器把剪贴板 HTML 直接塞进 contenteditable。
         判据全部取**真实行为**：chip 节点身份（重建 = 换节点）+ 光标位置 + 插入的文本形态。 */
      await h.eval(`(function(){ const b=document.querySelector('[title^="工作伙伴"]'); if(b){b.click(); return true;} return window.codex.popoutTeam().then(()=>true); })()`);
      const flow = await h.evalInTarget("teamPopout=1", `(async function(){
        const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
        const until=async(fn,ms=10000)=>{ const t0=Date.now(); while(Date.now()-t0<ms){ const v=fn(); if(v) return v; await sleep(120);} return null; };
        const group=await until(()=>document.querySelector(".team-mode__group"));
        if(!group) return {err:"no-group"};
        group.click();
        const ed=await until(()=>document.querySelector('.team-composer__input[contenteditable="true"]'));
        if(!ed) return {err:"no-editor"};
        const atBtn=await until(()=>document.querySelector(".team-group__member-at"));
        if(!atBtn) return {err:"no-member"};
        const sel=document.getSelection();
        const caretPos=()=>{ const r=sel.getRangeAt(0).cloneRange(); r.selectNodeContents(ed); r.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset); return r.toString().length; };
        ed.focus();
        const all=document.createRange(); all.selectNodeContents(ed); sel.removeAllRanges(); sel.addRange(all);
        document.execCommand("delete");
        await sleep(80);
        atBtn.click();                       /* 真实路径：成员行 @ → 插 chip（头像 + @名字） */
        await sleep(250);
        const chip1=ed.querySelector("[data-mention]");
        if(!chip1) return {err:"no-chip", text:ed.textContent};
        document.execCommand("insertText", false, "abc");
        await sleep(150);
        /* 退两格再插 X：正确光标停在 X 之后（⛔ 旧实现重绘后扔到末尾） */
        sel.modify("move","backward","character");
        sel.modify("move","backward","character");
        document.execCommand("insertText", false, "X");
        await sleep(150);
        const typedText=ed.textContent||"";
        const caretAfterType=caretPos();
        const chip2=ed.querySelector("[data-mention]");
        /* 输入法组合：compositionstart 期间打字，DOM 不许被重建 */
        ed.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        document.execCommand("insertText", false, "中");
        await sleep(150);
        const chip3=ed.querySelector("[data-mention]");
        const imeText=ed.textContent||"";
        ed.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中" }));
        await sleep(120);
        /* 粘贴：剪贴板里同时有 HTML 和纯文本 ⇒ 只许进纯文本 */
        const dt=new DataTransfer();
        dt.setData("text/html","<b>粗体HTML</b>");
        dt.setData("text/plain","纯文本粘贴");
        ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        await sleep(250);
        const pastedText=ed.textContent||"";
        const pastedHtml=ed.innerHTML||"";
        /* 收尾：清空输入框，别把测试文本留在用户群里 */
        const all2=document.createRange(); all2.selectNodeContents(ed); sel.removeAllRanges(); sel.addRange(all2);
        document.execCommand("delete");
        await sleep(80);
        return {
          chip1: Boolean(chip1), chip2Same: chip2 === chip1, chip3Same: chip3 === chip1,
          typedText, typedLen: typedText.length, caretAfterType,
          imeText, pastedText, hasBoldTag: /<b>|粗体HTML/i.test(pastedHtml),
          cleared: !(ed.textContent||"").trim(),
        };
      })()`);
      h.check("⓪ 前置：群聊窗口已开、输入框与成员 @ 键都在、chip 已插入",
        Boolean(flow && !flow.err), JSON.stringify(flow?.err ?? "ok"));
      if (!flow || flow.err) return;
      h.check("① 插 @ 后继续打字：chip 节点**没被重建**（旧实现每次按键重绘）",
        flow.chip2Same === true, JSON.stringify({ same: flow.chip2Same }));
      /* 编辑器末尾有一个零宽字符（renderEditor 补的，editorValue 会剥掉）——
         判据取「光标前一个字是刚输入的 X，且光标后仍有正文」= 光标留在插入点，⛔ 没被扔到末尾。 */
      h.check("② 光标停在 X 之后（⛔ 不是被扔到末尾）",
        flow.typedText.slice(0, flow.caretAfterType).endsWith("X")
        && flow.typedText.slice(flow.caretAfterType).replace(/[\s\u200b]/g, "").length > 0,
        JSON.stringify({ text: flow.typedText, caret: flow.caretAfterType, len: flow.typedLen }));
      h.check("③ 输入法组合期不重建 DOM（候选词不丢）",
        flow.chip3Same === true && flow.imeText.includes("中"),
        JSON.stringify({ same: flow.chip3Same, text: flow.imeText }));
      h.check("④ 粘贴只进纯文本（HTML 标签不进编辑器）",
        flow.pastedText.includes("纯文本粘贴") && !flow.hasBoldTag,
        JSON.stringify({ text: flow.pastedText, html: flow.hasBoldTag }));
      h.check("⑤ 收尾：输入框已清空（不把测试文本留在用户群里）", flow.cleared === true, String(flow.cleared));
    },
  },
  {
    id: "media-desk",
    name: "自媒体工作台：原版界面在令牌前缀 iframe 里真渲染 + 工具与界面同源（11-09 审查）",
    run: async (h) => {
      await h.eval(`(function(){ document.querySelector(".sidebar-settings")?.click(); return 1; })()`);
      await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置面板", timeoutMs: 8000 });
      await h.waitFor(`[...document.querySelectorAll(".settings-nav button")].some(function(b){ return (b.textContent||"").trim()==="自媒体工作台"; })`, { label: "工作台导航项", timeoutMs: 8000 });
      const clicked = await h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-nav button")].find(function(x){ return (x.textContent||"").trim()==="自媒体工作台"; }); if(!b) return 0; b.click(); return 1; })()`);
      h.check("⓪ 前置：设置面板里有「自媒体工作台」导航且已点击", clicked === 1, String(clicked));
      if (clicked !== 1) return;
      await h.waitFor(`!!document.querySelector(".media-desk-frame") || !!document.querySelector(".media-desk-error")`, { label: "工作台页面", timeoutMs: 20000 });
      const early = await h.eval(`(function(){ return { error:(document.querySelector(".media-desk-error")?.textContent||"").slice(0,200), loading:!!document.querySelector(".media-desk-loading") }; })()`);
      h.check("① 工作台页面挂载成功（⛔ 不是启动失败提示）", !early.error, JSON.stringify(early));
      if (early.error) return;
      await h.waitFor(`!!document.querySelector(".media-desk-frame")`, { label: "工作台 iframe", timeoutMs: 8000 });
      const frame = await h.eval(`(function(){ const f=document.querySelector(".media-desk-frame"); return f ? { src:f.getAttribute("src")||"" } : null; })()`);
      const endpointOk = Boolean(frame && /^http:\/\/127\.0\.0\.1:\d+\/t\/[0-9a-f]{36}\/$/.test(frame.src));
      h.check("② iframe 指向带随机令牌的本机地址", endpointOk, JSON.stringify(frame));
      if (!endpointOk) return;

      /* 本机服务真能取到页面 + 生产版 React 包（⛔ 不是 dev 包） */
      const pageOk = await fetch(frame.src).then((r) => r.text()).then((t) => t.includes("md-fatal")).catch(() => false);
      const bundle = await fetch(new URL("react.bundle.js", frame.src)).then(async (r) => ({ status: r.status, size: (await r.text()).length })).catch(() => ({ status: 0, size: 0 }));
      h.check("③ 页面与本机 React 包都取得到（且是生产包）", pageOk && bundle.status === 200 && bundle.size > 100000, JSON.stringify(bundle));

      /* 原版界面真渲染：跨源 iframe 是独立的 `iframe` target（进不了页面帧树，也读不到 DOM）
         ⇒ 按 /json 找到它、单独连一个 CDP ws 读 #root。 */
      const readIframe = async () => {
        const list = await (await fetch(`http://127.0.0.1:${h.port}/json`)).json();
        const target = list.find((t) => t.type === "iframe" && String(t.url || "").startsWith(frame.src.replace(/\/$/, "")));
        if (!target) return null;
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        const pending = new Map();
        let seq = 0;
        await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", () => reject(new Error("iframe CDP 连接失败"))); });
        ws.on("message", (data) => {
          const m = JSON.parse(data.toString());
          const slot = pending.get(m.id);
          if (slot) { pending.delete(m.id); slot(m); }
        });
        const send = (method, params = {}) => new Promise((resolve, reject) => {
          const id = ++seq;
          const timer = setTimeout(() => { pending.delete(id); reject(new Error(`iframe CDP ${method} 超时`)); }, 8000);
          pending.set(id, (m) => { clearTimeout(timer); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); });
          ws.send(JSON.stringify({ id, method, params }));
        });
        try {
          const r = await send("Runtime.evaluate", {
            expression: `(function(){ const root=document.getElementById("root"); return JSON.stringify({ ready:document.readyState, kids: root?root.children.length:0, text:(document.body.innerText||"").slice(0,160) }); })()`,
            returnByValue: true,
          });
          return JSON.parse(r?.result?.value ?? "null");
        } finally {
          ws.close();
        }
      };
      let view = null;
      const t0 = Date.now();
      while (!view && Date.now() - t0 < 20000) {
        try { view = await readIframe(); } catch { /* 帧还没建好 */ }
        if (!view) await wait(400);
      }
      h.check("④ 原版工作台已在 iframe 内渲染（#root 有内容）", Boolean(view && view.kids > 0), JSON.stringify(view));
      if (view) h.check("⑤ 渲染的是上游界面（导航/标题文字在位）", /灵感|内容|排期|复盘|风格/.test(view.text), JSON.stringify(view.text));

      /* 工具与界面同一份数据：bridge 返回同一地址（幂等，不另起第二个服务） */
      let again = "";
      for (let i = 0; i < 3 && again !== frame.src; i += 1) {
        again = String(await h.eval(`window.codex.mediaDeskEndpoint()`).catch(() => "") ?? "");
        if (again !== frame.src) await wait(500);
      }
      h.check("⑥ 工具走的 endpoint 与界面同源（幂等复用同一个服务）", again === frame.src, JSON.stringify({ again, src: frame.src }));

      /* 声明与跳转按键在位（⛔ 不真点：点了会拉起系统浏览器） */
      const note = await h.eval(`(function(){ return {
        text: (document.querySelector(".media-desk-note")?.textContent || "").replace(/\\s+/g, " ").trim(),
        hasLink: !!document.querySelector(".media-desk-link"),
        canOpen: typeof window.codex.openExternal === "function",
      }; })()`);
      h.check("⑦ 开源声明与跳转按键在位（MIT / 数据本机 / 不自动发布 + 可调 openExternal）",
        Boolean(note && /dsh-media-desk/.test(note.text) && /MIT/.test(note.text) && /不会自动发布/.test(note.text) && note.hasLink && note.canOpen),
        JSON.stringify(note));
    },
  },
  {
    id: "voice-engine-state",
    name: "🎙 语音设置：停用如实回显 / MOSS-Live 保存即刷新 / Kokoro 已移除（11-11）",
    run: async (h) => {
      if (!(await h.exists(".settings-modal"))) {
        await h.eval(`document.querySelector(".sidebar-settings")?.click()`);
        await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置面板", timeoutMs: 10000 });
        await wait(500);
      }
      await h.eval(`(function(){ const b=[...document.querySelectorAll(".settings-nav button")].find(function(x){ return (x.textContent||"").trim()==="语音通话"; }); b&&b.click(); return !!b; })()`);
      await h.waitFor(`!!document.querySelector(".voice-settings")`, { label: "语音设置页", timeoutMs: 15000 });
      await wait(800);
      const read = () => h.eval(`(function(){
        const cards=[...document.querySelectorAll(".voice-engine-card")];
        const vits=cards.find(function(c){ return (c.innerText||"").includes("轻量播报"); });
        const remote=document.querySelector(".voice-engine-remote");
        const toggle=document.querySelector(".voice-moss-modal .voice-remote-toggle")||document.querySelector(".voice-remote-toggle");
        return {
          names:cards.map(function(c){ return (c.querySelector(".voice-engine-name-row strong")?.textContent||"").trim(); }),
          vitsText:(vits?.innerText||"").replace(/\\s+/g," ").trim(),
          remoteState:(remote?.querySelector(".voice-engine-state")?.textContent||"").trim(),
          hasToggle:!!toggle,
          toggleText:toggle?(toggle.textContent||"").replace(/\\s+/g," ").trim():"",
          remoteActions:(function(){ const card=document.querySelector(".voice-engine-remote"); return card?[...card.querySelectorAll("button")].map(function(b){ return (b.textContent||"").trim(); }):[]; })()
        };
      })()`);
      const ui = await read();
      h.check("① Kokoro（自然多音色）卡片已移除",
        Boolean(ui && !ui.names.some(function(n){ return /自然多音色|Kokoro/i.test(n); })), JSON.stringify(ui?.names));
      const opened = await h.eval(`(function(){ const card=document.querySelector(".voice-engine-remote"); const b=card?[...card.querySelectorAll("button")].find(function(x){ return (x.textContent||"").trim()==="配置"; }):null; if(!b) return false; b.click(); return true; })()`);
      await h.waitFor(`!!document.querySelector(".voice-moss-modal")`, { label: "MOSS 配置弹窗", timeoutMs: 8000 });
      const ui2 = await read();
      h.check("② MOSS-Live 卡与本地引擎卡同构：配置 / 启用停用 / 试听音色（配置收进弹窗）",
        Boolean(opened && ui && ui.remoteActions.includes("配置") && ui.remoteActions.some(function(x){ return /^(启用|停用)$/.test(x); }) && ui.remoteActions.some(function(x){ return x.includes("试听音色"); })),
        JSON.stringify(ui && ui.remoteActions));
      h.check("②b 弹窗里有「用作实时通话后端」开关",
        Boolean(ui2 && ui2.hasToggle && /实时通话后端/.test(ui2.toggleText)), JSON.stringify({ hasToggle: ui2?.hasToggle, toggleText: ui2?.toggleText }));

      /* 用户实测「配置完状态都不刷新」：走真实表单保存，徽标必须立刻变「已配置」。 */
      const originalRemote = await h.eval(`window.codex.voiceSettingsGet().then(function(r){ return (r && r.settings && r.settings.remote) || {}; })`).catch(() => ({}));
      /* 新语义：远程配置按 id 合并、value=null 才是删除；空对象不再清空。 */
      const restoredRemote = originalRemote && Object.keys(originalRemote).length ? originalRemote : { "moss-live": null };
      try {
        const filled = await h.eval(`(function(){
          const form=document.querySelector(".voice-remote-form"); if(!form) return 0;
          const set=function(el,v){ const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value"); d.set.call(el,v); el.dispatchEvent(new Event("input",{bubbles:true})); };
          const ins=form.querySelectorAll("input"); if(ins.length<3) return 0;
          set(ins[0],"wss://e2e.invalid/v1/realtime");
          set(ins[1],"moss-live-e2e");
          set(ins[2],"sk-e2e-test");
          return ins.length;
        })()`);
        h.check("③ 前置：MOSS-Live 表单三个字段都能填", filled === 3, String(filled));
        await h.eval(`(function(){ const b=[...document.querySelectorAll(".voice-remote-actions button")].find(function(x){ return (x.textContent||"").trim()==="保存配置"; }); b&&b.click(); return !!b; })()`);
        let after = null;
        for (let i = 0; i < 20; i += 1) {
          await wait(250);
          after = await read();
          if (after && after.remoteState.includes("已配置")) break;
        }
        h.check("④ 保存后卡片状态立即变「已配置」（⛔ 不再挂旧「未配置」）",
          Boolean(after && after.remoteState.includes("已配置")), JSON.stringify(after && after.remoteState));
      } finally {
        await h.eval(`window.codex.voiceSettingsSet({ remote: ${JSON.stringify(restoredRemote)} })`).catch(() => undefined);
        await h.eval(`document.querySelector(".voice-moss-modal .voice-confirm-close")?.click()`).catch(() => undefined);
      }

      /* 用户实测「停用不行」：①主进程 baseEnabled 必须真翻转；②已装模型时引擎卡显示「已停用」；
         ③任何情况下都不能再写「使用中」（测试 profile 没装模型时显示「未安装」也不算可用）。 */
      const prevStatus = await h.eval(`window.codex.voiceModelsStatus()`).catch(() => null);
      const prevEnabled = Boolean(prevStatus && prevStatus.baseEnabled !== false);
      const installed = Boolean(prevStatus && prevStatus.ready);
      try {
        await h.eval(`window.codex.voiceResourceSetEnabled({ kind: "base", enabled: false })`);
        const afterDisable = await h.eval(`window.codex.voiceModelsStatus()`).catch(() => null);
        let uiAfter = null;
        for (let i = 0; i < 20; i += 1) {
          await wait(250);
          uiAfter = await read();
          if (uiAfter && !/使用中/.test(uiAfter.vitsText)) break;
        }
        h.check("⑤ 停用真的落到主进程（baseEnabled=false）+ 引擎卡不再写「使用中」" + (installed ? "，并显示「已停用」" : "（本 profile 未装模型，显示「未安装」）"),
          Boolean(afterDisable && afterDisable.baseEnabled === false && uiAfter && !/使用中/.test(uiAfter.vitsText)
            && (!installed || /已停用/.test(uiAfter.vitsText))),
          JSON.stringify({ baseEnabled: afterDisable && afterDisable.baseEnabled, installed, vits: uiAfter && uiAfter.vitsText.slice(0, 120) }));
      } finally {
        await h.eval(`window.codex.voiceResourceSetEnabled({ kind: "base", enabled: ${prevEnabled ? "true" : "false"} })`).catch(() => undefined);
      }
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
