/** 06-app-behavior 第 4/5 段：原 06-app-behavior.mjs L2519–L3231（逐字搬运 + 各自成块）。
 *  ⛔ 每个顶层语句外面套一层块：拆段后同一文件里不再共享作用域，const 重名不会撞（也正好还原原文件的分块隔离）。 */
/**
 * 预检守卫组：06-app-behavior
 * 分节：【23】【24】【25】【28】（原 L2914–L4089）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  C, ROOT, codeOnly, createRequire, existsSync, fail, join, mainSrc, mkdirSync, ok, pathToFileURL, readAppUi, readBuiltinSkillsSource, readFileSync, readMainSource, readResponsesBridgeSource, readSettingsSurface, readStyles, readdirSync, relative, rmSync, sliceHandle, spawnSync, statSync, typesSrc,
} from "../_ctx.mjs";
import { FUNCTION_MENU_DEFAULT_ORDER, moveFunctionMenuItem, normalizeFunctionMenu, resetFunctionMenuLayout, setFunctionMenuItemOverflow } from "../../../src/features/function-menu/menu-model.mjs";



export async function run() {
{
{
  // ⛔⛔ 读进来先过 codeOnly()：本块自己的注释里必然会提到这些类名/文案（讲解历史时写的），
  //   裸词断言会被自己的注释命中 —— 09-27 变异实测当场栽了两次（`search-box` 命中的是注释里的
  //   「.search-box」）。这是同一个坑的第五次，从此本块的断言一律在**剥掉注释的代码**上做。
  const side180 = codeOnly(readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "01-sidebar-shell.tsx"), "utf8"));
  // ① 删「会话备份」入口（用户：「会话备份选项删了，前面不需要这个了」）。
  //   ⛔ 只删**侧栏入口**：设置页里的 backup 页保留（用户说的是"主界面左侧侧边栏的"）。
  (!/setSettingsPage\("backup"\)/.test(side180) ? ok : fail)(
    "【180】侧栏不再有「会话备份」入口（⛔ 设置页里的备份页仍保留，别连带删掉）"
  );
  // ② 「自动化」→「定时任务」：它跳的本来就是 schedule 页，改名后入口与目标页同名
  /* ③ 10-21 用户**再次点名**改名 + 重排（覆盖上一条「一律 4 字」的口径）：
     名字由用户逐条给定，不再强求 4 字；入口从顶部挪到「用户名之下」。
     ⛔ 断言改成**精确名单 + 顺序**：改名类需求最容易漏一条，按名单比对才抓得住。 */
  /* 10-24 功能入口改成**共享菜单组件**（新建/搜索下面 / 侧栏底部 / 可拖动 / 更多）：
     文案与默认顺序从渲染层挪到了 FunctionMenu + menu-model；这里改为钉数据模型与接线。 */
  const fmSrc180 = codeOnly(readFileSync(join(ROOT, "src", "features", "function-menu", "FunctionMenu.tsx"), "utf8"));
  const fmStore180 = codeOnly(readFileSync(join(ROOT, "src", "features", "function-menu", "store.ts"), "utf8"));
  const fmDefault180 = normalizeFunctionMenu(null);
  /* ⛔ 10-26：拓展功能（技能/插件/MCP）独立成侧栏常驻行 ⇒ 从功能入口菜单的默认顺序里移出。 */
  (FUNCTION_MENU_DEFAULT_ORDER.join(">") === "schedule>frontend>team>identity>login>newbie"
    && fmDefault180.location === "bottom" && fmDefault180.overflow.length === 0
    ? ok : fail)(
    "【180】功能入口默认顺序 + 默认位置 = 侧栏底部（安装默认，可折叠），数据模型单一真相源"
  );
  (["自动化", "前端开发", "拓展", "团队", "登录管理", "新手教程", "个性化&记忆"].every((label) => fmSrc180.includes(label))
    && fmSrc180.includes('schedule: { label: "自动化"') ? ok : fail)(
    "【180】入口改名全在 FunctionMenu 元数据里（前端开发 / 拓展 / 团队 / 个性化&记忆 / 登录管理 / 新手教程）"
  );
  (side180.includes("<FunctionMenu location={menuLocation} />")
    && /renderOptionsGroup\("top"\)/.test(side180) && /renderOptionsGroup\("bottom"\)/.test(side180)
    && /functionMenu\.location === "top"/.test(side180) && /functionMenu\.location === "bottom"/.test(side180)
    && /setFunctionMenuActionHandler\(/.test(side180)
    && /id === "team"\) \{ setGuideKey\("agents"\)/.test(side180) ? ok : fail)(
    "【180】侧栏接共享菜单：顶部/底部两处渲染，动作经总线回到 setGuideKey/setSettingsPage（团队仍开 agents 教程）"
  );
  (/moveFunctionMenuItemInMenu\(dragId, "visible"/.test(fmSrc180)
    && /moveFunctionMenuItemInMenu\(dragId, "overflow"/.test(fmSrc180)
    && fmSrc180.includes("drop-before") && fmSrc180.includes("drop-into") ? ok : fail)(
    "【180】侧栏入口可直接拖动排序/拖进更多，落手即写回配置"
  );
  {
    const moved = moveFunctionMenuItem(fmDefault180, "schedule", "overflow");
    const back = moveFunctionMenuItem(moved, "schedule", "visible");
    (moved.overflow.includes("schedule") && !normalizeFunctionMenu(fmDefault180).overflow.includes("schedule")
      && back.overflow.length === 0 && back.order.includes("schedule") ? ok : fail)(
      "【180】拖动落点模型：拖进「更多」= overflow 标记、拖回 = 移除标记（顺序不丢）"
    );
    const nudged = moveFunctionMenuItem({ ...fmDefault180, order: ["frontend", "schedule", ...FUNCTION_MENU_DEFAULT_ORDER.filter((id) => id !== "frontend" && id !== "schedule")] }, "schedule", "visible", "frontend");
    (nudged.order[0] === "schedule" && nudged.order[1] === "frontend" ? ok : fail)(
      "【180】拖到某行之前 = 插到它前面（不是粗暴追加到末尾）"
    );
    const reset = resetFunctionMenuLayout({ ...fmDefault180, location: "bottom", order: [...fmDefault180.order].reverse() });
    (reset.location === "bottom" && reset.order.join(">") === FUNCTION_MENU_DEFAULT_ORDER.join(">") ? ok : fail)(
      "【180】恢复默认只还原排序/分组，保留用户选的位置"
    );
    (setFunctionMenuItemOverflow(fmDefault180, "login", true).overflow.join(">") === "login" ? ok : fail)(
      "【180】行尾「收进更多」按钮与拖动落点同源"
    );
  }
  /* 两种展示位置 + 设置页入口 + 首次教程 / 编辑菜单。 */
  (side180.includes("<FunctionMenuTourHost />") && side180.includes("<FunctionMenuEditorHost />")
    && (side180.match(/<FunctionMenu location=\{menuLocation\} \/>/g) || []).length === 1 ? ok : fail)(
    "【180】侧栏只挂一份菜单 + 一份教程宿主 + 一份编辑弹窗宿主"
  );
  {
    const appearance180 = codeOnly(readFileSync(join(ROOT, "src", "features", "settings-appearance", "AppearanceSettingsSection.tsx"), "utf8"));
    const quickIdx = side180.indexOf('className="sidebar-quick"');
    const topRenderIdx = side180.indexOf('renderOptionsGroup("top")');
    const bottomRenderIdx = side180.indexOf('renderOptionsGroup("bottom")');
    const accountIdx = side180.indexOf('className="account-row"');
    (quickIdx > 0 && topRenderIdx > quickIdx && bottomRenderIdx > quickIdx && bottomRenderIdx < accountIdx
      && appearance180.includes("FunctionMenuSettings") ? ok : fail)(
      "【180】顶部入口紧跟新建/搜索之后（贴紧）、底部位置在账户行之前；外观设置页有位置选择入口"
    );
    const composer180 = codeOnly(readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "03-composer.tsx"), "utf8"));
    (!composer180.includes("function-menu-composer") ? ok : fail)(
      "【180】入口不再挂到输入框上方（用户 10-24 澄清：位置是新建/搜索下面，不是对话框上面）"
    );
  }
  (fmStore180.includes('const CONFIG_KEY = "function-menu-v1"')
    && fmStore180.includes("function-menu-tour-seen-v1-")
    && fmSrc180.includes("onDragStart") && fmSrc180.includes("onDrop")
    && fmSrc180.includes("编辑菜单") ? ok : fail)(
    "【180】排序/更多落 localStorage、每个位置首次教程只弹一次；编辑菜单真有 dragstart/onDrop"
  );
  {
    const appSettingsSrc180 = codeOnly(readFileSync(join(ROOT, "electron", "app-settings.ts"), "utf8"));
    (fmStore180.includes("saveAppSettings") && fmStore180.includes("readAppSettings")
      && /saveAppSettings(\?\.)?\(\{\s*sidebarOptionsCollapsed/.test(side180)
      && appSettingsSrc180.includes("functionMenu") && appSettingsSrc180.includes("sidebarOptionsCollapsed") ? ok : fail)(
      "【180】功能入口位置/顺序落主进程 app-settings；折叠态仍写回（10-26 浮层版启动固定收起，不再回灌展开态）"
    );
  }
  {
    const fmCss180 = readFileSync(join(ROOT, "src", "styles", "44-function-menu.css"), "utf8");
    const sideCss180 = readFileSync(join(ROOT, "src", "styles", "41-sidebar-guide.css"), "utf8");
    (/\.sidebar-options-top\s*\{/.test(fmCss180) && /\.function-menu-tour\s*\{/.test(fmCss180)
      && /\.sidebar-options-top \.sidebar-options-toggle\s*\{\s*margin-top:\s*2px/.test(fmCss180)
      && /\.function-menu-editor-backdrop\s*\{\s*z-index:\s*900/.test(fmCss180)
      && !/function-menu-composer/.test(fmCss180) ? ok : fail)(
      "【180】顶/底两种位置、贴紧搜索任务、教程、编辑弹窗样式在位（旧的对话框上方样式已移除）"
    );
    (/\.sidebar-options-toggle\s*\{[^}]*margin-top:\s*0\s*;/.test(sideCss180)
      && !/margin-top:\s*-13px/.test(sideCss180) ? ok : fail)(
      "【180】底部入口组不得用负 margin 压住会话列表最后一行（10-26 实测：-13px 会盖住项目行，项目区/功能入口糊在一起）"
    );
    (/\.sidebar-options-flyout\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*68[^}]*width:\s*232px/.test(sideCss180)
      && /\.sidebar-options-flyout #sidebar-options-body\s*\{[^}]*max-height:\s*none/.test(sideCss180) ? ok : fail)(
      "【180】右侧浮层固定定位 232px、层级低于「更多」弹层、内部不再套 40vh 滚动"
    );
  }
  /* 布局：顶部只留「新会话 / 搜索任务」；入口组在账户行**之上**，账户行是侧栏最后一条。
     ⛔ 10-22 用户：「用户名那一排继续固定在页面最底部，不要移动位置」+「在用户名那一排上方的选项区域
        加折叠/展开」⇒ 结构从「用户名 → 入口」倒过来（入口在上、账户行贴底）—— 只有这样
        折叠入口组时账户行才可能 0 位移；写在账户行**下面**的方案折叠时整条会被拖着走。 */
  {
    const quickIdx = side180.indexOf('className="sidebar-quick"');
    const topNavIdx = side180.indexOf('名="能力入口"');
    const accountIdx = side180.indexOf('className="account-row"');
    const bottomNavIdx = side180.indexOf('className="sidebar-nav sidebar-nav-bottom"');
    const optionsIdx = side180.indexOf("sidebar-options");
    (quickIdx > 0 && topNavIdx === -1 && optionsIdx > 0 && optionsIdx < bottomNavIdx && bottomNavIdx < accountIdx && side180.indexOf('renderOptionsGroup("top")') > quickIdx && side180.includes('renderOptionsGroup("bottom")') ? ok : fail)(
      "【180】顶部只剩新建/搜索；功能入口组顶部/底部两处都接同一套折叠结构，账户行仍是贴底锚"
    );
    (side180.includes("is-collapsed") && side180.includes("aria-hidden={optionsCollapsed}")
      && /renderOptionsGroup\("top"\)/.test(side180) && /renderOptionsGroup\("bottom"\)/.test(side180) ? ok : fail)(
      "【180】两处入口共用可动画折叠体（is-collapsed + aria-hidden），不是只给底部做"
    );
    const tailAfterAccount = side180.slice(accountIdx);
    (!/className="sidebar-(?:nav|options)/.test(tailAfterAccount) ? ok : fail)(
      "【180】账户行之后不许再挂入口/选项块（否则用户名行就不是「页面最底部那一排」）"
    );
  }
  /* 入口组折叠 / 展开（10-22 用户要求）：真隐显 + 折叠头常驻 + 账户行位置与折叠无关。 */
  {
    const toggleIdx = side180.indexOf('className="sidebar-options-toggle"');
    const bodyIdx = side180.indexOf('id="sidebar-options-body"');
    (toggleIdx > 0 && bodyIdx > toggleIdx ? ok : fail)(
      "【180】折叠头画在入口块**之前**（挂着块内 ⇒ 一收起就再也点不开 = 死路）"
    );
    (/<span>功能入口<\/span>/.test(side180) && /aria-expanded=\{!optionsCollapsed\}/.test(side180) && /aria-controls="sidebar-options-body"/.test(side180) ? ok : fail)(
      "【180】折叠头有可见文案 + aria-expanded + aria-controls（不是只有一个裸箭头）"
    );
    (/className=\{`sidebar-options-body sidebar-options-flyout \$\{optionsCollapsed \? "is-collapsed" : ""\}`\}/.test(side180)
      && /aria-hidden=\{optionsCollapsed\}/.test(side180) ? ok : fail)(
      "【180】入口组是右侧浮层（收起时不渲染，比 hidden 更彻底）"
    );
    (/createPortal\([\s\S]{0,700}?sidebar-options-flyout/.test(side180) && /document\.body/.test(side180) ? ok : fail)(
      "【180】功能入口浮层 portal 到 body（⛔ 留在 .sidebar/.thread-list 里会被 overflow 裁掉）"
    );
    (!/onClickCapture=/.test(side180)
      && /target\.closest\("\.function-menu-popover"\)/.test(side180)
      && /document\.addEventListener\("click", onClick\)/.test(side180) ? ok : fail)(
      "【180】浮层入口可点：⛔ 禁止 capture 里关浮层（会在 click 前卸载按钮）、「更多」弹层不算外部、动作跑完再收"
    );
    (/localStorage\.setItem\("sidebar-options-collapsed",\s*"true"\)/.test(side180)
      && /if \(optionsCollapsed\) setOptionsCollapsed\(false\);\s*\n\s*else persistOptionsCollapsed\(true\);/.test(side180) ? ok : fail)(
      "【180】浮层每次启动一律收起，打开态不落盘（⛔ 否则开机自动弹出来盖住聊天）"
    );
    (/localStorage\.setItem\("sidebar-options-collapsed"/.test(side180) ? ok : fail)(
      "【180】折叠态跨重启保留（sidebar-options-collapsed，与 sidebar-collapsed 同口径）"
    );
    /* 无缝展开/折叠：grid 行高 0fr ↔ 1fr 过渡（不再用 hidden 瞬切）。 */
    const css41 = readFileSync(join(ROOT, "src", "styles", "41-sidebar-guide.css"), "utf8");
    (/\.sidebar-options-body\s*\{[\s\S]{0,220}?grid-template-rows:\s*1fr[\s\S]{0,220}?transition:\s*grid-template-rows/.test(css41)
      && /\.sidebar-options-body\.is-collapsed\s*\{[\s\S]{0,160}?grid-template-rows:\s*0fr/.test(css41) ? ok : fail)(
      "【180】折叠用 grid 行高过渡（0fr ↔ 1fr + transition），无缝高度动画"
    );
    /* 箭头方向：**横向**指，收起 ‹ / 展开 ›（10-27 用户第 4 次定版：「反了，收起朝左，展开朝右」）。
       面板是 `left = 侧栏右缘 + 8` 的右侧浮层，顶部 / 底部两种位置都在右边。
       ⛔ 别再按 top/bottom 或上下的思路改 —— 前两版按「上下」、第三版把左右弄反，各被否一次。 */
    (/\.sidebar-options \.sidebar-options-chevron\s*\{\s*transform:\s*rotate\(90deg\)/.test(css41)
      && /\.sidebar-options \.sidebar-options-chevron\.open\s*\{\s*transform:\s*rotate\(-90deg\)/.test(css41) ? ok : fail)(
      "【180】箭头横向指（收起 ‹朝左 / 展开 ›朝右）"
    );
    (/sidebar-options-chevron \$\{optionsCollapsed \? "" : "open"\}/.test(side180) ? ok : fail)(
      "【180】箭头只由 optionsCollapsed 一个变量驱动（⛔ 不许再写第二份展开判定）"
    );
    /* 贴底锚：账户行高度必须**固定**（flex-basis），否则折叠时会被列表弹性带着上下跑。 */
    const css02 = readFileSync(join(ROOT, "src", "styles", "02-sidebar-threads.css"), "utf8");
    (/\.account-row \{[\s\S]{0,600}?flex:\s*0 0 42px/.test(css02) ? ok : fail)(
      "【180】账户行仍是固定 42px（flex: 0 0 42px —— 折叠时 0 位移的前提）"
    );
    /* ⛔ 10-22 自适应（用户问「两个板块会不会冲突」）：矮窗口下 7 行入口组 + 账户行会把会话列表
       压到 0（列表消失）；现在列表有保底、入口组可收缩并自己滚，账户行照旧钉死。 */
    const css01 = readFileSync(join(ROOT, "src", "styles", "01-base-and-chrome.css"), "utf8");
    (/\.thread-list \{[\s\S]{0,700}?min-height:\s*96px/.test(css01) ? ok : fail)(
      "【180】会话列表有高度保底 96px（矮窗口下不被底部入口组压到 0）"
    );
    (/\.sidebar-nav-bottom \{[\s\S]{0,240}?flex:\s*0 1 auto/.test(css41) ? ok : fail)(
      "【180】底部入口组可收缩并自己滚（⛔ 别改回 flex:none —— 会把列表挤没 / 账户行顶出可视区）"
    );
    /* 10-22 用户：「这个为啥显示这么远呢，贴编辑文件尾部就行」——实时编辑行原来占满整宽，
       +N -N 被顶到最右边、目录被 flex:1 撑开 ⇒ 看着和文件隔了老远。现在整行**按内容收缩**，
       文件名 / 目录 / 数字紧挨着。 */
    const cards04 = readFileSync(join(ROOT, "src", "styles", "04-cards-tools.css"), "utf8");
    (/\.live-edit-row \{[\s\S]{0,400}?width:\s*fit-content/.test(cards04) && /\.live-edit-row small \{[\s\S]{0,260}?flex:\s*0 1 auto/.test(cards04) && !/\.live-edit-stats \{[^}]*margin-left:\s*auto/.test(cards04) ? ok : fail)(
      "【180】实时编辑行按内容收缩、目录紧跟文件名、数字不再被顶到行尾（⛔ 别改回满宽 + flex:1）"
    );
  }
  /* 新手教程：入口进底部组，且 NewbieGuide 走**受控**（不传 open 它会再画一行「新手引导」⇒ 底部两个入口）。 */
  (fmSrc180.includes('newbie: { label: "新手教程"') && /id === "newbie"\) \{ setNewbieOpen\(true\)/.test(side180) ? ok : fail)(
    "【180】菜单有「新手教程」一项且动作真锚到 setNewbieOpen"
  );
  (/<NewbieGuide open=\{newbieOpen\} onOpenChange=\{setNewbieOpen\}/.test(side180) ? ok : fail)(
    "【180】NewbieGuide 走受控打开（⛔ 不传 open 它会自带一行「新手引导」⇒ 底部出现两个入口）"
  );
  /* 登录管理（10-21 用户令）：「加一个登录管理，点击弹窗提醒 GPT订阅 / 中转站账户 / 云账号，跳转都是直达界面」。
     ⛔ 三处缺一 = 把某个登录入口藏起来；⛔ 行里必须各自交出自己的 page（都跳同一页 = 假入口）。 */
  (fmSrc180.includes('login: { label: "登录管理"') && /setLoginMgrOpen\(true\)/.test(side180) ? ok : fail)(
    "【180】菜单有「登录管理」入口，且动作真打开弹窗（不是死按钮）"
  );
  const loginMgrSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "LoginManagerModal.tsx"), "utf8");
  (["openai", "relay", "cloud"].every((page) => new RegExp(`page: "${page}"`).test(loginMgrSrc)) ? ok : fail)(
    "【180】登录管理弹窗列全三处账户（GPT 订阅 / 中转站 / 云账号）"
  );
  (/onNavigate\(account\.page\)/.test(loginMgrSrc) ? ok : fail)(
    "【180】每行把自己那个 page 交出去（⛔ 三行都跳同一页 = 假入口）"
  );
  (/onNavigate=\{\(page: LoginManagerTarget\) => \{/.test(side180) && /setSettingsPage\(page\)/.test(side180) && /setSettingsOpen\(true\)/.test(side180) ? ok : fail)(
    "【180】点一行**直达**对应设置页（⛔ 不再经「设置 → 账户与模型」多一层）"
  );

  /* 可达性（⛔ 不许省）：aria-modal 的对话框必须自带三条出路 + 焦点不外逃。 */
  (/aria-modal="true"/.test(loginMgrSrc) && /role="dialog"/.test(loginMgrSrc) ? ok : fail)(
    "【180】登录管理是个真对话框（role=dialog + aria-modal）"
  );
  (/addEventListener\("keydown", onKey, true\)/.test(loginMgrSrc) && /event\.key === "Escape"/.test(loginMgrSrc) ? ok : fail)(
    "【180】Esc 能关（键盘用户的主出口；⛔ 只做 ✕ 与遮罩等于把键盘用户关在里面）"
  );
  (/event\.key !== "Tab"/.test(loginMgrSrc) && /document\.activeElement === last/.test(loginMgrSrc) ? ok : fail)(
    "【180】Tab 焦点陷阱在（aria-modal 承诺焦点只在本框内；⛔ 不拦 Tab 焦点会跑到背后的侧栏/消息区）"
  );
  (/onMouseDown=\{\(event\) => \{ if \(event\.target === event\.currentTarget\) onClose\(\); \}\}/.test(loginMgrSrc) ? ok : fail)(
    "【180】点遮罩能关（第三条出路，且只在**遮罩本身**被点时才关 —— 点内容不许误关）"
  );
  (["frontend", "extensions", "team", "identity"].every((id) => fmSrc180.includes(`${id}: { label:`))
    && /setGuideKey\(id\)/.test(side180) && /id === "team"\) \{ setGuideKey\("agents"\)/.test(side180) ? ok : fail)(
    "【180】四条能力入口各自映射到教程（team → agents 的映射仍在；不是只写文案）"
  );
  (/\{guideKey && <SidebarGuideModal/.test(side180) ? ok : fail)(
    "【180】教程弹窗挂在 guideKey 条件上（⛔ 不是恒假/被删）"
  );
  (!/<span>技能-插件-专家\/专家团<\/span>/.test(side180) && !/\{extHubOpen && \(/.test(side180) ? ok : fail)(
    "【180】旧的三合一入口与 extHubOpen 弹窗已删除（技能/插件/MCP 与智能体已拆成两条）"
  );
  const guideModalSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "SidebarGuideModal.tsx"), "utf8");
  (/使用教程/.test(guideModalSrc) && /setView\("tutorial"\)/.test(guideModalSrc)
    && /view === "overview" \?/.test(guideModalSrc) && (guideModalSrc.match(/info-modal sidebar-guide/g) ?? []).length === 1 ? ok : fail)(
    "【180】每个入口弹窗都有「使用教程」，并在**同一个弹窗**内切换视图（只有一个弹窗类名，没有嵌套第二个）"
  );
  (guideModalSrc.includes("ui_component_search") && guideModalSrc.includes("ui_component_get") ? ok : fail)(
    "【180】组件库教程写明 Codex 已配备 ui_component_search / ui_component_get（用户要求让用户知道可直接调用）"
  );
  /* 10-21 用户截图：点专家卡后还停在「智能体团队」外层，要再点一次才进专家中心。
     ⇒ 三张卡必须直达各自内页（expert-center / teams / agents），不许再指向 agentteam 外层。 */
  (["expert-center", "teams", "agents"].every((t) => guideModalSrc.includes(`target: "${t}"`))
    && !guideModalSrc.includes('target: "agentteam"')
    && ["expert-center", "teams", "agents"].every((t) => new RegExp(`case "${t}"`).test(side180)) ? ok : fail)(
    "【180】专家 / 专家团 / 子智能体卡片直达各自内页（不先落到 agentteam 外层再点一次）"
  );
  const sideStyles180 = readStyles();
  /* ⛔ 10-26：三个按钮（新建任务 / 指挥中枢 / 搜索任务）统一整行宽 + 统一靠左，
     不再给「搜索任务」单独特判（那会把「只有它是靠左」的旧形态钉死）；圆角随皮肤改到 10px。 */
  (/\.sidebar-quick\s*\{[\s\S]{0,260}?flex-direction:\s*column/.test(sideStyles180)
    && /\.sidebar-quick \.sidebar-quick-btn\s*\{[\s\S]{0,300}?width:\s*100%[\s\S]{0,300}?justify-content:\s*flex-start[\s\S]{0,300}?border-radius:\s*10px/.test(sideStyles180) ? ok : fail)(
    "【180】新建任务 / 指挥中枢 / 搜索任务上下排列、整行宽、统一靠左（10-24 用户对照截图，不再并排胶囊）"
  );
  (/className=\{`sidebar-tab sidebar-cap-row/.test(fmSrc180)
    && fmSrc180.includes("schedule: { label: \"自动化\"") ? ok : fail)(
    "【180】「自动化」与其它能力入口同一行样式（统一 sidebar-cap-row，不再单独一档）"
  );
  (fmSrc180.includes("function-menu-more") && fmSrc180.includes("编辑菜单")
    && fmSrc180.includes("移到拓展功能下面") && fmSrc180.includes("移到侧栏底部")
    && !/moreHubOpen/.test(side180) ? ok : fail)(
    "【180】新的「更多」只收溢出入口 + 编辑菜单/切换位置（旧 AI 画布 moreHubOpen 已删除）"
  );
  (/setDramaCanvasOpen\(true\)/.test(side180) && /setUiSketchOpen\(true\)/.test(side180) ? ok : fail)(
    "【180】AI 画布 / 前端开发画布入口没有随「更多」一起消失（已并入前端 UI · 组件库）"
  );
  (/\.sidebar-guide\s*\{/.test(sideStyles180) ? ok : fail)(
    "【180】能力入口弹窗样式存在（缺了弹窗会是一堆裸按钮）"
  );
  // ④ 模型配置入口的删除在【70】里（同轮把那两条正向断言翻成负向）
  // ⑤ 新会话 / 搜索任务上下两行：快捷键仍然生效，但不再显示键帽
  const navStart180 = side180.indexOf('aria-label="导航"');
  const navEnd180 = navStart180 >= 0 ? side180.indexOf("</div>", navStart180) : -1;
  const nav180 = navStart180 >= 0 && navEnd180 > navStart180 ? side180.slice(navStart180, navEnd180) : "";
  /* ⛔ 10-25 用户令：「拓展功能从折叠组拉出来常驻；**搜索任务只在下方视图行的 🔍 里**」
     ⇒ 顶部快捷区现在是「新建任务 / 指挥中枢 / 拓展功能」，搜索不再是快捷区按钮。
     意图不变：新建类入口在顶部快捷区，搜索入口仍**可见且靠后**（视图行工具条）。 */
  (nav180.includes("sidebar-quick") && nav180.includes("新建任务") && nav180.includes("指挥中枢") ? ok : fail)(
    "【180】新建任务 / 指挥中枢在顶部快捷区（搜索任务 10-25 移到视图行 🔍）"
  );
  (/className="view-toolbar-btn ic-cyan" title="搜索任务"/.test(side180) ? ok : fail)(
    "【180】搜索任务入口在视图行工具条（🔍 + title，可点可发现）"
  );
  (!/<kbd>/.test(nav180) ? ok : fail)(
    "【180】快捷入口不再显示快捷键键帽（快捷键本身仍由全局监听生效）"
  );
}
}

{
if (!existsSync(join(ROOT, "src", "features", "team-office", "office-render.ts"))) {
    /* ⛔⛔ 2026-10-05：本组断言的**对象**（PixiJS 程序化绘制 / office-director 导演 /
       office-render 绘制）随 v19「像素素材 + 原生 canvas 2D」全部删除
       ⇒ 本组**长期空跑**。⛔ 静默跳过 = 假绿（让人以为办公室有几十条断言在保护）
       —— 用户 10-05 报「显示器没对准、没显示」时没有任何守卫拦下，根因就在这里。
       ✅ 先改成**显式打印**；恢复方式 = 按当前实现重写断言（样板见【154】）。 */
    console.log("  ! 【办公室】断言对象 office-render.ts 已随 v19 删除 ⇒ 本组跳过（⛔ 空跑=假绿，待按当前实现重写）");
  } else
{
  const canvas181 = readFileSync(join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx"), "utf8");
  const navPath181 = join(ROOT, "src", "features", "team-office", "office-nav.mjs");
  // ① 接线：走动人必须走 BFS 路径
  (/buildWalkerPath\(scene, ground/.test(canvas181) ? ok : fail)(
    "【181】走动人用 BFS 路径（buildWalkerPath）"
  );
  // ⛔ 用 codeOnly 剥注释再判：注释里讲解历史时必然提到"直线插值"这些词
  (!/lerp\(w\.from\.x, w\.to\.x/.test(codeOnly(canvas181)) ? ok : fail)(
    "【181】不再有 from→to 直线插值（那会让人穿过别人的桌子）"
  );
  // ② 路径只在目标变化时重算（这个同步函数每帧跑，无条件重算 = 每帧一次 BFS）
  (/walker\.pathKey !== key/.test(canvas181) ? ok : fail)(
    "【181】路径只在目标变化时重算（每帧重算 = 每帧一次 BFS）"
  );
  // ③ 可行走网格按工位布局缓存
  (/scene\.navKey !== navKey/.test(canvas181) ? ok : fail)(
    "【181】可行走网格按布局缓存（不每帧重建 768 格）"
  );
  // ④ 走动速度按弧长换算（按 t 恒速会让"绕远路"的人反而走得飞快）
  (/pxPerFrame \/ w\.totalLen/.test(canvas181) ? ok : fail)(
    "【181】走动速度按路径长度换算（不是按 t 恒速）"
  );
  // ⑤ 真跑纯模块（office-nav.mjs 就是为此才用 .mjs：.ts 守卫只能读文本、跑不了）
  if (!existsSync(navPath181)) fail("【181】office-nav.mjs 缺失 —— 守卫无法真跑寻路");
  else {
    const nav181 = await import(pathToFileURL(navPath181).href);
    // ⛔ 这里的工位 u/v 抄自 office-iso 的 COL_U / ROW_V（3 列 × 3 行）；布局改了两边一起改。
    const desks181 = [
      { u: 0.23, v: 0.3 }, { u: 0.5, v: 0.3 }, { u: 0.77, v: 0.3 },
      { u: 0.23, v: 0.61 }, { u: 0.5, v: 0.61 }, { u: 0.77, v: 0.61 },
      { u: 0.23, v: 0.92 }, { u: 0.5, v: 0.92 }, { u: 0.77, v: 0.92 },
    ];
    const grid181 = nav181.buildWalkGrid(desks181);
    const blocked181 = (pt) => nav181.isBlocked(grid181, nav181.cellOf(pt.u, pt.v, grid181).cx, nav181.cellOf(pt.u, pt.v, grid181).cy);
    (desks181.every(blocked181) ? ok : fail)("【181】真跑：工位座位点被判为障碍（网格确实按桌子标了）");
    const p181 = nav181.findPath({ u: 0.5, v: 0.61 }, { u: 0.9, v: 0.68 }, grid181);
    (Array.isArray(p181) && p181.length >= 3 ? ok : fail)(`【181】真跑：工位→饮水机有路径（${p181?.length ?? 0} 个点）`);
    if (p181) {
      const hits181 = p181.filter(blocked181).length;
      (hits181 <= 2 ? ok : fail)(`【181】真跑：路径不穿家具（落在障碍格的只有 ${hits181} 个，允许起终点计数）`);
      const walked181 = nav181.pathLength(p181.map((pt) => ({ x: pt.u, y: pt.v })));
      const direct181 = Math.hypot(0.9 - 0.5, 0.68 - 0.61);
      (walked181 > direct181 * 1.001 ? ok : fail)(
        `【181】真跑：路径比直线长（${walked181.toFixed(3)} vs ${direct181.toFixed(3)}）⇒ 确实在绕，不是直线`
      );
    }
    // 每个工位都要能走出去（⛔ 别出现"被自己桌子困住"的工位）
    let trapped181 = 0;
    for (const desk of desks181) if (!nav181.findPath(desk, { u: 0.5, v: 0.06 }, grid181)) trapped181++;
    (trapped181 === 0 ? ok : fail)(`【181】真跑：9 个工位都能走到后墙通道（被困住 ${trapped181} 个）`);
  }

  /* ══ 【182】archkit 架构图引擎（逆向复刻 archify 方法论，净室重实现；纯函数真跑） ══ */
  {
    const model = await import(pathToFileURL(join(ROOT, "src", "lib", "archkit-model.mjs")).href);
    const renderer = await import(pathToFileURL(join(ROOT, "src", "lib", "archkit-render.mjs")).href);
    (model.archkitNormalizeDiagram({ type: "mindmap", nodes: [], edges: [] }).ok === false ? ok : fail)(
      "【182】未知 type 被拒（白名单：architecture / workflow / sequence）"
    );
    const dup182 = model.archkitNormalizeDiagram({ type: "architecture", nodes: [{ id: "a" }, { id: "a" }], edges: [] });
    (dup182.ok === false && dup182.problems.some((p) => /重复/.test(p.message)) ? ok : fail)("【182】节点 id 重复 ⇒ 整份拒收");
    (model.archkitNormalizeDiagram({ type: "architecture", nodes: [{ id: "a" }], edges: [{ from: "a", to: "ghost" }] }).ok === false ? ok : fail)(
      "【182】连线端点不存在 ⇒ 不 ok（⛔ 不做静默修复——证据图错一根线就整份拒收）"
    );
    (model.archkitNormalizeDiagram({ type: "sequence", nodes: [{ id: "A" }, { id: "B" }], messages: [{ from: "A", to: "B" }] }).ok === false ? ok : fail)(
      "【182】sequence 消息缺 text 被拒"
    );
    const sample182 = model.archkitNormalizeDiagram({
      type: "architecture", title: "样例",
      nodes: [
        { id: "m", kind: "entry", label: "main.ts", evidence: ["electron/main.ts"] },
        { id: "e", kind: "external", label: "引擎" },
        { id: "u", kind: "module", label: "渲染层" },
      ],
      edges: [{ from: "m", to: "e", label: "spawn" }, { from: "m", to: "u", label: "桥" }],
    });
    if (sample182.ok) {
      const html182 = renderer.archkitRender(sample182.diagram);
      (html182 === renderer.archkitRender(sample182.diagram) ? ok : fail)(
        "【182】渲染确定性：同输入两次输出逐字节一致（deliver 回执 sha256 的前提）"
      );
      (!/(src|href)\s*=\s*"https?:|@import|url\(\s*['"]?https?:/i.test(html182) && html182.includes("<svg") ? ok : fail)(
        "【182】产出自包含：无任何外链资源（src/href 都要查——link 标签走 href，⛔ 只查 src 会漏）"
      );
      (html182.includes("main.ts") && html182.includes('data-archkit="1"') && html182.includes('data-id="m"') ? ok : fail)(
        "【182】节点卡片是真 SVG 文本（可搜索可复制），不是位图；且带 data 属性供交互"
      );
      (renderer.archkitRender(model.archkitNormalizeDiagram({
        type: "sequence", title: "s",
        nodes: [{ id: "A" }, { id: "B" }], messages: [{ from: "A", to: "B", text: "hi" }],
      }).diagram).includes("lifeline") ? ok : fail)("【182】sequence 渲染出 lifeline（三型图各自有专属布局）");
    } else {
      fail("【182】样例输入竟不合法：" + JSON.stringify(sample182.problems));
    }
  }

  /* ══ 【183】定时任务 → 微信主动投递（09-27：打通「会话设定时 + 到点推微信」通道） ══ */
  {
    const sched183 = readFileSync(join(ROOT, "electron", "scheduler.ts"), "utf8");
    const im183 = readFileSync(join(ROOT, "electron", "features", "weixin-ipc.ts"), "utf8");
    const gw183 = readFileSync(join(ROOT, "electron", "weixin-gateway.ts"), "utf8");
    // ⛔ 都锚接线形态，别锚常量/注释（注释里的同名字串不算——【180】【70】各踩过一次）
    (/deliver\?: DeliverTarget/.test(sched183) && /deliver: input\.deliver === undefined \? current\?\.deliver : sanitizeDeliver\(input\.deliver\)/.test(sched183) ? ok : fail)(
      "【183】定时任务有 deliver 字段且 save 走 sanitizeDeliver（缺省保留原值，局部更新不打掉已有投递）"
    );
    (/task\.deliver\?\.channel === "weixin"/.test(sched183) && /await this\.deliverWeixin\(task, outcome\.replyText\)/.test(sched183) ? ok : fail)(
      "【183】run 完成后真的调 deliverWeixin 并把抓到的回复文本传进去（⛔ 只建通道不接线 = 永远不发）"
    );
    (/if \(!weixinGateway\) throw/.test(sched183) && /weixinGateway\.sendToBoundUser\(text\)/.test(sched183) && /weixinGateway\.sendText\(to, text\)/.test(sched183) ? ok : fail)(
      "【183】投递走微信网关（to 显式→sendText；缺省→sendToBoundUser；未登录要抛错留痕，不许静默吞）"
    );
    (/textByTurn/.test(sched183) && /item\/agentMessage\/delta/.test(sched183) && /item\/completed/.test(sched183) ? ok : fail)(
      "【183】回复文本从 agentMessage 增量聚合 + completed 兜底（完成事件经常只回 id+status，只等 completed 会拿到空文本）"
    );
    // ⛔ 10-03：域改插件形态后注册写 ipcHost.handle —— 只认 ipcMain.handle 会让这条**安全/能力**断言假红。
    (/(?:ipcMain\.handle|ipcHost\.handle)\("weixin:send"/.test(im183) && /sendToBoundUser\(text\)/.test(im183) && /hasSession\(\)/.test(im183) ? ok : fail)(
      "【183】weixin:send 通道存在（agent 主动推送的直连工具；未登录 must 抛错，to 缺省走绑定用户）"
    );
    (/get boundUserId\(\)/.test(gw183) && /sendToBoundUser/.test(gw183) ? ok : fail)(
      "【183】网关暴露 boundUserId/sendToBoundUser（调度投递的缺省目标）"
    );
    let manifest183 = {};
    try { manifest183 = JSON.parse(readFileSync(join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8")); } catch { /* 读不到由下一条报 */ }
    const wxSend183 = (manifest183.channels || []).find((c) => c.channel === "weixin:send");
    (wxSend183 && wxSend183.cast === "Promise<{ ok: boolean }>" ? ok : fail)(
      "【183】manifest 登记了 weixin:send（cast 完整 Promise 形态——写对象类型会让 preload TS2352，phone 域踩过）"
    );
    const cap183 = readFileSync(join(ROOT, "electron", "builtin-skills", "14-skill-harness-api.ts"), "utf8");
    (cap183.includes("weixin:send") && cap183.includes("deliver") ? ok : fail)(
      "【183】harness-api 能力清单包含 weixin:send 与 deliver（agent 读的就是这份——清单里没有 = 会话里永远配不出来）"
    );
  }

  /* ══ 【184】内置视频生成接口 + 生图工作流（09-27；适配层纯函数真跑） ══ */
  {
    const videoGen184 = readFileSync(join(ROOT, "electron", "features", "video-gen.ts"), "utf8");
    const manifest184 = JSON.parse(readFileSync(join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8"));
    const videoChannels184 = (manifest184.channels || []).filter((c) => c.channel.startsWith("video:")).map((c) => c.channel);
    // ⛔ 期望清单要**穷举**：少写一个（如 09-29 新增的 video:concat）会让断言在域里加了通道后
    //    仍然绿 —— 那就从「登记完整性」退化成了「这几个还在」。
    const wantVideo184 = ["video:providers", "video:config-read", "video:config-save", "video:submit", "video:poll", "video:download", "video:concat"];
    (wantVideo184.every((ch) => videoChannels184.includes(ch)) && videoChannels184.length === wantVideo184.length ? ok : fail)(
      `【184】manifest 登记了 video 域全部 7 通道（providers/config-read/config-save/submit/poll/download/concat；实得 ${videoChannels184.length}）`
    );
    (/videoAssertImageOk\(/.test(videoGen184) ? ok : fail)(
      "【184】video:submit 提交前过 videoAssertImageOk（url-only 厂商吃本地首帧要当场报错，不许静默失败）"
    );
    (/isInsideTrustedRoots\(String\(input\.workspace\)\)/.test(videoGen184) ? ok : fail)(
      "【184】video:download 落盘前过可信根校验（与 fs:write 同一口径）"
    );
    const registry184 = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");
    (/{ prefix: "video", count: 7,/.test(registry184) && /features\/video-gen\.ts/.test(registry184) ? ok : fail)(
      "【184】ipc-registry 有 video 域条目（count 7，file 指向 video-gen.ts）"
    );
    // 适配层真值表（纯 .mjs 直接 import 跑，不是读文本）
    const vp = await import(pathToFileURL(join(ROOT, "src", "lib", "video-providers.mjs")).href);
    const NOW184 = 1727420000000;
    (vp.VIDEO_PROVIDERS.length === 8 && vp.VIDEO_PROVIDERS.filter((p) => p.region === "cn").length === 5 ? ok : fail)(
      "【184】真跑：8 家厂商（国内 5 国外 3）——国内外都要支持是用户点名的要求"
    );
    (vp.klingToken({ accessKey: "ak", secretKey: "sk" }, NOW184) === vp.klingToken({ accessKey: "ak", secretKey: "sk" }, NOW184) ? ok : fail)(
      "【184】真跑：klingToken 确定性（nowMs 入参，同输入同输出——JWT 里不许藏 Date.now）"
    );
    (() => {
      try { vp.videoAssertImageOk("wanx", "i2v", "D:/local/frame.png"); return fail("【184】真跑：url-only 厂商吃本地首帧竟然放行了"); }
      catch (e) { return /公网/.test(e.message) ? ok("【184】真跑：url-only 厂商吃本地首帧被拒且指明替代厂商") : fail("【184】真跑：报错文案没说清要公网 URL"); }
    })();
    (vp.videoParsePoll("wanx", { output: { task_status: "SUCCEEDED", video_url: "https://v/1.mp4" } }).url === "https://v/1.mp4" ? ok : fail)(
      "【184】真跑：wanx 成功态取到 video_url（parsePoll 归一成 {status,url}）"
    );
    // 渲染层：shot 卡的生成按钮必须真接线（⛔ 禁止"生成视频（未接入）"这种假按钮回潮）
    // 09-28：按钮改为按 GEN_CHANNELS 映射表逐通道渲染 ⇒ 锚点跟着改成「视频通道分支真的调
    // generate(id, what)」（不再是写死的 `generate(id, "video")` 字面量，否则重构即假红）。
    // ⛔ 09-28 二次搬家：按钮本体移到 DramaChannelButton.tsx（卡面 + 检查器共用）⇒ 读那个文件，
    //    并额外要求 shot 在映射表里确实挂着 video 通道（只查「调了 generate」会漏掉"通道被摘掉"）。
    const btn184 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaChannelButton.tsx"), "utf8");
    const card184 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaNodeCard.tsx"), "utf8");
    (btn184.includes("void actions.story.generate(id, what)") && /shot: \["image", "video", "audio"\]/.test(btn184) && !card184.includes("生成视频（未接入）") ? ok : fail)(
      "【184】shot 卡「生成视频」真调 story.generate（未接入的置灰假按钮不许回潮）"
    );
    const story184 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-story.ts"), "utf8");
    (story184.includes("videoSubmit") && story184.includes("videoPoll") && story184.includes("videoDownload") ? ok : fail)(
      "【184】视频生成闭环三步都在（submit → poll → download 落工作区），不是只调了 submit"
    );
    // 生图工作流（09-27 二次修正）：⛔ 不做独立侧栏入口（用户点名：原来一个入口就别造重复入口）
    // —— 同一画布 + 两种起手按钮；专家召唤在选择器里（会话选择 + 视频团/生图专家）。
    const model184 = readFileSync(join(ROOT, "src", "lib", "drama-canvas-model.mjs"), "utf8");
    const side184 = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "01-sidebar-shell.tsx"), "utf8");
    const canvas184 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8");
    (model184.includes("export function imageStarterWorkflow") ? ok : fail)(
      "【184】生图起手骨架 imageStarterWorkflow 存在"
    );
    (/setDramaCanvasVariant/.test(side184) ? fail("【184】侧栏又出现了 variant 双入口（用户点名别造重复入口）") : ok)(
      "【184】侧栏只有一个画布入口（无 variant 双入口回潮）"
    );
    (canvas184.includes('createStarter("drama")') && canvas184.includes('createStarter("image")') && canvas184.includes("新建生图工作流") ? ok : fail)(
      "【184】画布头部有「短剧/生图」两个起手按钮（生图工作流在同入口内闭环）"
    );
    (canvas184.includes("onSummonTeam") && canvas184.includes('"video-production-team"') && canvas184.includes('"image-gen-expert"') ? ok : fail)(
      "【184】交给 Agent 选择器里有专家召唤（视频制作专家团 / 生图专家——没这俩选项就没闭环）"
    );
    (readFileSync(join(ROOT, "src", "features", "app-view", "AppView.tsx"), "utf8").includes('startTeamSession({ teamId, task: text') ? ok : fail)(
      "【184】召唤走 teams:start-session（task 直接进团队会话，不是塞输入框）"
    );
    (readFileSync(join(ROOT, "electron", "expert-teams", "07-team-default.ts"), "utf8").includes("imageGenExpert(mk)") ? ok : fail)(
      "【184】生图专家已注册进默认专家团清单（清单里没有 = 选择器召唤会报未知 teamId）"
    );
    (canvas184.includes("? 0.62 : MIN_ZOOM") ? ok : fail)(
      "【184】适配最小缩放 0.62（⛔ 0.38 会把 12.5px 卡片字缩成 ~5px——「卡片文字糊」的主因）"
    );
  }

  /* ══ 【185】备份页「选择会话导出」（09-27：勾选任意多条一次导出） ══ */
  {
    const backup185 = readFileSync(join(ROOT, "src", "features", "settings-backup", "BackupSettingsSection.tsx"), "utf8");
    (backup185.includes("void exportThreadsMarkdown(picked)") && backup185.includes("void exportThreadsBackup(picked)") ? ok : fail)(
      "【185】选择器勾的 id 数组要真的传进导出函数（⛔ 两张卡各自为政 = 勾了白勾）"
    );
    (/backup-picker-search/.test(backup185) && /onChange=\{\(e\) => setPickerQuery\(e\.target\.value\)\}/.test(backup185) ? ok : fail)(
      "【185】选择器带搜索框（会话多了之后没有搜索的勾选列表没法用）"
    );
    (/allVisiblePicked/.test(backup185) && /取消全选/.test(backup185) ? ok : fail)(
      "【185】全选只作用于当前可见集（搜索过滤后全选/取消全选不能误伤被过滤掉的勾选）"
    );
  }

  /* ══ 【186】archkit 收尾：5 型图齐 + delta 对比 + visual-check 门禁（09-27） ══ */
  {
    const model186 = await import(pathToFileURL(join(ROOT, "src", "lib", "archkit-model.mjs")).href);
    const render186 = await import(pathToFileURL(join(ROOT, "src", "lib", "archkit-render.mjs")).href);
    // ① 5 型白名单真跑
    (model186.archkitNormalizeDiagram({ type: "dataflow", nodes: [{ id: "p" }], edges: [] }).ok
      && model186.archkitNormalizeDiagram({ type: "lifecycle", nodes: [{ id: "idle" }], edges: [{ from: "idle", to: "idle", label: "tick" }] }).ok ? ok : fail)(
      "【186】真跑：dataflow / lifecycle 归一通过（5 型图齐；lifecycle 自环转移合法）"
    );
    // ② delta 真值表
    const oldD = model186.archkitNormalizeDiagram({ type: "architecture", nodes: [{ id: "a", kind: "module", label: "A" }, { id: "b", kind: "module", label: "B" }], edges: [{ from: "a", to: "b" }] }).diagram;
    const newD = model186.archkitNormalizeDiagram({ type: "architecture", nodes: [{ id: "a", kind: "module", label: "A2" }, { id: "c", kind: "entry", label: "C" }], edges: [{ from: "a", to: "c" }] }).diagram;
    const d186 = model186.archkitDelta(oldD, newD);
    (JSON.stringify(d186.added) === '["c"]' && JSON.stringify(d186.removed) === '["b"]' && JSON.stringify(d186.changed) === '["a"]' ? ok : fail)(
      "【186】真跑：delta 增/删/改判定（按 id 对齐；changed = 同 id 内容变化）"
    );
    (() => { try { model186.archkitDelta(oldD, model186.archkitNormalizeDiagram({ type: "sequence", nodes: [], edges: [] }).diagram); fail("【186】跨 type delta 竟然没抛错"); } catch (e) { return /同型/.test(e.message) ? ok("【186】真跑：跨 type delta 抛错（架构图 vs 时序图没有可比性）") : fail("【186】跨 type 报错文案不对：" + e.message); } })();
    // ③ 渲染：lifecycle 圆环 / delta 面板 / 无 delta 不带面板
    (render186.archkitRender(model186.archkitNormalizeDiagram({ type: "lifecycle", nodes: [{ id: "idle" }, { id: "running" }], edges: [{ from: "idle", to: "running", label: "start" }] }).diagram).includes("k-state") ? ok : fail)(
      "【186】lifecycle 渲染出状态卡（圆环布局 + 状态配色）"
    );
    (render186.archkitRender(newD, { delta: d186 }).includes("delta-panel") && !render186.archkitRender(newD).includes("delta-panel") ? ok : fail)(
      "【186】delta 面板只在传 delta 时渲染（普通渲染输出必须保持逐字节稳定）"
    );
    // ④ visual-check 门禁：electron 启动前必须清 ELECTRON_RUN_AS_NODE / NODE_OPTIONS（宿主常带，不清=纯 Node 化）
    const cli186 = readFileSync(join(ROOT, "scripts", "archkit.mjs"), "utf8");
    (/visual-check/.test(cli186) && /delete env\.ELECTRON_RUN_AS_NODE/.test(cli186) && /delete env\.NODE_OPTIONS/.test(cli186) ? ok : fail)(
      "【186】visual-check spawn 前清 ELECTRON_RUN_AS_NODE / NODE_OPTIONS（不清 = electron.exe 退化纯 Node，require('electron') 直接 MODULE_NOT_FOUND）"
    );
    (readFileSync(join(ROOT, ".codex", "skills", "arch-diagram", "SKILL.md"), "utf8").includes("5 型齐") ? ok : fail)(
      "【186】技能文档已更新为 5 型齐（诚实边界清零：dataflow/lifecycle/delta/visual-check 都已落地）"
    );
  }

  /* ══ 【187】排队消息定时发送：主进程定时器 + due 落点 + UI 入口（09-28） ══ */
  {
    console.log(C.bold("\n【187】排队消息定时发送（queue-timer 域）"));
    const timerIpc = codeOnly(readFileSync(join(ROOT, "electron", "features", "queue-timer-ipc.ts"), "utf8"));
    // ① 主进程：定时器本体必须在主进程（渲染层 setTimeout 会被 Chromium 隐藏节流），set 前幂等清理
    // ⛔ 10-03 改插件形态（P0 容器）：注册走 `inject: ["ipc"]` 注入的 ipcHost，不再直接 `ipcMain.handle`。
    //    **断言跟着搬**：锚点换成新形态，但"两个通道都必须注册、且卸载要能摘掉"这条不变量不变。
    (/ipcHost\.handle\("queue-timer:set"/.test(timerIpc) && /ipcHost\.handle\("queue-timer:cancel"/.test(timerIpc)
      && /inject: \["ipc"\]/.test(timerIpc) && /ctx\.effect\(/.test(timerIpc) ? ok : fail)(
      "【187】主进程注册 queue-timer:set / queue-timer:cancel 两个 handler（经容器注入 ipcHost），且卸载可摘"
    );
    (/broadcastToAll\("queue-timer:due", \{ threadId, queuedSubmissionId: id \}\)/.test(timerIpc) && /timers\.delete\(id\);/.test(timerIpc) ? ok : fail)(
      "【187】到点只广播 queue-timer:due、不直接调引擎（启动/钉顶/429 兜底/toast 全在渲染层），广播前消费掉条目（一次性）"
    );
    (/clearTimer\(id\);\s*\n\s*const delay = Math\.max\(0, runAt - Date\.now\(\)\)/.test(timerIpc) ? ok : fail)(
      "【187】set 前先 clearTimer（同一条重复设定时 = 覆盖而不是叠两个 setTimeout）"
    );
    // ② preload：due 订阅 + 类型面
    const preload187 = codeOnly(readFileSync(join(ROOT, "electron", "preload.ts"), "utf8"));
    (/__on\("queue-timer:due"/.test(preload187) ? ok : fail)("【187】preload 手写 onQueueTimerDue 订阅（事件不走 manifest）");
    (/onQueueTimerDue\(listener: \(event: \{ threadId: string; queuedSubmissionId: string \}\) => void\): \(\) => void;/.test(typesSrc) ? ok : fail)(
      "【187】vite-env.d.ts 声明 onQueueTimerDue（渲染层类型面）"
    );
    // ③ 渲染层落点：due 处理按 threadId 定位（⛔ 不认 bag.queue/bag.thread —— 到点的会话可能不是当前会话）
    const appUi = readAppUi();
    const part04c2 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part04", "03-seg", "02-browser-queue-settings.tsx"), "utf8");
    (/const list = await window\.codex\.request\("thread\/queue\/list", \{ threadId, limit: 100 \}\)/.test(part04c2) && /if \(!entry\) return;/.test(part04c2) ? ok : fail)(
      "【187】到点先以引擎队列为准确认条目还在（被删/已被启动 ⇒ 定时自然失效）"
    );
    (/const busy = bag\.runningThreadIdsRef\.current\.has\(threadId\);/.test(part04c2) && /queuedSubmissionIds: \[id, \.\.\.rest\]/.test(part04c2) ? ok : fail)(
      "【187】会话忙 ⇒ 这条 reorder 到队头交给既有的回合结束 auto-start（定时只改时机，不改变排队不打断的约定）"
    );
    (/thread\/queue\/start", \{ threadId, queuedSubmissionId: id \}/.test(part04c2) && /isQueueAlreadyStartedError\(message\)/.test(part04c2) ? ok : fail)(
      "【187】会话空闲 ⇒ thread/queue/start 直接启动 + 引擎竞态（already started）按成功静默"
    );
    (/bag\.armRetryForQueueRelease\(threadId, entry\.input\)/.test(part04c2) && /bag\.armPinForReleasedQueue\(threadId, "queue-timer"\)/.test(part04c2) ? ok : fail)(
      "【187】定时释放与「立即」同待遇：钉顶意图 + 429 兜底都要挂上"
    );
    (/void window\.codex\.queueTimerCancel\(\{ queuedSubmissionId: id \}\)/.test(codeOnly(part04c2).split("async function deleteQueued")[1]?.split("async function reorderQueued")[0] ?? "") ? ok : fail)(
      "【187】删除排队消息时同步取消它的定时（衍生状态一起撤，不能只靠到点 due 兜底）"
    );
    // ④ UI 入口
    const queueUi = readFileSync(join(ROOT, "src", "features", "session-queue", "SessionQueue.tsx"), "utf8");
    (/TIMER_PRESET_MINUTES = \[5, 15, 30, 60\]/.test(queueUi) && /取消定时/.test(queueUi) && /type="datetime-local"/.test(queueUi) ? ok : fail)(
      "【187】条目有定时按钮：预设相对时间 + 自定义时间（datetime-local）+ 取消定时"
    );
    (queueUi.includes("window.prompt") ? fail("【187】定时输入不许用 window.prompt（Electron 不支持，实测抛错）") : ok)(
      "【187】定时输入用自建弹层（window.prompt 在 Electron 不可用）"
    );
    const composer187 = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "03-composer.tsx"), "utf8");
    (composer187.includes("timers={queueTimers[thread.id] ?? {}}") && composer187.includes("void setQueuedTimer(thread.id, entry.id, runAt)") ? ok : fail)(
      "【187】composer 把当前会话的定时表传进 QueuedMessageList（徽标渲染的数据面）"
    );
    (/\.queued-timer-menu \{/.test(readStyles()) ? ok : fail)("【187】定时弹层样式已接入（15-queued-messages.css）");
    // ⛔⛔ 09-28 启动崩溃复盘：queueTimers 家族在 bag-types 有声明、tsc/check-bag-types 双绿，
    //    但 part04c2 里 **bag.x = x 镜像赋值行整批漏写** ⇒ 运行时 bag.queueTimers undefined，
    //    对账 effect 挂载即读 undefined[threadId]（uuid 正是 thread.id）⇒ 整个渲染层崩。
    //    判据 = 每个 bag 家族名字的**赋值行**必须存在（类型声明在≠接线在）。
    const part04c2b = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part04", "03-seg", "02-browser-queue-settings.tsx"), "utf8");
    const bagBindings = ["bag.queueTimers =", "bag.setQueueTimers =", "bag.queueTimersLoadedRef =", "bag.persistQueueTimers =", "bag.setQueuedTimer =", "bag.releaseQueuedTimerDue ="];
    (bagBindings.every((binding) => part04c2b.includes(binding)) ? ok : fail)(
      "【187】queueTimers 家族 6 个名字的 bag 镜像赋值行全部在位（缺一个 = 运行时 undefined = 启动崩）"
    );
  }

}
}

{
if (!existsSync(join(ROOT, "src", "features", "team-office", "office-assets.ts"))) {
    /* ⛔⛔ 同上一类：本组断言的是 v18（Kenney CC0 资产版）实现，v19 已换成像素素材版
       ⇒ 文件不在、整组空跑。⛔ 不再静默跳过。 */
    console.log("  ! 【231】断言对象 office-assets.ts 是 v18 实现、v19 已换 ⇒ 本组跳过（⛔ 空跑=假绿，待重写）");
  } else
  {
    const taDir = join(ROOT, "src", "features", "team-office");
    /* ① 资产授权声明：CC0 + 可商用（⛔ 资产来源换成人人无许可的包时必须在这里显红） */
    const assetsSrc = readFileSync(join(taDir, "office-assets.ts"), "utf8");
    (assetsSrc.includes("CC0") && /(commercial|可商用)/.test(assetsSrc) ? ok : fail)(
      "【231】资产索引声明 CC0 + 可商用（换源必须同步声明）"
    );
    /* ② 索引与磁盘**逐个数对账**（索引漂移 = 运行时静默缺件） */
    const fDir = join(taDir, "assets", "kenney", "furniture");
    const pDir = join(taDir, "assets", "kenney", "persons");
    const fCount = readdirSync(fDir).filter((x) => x.endsWith(".png")).length;
    const pCount = readdirSync(pDir).filter((x) => x.endsWith(".png")).length;
    const fRows = (assetsSrc.match(/^  "\S+": f_\S+,$/gm) || []).length;
    const pRows = (assetsSrc.match(/^  "\S+": p_\S+,$/gm) || []).length;
    (fRows === fCount ? ok : fail)(`【231】家具索引数与磁盘一致（${fRows}/${fCount}）`);
    (pRows === pCount ? ok : fail)(`【231】角色索引数与磁盘一致（${pRows}/${pCount}）`);
    /* ③ 资产索引**由生成器产出**（手改会被覆盖；缺生成器 = 下一个人不知道怎么加件） */
    (existsSync(join(ROOT, ".workbuddy", "tmp", "gen-art-kenney.mjs")) ? ok : warn)(
      "【231】资产索引生成器在位（.workbuddy/tmp/gen-art-kenney.mjs）"
    );
    /* ④ 布局单一真相源：格坐标只在 office-scene.ts（渲染层出现 isoPoint(数字) 就是漂移） */
    const sceneSrc = readFileSync(join(taDir, "office-scene.ts"), "utf8");
    const canvasSrc = readFileSync(join(taDir, "OfficeCanvas.tsx"), "utf8");
    (sceneSrc.includes("export const DESKS") && sceneSrc.includes("export const PROPS") ? ok : fail)(
      "【231】工位与静物清单收在 office-scene.ts（单一真相源）"
    );
    (!/\{\s*u:\s*[\d.]+,\s*v:\s*[\d.]+/.test(canvasSrc) ? ok : fail)(
      "【231】渲染层不内联工位/静物布局字面量（一律从 office-scene 取）"
    );
    /* ⑤ 等距资产**不做纵深缩放**（⛔ 缩了桌腿与地板格子就错位 —— v9~v17 的 depthScale 必须不在） */
    (!canvasSrc.includes("depthScale") ? ok : fail)("【231】等距渲染不含 depthScale（缩放会破坏格对齐）");
    /* ⑥ 角色必须在桌子**近端**（v + 正值）：放远端会被桌+显示器整块盖住（实测全看不见） */
    (/isoPoint\(d\.u[^)]*d\.v \+ [\d.]+/.test(canvasSrc) ? ok : fail)(
      "【231】角色/椅子放桌子近端（v + 正值；远端会被桌子挡住）"
    );
    /* ⑦ Pixi v8 必须先 Assets.load 再建场景（⛔ Texture.from(未加载 url) 返回空纹理 = 一片白点） */
    (canvasSrc.includes("await preloadOfficeArt()") ? ok : fail)(
      "【231】资产先预加载再建场景（v8 的 Texture.from 对未加载 URL 返回空纹理）"
    );
    /* ⑧ 入口链路 + bag 镜像赋值（⛔ 09-28 启动崩的形态：类型声明在、赋值行缺） */
    const tlSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "01-timeline.tsx"), "utf8");
    const appViewSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView.tsx"), "utf8");
    const part02Src = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part02", "03-thread-switch-update", "02-update-ui-settings.tsx"), "utf8");
    (tlSrc.includes("onOpenOffice={() => setCompanyPreviewTeamId(railTeam.teamId)}") ? ok : fail)(
      "【231】成员流转轨的「办公室」按钮接到预览状态"
    );
    (appViewSrc.includes("<TeamOfficePreview") && appViewSrc.includes("teamId={app.companyPreviewTeamId}") ? ok : fail)(
      "【231】预览浮层挂在 AppView（显式 props）"
    );
    (part02Src.includes("bag.companyPreviewTeamId =") && part02Src.includes("bag.setCompanyPreviewTeamId =") ? ok : fail)(
      "【231】bag 镜像赋值两行齐（缺一行 = 运行时 undefined）"
    );
    /* ⑨ CSS 三前缀同源 + 入口引用 */
    (existsSync(join(ROOT, "src", "styles", "20-team-office.css")) && readFileSync(join(ROOT, "src", "styles.css"), "utf8").includes("./styles/20-team-office") ? ok : fail)(
      "【231】办公室样式接入 styles.css（20-team-office.css）"
    );
  }
}
}
