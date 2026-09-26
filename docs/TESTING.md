# 验证与测试（TESTING）

本项目的自动化验证分两层，**目的只有一个：改完代码后不用手点一遍**。

## 〇、验收门槛（硬性要求）

**本项目任何源码改动，一律以「自动验收全绿」为完成标准。禁止「我改完了，你自己点一下试试」。**

```bash
npm run verify   # = npm run check && npm run e2e，退出码 0 才算完成
```

- **只跑一半不算验收**：`check` 过但 `e2e` 没过 = 没完成，不许提交。
- **改了哪个模块，就给它补判据**：⛔ 场景目录 `scripts/e2e/scenarios/` 与 runner `scripts/e2e/run.mjs` **已按用户要求删除**（守卫【7】不许它们回来），别再往那儿加东西。现在是两条路：① 能在离线静态验证的 → 加进 `scripts/guards/` 下**对应域**的文件（⛔ 不是 `scripts/check-preflight.mjs`，它只是个 ~20 行的聚合器，其头注释明确写着「加新守卫请改 guards/ 下对应域的文件」）；② 需要真链路证据的 → 在 `scripts/accept.mjs` 加一项并**登记 `ROUND_OF` 轮次**。不要写一次性脚本跑完就丢——09-06 那批 `verify-*.mjs` 全员消失就是这么来的。
- **不做反证**（用户 09-19 明令：「把你的反证流程删了，以后不需要再反证了」）：断言写完直接跑正式那轮。
  历史上「把修复临时改回去确认会红」的步骤**已取消**；省下的时间用于覆盖更多真实场景。
- **GUI 起不来时**最低跑 `check`（离线可用），并在提交信息里写明 `e2e` 未跑的原因。

### Codex 引擎自己怎么跑

引擎跑在应用体内，而 `e2e` 会再拉起一个**隔离实例**，两者不冲突。实测依据：单实例锁（`electron/main.ts:1344`）按 `userData` 隔离，E2E 用临时 profile，两实例完全独立并存——A 窗口里写的 `window.__PROBE_TAG__` 在 B 里读不到，两个 electron 进程都存活。

```bash
# 推荐：随包 node，不依赖 npm
resources/tools/node/node.exe scripts/accept.mjs              # 跑「最新一轮」全部验收项（约 20s）
resources/tools/node/node.exe scripts/accept.mjs --only greet  # 只跑 id 含 greet 的项
resources/tools/node/node.exe scripts/accept.mjs --list        # 列出全部项并标注所属轮次
resources/tools/node/node.exe scripts/accept.mjs --all         # 全量（发版闸门，平时别用）

# 有 node 在 PATH 时等价于
npm run check && npm run e2e
```

注意 **E2E 跑的是构建产物**（`dist/` + `dist-electron/`）；只跑 `e2e` 而不跑 `check` 时，务必先确保产物不过期（`check` 含构建，会替你保证这点）。

---

| 命令 | 层级 | 需要 GUI | 耗时 | 能发现什么 |
|---|---|---|---|---|
| `npm run check` | 离线预检 | 否 | ~1 分钟（含构建） | 编译不过、产物没重建、IPC 桥接与类型不一致、CSS 类没规则、**纯函数逻辑跑偏** |
| `npm run e2e` | 应用冒烟（**全部场景**） | 是（自动拉起，不用你操作） | ~22 秒 | 应用能不能起来、主界面有没有破相、关键交互与关键判定还在不在 |
| `npm run e2e -- smoke` | 只跑指定场景 | 是 | ~11 秒 | 同上，单场景 |
| `npm run e2e -- --list` | 列出全部场景 | 否 | 瞬时 | —— |

改动完成的标准流程：

```bash
npm run check        # 离线全绿
npm run e2e          # UI 冒烟全绿，去 .e2e-artifacts/shots/ 扫一眼截图
```

---

## 一、`npm run check` —— 离线预检

`= npm run build && node scripts/check-preflight.mjs`。不需要图形界面，最坏情况也能跑。

**检查项：**

1. **构建产物存在 + 新鲜度**
   拿 `src/`、`electron/` 里最新的源码 mtime 跟 `dist/`、`dist-electron/` 的产物 mtime 比。**源码比产物新 = 你改了没重建** —— 「我改的东西没生效」九成是这个，这一条直接把它揪出来。
2. **IPC 通道一致性**（`electron/main.ts` ↔ `electron/preload.ts` ↔ `src/vite-env.d.ts`）
   - `preload` 发出、主进程没有 handler 的通道 → **硬失败**（点了没反应就是这么来的）
   - `window.codex` 上渲染层**真正在调**、但 `vite-env.d.ts` 没声明的方法 → **硬失败**
   - preload 暴露但渲染层从未调用、类型也没声明 → 告警（疑似冗余桥接，可清理）
   - 类型声明了但 preload 没暴露 → 告警（疑似残留声明）
3. **CSS 类覆盖**（仅告警）
   扫 `src/` 里 `className="..."` 的**静态字面量**，看 `src/styles.css` 有没有对应规则。动态拼接的类（含 `${}`）不参与。
   告警不等于 bug——父选择器承载、动态变体都会命中，需人眼过一遍。判定口径：动态模板类先 grep `.x-xxx` 变体；单类且无任何兜底才是真缺口。
4. **纯逻辑行为断言**
   `src/lib/*.mjs` 这类**零依赖纯函数**（node 能直接 `import`，不用转译）在预检里跑真实实现的行为断言，边界一次定死。目前只有 `src/lib/model-scope.mjs`（模型选择的作用域），另带两条**结构守卫**：① `App.tsx` 里 `openThread` 的模型回填必须走 `resolveThreadModel`；② `default-model` 全仓库**只许有一处写入**（统一入口 `applyGlobalModelChoice`）且它必须按 `shouldSyncOpenThread` 决定要不要同步当前会话——散落写入会绕过「有会话才同步、其它会话一律不动」的作用域规则，这正是 09-11 返工的根因。
   > 这类逻辑放 `.mjs`（纯实现）+ `.d.mts`（类型）是因为 tsconfig 关着 `allowJs`：渲染层 `import` 有类型，预检 `import` 能直接跑，一份实现两处用，不复制粘贴。

**退出码**：0 = 通过（告警不算失败），1 = 有硬失败。

---

## 二、`npm run e2e` —— 应用冒烟（全场景）

自动拉起**已构建**的应用（跑之前必须先构建，脚本会检查），经 CDP 驱动渲染层跑剧本，逐步截图。

**不带参数 = 只跑 `LATEST_ROUND` 那一轮**（不是全部！）—— `ROUND_OF` 登记每项所属轮次，新增项必须登记否则默认跑不到。要全量必须显式 `--all`（仅发版/里程碑/跨模块改动时用，且先在提交信息里说明理由）。

### 原理

不依赖 Playwright/Puppeteer，用的是应用**主进程自带**的两个测试开关（⛔ 别写行号 —— 它们已经搬过一次，用符号 grep `CODEX_HARNESS_USER_DATA` / `CODEX_HARNESS_DEBUG_PORT` 定位）：

```
CODEX_HARNESS_USER_DATA   → 把 userData 重定向到临时目录（完全隔离，绝不碰你的真实会话/配置）
CODEX_HARNESS_DEBUG_PORT  → 打开 CDP 调试端口（端口随机取空闲端口，不撞你正在运行的应用）
```

框架在 `scripts/e2e/lib/harness.mjs`，只用项目已有的 `ws` 依赖。启动时它会先做一件事：

> **把真实模型配置灌进隔离 profile**——从真实 userData 复制 `custom-model.json`、`custom-models.json`、`codex-home/config.toml`、`codex-home/model-catalog.json`，**外加 Chromium 的 `Local State`，并保留 `encryptedKey` 密钥密文**（可用 `CODEX_HARNESS_REAL_USER_DATA` 指定别的目录）。保留 Key 是为了让「切换生效」的断言打到**真实后端**（真实网关真的回包才算数）；Key 是本机 safeStorage 密文，必须配合同机同用户的 `Local State`（DPAPI 密钥材料）才解得开——早先「抹掉密钥」的做法只能测到「引擎接了参数」那一层，用户指正过不算数。只想跑无 Key 的纯逻辑断言时设 `CODEX_HARNESS_KEEP_SECRETS=0`。密文只落在系统临时目录、不出这台机器、不进 git。
>
> **为什么必须**：隔离 profile 若是白纸，模型选择器里一个模型都没有，「每个会话独立选模型」「切换到底有没有生效」这类断言就只能摆弄假的 model id，**等于没测**。带上真配置，场景才能真的点开菜单、真的选中 `custom:custom906:deepseek-v4-flash`。harness 找不到真实配置时会打黄字警告——看到它就意味着模型类结论不可信。

### 产出

- 终端：逐步断言结果 + 每步耗时；多场景时最后附一行各场景结果汇总
- `.e2e-artifacts/shots/<场景名>-NN-名称.png`：**每步一张截图**，失败时额外存一张「失败-步骤名.png」
  （文件名带场景前缀，多场景共用一个目录也不会互相覆盖）
- `.e2e-artifacts/` 已进 `.gitignore`

**这个截图目录就是替代「你手动点一遍」的东西**——跑完扫一眼，破相立刻看得见。

### 现有场景

| 场景 | 覆盖 |
|---|---|
| `smoke` | 引导页 → 跳过 → 主界面骨架（标题栏/侧栏/输入框/发送键）→ 侧栏六项 → 输入框读写 → `#` 技能面板 → `/` 命令面板 → 技能中心开关 → 右栏展开 → 设置弹窗开关 + **焦点归还** → 渲染层无 console.error |
| `model-scope` | **每个会话独立选模型 + 切换真实生效**（60 断言）。真起引擎真建 **两个**会话：③ 有记录 → 打开时不被全局默认冲掉、且不改写全局；④ 没记录 → 落全局默认；⑤⑥ 用**真实模型菜单**点选（`custom:custom906:…`），断言在会话里选模型不动全局、在欢迎页选模型不动任何会话；⑦ **引擎侧 + 后端取证**——真发一条消息，从 rollout 读 `turn_context.model` / `thread_settings_applied` / `token_usage_record.response_id`，断言 A 真跑 A 的模型、B 真跑 B 的模型、两边互不追加回合，**且每一轮都是真实网关回包**（实测 output=159 / 3 tokens）；⑦bis 同一会话换下拉 → 下一轮**立刻**跑新模型 + `custom-model.json` 与 `config.toml` 顶层同步；⑦ter 打开另一个会话 → 档案对齐该会话的模型 |

### 写新场景

在 `scripts/accept.mjs` 的 `CHECKS` 里加一项 `{ id, name, run(h) }`，并在 `ROUND_OF` 登记轮次（⛔ 旧的场景目录已删除，不要再新建）：

```js
export const description = "一句话说明这个场景管什么";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const steps = [
  {
    name: "① 某某功能可用",
    run: async (h) => {
      await h.clickByText("某按钮");
      await h.waitFor(`!!document.querySelector(".某元素")`, { label: "面板出现" });
      h.check("面板打开", true);
      await h.screenshot("某功能");
    },
  },
];
```

**harness 提供的 API：**

| 方法 | 说明 |
|---|---|
| `h.eval(expr)` | 在页面上下文求值，返回可序列化结果 |
| `h.waitFor(expr, {label, timeoutMs})` | 轮询直到表达式为真 |
| `h.exists(sel)` / `h.count(sel)` / `h.text(sel)` / `h.bodyText(n)` | 元素查询 |
| `h.click(sel)` | 原生点击（React onClick 有效） |
| `h.clickByText(text)` | 按可见文本点（自动取最内层匹配元素） |
| `h.clickByTitle(title)` | 按 `title` / `aria-label` 点（本项目大量按钮只有 title） |
| `h.reload()` | 重载渲染层（只刷 renderer，主进程不动）——验证「启动时」逻辑用 |
| `h.typeInto(sel, text)` | 用 CDP 真实输入（对 `contenteditable` 最可靠） |
| `h.clearInput(sel)` | 清空输入框 |
| `h.pressKey(key)` | 派发按键（如 `"Escape"`） |
| `h.screenshot(label)` | 截图落盘，返回路径 |
| `h.check(label, cond, detail)` | 记一条断言（不中断，最后统一汇总） |
| `h.realConfig` | `{ ok, src, copied }`：真实模型配置灌入结果（`copied` 里应含 `Local State`）。**模型类场景必须先断言 `ok`，并断言 `custom-model.json` 里 `encryptedKey` 仍在**——否则「真实后端回包」这类结论不成立 |
| `h.engineModelOf(threadId)` | **引擎侧 + 后端取证**：读该会话 rollout，返回 `{ file, turns, turnModel, turnModels, settingsModel, provider, backendResponses, errors }`。`turnModel` = 最新一回合 `turn_context.model`（引擎**真正跑**的模型）；`settingsModel` = `thread_settings_applied` 的会话级设置；`backendResponses` = `token_usage_record`（带网关 `response_id` 与 `usage.output_tokens`，**真实后端回包的硬证据**）；`errors` = 后端/流错误事件。判定「切换有没有真实生效」只认它——localStorage / UI 都只是意图 |
| env `CODEX_HARNESS_KEEP_SECRETS` | 设 `0` → 灌配置时抹掉 `encryptedKey`（跑不需要真实后端的纯逻辑断言时用）。默认不设 = **保留真 Key + `Local State`**，断言打到真实后端 |

**三条写场景的纪律：**

1. **断言要有前置条件**——先断言「弹窗此刻是关的」，再点开、再断言「打开了」。否则上一步残留的弹窗会让这一步**假通过**（这个坑真的踩过）。
2. **每步自收尾**——步骤结束时把打开的面板关掉，别把状态留给下一步。
3. **「生效没生效」必须查到引擎侧，并且要打到真实后端**——涉及模型/权限这类**下发到引擎**的开关，只断言 localStorage 或 UI 文案是不够的（改错了照样绿）。要么读 rollout（`h.engineModelOf`），要么读引擎 RPC 的回带值。**再往前一步**：还要证明**真实后端真的回了包**（09-11 用户指正「你这个没有拉起来真实后端测试」）——只证明「引擎接受了 model 参数」不算「切换真的生效」。判据是 rollout 里的 `token_usage_record.response_id`（即 `h.engineModelOf().backendResponses`）；出现 `error/stream_error/turn_failed` 就早停早红。反面教材：`smoke` 里那条「输入框底部「模型」档」曾按**占位文案**断言，profile 一带真实模型就假红——现在改成按 `title` 属性判定。

### 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `CDP 端口未就绪` | 应用启动失败。看报错里附的 Electron 输出尾部；沙箱/权限受限时属环境限制 |
| 启动即崩：`Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`，栈尾还打着 `Node.js vXX` | 环境里带着 `ELECTRON_RUN_AS_NODE`（自己就跑在 Electron 里的宿主终端会把这条传下来），Electron 被降级成纯 node 跑主进程。框架已在 spawn 前 `delete` 掉这个变量；外部直接 `electron .` 复现时也要先 `unset` |
| `E2E 前置检查失败：构建产物缺失` | 先 `npm run build`（或 `npm run check`） |
| 页面请求被代理拦 | 框架已给子进程注入 `NO_PROXY=127.0.0.1,localhost`；本机环境有 `HTTP_PROXY` 时这条必须有 |
| 想造一个「能 resume 的会话」 | 引擎的 rollout 是**首回合**才落盘的：只 `thread/start` 的会话 `thread/resume` 报 `no rollout found`、`thread/list` 里也没有。先补一发 `turn/start` 把它坐实（见 `scenarios/model-scope.mjs` 步骤②） |
| `未找到 page target` | `/json/version`（浏览器端点）先就绪、page target 后注册；带真实模型配置后启动更慢。框架已轮询 20s，仍失败就看报错里列出的 target 类型 |
| 模型选择器点不开 / 菜单里只有「更多设置…」 | 真实模型配置没灌进去（看开头的黄字警告），或 `custom-model.json` 缺失 |
| 黄字 `未找到真实模型配置` | 本机还没配置过供应商，或 userData 不在默认位置——用 `CODEX_HARNESS_REAL_USER_DATA=<目录>` 指定 |
| 步骤① 「按文本点击失败：暂时不登录，直接进入」 | 真实 Key 灌进去后 `customModel.hasKey=true`，兼容 effect 会自动跳过引导页进主界面，按钮已消失（⛔ 别引用 `App.tsx:7754` 这类行号，`App.tsx` 现在只有 12 行；用符号 grep `login-skipped` 定位）。步骤① 现在等的是「引导页**或**主界面」，两者都放行 |
| 断言「真实后端回了话」红、`后端响应 0 → 0` | 三种可能：① 灌配置时把 `encryptedKey` 抹掉了（看步骤① 的 `encryptedKey 已保留` 断言）；② 没复制 `Local State`，safeStorage 解不开；③ 网关侧问题（看 `errors` 里的 401 原文） |
| 断言「真实后端回了话」红、`encryptedKey 已保留` 也红 | 灌配置代码又被改回「抹密钥」了——检查 `seedRealModelConfig` 里 `CODEX_HARNESS_KEEP_SECRETS === "0"` 那个分支（默认必须**不**进） |
| 想跑完不关应用 | `npm run e2e -- smoke --keep` |

---

## 三、其它回归脚本（保留的）

| 脚本 | 用途 |
|---|---|
| `npm run verify:reasoning` | 推理内容传输链路 |
| `npm run verify:image-plugin` | 内置媒体插件 |
| `npm run verify:packaged-tools` | 打包后工具完整性（需已打包） |

> 历史的 `verify:turnfold` / `verify:userrefs` / `verify:memory-layers` 等一批脚本在 09-06 清理批次中已删除，`package.json` 里的死条目在 09-11 一并清掉——**现在每条 npm script 都真实可跑**。新增验证请走 `scripts/e2e/` 场景或 `check-preflight.mjs` 检查项。


---

> 以下由 AGENTS.md 于 2026-09-26 外置迁入（AGENTS.md 有注入上限，历史事故叙述与方法论长文移出）。

## 排查方法论（09-13 一整天弯路换来的，下一轮动手前先读）

1. **看到症状先别调阈值、别加条件**。先问一句：「**现在有几个东西在写同一份状态 / 同一根滚动条？**」这一天 6 次修复的真根因全部是两类 —— ①**多个 owner 抢同一个东西**（钉顶与跟随每 60px 互拉、`switchJumpRef` 被两处消费）；②**状态被提前/错位消费**（裸布尔被下一次任意渲染吃掉）。**阈值从来不是根因**，调阈值只是把互拉挪到另一个区间。
2. **先打点，再推理**。`window.__adbg` 一次 dump 出的时间线胜过半小时的代码推演：这一天每次"我觉得是这个原因"都猜错，每次打点都一击命中（`pin-fix{err:-65}` ↔ `follow-grow{+65}` 互拉、`clear-anchor{at:"switch-jump"}` 出现在**发送**时刻、`pad:622` 残留、`follow-grow` 全程不触发）。**加打点是第一动作，不是最后手段**；打点要带数字（top/gap/pad/err），不要只写"到这里了"。
3. **测试必须跑到事件真正结束**（用户原话：「每次测试消息都不看完，你能发现什么bug，总是运行中就杀应用」）。长回合的毛病只在后段暴露；采样截断 + 收尾杀应用 = 把最关键的证据扔掉，还会把"没跑完"误报成失败。
4. **判据不能用会随渲染状态变化的量**：折叠组收起时 `innerText` 是空串、`textContent` 才与折叠无关；侧栏按最近活动重排，**会话要用标题点、不能用行索引**（用索引测出来的"钉顶没了"有一半是点开了别的会话 → 假红）。判据要落在**语义主体**上（"正在跑的那个回合"），不要用整页总量。
5. **状态重置要挂在「动作」上，不能挂在「某条渲染分支」上**。曾经把锚定状态清零写在"切会话瞬时定位"分支里，那段一旦被任何条件挡掉，清零就跟着被跳过 → 留白残留一整屏、锚点指向别的会话。现在清零挂在 `openThread` 里，结构上不可能被跳过。
6. **文档与代码同轮更新**。过时文档会主动误导下一轮（旧版 AGENTS.md 详细描述了已被删除的 `anchorHeightBaselineRef` 增长量模型与 `byUs` 判据，这一天的弯路有一部分就是照着它走的）。**删掉实现就把对应文档段落标记作废或改写**，别让后来者读到一段"看起来很像现状"的历史。
7. **⛔ 不跑与本次改动无关的断言（用户 09-13 严令，第二次强调）**。原话：「能不能不要再跑旧的测试了，不要浪费我token啊…只能测试最新改动，给你说了几百遍」。
   - 每轮改完只跑 **`--only <与改动相关的 id>`**；判据是「**这条断言会不会因为这次改动而变红**」，不会就别跑。
   - 全量 `accept.mjs` 只用于**发版前 / 跨模块改动 / 用户明确要求**，且跑之前先说明为什么必须全量。
   - 改主进程/引擎/打包这类 CDP 测不到的模块 → **不要跑 accept**，改跑 `check`，并把可静态验证的部分补进预检守卫（【10】【11】就是为此存在的）。
   - 曾经一整天每轮都全量跑 57 项，其中绝大多数与本轮改动无关 —— 纯浪费用户时间和 token，**这是行为准则层面的硬约束，不是建议**。
8. **⛔ 改动范围纪律：只做「架构层设计缺陷」和「渲染层真 bug」，不许顺手改行为（用户 09-13 明令）**。
   原话：「设计缺陷是只架构层，渲染层的bug，你别给我乱改」。
   - **两类可动**：① **架构层设计缺陷** —— IPC 契约与错误传播、真相源数量、事件通道与背压、持久化原子性与迁移、模块边界与守卫、生命周期状态机；② **渲染层真 bug** —— 有可复现路径、能说清"用户看到什么错"的。
   - **不许动**：行为语义、权限边界、可见交互（不经用户确认就"收紧/放开"）。**教训**：我自作主张把 `fs:write` 限定到工作区，用户不得不叫停并回退（`7f0de22`）—— 安全收紧也是**产品决策**，先问再做。
   - **重构不算修复**：除非要动的那段代码本身就是缺陷（例如"两个 owner 抢同一份状态"），否则不要为了"更干净"去改它。
   - 动之前先回答两句：**这是架构缺陷还是渲染 bug？**、**这个改动会不会改变用户看得见的行为？** 第二问为"是"就先问用户。
9. **⛔ 功能完整性铁律（09-15 用户明令：「加功能必须考虑得比我多，不能只做表面」）。**
   一个对象被创建/接力/归档/删除时，它的**全部衍生状态**必须有明确去向——成员会话、
   渲染缓存、映射表（threadProviderRef / team-threads / thread-runtime）、复用键、备份分支、
   侧栏列表。做法：把这次动作当**状态机迁移**，穷举它触碰的每一份持久化状态并逐一回答
   「它去哪」；只实现用户说的那一步 = 半成品。09-14~15 三起事故全是这一类：接力后旧会话
   还在、删主会话后成员成孤儿、统一 id 后 config 出现重复段。修 bug 时同样要问：
   **同类场景还有哪些没覆盖？旧的引用还在不在？清理动作要不要级联？**

10. **⛔ 探针方法论（09-16 发版当天踩出来的三条，省下的是错误结论而不只是时间）**：
   - **Node 的 `https.request` 不读 `HTTP(S)_PROXY` 环境变量**（只有 `curl` 之类会读）。所以「清掉代理变量
     再直连」对 Node 探针**等于没清**，而直连 GitHub 在国内时通时不通 ⇒ 同一脚本这次 533KB、下次 0 字节，
     判据随机。**凡是测网络行为的断言，要么用本地 mock，要么走 curl。**
   - **外网不可当判据**：`downloadUpdate` 那类「跟随重定向」的行为，用真 GitHub 验证会被 ECONNRESET /
     0 字节干扰（还容易被误读成代码有问题）。**正解 = 本地 HTTPS mock**：openssl 自签证书（`-subj /CN=127.0.0.1`
     且 `-addext subjectAltName=IP:127.0.0.1`，否则 Node 不认）× `https.createServer` 一个
     `/redirect → 302 → /payload → 200`，进程内 `NODE_TLS_REJECT_UNAUTHORIZED=0` 放行自签。
     确定性判据 = **下载字节数 + 载荷 sha256 与源一致**；反证 = 摘掉重定向分支 → 必然报 `HTTP 302`。
   - **`(cond ? ok : fail)("消息")` 不能写成 `cond ? ok : fail("消息")`**：后者在 `cond` 为真时**根本不调用 `ok`**，
     于是该断言**一行都不打印、静默漏检**（我这两条新守卫第一版就是这样，预检 526 条"全绿"却查不到它们）。
     写完新守卫先确认**它在输出里出现了**。：临时 profile 每轮都是白纸 —— 侧栏零会话，「切会话重播 / 首轮不出字 / 会话一多互相拖慢」这类问题**只在有历史时才现形**，空目录里测等于没测（用户原话：「为啥你每次拉起来的应用都没有历史记录，那测试有什么意义呢」）。现在首次建 profile 时会把**真实 profile 的会话历史**（`codex-home/sessions/**`）搬进来，之后一轮轮叠加；断言「本轮数据」时用 `h._rolloutFiles({ since: h.launchedAt })`，别让历史文件把断言顶成假绿。profile 在 `.e2e-profile/<name>/`（已 gitignore，含真实对话内容与 Key 密文，**绝不入库**）；想重来就删目录，想重灌真实配置/历史用 `CODEX_HARNESS_RESEED=1`。

GUI 起不来时，最低限度跑 `check`（离线可用），并在提交信息里写明 `accept` 未跑的原因。手册见 `docs/TESTING.md`。


---

> 以下由 AGENTS.md 于 2026-09-26 外置迁入（写新验收项时才需要查的细节）。

## 验证基建实现细节（配合开头的「验收铁律」看）

- **E2E 靠主进程自带开关实现**：`CODEX_HARNESS_USER_DATA`（重定向 userData，完全隔离）+ `CODEX_HARNESS_DEBUG_PORT`（开 CDP 端口，端口随机取空闲）——⛔ **别写行号**（这两个开关已经搬过一次，原写的 `main.ts:60/:65` 当场失效）：用符号 grep `CODEX_HARNESS_USER_DATA` 定位。框架 `scripts/e2e/lib/harness.mjs` 零新依赖（复用 `ws`），**不要引入 Playwright/Puppeteer**。
- **测试实例的工作区 = 项目根目录**（09-11 用户定：以后拉 CDP 就用这个项目地址测）：应用从 `localStorage.workspace` 读工作区（⛔ 同样别写行号 —— 原写的 `App.tsx:5972` 已失效；用符号 grep `localStorage.getItem("workspace")` 定位，当前在 `src/features/app-state/parts/part01/01-session-drafts-voice.tsx`），而隔离 profile 是白纸 → 界面停在「尚未选择工作区」，部分路径下发送会被拦。harness 现在默认用 `Page.addScriptToEvaluateOnNewDocument` 把 `workspace` 注入成 `this.root`（项目根）**并重载一次**让注入先于页面脚本执行；需要「未选择工作区」空态的场景可传 `new ElectronHarness({ workspace: null })` 关掉。
- **离线预检**：`npm run check` = `build` + `scripts/check-preflight.mjs`。其中 IPC「方法面」解析用自写的括号深度扫描器（纯正则会被「同一行写多个方法 `a: …,  b: …`」和「类型里的 `name(...)` 括号被吃掉后参数名被误当方法名」骗到）。
- **现存验收项**：`scripts/accept.mjs` 里 26 项，按 `ROUND_OF` 登记轮次、`LATEST_ROUND` 指向当前轮（默认只跑那一轮）。⛔ **此处不再逐一列举** —— 早期版本在这里描述 `smoke` / `model-scope` 两个"场景"，而那两个脚本**早已删除**（连同 `scripts/e2e/scenarios/`，守卫【7】不许它们回来），留在文档里只会误导。要看待跑清单就 `node scripts/accept.mjs --list`，要看某一项做什么就直接读它的 `name` 与 `run(h)`。
- **引导页可能被跳过**：真实 Key 灌进去后 `customModel.hasKey=true`，兼容 effect 会自动进入主界面（写 `login-skipped`），所以任何"等引导页"的断言都要写成「引导页**或**主界面二选一」，不能硬等跳过按钮。⛔ 别再引用 `App.tsx:7754` 这类行号（`App.tsx` 现在只有 12 行）；用符号 grep `login-skipped` 定位。
- **环境坑（踩过）**：①环境里的 `HTTP_PROXY` 会把回环请求也代理走 → harness 已自动注入 `NO_PROXY=127.0.0.1,localhost`；②`ws` 库的 `on("message", (data) => …)` 首参是**原始数据**不是 `MessageEvent`；③`clickByText` 必须取**最内层**元素（按 innerText 长度升序），否则点到 wrapper 上；④`contenteditable` 用 CDP `Input.insertText` 输入，`[contenteditable="true"]` 匹配不到 `plaintext-only`；⑤**宿主带着 `ELECTRON_RUN_AS_NODE` 时 Electron 会被降级成纯 node 跑主进程**（启动即崩 `Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`，栈尾打 `Node.js vXX`）→ harness 在 spawn 前 `delete` 掉这个变量；⑥**引擎的 rollout 是首回合才落盘的**：只 `thread/start` 的会话 `thread/resume` 报 `no rollout found`、`thread/list` 里也不出现 → 想造「能 resume 的会话」必须补一发 `turn/start`（模型调用失败无妨，rollout 已落盘）；⑦宿主还会注入 `NODE_OPTIONS=--require …node-language-shim.cjs`（拦截子进程 fs 写入）——继承下去会让主进程写 userData 时 `EPERM`、启动链断掉（**窗口能开、引擎不 spawn、发消息零回复**）→ harness 也一并 `delete` 掉 `NODE_OPTIONS`（与 ⑤ 同源：都是宿主环境泄漏）；⑧**无 GPU 的机器 / CI 上 Chromium 的 GPU 子进程会反复起不来并最终 FATAL 自杀**（`GPU process isn't usable. Goodbye.`），表现为 e2e「CDP Runtime.enable 超时 / Target crashed」——实测连零项目代码的最小 Electron 应用也一样崩，**与本项目代码无关**；harness 已带 `CODEX_HARNESS_IN_PROCESS_GPU`（主进程据此 `appendSwitch("in-process-gpu")`，另附 `no-sandbox` 等，**仅测试实例生效**）绕开。
- **历史遗留**：`verify:turnfold`/`verify:userrefs`/`verify:memory-layers` 等一批 npm script 指向的文件早已删除（跑必 ENOENT），**09-11 已从 package.json 清理**；现存真脚本只有 `verify:reasoning` / `verify:image-plugin` / `verify:packaged-tools`。新增验证请走 e2e 场景或 preflight 检查项，**别再散落一次性 `.mjs`**。
- 手册见 `docs/TESTING.md`。
