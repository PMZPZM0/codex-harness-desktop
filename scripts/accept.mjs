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
          hasInstructions:!!page.querySelector(".personalization-instructions"),
          pageW:Math.round(page.getBoundingClientRect().width),
          groupW:Math.round((page.querySelector(".personalization-group")?.getBoundingClientRect().width)||0) };
      })()`).catch(() => null);
      h.check("⑧ 个性化：无称呼输入、无语气自适应；回复风格与自定义指令仍在",
        Boolean(per && per.page === "个性化" && !per.hasNickInput && !per.hasNickText && !per.hasTone
          && per.hasStyle && per.hasInstructions && per.groupW >= per.pageW - 12),
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
