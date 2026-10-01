/**
 * usePart05b（09-22：part05 按序切分出来的第 2 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { isMacPlatform } from "../../../../lib/is-mac-platform";
import { EnvCheckDialog, ENV_CHECK_SPEC, ENV_CHECK_OPTOUT_KEY, type EnvCheckState } from "../../../../components/EnvCheckDialog";
import type { Bag } from "../bag-types";

export function usePart05b(bag: Bag) {
  // 独立会话弹窗探测：**同步读 URL query**（弹窗 URL 固定带 ?popout=<id>，首帧即可确定，
  // 不必等 IPC 往返——异步探测会让弹窗先按主界面布局渲染一帧：timeline 820 居中 + 侧栏
  // 列占位 → 用户看到的就是「打开弹窗右边一大片空白，要加载一会儿才没」）。
  // IPC 探测保留作兜底（某些加载路径 query 可能被剥离），但状态在首帧同步置好。
  const popoutFromQuery = useMemo(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("popout");
      return q ? String(q) : null;
    } catch { return null; }
  }, []);
bag.popoutFromQuery = popoutFromQuery as typeof bag.popoutFromQuery;


  useEffect(() => {
    if (bag.popoutFromQuery) {
      bag.popoutThreadIdRef.current = bag.popoutFromQuery;
      bag.setPopoutThreadId(bag.popoutFromQuery);
      try { document.title = `Codex Harness — 独立会话`; } catch { /* 忽略 */ }
      return;
    }
    void window.codex.popoutThreadId().then((id) => {
      if (id) {
        bag.popoutThreadIdRef.current = id;
        bag.setPopoutThreadId(id);
        try { document.title = `Codex Harness — 独立会话`; } catch { /* 忽略 */ }
      }
    }).catch(() => undefined);
    // 主窗口侧：启动时同步一次「哪些会话已被弹窗」→ 侧栏隐藏它们
    if (!bag.popoutFromQuery) bag.refreshPoppedOut();
  }, [bag.popoutFromQuery, bag.refreshPoppedOut]);



  useEffect(() => { if (!bag.loading) void bag.refreshThreads(); }, [bag.loading]);



  // ⛔ 模型配置引导已删除（10-01 用户定稿）：首次启动只弹「开发工具」引导，不再有模型配置
  //    引导步骤——模型配置走 设置 → 模型（配好即用，不需要新手引导弹窗带）。
  //    登录页快捷配置链路保留（登录页配完写 MODEL_CONFIGURED_KEY，与本弹窗无关）。




  /** 体检项（推荐：Git / ripgrep / PowerShell 7(仅 Windows)；按需：Python / jq / 7-Zip）。
   *  ⛔ 10-01 用户定稿：模型项已移出（首次启动只弹「开发工具」引导，模型配置走设置页）；
   *  运行时的显示名与体积取自 devRuntimes —— 与「开发工具」页同一份数据，不会两处打架。 */
  const envSpecs = useMemo(() => ENV_CHECK_SPEC.filter((spec) => spec.id !== "pwsh" || !isMacPlatform()), []);
bag.envSpecs = envSpecs as typeof bag.envSpecs;


  /** 跳过的工具（10-01：每项支持 立即安装/稍后/跳过）：localStorage 持久，跳过项不进一键安装、
   *  灰显「已跳过」；用户仍可单点安装或点「恢复」取消跳过。 */
  const [envSkipped, setEnvSkipped] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("env-skip-v1") ?? "[]") as string[]; } catch { return []; }
  });
bag.envSkipped = envSkipped as typeof bag.envSkipped;

  function skipEnvItem(id: string) {
    setEnvSkipped((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      try { localStorage.setItem("env-skip-v1", JSON.stringify(next)); } catch { /* 忽略 */ }
      return next;
    });
  }
bag.skipEnvItem = skipEnvItem as typeof bag.skipEnvItem;

  /** 每工具失败态（10-01：失败要落在那一项上，带重试入口；不再只拼一句总文案）。 */
  const [envFailures, setEnvFailures] = useState<Record<string, string>>({});
bag.envFailures = envFailures as typeof bag.envFailures;
bag.setEnvFailures = setEnvFailures as typeof bag.setEnvFailures;

  /** 体检项（显示名/体积/已装取自 devRuntimes；失败/跳过状态叠加在上面）。 */
  const envItems: EnvCheckState[] = useMemo(() => bag.envSpecs.map((spec) => {
    const runtime = bag.devRuntimes.find((entry) => entry.id === spec.id);
    return {
      id: spec.id,
      name: runtime?.name ?? spec.fallbackName,
      why: spec.why,
      size: runtime?.size ?? "",
      core: spec.core,
      ok: Boolean(runtime?.installed),
      installing: Boolean(runtime?.installing),
      failed: bag.envFailures[spec.id] ?? null,
      skipped: bag.envSkipped.includes(spec.id),
    };
  }), [bag.devRuntimes, bag.envSpecs, bag.envFailures, bag.envSkipped]);
bag.envItems = envItems as typeof bag.envItems;



  /** 安装队列（10-01 重构）：**并发 2** 的并行队列 + 每工具状态机 + 总进度汇总。
   *  ⛔ 为什么是 2 不是更多：基础工具链（git/rg/pwsh/python/jq/7zip）互不共享缓存，并行安全；
   *     npm 类安装（cloakbrowser 等，不在首启清单）会抢 npm 缓存目录 —— 并发 2 是折中。
   *  ⛔ 每项独立容错：单项失败记进 envFailures（弹窗里那一项红显 + 重试按钮），其余照常。
   *  背景：全部装完/有失败时的弹窗与角标行为沿用 09-18 语义（关闭 ≠ 取消，失败自动展开）。 */
  const [envQueueTotal, setEnvQueueTotal] = useState<number | null>(null);
  const [envQueueDone, setEnvQueueDone] = useState<number | null>(null);

  async function installEnvMissing(ids: string[]) {
    if (ids.length === 0) return;
    bag.setEnvInstalling(true);
    setEnvFailures((cur) => { const next = { ...cur }; for (const id of ids) delete next[id]; return next; });
    // 多项才后台化（弹窗收起、角标接管）；单工具安装保持弹窗打开看它自己的进度
    if (ids.length > 1) bag.setEnvCheckOpen(false);
    const failed: Record<string, string> = {};
    let done = 0;
    const queue = [...ids];
    const worker = async () => {
      while (queue.length > 0) {
        const id = queue.shift()!;
        try {
          const result = await window.codex.installRuntime(id);
          if (result?.runtimes) bag.setDevRuntimes(result.runtimes);
        } catch (error: any) {
          failed[id] = String(error?.message ?? error).slice(0, 200);
        }
        done += 1;
        setEnvQueueDone(done);
      }
    };
    setEnvQueueTotal(ids.length);
    setEnvQueueDone(0);
    await Promise.all([worker(), worker()]);
    const list = await window.codex.listRuntimes().catch(() => null);
    if (list) bag.setDevRuntimes(list);
    setEnvFailures(failed);
    const failedNames = Object.keys(failed).map((id) => bag.devRuntimes.find((e) => e.id === id)?.name ?? id);
    if (Object.keys(failed).length === 0) {
      bag.setNotice(`已装好 ${ids.length} 项，Codex 可以正常干活了`);
    } else {
      bag.setEnvCheckOpen(true); // 有失败：展开回弹窗，失败项红显 + 重试按钮
      bag.setNotice(
        Object.keys(failed).length === ids.length
          ? `安装失败：${failedNames[0]}${failedNames.length > 1 ? ` 等 ${failedNames.length} 项` : ""}（弹窗里可重试）`
          : `部分完成：已装好 ${ids.length - failedNames.length} 项；${failedNames[0]}（弹窗里可重试）`
      );
    }
    bag.setEnvInstalling(false);
  }
bag.installEnvMissing = installEnvMissing as typeof bag.installEnvMissing;


  /** 安装进度（复用主进程推来的 runtime:progress，取**当前正在装的那个工具**的条目——
   *  批量安装时逐个推进，显示正在装的那一项的百分比与阶段）。 */
  const envProgress = bag.envInstalling && bag.runtimeActiveId ? (bag.runtimeProgress[bag.runtimeActiveId] ?? "") : "";
bag.envProgress = envProgress as typeof bag.envProgress;


  const envPercent = bag.envInstalling && bag.runtimeActiveId ? bag.runtimePercent[bag.runtimeActiveId] : undefined;
bag.envPercent = envPercent as typeof bag.envPercent;


  const envStage = bag.envInstalling && bag.runtimeActiveId ? bag.runtimeStage[bag.runtimeActiveId] : undefined;
bag.envStage = envStage as typeof bag.envStage;


  const envSpeed = bag.envInstalling && bag.runtimeActiveId ? bag.runtimeSpeed[bag.runtimeActiveId] : undefined;
bag.envSpeed = envSpeed as typeof bag.envSpeed;


  // ⛔ 这里曾有 `activeModelSupportsImage()`（按模型 inputTypes 预判能否收图），09-18 随
  //   「图片一律正常发送」一并删除：**判据不可靠**（本地元数据，模型其实支持视觉只是漏勾
  //   「图片」时会把图白吞），而且它是「预判 → 吞图 → 注入说明文字」那条错路的入口 ——
  //   留着只会被下一个改动顺手复用。真不支持时由引擎报错 → `healImageModalityIfUnsupported` 自愈。

  /** 图片模态自愈（09-18）：接入点明确报「不支持图片输入」且生效模型标了 image →
   *  自动摘掉 image 模态并保存（保存即重载引擎配置），toast 说明。只在错误原话点名时触发；
   *  摘掉后不再命中（幂等），用户仍可在模型编辑器手动勾回。
   *  ⛔ 这是**唯一的**图片兜底路径（09-18 起）：不再按 inputTypes 预判吞图 —— 预判会误伤
   *  「其实支持视觉、只是漏勾了图片」的模型（用户截图实证：图被吞掉，还往消息正文里塞了
   *  一段面向用户的说教文字，模型照抄出来就是在气泡里对用户讲道理）。 */
  async function healImageModalityIfUnsupported(message: string | undefined) {
    if (!message || !/do not support image(?:s| input)?|not support image|不支持图片|不支持图像/i.test(message)) return;
    const live = bag.customModel;
    if (!live?.baseUrl) return; // 官方订阅原生支持视觉，不涉及
    const model = (live.models ?? []).find((m) => m.id === live.model);
    if (!model || !(model.inputTypes ?? []).includes("image")) return;
    // ⛔ 有回合正在跑时**绝不**自动写配置（09-18 用户实测「切到另一个会话，原来在跑的那个立马就断」）：
    //   保存模型走 `custom-model:save → applyCustomModel() → server.restart()`，而引擎重启会
    //   **打断所有正在跑的回合**（main.ts 注释原话：「重启会打断所有在跑回合（app-server restarted）」）。
    //   自愈是个后台便利动作，可能由任意一次带图发送触发 —— 它没有资格杀掉用户别的会话里正在跑的任务。
    //   跳过并说清楚，让人自己决定什么时候改（改完在下个回合生效）。
    if (bag.runningThreadIdsRef.current.size > 0) {
      bag.showToast("已跳过图片模态自动修正",
        `「${live.model}」的接入点不支持图片，但当前有 ${bag.runningThreadIdsRef.current.size} 个会话正在运行——自动改配置要重启引擎、会把它们全部打断。等任务跑完，或到「设置 → 模型」手动取消勾选「图片」。`);
      return;
    }
    // ⛔ 以「已保存的 live 配置」为基底合并，不能用 customDraft——草稿可能正开着另一个供应商的编辑态
    const merged = { ...live, models: (live.models ?? []).map((m) => m.id === live.model ? { ...m, inputTypes: (m.inputTypes ?? []).filter((t) => t !== "image") } : m) };
    const saved = await bag.saveCustomDraft(merged);
    bag.showToast(saved ? "已自动关闭该模型的图片输入" : "未能自动关闭图片输入",
      saved
        ? `「${live.model}」的接入点不支持图片（供应商原话：${message.slice(0, 140)}）。模型配置已自动改正，去掉图片重新发送即可。`
        : `接入点不支持图片输入，自动写配置失败。请到「设置 → 模型」编辑该模型，取消勾选「图片」。`);
  }
bag.healImageModalityIfUnsupported = healImageModalityIfUnsupported as typeof bag.healImageModalityIfUnsupported;
  return { popoutFromQuery, envSpecs, envItems, installEnvMissing, envProgress, envPercent, envStage, envSpeed, envSkipped, skipEnvItem, envFailures, setEnvFailures, envQueueTotal, envQueueDone, healImageModalityIfUnsupported };
}
