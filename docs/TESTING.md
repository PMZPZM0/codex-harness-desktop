# 验证与测试（TESTING）

本项目的自动化验证分两层，**目的只有一个：改完代码后不用手点一遍**。

## 〇、验收门槛（硬性要求）

**本项目任何源码改动，一律以「自动验收全绿」为完成标准。禁止「我改完了，你自己点一下试试」。**

```bash
npm run verify   # = npm run check && npm run e2e，退出码 0 才算完成
```

- **只跑一半不算验收**：`check` 过但 `e2e` 没过 = 没完成，不许提交。
- **改了哪个模块，就给哪个模块补场景**：在 `scripts/e2e/scenarios/` 加/改场景，让这次验证沉淀成下次的自动回归。不要写一次性脚本跑完就丢——09-06 那批 `verify-*.mjs` 全员消失就是这么来的。
- **GUI 起不来时**最低跑 `check`（离线可用），并在提交信息里写明 `e2e` 未跑的原因。

### Codex 引擎自己怎么跑

引擎跑在应用体内，而 `e2e` 会再拉起一个**隔离实例**，两者不冲突。实测依据：单实例锁（`electron/main.ts:1344`）按 `userData` 隔离，E2E 用临时 profile，两实例完全独立并存——A 窗口里写的 `window.__PROBE_TAG__` 在 B 里读不到，两个 electron 进程都存活。

```bash
# 推荐：随包 node，不依赖 npm
resources/tools/node/node.exe scripts/e2e/run.mjs smoke
resources/tools/node/node.exe scripts/e2e/run.mjs --list     # 列出场景

# 有 node 在 PATH 时等价于
npm run check && npm run e2e
```

注意 **E2E 跑的是构建产物**（`dist/` + `dist-electron/`）；只跑 `e2e` 而不跑 `check` 时，务必先确保产物不过期（`check` 含构建，会替你保证这点）。

---

| 命令 | 层级 | 需要 GUI | 耗时 | 能发现什么 |
|---|---|---|---|---|
| `npm run check` | 离线预检 | 否 | ~1 分钟（含构建） | 编译不过、产物没重建、IPC 桥接与类型不一致、CSS 类没规则 |
| `npm run e2e` | 应用冒烟 | 是（自动拉起，不用你操作） | ~11 秒 | 应用能不能起来、主界面有没有破相、关键交互还在不在 |
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

**退出码**：0 = 通过（告警不算失败），1 = 有硬失败。

---

## 二、`npm run e2e` —— 应用冒烟

自动拉起**已构建**的应用（跑之前必须先构建，脚本会检查），经 CDP 驱动渲染层跑剧本，逐步截图。

### 原理

不依赖 Playwright/Puppeteer，用的是应用**主进程自带**的两个测试开关（`electron/main.ts:60` / `:65`）：

```
CODEX_HARNESS_USER_DATA   → 把 userData 重定向到临时目录（完全隔离，绝不碰你的真实会话/配置）
CODEX_HARNESS_DEBUG_PORT  → 打开 CDP 调试端口（端口随机取空闲端口，不撞你正在运行的应用）
```

框架在 `scripts/e2e/lib/harness.mjs`，只用项目已有的 `ws` 依赖。

### 产出

- 终端：逐步断言结果 + 每步耗时
- `.e2e-artifacts/shots/NN-名称.png`：**每步一张截图**，失败时额外存一张「失败-步骤名.png」
- `.e2e-artifacts/` 已进 `.gitignore`

**这个截图目录就是替代「你手动点一遍」的东西**——跑完扫一眼，破相立刻看得见。

### 现有场景

| 场景 | 覆盖 |
|---|---|
| `smoke` | 引导页 → 跳过 → 主界面骨架（标题栏/侧栏/输入框/发送键）→ 侧栏六项 → 输入框读写 → `#` 技能面板 → `/` 命令面板 → 技能中心开关 → 右栏展开 → 设置弹窗开关 + **焦点归还** → 渲染层无 console.error |

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
| `h.typeInto(sel, text)` | 用 CDP 真实输入（对 `contenteditable` 最可靠） |
| `h.clearInput(sel)` | 清空输入框 |
| `h.pressKey(key)` | 派发按键（如 `"Escape"`） |
| `h.screenshot(label)` | 截图落盘，返回路径 |
| `h.check(label, cond, detail)` | 记一条断言（不中断，最后统一汇总） |

**两条写场景的纪律：**

1. **断言要有前置条件**——先断言「弹窗此刻是关的」，再点开、再断言「打开了」。否则上一步残留的弹窗会让这一步**假通过**（这个坑真的踩过）。
2. **每步自收尾**——步骤结束时把打开的面板关掉，别把状态留给下一步。

### 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `CDP 端口未就绪` | 应用启动失败。看报错里附的 Electron 输出尾部；沙箱/权限受限时属环境限制 |
| `E2E 前置检查失败：构建产物缺失` | 先 `npm run build`（或 `npm run check`） |
| 页面请求被代理拦 | 框架已给子进程注入 `NO_PROXY=127.0.0.1,localhost`；本机环境有 `HTTP_PROXY` 时这条必须有 |
| 想跑完不关应用 | `npm run e2e -- smoke --keep` |

---

## 三、其它回归脚本（保留的）

| 脚本 | 用途 |
|---|---|
| `npm run verify:reasoning` | 推理内容传输链路 |
| `npm run verify:image-plugin` | 内置媒体插件 |
| `npm run verify:packaged-tools` | 打包后工具完整性（需已打包） |

> 历史的 `verify:turnfold` / `verify:userrefs` / `verify:memory-layers` 等一批脚本在 09-06 清理批次中已删除，`package.json` 里的死条目在 09-11 一并清掉——**现在每条 npm script 都真实可跑**。新增验证请走 `scripts/e2e/` 场景或 `check-preflight.mjs` 检查项。
