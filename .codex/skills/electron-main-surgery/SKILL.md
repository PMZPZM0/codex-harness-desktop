---
name: electron-main-surgery
description: 改 electron/main.ts 或搬它顶层定义前必读的手术守则：聚合导出会被「定义体切片」连带删掉（一删断 20+ 文件 import）、顶层 app.getPath("userData") 路径常量绝不能搬出 main.ts（预检【91】红线，会让路径静默漂移到错目录）。当你要删/搬 main.ts 的顶层声明、想把 features → main 的循环依赖拆掉、或遇到一片 `TS2305: Module "../main" has no exported member` 时用它。
---

# electron/main.ts 手术守则

## 何时用
- 要删 / 搬 `electron/main.ts` 的顶层声明（往 `electron/features/**` 或新模块搬）
- 出现一片 `error TS2305: Module "../main" has no exported member 'X'`
- 想拆掉「22 个 features 从 `../main` 取活绑定」的循环依赖

## 步骤
1. 先拿基线：`npx tsc -p electron/tsconfig.json --noEmit` —— 必须 0 错再动手（否则分不清新旧错误）。
2. **先把聚合导出集中到文件末尾**。`export { A, B };` 与 `export type { X } from "…";` **不是顶层声明**（不会被 `^(export )?(const|let|function)` 类正则抓到），因此会落在「定义体 = 本声明 → 下个声明」的切片里被**连带删掉**。用脚本把它们抽出来追加到文件末尾：`export` 位置与求值顺序无关，属零语义变化（本仓实测 28 条，行数 1224 → 1234，tsc 0 错）。
3. 再删 / 搬定义，每步跑 tsc；搬迁用**字符区间**切片，别用行号。
4. 收尾：`git diff --stat` 看删除量是否与预期相符 → `npm run check` 必须绿。

## 坑
- ⛔ **顶层 `app.getPath("userData")` 常量不能搬出 main.ts**。`app.setPath("userData", …)` 是 main.ts 的**模块体语句**，而 TS 把所有 import 编译成 require 提到文件最前 ⇒ 被 import 的模块体在 setPath **之前**执行 ⇒ 顶层求值拿到**默认目录**，墓碑 / 账号 vault / 机器人绑定会**静默写错地方**（磁盘上并存 `%APPDATA%\codex-harness-desktop` 与 `%APPDATA%\Codex Harness Desktop`）。预检【91】扫 `electron/**` 且**只豁免 main.ts**，搬了就红。实测 main.ts 有 **23 个**这类常量（含 `teamRunStore` / `delegateRegistry` / `memoryLayers` 三个依赖路径的单例）。
- ⛔ **「先惰性化再搬」也不划算**：惰性化要改 **387 处调用点**（`codexHome` 一个 170 处、跨 36 文件）。该方案已实测证否，结论与依据钉在 `docs/ARCHITECTURE-RULES.md` §8，别再试第二次。
- ⛔ **动手前先 grep 同文件 / 邻近代码有没有既有的正确写法**。这条是两次踩坑的共同根因：记忆捕获链那次该复用 `boot.ts:359` 早已存在的宽容取法 `params?.turn?.id ?? params?.turnId ?? params?.id`，我却另写了 `p?.turnId` ⇒ 两端 key 对不上、整条链静默断掉。

## 判据
- `npx tsc -p electron/tsconfig.json --noEmit` = 0 错
- `npm run check` = 0（含【91】userData 惰性、【96】require 断链）
- `git diff --stat` 的删除量与预期相符（一次删 589 行 = 删多了，回滚重做）
- 若动了启动链 / 单例求值时机 ⇒ 跑 `npm run accept`（拉起隔离实例验证能启动）