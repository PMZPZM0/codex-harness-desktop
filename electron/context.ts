/**
 * 主进程插件容器（P0，2026-10-03 立）：Cordis 式的「上下文 + 依赖注入 + 生命期回收」最小内核。
 *
 * 为什么要有它：`docs/ARCHITECTURE-RULES.md` §8 的诚实清单里，
 * **「主进程 ctx（deps 契约）」一直是未落地** —— handler 共享模块级闭包、没有依赖声明、
 * 没有"卸载"这个概念。这里给最小可用内核，三件事：
 *   · `Context` —— 依赖容器：服务沿父链查找、可 provide/覆盖，释放时自动摘；
 *   · `inject`  —— 依赖声明：缺依赖时**挂载前就失败**（不是跑到一半才 undefined）；
 *   · `Fiber`   —— 插件生命期句柄：`dispose()` ⇒ 逆序跑本 ctx 的 effect、摘监听、清服务。
 *
 * ⛔ 本文件是**基座层纯逻辑**：不许 `import electron` / `node:fs` / 任何 I/O 与计时器。
 *    原因有二：① 预检要**直接 require 产物**（`dist-electron/context.js`）跑真值表（守卫【252】），
 *    一旦引入 electron，守卫进程根本加载不起来；② 容器要能被换掉、被单测，就不能绑死在宿主上。
 * ⛔ 不搬 Cordis 的 `isolate` / `intercept` / volatile schema：那是给"多 realm 服务复用 + 热配置"
 *    用的，本项目的域没有这个需求，搬来只增加概念面与守卫成本（见桌面文档《CodexHarness-一切皆插件-可行性分析.md》§5）。
 * ⛔ 不引入依赖：整个容器零 import —— 它要能活在任何一层、任何一次构建里。
 */

export type Disposer = () => void;
export type Listener = (...args: unknown[]) => void;
export type PluginApply<T> = (ctx: Context, config: T) => unknown;

/** 插件两种形态：函数式（极简）与对象式（带 name / inject）。 */
export type Plugin<T = unknown> =
  | PluginApply<T>
  | { name?: string; inject?: string[]; apply: PluginApply<T> };

/** 功能板块（域）声明：`id` = IPC 域前缀（三前缀同源），`inject` = 依赖的服务名。 */
export type FeatureSpec<T = unknown> = {
  id: string;
  inject?: string[];
  setup: PluginApply<T>;
};

let seq = 0;

/** 插件的生命期句柄。`dispose()` 之后该插件注册的一切（服务 / effect / 监听）都应当消失。 */
export class Fiber {
  private done = false;
  constructor(readonly ctx: Context, readonly name: string) {}

  get disposed(): boolean {
    return this.done;
  }

  dispose(): void {
    if (this.done) return;
    this.done = true;
    this.ctx.parent?.detach(this.ctx);
    this.ctx.dispose();
  }
}

export class Context {
  private services = new Map<string, unknown>();
  private effects: Disposer[] = [];
  private listeners = new Map<string, Set<Listener>>();
  private children = new Set<Context>();
  private done = false;

  constructor(readonly parent: Context | null = null, readonly name = "root") {}

  get disposed(): boolean {
    return this.done;
  }

  /** 取服务：沿父链向上找；子 ctx 的同名服务覆盖父的（作用域隔离靠这一条）。 */
  get<T>(key: string): T | undefined {
    for (let c: Context | null = this; c; c = c.parent) {
      if (c.services.has(key)) return c.services.get(key) as T;
    }
    return undefined;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** 提供 / 覆盖服务（只登记在本 ctx）。返回撤销函数；`dispose()` 会清空本 ctx 的全部服务。 */
  provide<T>(key: string, value: T): Disposer {
    const had = this.services.has(key);
    const prev = this.services.get(key);
    this.services.set(key, value);
    return () => {
      if (had) this.services.set(key, prev);
      else this.services.delete(key);
    };
  }

  /** 注册清理函数：`dispose()` 时**逆序**执行（后注册的先清，与"先建的后拆"一致）。 */
  effect(fn: Disposer): void {
    if (this.done) {
      // 已经释放过的 ctx 上再注册 ⇒ 立即执行，避免"注册了却永远回收不掉"
      try { fn(); } catch { /* 单个清理失败不抛 */ }
      return;
    }
    this.effects.push(fn);
  }

  /** 订阅事件；返回退订函数（同时作为 effect 挂到本 ctx 上，随释放自动摘）。 */
  on(event: string, fn: Listener): Disposer {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    const setRef = set;
    const off = () => { setRef.delete(fn); };
    this.effect(off);
    return off;
  }

  /** 触发事件：自己 → 父 → 祖父（同层按注册顺序）。 */
  emit(event: string, ...args: unknown[]): void {
    for (let c: Context | null = this; c; c = c.parent) {
      const set = c.listeners.get(event);
      if (!set || set.size === 0) continue;
      for (const fn of [...set]) fn(...args);
    }
  }

  /**
   * 挂一个插件：① 校验 inject ② 建子 ctx ③ apply ④ 包成 Fiber。
   * ⛔ `inject` 缺服务时**在 apply 之前**抛错；apply 中途抛错则回收半成品（子 ctx 摘掉 + 副作用清掉），
   *    绝不留"注册了一半"的插件 —— 半注册状态是最难查的一类故障。
   */
  plugin<T>(plugin: Plugin<T>, config?: T): Fiber {
    const spec = typeof plugin === "function"
      ? { name: "", inject: [] as string[], apply: plugin }
      : plugin;
    const name = spec.name || `plugin#${++seq}`;
    const missing = (spec.inject || []).filter((k) => !this.has(k));
    if (missing.length) {
      throw new Error(`[context] 插件 ${name} 缺少依赖服务：${missing.join(" / ")}（inject 声明的服务必须已 provide）`);
    }
    const ctx = new Context(this, name);
    const fiber = new Fiber(ctx, name);
    this.children.add(ctx);
    try {
      const ret = spec.apply(ctx, config as T);
      // ⛔ 审查发现（10-03）：apply 返回 Promise 时**旧写法会静默丢掉它** —— 插件"挂上了"但初始化没跑完，
      //    而且没有任何症状。P0 容器只支持同步挂载（异步初始化请自行 ready 后再对外暴露能力），
      //    所以这里显式报错；抛在 try 内 ⇒ 走下面 catch 的回滚路径，不留半注册。
      if (ret && typeof (ret as { then?: unknown }).then === "function") {
        throw new Error(`[context] 插件 ${name} 的 apply 返回了 Promise —— P0 容器只支持同步挂载（异步初始化请自行 ready 后再暴露能力）`);
      }
      if (typeof ret === "function") ctx.effect(ret as Disposer);
    } catch (err) {
      this.children.delete(ctx);
      ctx.dispose();
      throw err;
    }
    return fiber;
  }

  /** 内部：父子关系解绑（由 `Fiber.dispose()` 调）。 */
  detach(child: Context): void {
    this.children.delete(child);
  }

  /** 释放：先子后己（子再释放自己的子）、effect 逆序、监听与本地服务清空。可重复调用。 */
  dispose(): void {
    if (this.done) return;
    this.done = true;
    for (const child of [...this.children]) child.dispose();
    this.children.clear();
    for (let i = this.effects.length - 1; i >= 0; i--) {
      try { this.effects[i](); } catch { /* 单个清理失败不影响其余（与启动链"副作用一律 try/catch 降级"同一条原则） */ }
    }
    this.effects.length = 0;
    this.listeners.clear();
    this.services.clear();
  }
}

/** 定义一个功能板块（域）。返回对象式插件，可直接交给 `Context.plugin` / `mountFeature`。 */
export function defineFeature<T = unknown>(spec: FeatureSpec<T>): { name: string; inject: string[]; apply: PluginApply<T> } {
  if (!spec || !spec.id) throw new Error("[defineFeature] 必须给 id（= IPC 域前缀，三前缀同源）");
  if (typeof spec.setup !== "function") throw new Error(`[defineFeature] ${spec.id} 缺少 setup`);
  const setup = spec.setup;
  return {
    name: spec.id,
    inject: spec.inject ? [...spec.inject] : [],
    apply: (ctx, config) => setup(ctx, config),
  };
}

/** 根上下文：整个主进程一个。P1 起由组合文件决定挂哪些域。 */
export const rootContext = new Context(null, "app");

const mounted = new Set<string>();

/**
 * 挂载一个域到根上下文（P0 过渡入口）。
 * ⛔ 同一个 `id` 只许挂一次（重复挂载 = 两套 handler / 两份状态，必然互相打架）；
 *    释放后自动从清单移除，可以重挂。
 */
export function mountFeature<T>(plugin: Plugin<T>, config?: T): Fiber {
  // ⛔ 传进来 undefined 时旧写法读 `plugin.name` 会把整个宿主带走（10-03 实测事故：
  //    CJS 循环依赖导致 plugin 为 undefined ⇒ 启动即崩，且错误信息指向容器而非根因）。
  if (!plugin) {
    throw new Error("[mountFeature] 插件是 undefined —— 多半是**循环依赖**或导出名写错（见 electron/composition-runtime.ts 的说明）");
  }
  const name = typeof plugin === "function" ? "" : plugin.name || "";
  if (name && mounted.has(name)) throw new Error(`[mountFeature] 插件已挂载：${name}`);
  const fiber = rootContext.plugin(plugin, config);
  if (name) {
    mounted.add(name);
    fiber.ctx.effect(() => { mounted.delete(name); });
  }
  return fiber;
}

/** 当前已挂载的域清单（守卫断言"释放后归零"用）。 */
export function mountedFeatures(): string[] {
  return [...mounted];
}
