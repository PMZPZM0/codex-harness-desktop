# 图像工坊（image-lab）—— 集成说明

> 立项：2026-10-09。用户需求：「把图像生成与编辑类工具内置集成进应用，配齐可供 Codex 直接调用的
> 接口（作图 / 修图），并逆向移植出可在 Windows 上正常运行的版本，功能完整可跑；调用时弹出
> 图像编辑 / 预览界面，调用完成后自动消失。」

---

## 0. 先纠正一个前提（重要）

**Compositor（`robbietilton/Compositor`）没有被"逆向"，也不需要逆向**：它是 **MIT 开源的公开项目**，
源码就在 GitHub 上。而且它是一条**走不通的路**：

| Compositor 的实际形态 | 后果 |
|---|---|
| 原生 **Swift**（SwiftUI + AppKit + Metal，少量 C） | 与 Electron 的 JS/TS 运行时不通用 |
| 仅 **macOS 26.0+ / Apple 芯片**，`xcodebuild` 构建、Developer ID 签名公证 | Windows 上无法加载、无法运行 |
| 功能对标 Photoshop 的完整原生编辑器 | "移植" = **从零重写**，不是 port |

把它做成 Windows 版并塞进 Electron，等价于另起炉灶写一个新软件——那不是集成。所以本方案
**不搬 Compositor 的代码**，而是给应用**内置一套等价的、跨平台可跑的能力**。

## 1. 定位与选型

- **生成** = `image_generate`（既有，走内置生图插件）。
- **编辑/修图** = `image_edit`（本轮新增）。
- **元信息** = `image_info`；**在应用内看** = `image_view`（本轮新增）。

**引擎选型 = `jimp`（纯 JS，零原生依赖）**：

- 本仓已因 `better-sqlite3` 的原生模块 **ABI 三元组**踩过坑（装与跑必须同一个 node）；
  `sharp` / `canvas` / `@napi-rs/canvas` 这类带 `.node` 的库，在「Windows 打包 + mac 交叉构建」
  下是已知风险点（交叉构建拿不到对端平台的预编译二进制）。
- jimp 全部是 JS，**Win / mac 行为逐字节一致**，asar 打包零特判 —— 直接满足「Windows 功能完整」的硬要求。
- 代价：比 libvips 慢（1024² 图的一次操作在百毫秒量级），基础编辑够用。
- ⛔ 守卫 `12b-image-lab.mjs` 钉死这条：依赖里一旦出现 `sharp`/`canvas`/`@napi-rs/canvas` 立刻报红。

## 2. 链路（生图与编辑**两条独立通道**，缺一即功能不可用）

```
引擎（Codex）
  │  四个**各自独立**的 dynamicTool（模型工具面里一眼可见，不再包一层 harness_tools）
  │  image_generate / image_edit / image_info / image_view
  ▼
src/features/app-state/parts/part08/01-seg.tsx          ← 工具 schema（渲染层持有）
  │  每条 description 都写清「适用场景 / 使用时机 / 职责边界」——模型靠它选对工具
  ▼
src/features/app-state/parts/part05/event-router/02-request.tsx  ← 按工具名**分别**路由
  │
  ├─ image_generate ─► image-lab:generate ─┐
  ├─ image_edit     ─► image-lab:edit     ─┤
  ├─ image_info     ─► image-lab:info     ─┤
  └─ image_view     ─► image-lab:view     ─┤
                                          ▼
electron/features/image-lab.ts   ← 执行端（**生图与编辑分属不同 handler，不共用一条通道**）
  │  · generate     ：读生图插件凭证 → 打外部网关（**唯一要 API Key 的**，会花钱）
  │  · edit/info/view：零凭证，本地 jimp（imageEditCore / imageInfoCore）+ 路径闸 resolveImagePath
  │  · 浮层推送 pushImageLabEvent（sendToWindow "image-lab:event"）；读通道 image-lab:read
  ▼
electron/preload.ts   ← 五条 gen 桥（read / generate / edit / info / view）+ onImageLabEvent（手写推送桥）
  ▼
src/features/image-lab/ImageLabModal.tsx  ← 浮层（拉字节 → Blob → 显示；close 后延时自动卸载）
  ▼
src/styles/33-image-lab.css + src/styles.css 引入
```

⛔ **图像族不经过 `agents:dispatch-call` 能力网关** —— 那条通道只服务其余 25 个能力。
   用户 10-09 两次点名：「工具区分开，不要共用一个工具」+「把生成和编辑的 IPC 也彻底分开」。
   设计定稿见 `docs/IMAGE-TOOL-SPLIT.md`，守卫 = `12b-image-lab.mjs`（23 条）。

**接线生成物**（都是"改一处、跑生成器"）：

| 真相源 | 生成器 | 产物 |
|---|---|---|
| `electron/ipc-channels.manifest.json`（加 `image-lab:read`） | `npm run gen:ipc` | `preload.ts` gen 段、`vite-env.d.ts` gen 段、`IPC_CHANNEL_COUNT`(→435) |
| `electron/composition.json`（加 `image-lab` 域） | `npm run gen:domains` | `composition.gen.ts`（85 个启用域） |
| `electron/ipc-registry.ts`（手写账本） | — | 预检【2】校验 |
| `scripts/guards/12b-image-lab.mjs` | — | 已登记进 `npm run check` 链 |

## 3. Codex 工具接口

### `image_edit` —— 修图（核心）

| 参数 | 类型 | 说明 |
|---|---|---|
| `path` / `paths` | string / string[] | 源图绝对路径（单张 / 多张） |
| `ops` | object[] | **按顺序执行**的编辑操作（见下） |
| `output` | string | 输出路径（缺省 = 源图同目录 `<名字>-edit.<ext>`），必须可信目录内 |
| `format` | `png`/`jpeg`/`bmp`/`tiff` | 输出格式（缺省沿用源图；webp/gif 源回落 png） |
| `quality` | number | jpeg 质量 1–100（缺省 90） |

`ops` 支持的 op：

| op | 参数 | 作用 |
|---|---|---|
| `resize` | `width?`,`height?` | 缩放（只给一边 = 等比） |
| `scale` | `factor` | 按倍率缩放 |
| `crop` | `x`,`y`,`width`,`height` | 裁剪 |
| `rotate` | `degrees` | 旋转 |
| `flip` | `axis` = horizontal/vertical/both | 翻转 |
| `brightness` / `contrast` | `value` −1..1 | 明暗 / 对比 |
| `greyscale` / `invert` / `sepia` / `normalize` | — | 色彩处理 |
| `blur` / `gaussian` | `radius` | 模糊 |
| `posterize` | `n` | 色阶化 |
| `pixelate` | `size` | 马赛克（打码） |
| `opacity` | `value` 0..1 | 整体透明度 |
| `color` | `apply`,`params` | 高级调色 |
| `composite` | `path`,`x`,`y`,`opacity?` | 叠加另一张图（水印） |
| `text` | `text`,`x`,`y`,`size?`,`color?` | 加文字（⛔ **仅 ASCII**） |
| `background` | `color` = `#rrggbb` | 把透明底压成纯色 |

返回：产出文件路径 + 宽高 + 格式 + 字节数。

### `image_info`

读图片元信息：宽高 / 格式 / 是否带透明 / 字节数（`path` 或 `paths`）。

### `image_view`

在应用内弹「图像工坊」浮层给用户看一张图（只读，不自动消失——由用户自己关）。

### `image_generate`（既有）

生图，走内置生图插件；本轮**新增**了弹浮层联动（生成中 → 出图 → 自动收起）。

## 4. 浮层联动协议（用户要求的"弹出 → 完成自动消失"）

单通道三态，主进程 `pushImageLabEvent()` → `sendToWindow("image-lab:event")`：

```ts
{ phase: "open"|"update"|"close", taskId, mode?: "generate"|"edit", title?, status?: "running"|"done"|"error", images?: string[], note? }
```

- 工具**开始**时推 `open`（亮源图 / 提示词），**出结果**推 `update`（亮产物），**结束**推 `close`。
- 渲染层收到 `close` 后**先亮约 900ms 再卸载**（否则快工具会一闪而过，用户看不清）。
- `image_view` 刻意**不发 close**（这是"给用户看"，自收等于没看）。

## 5. Windows 关键改动点（相对"直接搬 Mac 原生应用"）

1. **不引入任何原生二进制**：编辑引擎换成纯 JS 的 jimp；`12b-image-lab.mjs` 有负向断言钉死。
2. **一条命令都不依赖平台**：读写走 `node:fs/promises`，路径用 `path` 归一，无 shell / 无外部程序。
3. **打包无特判**：jimp 是 JS，进 asar 即可，不需要 `asarUnpack` / `extraResources` 之类平台分支。
4. **平台无关的路径闸**：`resolveImagePath`（可信根 + 图片扩展名白名单 + 128MB）在 Win / mac 同一条代码路径。

> 一句话：**这不是"Mac 软件的 Windows 移植"，而是一套两个平台跑同一份代码的新能力**——
> 所以 Windows 上不存在"功能缺失"这一档，只有同一份实现。

## 6. 已知限制

- `text` 操作**只支持英文/数字**（jimp 内置位图字体，中文会画成空白）。中文文字建议用设计工具。
- 输出格式限 `png`/`jpeg`/`bmp`/`tiff`（webp/gif 可读不可写）。
- 编辑能力是"基础修图"档：图层 / 蒙版 / Camera Raw / PSD 这类 Photoshop 级特性**不在此范围**。

## 7. 验证

- 引擎冒烟：缩放 / 裁剪 / 旋转 / 棕褐 / 模糊 / 文字 / 合成 / 格式转换 / 元信息 / 未知 op 报错，全过。
- 守卫 `【img】16/16`；**4 处变异测试全部被抓**（去掉读通道 / 去掉大小上限 / 去掉自动收起 / 塞入 sharp），
  还原后回到 16/16。
- 双侧 `tsc` 0 错；`gen:ipc check` 一致（435 方法）；链尾【93】bag 1389 / 【94】 / 【96】全绿。
- `npm run check` 全链跑完：除 19 项**环境类**硬失败（宿主封锁子进程 / 缺 python 等既有基线）外无红项。
