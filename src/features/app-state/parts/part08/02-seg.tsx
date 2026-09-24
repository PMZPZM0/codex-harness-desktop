/**
 * usePart08b（09-22：part08 按序切分出来的第 2 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { matchModelSpec, loadExternalSpecs, formatTokenCount } from "../../../../lib/model-specs";
import { ALL_EFFORTS } from "../../../../lib/effort";
import { performRelayLogin, resolveRelayAutoTarget, resolveRelayTarget, resolveRelayKeyTarget, writeRelayActive, readRelayActive, type RelayActive } from "../../../../lib/relay";
import { OFFICIAL_MODELS } from "../../../../lib/official-models";
import { requestVoiceDictation, setVoiceDictationSendHandler, setVoiceOpenSettingsHandler, subscribeVoiceStage } from "../../../../voice/wave-level";
import type { Bag } from "../bag-types";
import { send as sendImpl } from "./02-seg/send";

export function usePart08b(bag: Bag) {
  // 让「长按语音输入」在松手后走现有 send()（发送/排队/权限全部复用）。
  useEffect(() => {
    setVoiceDictationSendHandler(() => { void bag.send(); });
    return () => setVoiceDictationSendHandler(null);
  });function send(event?: FormEvent) {
  return sendImpl(bag, event);
}

bag.send = send as typeof bag.send;

  async function handleLogin(info: { provider: string; name: string; baseUrl: string; apiKey: string; model: string; username?: string }): Promise<boolean> {
    try {
      const preservedThreadId = bag.accountSwitchThreadRef.current;
      // 用户名同步（昵称走 personalization，引擎下次对话就用这个称呼）
      if (info.username) {
        localStorage.setItem("username", info.username);
        bag.setUsername(info.username);
        void window.codex.setNickname(info.username).catch(() => undefined);
      }
      // 1) 探测该端点模型；官方订阅走引擎内置模型目录（chatgpt 网关无裸 /models 探测），跳过探测
      let models: string[];
      if (info.provider === "openai-official") {
        models = OFFICIAL_MODELS;
      } else {
        const probe = await window.codex.probeCustomModel({ provider: info.provider, baseUrl: info.baseUrl, apiKey: info.apiKey, wireApi: "responses" });
        models = probe?.models ?? [];
        if (!models.length) return false;
      }
      // 2) 第一个非多媒体模型生效；已知模型按规格表回填上下文/最大输出/思考档位
      const defaultModel = info.model || models.find((id: string) => !/image|embedding|moderation|audio|tts|whisper|auto-review/i.test(id)) || models[0];
      const allModels = models.map((id: string) => { const spec = matchModelSpec(id); return { id, contextWindow: spec?.contextWindow ?? 256000, maxOutputTokens: spec?.maxOutputTokens, efforts: spec?.efforts?.length ? [...spec.efforts] : [...ALL_EFFORTS], inputTypes: spec?.inputTypes ? [...spec.inputTypes] : ["text"] as ("text" | "image" | "video")[], outputTypes: ["text"] as ("text" | "image" | "video")[] }; });
      const saved = await window.codex.saveCustomModel({
        provider: info.provider,
        name: info.name,
        model: defaultModel,
        baseUrl: info.baseUrl,
        contextWindow: matchModelSpec(defaultModel)?.contextWindow ?? 256000,
        wireApi: "responses",
        apiKey: info.apiKey,
        models: allModels,
        enabled: true,
      });
      // 3) 选中生效 + 设置思考
      const id = `custom:${saved.provider}:${saved.model}`;
      bag.setModelId(id);
      // 登录/切换账号导入的供应商模型 = 全局默认（当前会话一并跟过去，其它会话不动）
      bag.applyGlobalModelChoice(id);
      bag.setEffort("high");
      localStorage.setItem("default-effort", "high");
      bag.adoptSavedProvider(saved, models);
      // 4) 进主界面
      localStorage.setItem("login-skipped", "false");
      // ⛔ 配置成功 ⇒ 落「已配置过」标记（引导弹窗从此永不再弹）。三条配置路径（登录页 /
      //   引导弹窗 / 中转站）最终都汇到这里，所以在这里写最不容易漏。
      bag.markModelConfigured();
      bag.setShowLogin(false);
      bag.showToast("登录成功", `已创建 ${info.name}，导入 ${models.length} 个模型，默认生效 ${defaultModel}`);
      // 登录/切换账号后只刷新列表，不创建新会话、不清空本地历史；优先恢复切换前打开的线程。
      await bag.refreshThreads().catch(() => undefined);
      if (preservedThreadId) await bag.openThread(preservedThreadId);
      bag.accountSwitchThreadRef.current = null;
      return true;
    } catch (error: any) {
      bag.setNotice("登录失败：" + error.message);
      return false;
    }
  }
bag.handleLogin = handleLogin as typeof bag.handleLogin;

  async function handleSkip() {
    localStorage.setItem("login-skipped", "true");
    bag.setShowLogin(false);
  }
bag.handleSkip = handleSkip as typeof bag.handleSkip;

  /** ⛔「模型已配置过」的持久标记：引导弹窗**配好一次就永不再弹**。
   *  用户 09-19 原话：「如果在登录界面配置过了，就不要弹这个弹窗了」。
   *  ⛔ 不能只看「当前有没有 customModel」——启动时配置是**异步**加载的，中间有短暂空窗，
   *    已配好的用户会看到弹窗闪一下（正是用户报的现象）。标记一落盘就彻底不再出现。 */
  const MODEL_CONFIGURED_KEY = "model-configured-v1";
bag.MODEL_CONFIGURED_KEY = MODEL_CONFIGURED_KEY as typeof bag.MODEL_CONFIGURED_KEY;

  function markModelConfigured() { try { localStorage.setItem(bag.MODEL_CONFIGURED_KEY, "1"); } catch { /* 忽略 */ } }
bag.markModelConfigured = markModelConfigured as typeof bag.markModelConfigured;

  function hadModelConfigured() { try { return localStorage.getItem(bag.MODEL_CONFIGURED_KEY) === "1"; } catch { return false; } }
bag.hadModelConfigured = hadModelConfigured as typeof bag.hadModelConfigured;

  /**
   * 引导弹窗里的「粘 Key 一键配好」（09-19 用户要求：让小白快速上手）。
   *
   * ⛔ 直接复用 handleLogin 的成熟链路（探测端点 → 导入全部模型 → 勾选生效模型 →
   *   写入档案 → 进主界面 → toast 反馈），**不另写一套**：
   *   两套链路必然漂移，且这条链路走过「探测失败不许进主界面」等一堆边界。
   * ⛔ 与登录页的区别只在于**入口位置**：新手点了「暂时不登录直接进入」之后，
   *   仍然能在引导弹窗里走同一条快路（原先这条快路只存在于登录页，跳过登录就再也找不到）。
   */
  async function quickSetup(info: { provider: string; name: string; baseUrl: string; apiKey: string }) {
    bag.setQuickSetupBusy(true);
    bag.setQuickSetupError("");
    try {
      const ok = await bag.handleLogin({ ...info, model: "" });
      if (ok) {
        bag.setShowModelGuide(false);
        bag.markModelConfigured();   // ⛔ 配好即「永不再弹」（用户 09-19：「配置过了就不要弹这个弹窗了」）
        bag.showToast("配置完成，可以开始了", `已启用 ${info.name} —— 直接在下面输入你的任务试试`);
      } else {
        bag.setQuickSetupError("没探测到可用模型。请确认：① Key 复制完整（末尾无空格）；② 线路选对了；③ 该账号有可用额度。");
      }
    } catch (error: any) {
      bag.setQuickSetupError(String(error?.message ?? error));
    } finally {
      bag.setQuickSetupBusy(false);
    }
  }
bag.quickSetup = quickSetup as typeof bag.quickSetup;

  /** 引导弹窗里的中转站登录：走与登录页**同一条链路**（lib/relay.ts 的 performRelayLogin，
   *  含"无分组 key 被网关 403 时改绑套餐分组重试"的兜底），不另写一份以免两处漂移。 */
  async function relayQuickLogin(info: { baseUrl: string; email: string; password: string }) {
    bag.setRelaySetupBusy(true);
    bag.setRelaySetupError("");
    try {
      const result = await performRelayLogin({ ...info, onLogin: (payload) => bag.handleLogin(payload) });
      if (result.ok) {
        bag.setShowModelGuide(false);
        bag.markModelConfigured();
        bag.showToast("中转站登录成功", `已启用 ${result.active?.label ?? "中转站账户"} —— 直接在下面输入你的任务试试`);
      } else {
        bag.setRelaySetupError(result.message ?? "中转站登录未完成");
      }
    } catch (error: any) {
      bag.setRelaySetupError(String(error?.message ?? error));
    } finally {
      bag.setRelaySetupBusy(false);
    }
  }
bag.relayQuickLogin = relayQuickLogin as typeof bag.relayQuickLogin;

  async function handleLogout() {
    if (!(await bag.openAppConfirm("退出登录", "将回到登录界面，本机模型与会话配置都会保留。", "退出登录"))) return;
    bag.accountSwitchThreadRef.current = bag.threadRef.current?.id ?? null;
    localStorage.setItem("login-skipped", "logout");
    // 明确保留 thread、threads、threadCacheRef 和 codex-home/sessions，不因切换账号丢失历史。
    // 两个引导弹窗必须一起收起：登录页是**提前 return 的渲染分支**（`if (showLogin) return <LoginScreen/>`），
    // 弹窗留在打开状态时登录页看不到，等重新登录回到主界面又突然冒出来 —— 用户会以为是新弹的。
    // ⛔ 但**不复位** done 标记：工具装没装跟账号无关，复位会让「刚点过稍后再说」的体检再弹一次。
    bag.setEnvCheckOpen(false);
    bag.setShowModelGuide(false);
    bag.setShowLogin(true);
  }
bag.handleLogout = handleLogout as typeof bag.handleLogout;
  return { send, handleLogin, handleSkip, MODEL_CONFIGURED_KEY, markModelConfigured, hadModelConfigured, quickSetup, relayQuickLogin, handleLogout };
}
