# 验证与测试（TESTING）

本项目的自动化验证分两层，**目的只有一个：改完代码后不用手点一遍**。

## 〇、验收门槛（硬性要求）

**本项目任何源码改动，一律以「自动验收全绿」为完成标准。禁止「我改完了，你自己点一下试试」。**

```bash
npm run verify   # = npm run check && npm run e2e，退出码 0 才算完成
```

- **只跑一半不算验收**：`check` 过但 `e2e` 没过 = 没完成，不许提交。
- **改了哪个模块，就给哪个模块补场景**：在 `scripts/e2e/scenarios/` 加/改场景（`npm run e2e` 不带参数就是跑**全部**场景，新场景自动进门槛），或给 `check-preflight.mjs` 加检查项。不要写一次性脚本跑完就丢——09-06 那批 `verify-*.mjs` 全员消失就是这么来的。
- **新断言的正确性要当场反证一次**：把修复临时改回去，确认这条断言真的会红。不做这一步的断言，很可能只是永远绿的摆设——尤其「没生效」类的 bug。（本项目实测过两次：`model-scope` 步骤③/⑤ 会因「全局永远赢」变红，步骤④ 会因「只认会话记录」变红。）
- **GUI 起不来时**最低跑 `check`（离线可用），并在提交信息里写明 `e2e` 未跑的原因。

### Codex 引擎自己怎么跑

引擎跑在应用体内，而 `e2e` 会再拉起一个**隔离实例**，两者不冲突。实测依据：单实例锁（`electron/main.ts:1344`）按 `userData` 隔离，E2E 用临时 profile，两实例完全独立并存——A 窗口里写的 `window.__PROBE_TAG__` 在 B 里读不到，两个 electron 进程都存活。

```bash
# 推荐：随包 node，不依赖 npm
resources/tools/node/node.exe scripts/e2e/run.mjs            # 全部场景
resources/tools/node/node.exe scripts/e2e/run.mjs smoke      # 指定场景
resources/tools/node/node.exe scripts/e2e/run.mjs --list     # 列出场景

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

**不带参数 = 跑 `scripts/e2e/scenarios/` 下的全部场景**（验收门槛必须覆盖所有回归场景，否则新写的场景只是摆设）；指定名字则只跑那几个：`npm run e2e -- smoke model-scope`。

### 原理

不依赖 Playwright/Puppeteer，用的是应用**主进程自带**的两个测试开关（`electron/main.ts:60` / `:65`）：

```
CODEX_HARNESS_USER_DATA   → 把 userData 重定向到临时目录（完全隔离，绝不碰你的真实会话/配置）
CODEX_HARNESS_DEBUG_PORT  → 打开 CDP 调试端口（端口随机取空闲端口，不撞你正在运行的应用）
```

框架在 `scripts/e2e/lib/harness.mjs`，只用项目已有的 `ws` 依赖。启动时它会先做一件事：

> **把真实模型配置灌进隔离 profile**——从真实 userData 复制 `custom-model.json`、`custom-models.json`、`codex-home/config.toml`、`codex-home/model-catalog.json`（可用 `CODEX_HARNESS_REAL_USER_DATA` 指定别的目录；复制时抹掉 `encryptedKey`，因为换 profile 后 safeStorage 密文解不开，只会刷一堆噪音）。
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
| `model-scope` | **每个会话独立选模型 + 切换真实生效**（43 断言）。真起引擎真建 **两个**会话：③ 有记录 → 打开时不被全局默认冲掉、且不改写全局；④ 没记录 → 落全局默认；⑤⑥ 用**真实模型菜单**点选（`custom:custom906:…`），断言在会话里选模型不动全局、在欢迎页选模型不动任何会话；⑦ **引擎侧取证**——真发一条消息，从 rollout 读 `turn_context.model` / `thread_settings_applied`，断言 A 的回合真跑 A 选的模型、B 真跑 B 选的模型、两边互不追加回合 |

### 写新场景

在 `scripts/e2e/scenarios/` 下加一个 `.mjs`，导出一个 `steps` 数组即可（文件名 = 场景名）：

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
| `h.realConfig` | `{ ok, src, copied }`：真实模型配置灌入结果。**模型类场景必须先断言 `ok`**，否则结论不可信 |
| `h.engineModelOf(threadId)` | **引擎侧取证**：读该会话 rollout，返回 `{ file, turns, turnModel, turnModels, settingsModel, provider }`。`turnModel` = 最新一回合 `turn_context.model`（引擎**真正跑**的模型）；`settingsModel` = `thread_settings_applied` 的会话级设置。判定「切换有没有真实生效」只认它——localStorage / UI 都只是意图 |

**三条写场景的纪律：**

1. **断言要有前置条件**——先断言「弹窗此刻是关的」，再点开、再断言「打开了」。否则上一步残留的弹窗会让这一步**假通过**（这个坑真的踩过）。
2. **每步自收尾**——步骤结束时把打开的面板关掉，别把状态留给下一步。
3. **「生效没生效」必须查到引擎侧**——涉及模型/权限这类**下发到引擎**的开关，只断言 localStorage 或 UI 文案是不够的（改错了照样绿）。要么读 rollout（`h.engineModelOf`），要么读引擎 RPC 的回带值。反面教材：`smoke` 里那条「输入框底部「模型」档」曾按**占位文案**断言，profile 一带真实模型就假红——现在改成按 `title` 属性判定。

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
| 想跑完不关应用 | `npm run e2e -- smoke --keep` |

---

## 三、其它回归脚本（保留的）

| 脚本 | 用途 |
|---|---|
| `npm run verify:reasoning` | 推理内容传输链路 |
| `npm run verify:image-plugin` | 内置媒体插件 |
| `npm run verify:packaged-tools` | 打包后工具完整性（需已打包） |

> 历史的 `verify:turnfold` / `verify:userrefs` / `verify:memory-layers` 等一批脚本在 09-06 清理批次中已删除，`package.json` 里的死条目在 09-11 一并清掉——**现在每条 npm script 都真实可跑**。新增验证请走 `scripts/e2e/` 场景或 `check-preflight.mjs` 检查项。
