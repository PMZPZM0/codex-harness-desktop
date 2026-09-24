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



  // 模型配置引导（09-17 用户要求）：只在**没有生效模型**时弹（配好即永不再弹，用户确认的条件）。
  // ⛔ 必须等首屏数据到位再判断：启动过程中 customModel 还是初始空值，直接判断会误弹给已配好的用户。
  // ⛔ 判据是"没有生效模型"而不是"供应商列表为空"——有供应商但没勾选模型同样发不出消息。
  useEffect(() => {
    if (bag.modelGuideDoneRef.current) return;
    if (bag.threadsLoading) return;
    if (bag.showLogin) return;              // 登录页先不谈配置
    // ⛔ 再等一拍：threadsLoading 结束只说明会话查完了，供应商配置是**另一路**加载。
    //    不等这一下，配置正常的老用户会看到「先配一个模型」的误弹（code review 发现）。
    //    customModel 变化会重建本 effect（清掉旧计时器），所以 1.2s 后读到的一定是最新值。
    const timer = window.setTimeout(() => {
      if (bag.modelGuideDoneRef.current) return;
      bag.modelGuideDoneRef.current = true;   // 本次启动只判断一次（关掉后不再弹）
      // ⛔ 配好过就**永不**再弹（用户 09-19：「在登录界面配置过了，就不要弹这个弹窗了」）。
      //   登录页 / 引导弹窗 / 中转站 三条配置路径成功后都会写这个标记，所以"登录页配过"
      //   再进主界面时不会弹（之前只看 customModel，异步加载的空窗会让弹窗闪一下）。
      if (bag.hadModelConfigured()) return;
      if (!bag.customModel) bag.setShowModelGuide(true);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [bag.threadsLoading, bag.showLogin, bag.customModel]);



  /** 体检项按平台过滤：PowerShell 7 只在 Windows 是必备——mac 终端用的是系统 shell
   *  （terminal.ts 非 win32 分支取 SHELL，默认 zsh），不依赖 pwsh，标成「缺了干不了活」反而误导；
   *  pwsh 在 mac 仍可从「开发工具」页按需装。 */
  const envSpecs = useMemo(() => ENV_CHECK_SPEC.filter((spec) => spec.id !== "pwsh" || !isMacPlatform()), []);
bag.envSpecs = envSpecs as typeof bag.envSpecs;


  /** 体检项（必备：模型 / Git / ripgrep / PowerShell 7(仅 Windows)；常用：Python / jq / 7-Zip）。
   *  ⛔ 09-20 用户定稿：工作区已移出体检（不要必选，后续用户自己配置），体检只管模型与工具下载。
   *  运行时的显示名与体积取自 devRuntimes —— 与「开发工具」页同一份数据，不会两处打架。 */
  const envItems: EnvCheckState[] = useMemo(() => bag.envSpecs.map((spec) => {
    if (spec.id === "model") return { id: "model", name: spec.fallbackName, why: spec.why, size: "", core: true, ok: Boolean(bag.customModel), go: "model" as const };
    const runtime = bag.devRuntimes.find((entry) => entry.id === spec.id);
    return { id: spec.id, name: runtime?.name ?? spec.fallbackName, why: spec.why, size: runtime?.size ?? "", core: spec.core, ok: Boolean(runtime?.installed), installing: Boolean(runtime?.installing) };
  }), [bag.devRuntimes, bag.customModel, bag.envSpecs]);
bag.envItems = envItems as typeof bag.envItems;



  /** 一键安装体检缺项 —— **后台安装**（09-18 用户要求：「加一个后台安装功能，弹窗要知
   *  道缩小，安装完成自动消失」）：点下去弹窗立刻收起，右下角只剩一枚进度角标，
   *  用户可以继续用应用；全部装好角标自动消失；有失败时把弹窗展开回来给重试入口。
   *  ⛔ 串行而不是并行：并行会多个安装进程同时抢同一份 npm 缓存目录。
   *  ⛔ 逐项独立容错（09-18 用户反馈）：单项失败只记下来，其余照常装——原先循环外一个
   *  try，任何一项失败就整批中断、弹窗还卡着关不掉（用户只能重启）。 */
  async function installEnvMissing(ids: string[]) {
    if (ids.length === 0) return;
    bag.setEnvInstalling(true);
    bag.setEnvCheckOpen(false); // 后台化：弹窗收起，右下角角标接管进度展示
    const failed: string[] = [];
    try {
      for (const id of ids) {
        try {
          const result = await window.codex.installRuntime(id);
          if (result?.runtimes) bag.setDevRuntimes(result.runtimes);
        } catch (error: any) {
          const name = bag.devRuntimes.find((entry) => entry.id === id)?.name ?? id;
          failed.push(`${name}：${error?.message ?? error}`);
        }
      }
      const list = await window.codex.listRuntimes().catch(() => null);
      if (list) bag.setDevRuntimes(list);
      if (failed.length === 0) {
        bag.setNotice(`已装好 ${ids.length} 项，Codex 可以正常干活了`);
        // 全成：角标随 envInstalling=false 自动消失，弹窗保持收起（=「安装完成自动消失」）
      } else {
        bag.setEnvCheckOpen(true); // 有失败：展开回弹窗，让用户看见哪项没成、可重试
        if (failed.length === ids.length) {
          bag.setNotice(`安装失败：${failed[0]}${failed.length > 1 ? ` 等 ${failed.length} 项` : ""}（可在「设置 → 开发工具」重试）`);
        } else {
          bag.setNotice(`部分完成：已装好 ${ids.length - failed.length} 项；${failed[0]}（可在「设置 → 开发工具」重试）`);
        }
      }
    } finally {
      bag.setEnvInstalling(false);
    }
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
  return { popoutFromQuery, envSpecs, envItems, installEnvMissing, envProgress, envPercent, envStage, envSpeed, healImageModalityIfUnsupported };
}
