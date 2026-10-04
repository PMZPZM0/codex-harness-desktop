/**
 * 不可停用的域（10-04 阶段 6）—— **单一真相源**。
 *
 * ⛔ 为什么必须有一份显式名单：停用是"下次启动不挂载"，而域的通道是渲染层唯一的调用入口。
 *   用户停掉一个域 ⇒ 那个功能的所有 invoke 抛 `No handler registered`（表现为组件空白 /
 *   catch 成空数组 / 永远"加载中"）。所以有些域**不能**给用户停：
 *
 *   · user / capabilities —— 身份与能力清单本身（停用它，设置页与状态栏都拿不到数据）
 *   · app / dialog / fs    —— 文件对话框、可信根校验、诊断/存储管理（停用它，
 *                            "重开模型文件""清理缓存"这类基础操作就没了）
 *   · engine / codex / thread-runtime / threads —— 引擎与会话主链路
 *                            （停用它 = 应用不能对话）
 *   · runtime / shell / external —— 工具链安装、文件定位、外链（其他功能的前置）
 *
 * ⛔ 这不是"重要程度排序"，是**功能依赖**：被依赖者停掉 ⇒ 依赖它的功能连带失效，
 *   而用户看到的只是"某个按钮不工作了"，极难归因。宁可少给几个开关。
 *
 * ⚠️ 新增域时若它属于上述任一类，必须同步加进来 —— 守卫【269】会查组合表里
 *    标了 `essential: true` 的域与本名单一致（两处不许各写一份）。
 */

/** 不可停用的域 id。 */
export const ESSENTIAL_DOMAINS: readonly string[] = [
  // 身份 / 能力
  "user", "capabilities",
  // 宿主基础能力（对话框、可信根校验、诊断与存储）
  "app", "dialog", "fs",
  // 引擎与会话主链路
  "engine", "codex", "thread-runtime", "threads",
  // 其他功能的前置
  "runtime", "shell", "external",
];

/** 该域是否不可停用。 */
export function isEssentialDomain(id: string): boolean {
  return ESSENTIAL_DOMAINS.includes(id);
}

/**
 * 可停用但**不支持运行时卸载**的域（10-04 真热插拔的安全阀）。
 *
 * ⛔⛔ 与 `ESSENTIAL_DOMAINS` 的区别（这两个名单解决的是不同问题，别混）：
 *   · ESSENTIAL      = **不许停**（停掉会连带弄坏别的功能）
 *   · 本名单          = **可以停，但必须重启**（停了不影响别人，只是不能热卸载）
 *
 * ⚠️ 为什么不能一律热卸载 —— 两类私有状态在 `dispose()` 后**不会**被重置：
 *
 *   ① **跨域共享单例**：`dispose()` 只清本域注册的服务/effect/监听，而模块级变量
 *      （`export let server` / `codexHome` / `mainWindow` / `toolsRoot`）是**别的域**
 *      在 import 的。实测 `server` 被 25 个域 import、`codexHome` 24 个、`mainWindow` 7 个。
 *      卸载持有方 ⇒ 别的域继续用**半初始化**的对象（server 还是 undefined）。
 *      ⇒ 持有共享单例的域只能重启生效。
 *
 *   ② **模块级资源**：子进程 / 句柄 / 定时器（voice 的 worker 池、relay 的 purchaseWindow、
 *      laya 的 will-quit 订阅）。dispose() 撤得掉自己登记的，撤不掉模块体里 new 出来的。
 *
 * ⛔ 这份名单里**没有** `window-factory` / `boot` 之类：它们**不是域**（在 main.ts 的
 *   5 个 handler 里，已证不可搬），组合表里查无此 id。写进来会让守卫恒真 ——
 *   守卫【270】会逐个核名单里的 id 真实存在于组合表。
 *
 * ⛔ 这份名单是**保守的**（宁可多列几个）：热插拔是便利功能，不做不会有功能坏；
 *   贸然热卸载共享单例持有方会造成**启动即崩**这类最难归因的问题。
 */
export const DOMAINS_NOT_HOT_UNLOADABLE: readonly string[] = [
  // 持有 engine 单例（server）：25 个域从 runtime-refs 取它
  "engine",
  // 持有 / 注册线程运行时与工作目录（threadCwd / engineActiveTurnIds 被多域 import）
  "thread-runtime", "threads",
  // 持有主窗口引用的域（mainWindow 被 7 个域 import，主窗口工厂本身在 main.ts 不在表里）
  "dialog", "notify", "screenshot",
  // 持有工具链根目录（toolsRoot 被 6 个域 import）
  "runtime", "app",
  // 持有子进程 / 模块级资源
  "voice", "relay", "laya", "video", "scheduler",
  // 承载「重启后生效」这条通道本身 —— 卸载它就没有下一次 set-enabled 可调了
  "domains",
];

/**
 * 该域能否在运行时卸载（即不需要重启）。
 *
 * @param mounted 该域本次启动是否已挂载 —— 未挂载的域无所谓热卸载
 */
export function canHotUnload(id: string, mounted: boolean): boolean {
  if (!mounted) return true;                 // 没挂载过，不涉及卸载
  if (isEssentialDomain(id)) return false;   // 本来就不许停
  return !DOMAINS_NOT_HOT_UNLOADABLE.includes(id);
}
