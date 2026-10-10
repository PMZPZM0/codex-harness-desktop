/**
 * usePart08a（09-22：part08 按序切分出来的第 1 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { composeScopeInstructions, sessionScopeBlock, sessionScopeSignature } from "../../../../lib/session-scope.mjs";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../lib/user-refs";
import { basename } from "../../../../lib/basename";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../app-view/helpers";
import { DELEGATE_RAIL_LINGER_MS, IDENTITY_ONBOARD_INSTRUCTIONS, IDENTITY_ONBOARD_TOOL, MEMBER_LABELS, NOTICE_MAX, NOTICE_TTL_MS, QUICK_SITES } from "../../../app-view/constants";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../app-view/types";
import type { Bag } from "../bag-types";
import { openThread as openThreadImpl } from "./01-seg/open-thread";

/** 调度工具 `agent_invoke` 的**兜底描述**（本会话没开调度、或描述还没算出来时用）。
 *  ⛔ 与 `electron/features/dispatch-core.ts` 里那条 MCP 孪生描述**逐字同源**
 *     （守卫【dpcat】比对这句「以会话里那条《调度已开启 / 调度范围已更新》的告知为准」）。
 *     electron/ 与 src/ 互不 import ⇒ 只能各留一份字面量，靠守卫防漂移。
 *  ⛔ 描述里**不写会话级目录**：dynamicTools 在 thread/start 时就定死了，用户中途打开调度
 *     不会重建工具面（真机实证：会话 15:35:32 建立、15:35:54 才注入「调度已开启」）⇒
 *     把目录写死进描述，就会出现"告诉模型去派一个本会话没开的类"的假信息。
 *     会话级目录的唯一投递口 = 那条告知（按勾选逐类列 + 显式否定未开的类）。 */
const DISPATCH_TOOL_DESC_FALLBACK =
  "调度专家 / 专家团 / 子智能体 执行一个独立子任务并拿回产出。"
  + "⛔ 可用范围**按会话**：只允许派本会话「调度」面板里**已勾选**的类别；"
  + "未勾选的类别**即使参数能拼出名字，调用也会被拒绝**（别反复试，白烧回合）。"
  + "本会话当前实际开启了哪几类、各有哪些对象，以会话里那条「调度已开启 / 调度范围已更新」的告知为准。";

/** 图像四件套：各自独立的 dynamicTool（10-09）。
 *  ⛔ 它们**不走** `harness_tools` 网关，也不共用一个执行通道 —— 每个工具调自己的 IPC：
 *       image_generate → image-lab:generate（**唯一要生图凭证的**，会花钱）
 *       image_edit     → image-lab:edit    （零凭证，本地 jimp，产出不覆盖原图）
 *       image_info     → image-lab:info    （只读）
 *       image_view     → image-lab:view    （只读，浮层不自动收）
 *     （路由见 parts/part05/event-router/02-request.tsx。用户 10-09：「工具区分开，不要共用一个工具」
 *       + 「把生成和编辑的 IPC 也彻底分开，不要混在一起」。）
 *  ⛔⛔ 每条 description 都必须写清 **适用场景 / 使用时机 / 职责** —— 模型就是靠它选对工具的。
 *      改这里等于改模型的行为，别只当成注释。 */
function imageToolDefs(): any[] {
  return [
    {
      type: "function",
      name: "image_generate",
      description:
        "生成一张**全新的**图片（凭空造内容），落盘并返回本地文件路径。"
        + "【适用场景】用户说「画一张 / 生成图片 / 配图 / 出图」，或需要一张**原本不存在**的画面。"
        + "【使用时机】只在需要**新内容**时用 —— 换主体（狗换猫）、换风格、换构图、换姿势，都归这类。"
        + "【职责边界】⛔ 若用户是**对已有图片做局部修改**（裁剪/缩放/调色/加水印/打码），用 image_edit，"
        + "不要重新生成 —— 重画会换掉整张图，还白花一次额度。"
        + "⛔ 刚生成过一张图、用户只想改个局部时，**先用 agent_ask 问一句**：「修图（保留这张，只改局部）」"
        + "还是「重新生成」—— 不要自己替用户决定。"
        + "【怎么用】返回的路径展示给用户请用 markdown 图片语法 ![描述](路径)。",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "画面描述（主体 + 环境 + 光线 + 风格 + 质量词，越具体越好）" },
          count: { type: "number", description: "生成张数 1-4（默认 1）。多张会并发，适合同一提示词的多个变体" },
          model: { type: "string", description: "覆盖默认模型（一般不用填，留空走「设置 → 插件」里配的模型）" },
          workspace: { type: "string", description: "落盘到哪个工作目录的 .drama-canvas/assets/image（缺省 = 调用者会话的工作目录）" },
          name: { type: "string", description: "文件名前缀（缺省 img）" },
          size: { type: "string", description: "画幅尺寸，如 1024x1024 / 1024x1536（竖）/ 1536x1024（横）。⛔ 不给就走网关默认 —— 各家接受的值不同，报错就把这个参数去掉" },
          negative: { type: "string", description: "负面提示词（不想要什么：文字、畸形手指、水印…）。⛔ 不是每个网关都支持，无效时改用正面描述" },
        },
        required: ["prompt"],
      },
    },
    {
      type: "function",
      name: "image_edit",
      description:
        "对**已有图片**做确定性编辑（修图），产出新文件并返回路径。**不改动原图**，**不需要任何 API Key**。"
        + "【适用场景】裁剪 / 缩放 / 旋转 / 翻转 / 转格式 / 调明暗对比 / 灰度·棕褐·反相 / 模糊 / 马赛克 / "
        + "叠水印 / 加一行英文文字 / 把透明底压成纯色。"
        + "【使用时机】用户说「把这张图…」「裁一下 / 缩到 800 / 转成 jpg / 调亮点 / 加个水印 / 打码 / 加行字」，"
        + "且诉求指向**某张已有的图**。"
        + "【职责边界】⛔ 它改的是「形」（几何 / 色彩 / 编码 / 叠加），**改不了「意」** —— "
        + "换主体、换风格、换背景内容这类语义修改做不到，那要用 image_generate 重画，别硬拼 ops。"
        + "⛔ 用户给的诉求若是语义修改，直接说明并转 image_generate，不要先调本工具再报失败。"
        + "【怎么用】只处理**可信目录**（会话工作目录 / 应用数据目录）内的图片；ops 按数组顺序依次执行，"
        + "后一个接前一个的产物；缺省输出到源图同目录的 `<名字>-edit.<ext>`（所以原图天然可回退）。",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "源图绝对路径（单张）。与 paths 至少给一个" },
          paths: { type: "array", items: { type: "string" }, description: "多张源图（同一组 ops 逐张应用）" },
          ops: {
            type: "array",
            description:
              "编辑操作，**按顺序执行**。每项是一个对象，op 字段决定类型："
              + "resize{width?,height?} 缩放（只给一边=等比）；scale{factor} 按倍率缩放；"
              + "crop{x,y,width,height} 裁剪；rotate{degrees} 旋转；flip{axis:'horizontal'|'vertical'|'both'} 翻转；"
              + "brightness{value:-1..1} / contrast{value:-1..1} 明暗对比；greyscale 灰度；invert 反相；sepia 棕褐；"
              + "blur{radius} / gaussian{radius} 模糊；posterize{n} 色阶化；pixelate{size} 马赛克；normalize 自动色阶；"
              + "opacity{value:0..1} 整体透明度；color{apply,params} 高级调色；"
              + "composite{path,x,y,opacity?} 叠加另一张图（水印）；text{text,x,y,size?,color?} 加文字（⛔ 只支持英文/数字，中文会在图上显示成空白）；"
              + "background{color:'#rrggbb'} 把透明底压成纯色。",
            items: {
              type: "object",
              properties: {
                op: { type: "string", description: "操作类型（见数组说明）" },
                width: { type: "number" }, height: { type: "number" }, x: { type: "number" }, y: { type: "number" },
                factor: { type: "number" }, degrees: { type: "number" }, radius: { type: "number" },
                value: { type: "number" }, n: { type: "number" }, size: { type: "number" },
                axis: { type: "string", enum: ["horizontal", "vertical", "both"] },
                path: { type: "string", description: "composite 要叠加的图片路径" },
                text: { type: "string", description: "text 操作要写的内容（仅 ASCII）" },
                color: { type: "string", description: "text 的 black/white；background 的 #rrggbb" },
                opacity: { type: "number" }, apply: { type: "string" }, params: { type: "array", items: { type: "number" } },
              },
              required: ["op"],
            },
          },
          output: { type: "string", description: "输出文件路径（缺省 = 源图同目录 <名字>-edit.<ext>）；必须在可信目录内" },
          format: { type: "string", enum: ["png", "jpeg", "bmp", "tiff"], description: "输出格式（缺省沿用源图；webp/gif 源回落 png）" },
          quality: { type: "number", description: "输出 jpeg 的质量 1-100（缺省 90）" },
        },
        required: ["ops"],
      },
    },
    {
      type: "function",
      name: "image_info",
      description:
        "读图片元信息：宽高 / 格式 / 是否带透明通道 / 文件字节数。"
        + "【适用场景】需要先知道尺寸再决定怎么裁/缩放；用户问「这图多大 / 什么格式 / 有没有透明」。"
        + "【使用时机】动手编辑**之前**核对原图，或用户单纯问图的属性。"
        + "【职责边界】只读 —— 不弹浮层、不改文件。要看内容用 image_view。",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "图片绝对路径（单张）" },
          paths: { type: "array", items: { type: "string" }, description: "多张" },
        },
      },
    },
    {
      type: "function",
      name: "image_view",
      description:
        "在应用内弹出「图像工坊」浮层，把图片**展示给用户看**（可放大）。"
        + "【适用场景】用户说「给我看看这张图 / 打开这张图」；或你要把刚生成/编辑的产物**亮给用户**。"
        + "【使用时机】产物落地之后、或在回复里说明之前，让用户眼见为实。"
        + "【职责边界】只读展示、**不自动关闭**（由用户自己关 —— 自动收掉等于没看）。"
        + "⛔ 不要在回复里内联 base64 图片，本工具就是用来替代它的。",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "图片绝对路径" },
          title: { type: "string", description: "浮层标题（缺省用文件名）" },
        },
        required: ["path"],
      },
    },
  ];
}

export function usePart08a(bag: Bag) {function openThread(id: string, freshThread?: Thread | null) {
  return openThreadImpl(bag, id, freshThread);
}

bag.openThread = openThread as typeof bag.openThread;

  /** 归档/删除团队主会话时**级联**处理同簇成员会话（09-14 用户：主会话归档/删除了，侧栏团队条还在）。
   *  根因：成员子线程是主理人调度时新建的长期会话，主会话没了就成了孤儿，聚簇兜底会继续
   *  把它们归在团队名下 → 团队条永远不消失。逐个容错，单个失败不阻塞其余。 */
  const cascadeTeamCluster = async (id: string, action: "archive" | "delete") => {
    const cluster = bag.clusteredSidebar.clusters.find((entry) => entry.lead?.id === id);
    if (!cluster?.members.length) return 0;
    let done = 0;
    for (const member of cluster.members) {
      try {
        await window.codex.request(action === "archive" ? "thread/archive" : "thread/delete", { threadId: member.id });
        bag.threadCacheRef.current.delete(member.id);
        done += 1;
      } catch (error: any) {
        /* 单个失败不阻塞其余。⛔ 幽灵成员分流（09-30 用户归档「交易分析专家团」弹「归档失败」）：
           4 个成员的 rollout 文件已不存在（09-29 在数据管理页删过原档，引擎 sqlite 里的线程记录还在
           ⇒ thread/list 仍返回 ⇒ 侧栏仍显示），引擎原话 `rollout path '<路径>'`。归不了档也删不了，
           但用户意图是**整簇消失** ⇒ 本地移除，否则 done=0 时成员行永不消失。 */
        const msg = String(error?.message ?? error);
        if (/no rollout found|thread[^.]{0,40}not found|failed to read session metadata|rollout path|canonical rollout/i.test(msg)) {
          bag.threadCacheRef.current.delete(member.id);
          bag.setThreads((current) => current.filter((entry) => entry.id !== member.id));
          done += 1;
        }
      }
    }
    if (done) bag.setThreads((current) => current.filter((entry) => !cluster.members.some((m) => m.id === entry.id)));
    return done;
  };
bag.cascadeTeamCluster = cascadeTeamCluster as typeof bag.cascadeTeamCluster;

  async function archiveThread(id: string) {
    // ⛔ 09-26 用户报「点归档没反应」：本函数此前被调用方以 `void` 调用（02-thread-attention-rows
    //    的归档按钮、会话菜单的归档项），引擎 thread/archive 一旦报错（瞬态 / rollout 异常 /
    //    引擎重启窗口），异常在 unhandled rejection 里无声消失 —— 行不消失、无任何提示，
    //    观感就是「点了没反应」。修法 = 失败必须可见：弹错误 toast（带引擎原话），行保持原位。
    try {
      // 归档后提示（09-17 用户要求）：先取名字（归档后列表里就查不到了）
      const archivedName = bag.threadsRef.current.find((entry) => entry.id === id)?.name
        || bag.threadCacheRef.current.get(id)?.name
        || "当前会话";
      await bag.cascadeTeamCluster(id, "archive");
      await window.codex.request("thread/archive", { threadId: id });
      bag.setThreads((current) => current.filter((entry) => entry.id !== id));
      bag.threadCacheRef.current.delete(id);
      if (bag.threadRef.current?.id === id) {
        // 归档当前会话 = 回到全新会话：必须走 startNewThread 完整复位。
        // 之前手工清了一堆状态但漏了 sending/interrupting——会话在运行中被归档后
        // sending 卡 true，发送按钮永远是「停止」，输入框发不出消息。
        bag.startNewThread();
        requestAnimationFrame(() => bag.composerInputRef.current?.focus());
      }
      // 提示浮层（**窗口正中间** / 3 秒自动消失 / 可手动关，09-23 改）；token 递增保证连续归档都拿到完整 3 秒
      bag.setArchiveToast((current) => ({ name: archivedName, token: (current?.token ?? 0) + 1 }));
    } catch (error: any) {
      const msg = String(error?.message ?? error);
      console.error("[archive] 归档失败:", error);
      // ⛔ 幽灵会话分流（09-26 用户报「点归档没反应」的真根因）：rollout 在 sessions/ 与
      //    archived_sessions/ 双份残留时，引擎已不认这条线程，thread/archive 报
      //    `no rollout found`。用户点归档的意图 = 让它从侧栏消失 ⇒ 本地移除即达成意图，
      //    而不是弹「归档失败」让用户反复点。其余错误（瞬态/引擎重启）才按失败提示。
      if (/no rollout found|thread[^.]{0,40}not found|failed to read session metadata|rollout path|canonical rollout/i.test(msg)) {
        bag.setThreads((current) => current.filter((entry) => entry.id !== id));
        bag.threadCacheRef.current.delete(id);
        bag.showToast("已从列表清理", "该会话在引擎中已不存在（可能已归档过或记录丢失），已从侧栏移除");
        return;
      }
      bag.showToast("归档失败", msg.slice(0, 160));
    }
  }
bag.archiveThread = archiveThread as typeof bag.archiveThread;

  async function renameThread(id: string, value: string) {
    const name = value.trim();
    if (!name) return;
    // ⛔ 名字**先落本地覆盖表**（它才是权威）：引擎那份 `name` 会被「该会话第一条用户消息」
    //    顶掉（实测，见 nameOverrides 注释），所以不能反过来依赖引擎回包来显示。
    bag.rememberThreadName(id, name);
    const applyName = (entry: Thread) => entry.id === id ? { ...entry, name } : entry;
    bag.setThreads((current) => current.map(applyName));
    const cached = bag.threadCacheRef.current.get(id);
    if (cached) bag.threadCacheRef.current.set(id, applyName(cached));
    if (bag.threadRef.current?.id === id) {
      const next = applyName(bag.threadRef.current);
      bag.threadRef.current = next;
      bag.setThread(next);
    }
    // 引擎侧只是**尽力同步**（别的客户端 / 引擎自己的标题机制还看它），失败不回滚本地改名。
    let engineError: any = null;
    try { await window.codex.request("thread/name/set", { threadId: id, name }); }
    catch (error: any) { engineError = error; }
    await bag.refreshThreads().catch(() => undefined);
    // ⛔ 措辞必须说清「哪一侧没同步」：改名在本地已经生效，说「重命名失败」会让用户以为白改了
    //    （这正是本 bug 的观感来源之一 —— 引擎侧那份名字随后还会被首条消息顶掉）。
    if (engineError) bag.setNotice(`已改名（引擎侧未同步：${engineError.message}）`);
  }
bag.renameThread = renameThread as typeof bag.renameThread;

  async function clearCurrentConversation() {
    const id = bag.threadRef.current?.id;
    if (!id) return;
    try {
      await window.codex.request("thread/delete", { threadId: id });
    bag.forgetThreadMood(id);
      bag.threadCacheRef.current.delete(id);
      bag.setThreads((current) => current.filter((entry) => entry.id !== id));
      bag.startNewThread();
      await bag.refreshThreads();
      requestAnimationFrame(() => bag.composerInputRef.current?.focus());
      bag.showToast("对话记录已清空", "当前会话已永久删除，可以直接开始新对话");
    } catch (error: any) {
      bag.showToast("清空对话失败", error.message);
    }
  }
bag.clearCurrentConversation = clearCurrentConversation as typeof bag.clearCurrentConversation;

  async function unarchiveThread(id: string) {
    // 同 archiveThread（09-26）：unarchive 也曾被静默吞错（历史归档区点恢复没反应 = 引擎报错看不见）
    try {
      await window.codex.request("thread/unarchive", { threadId: id });
      bag.setThreads((current) => current.filter((entry) => entry.id !== id));
    } catch (error: any) {
      console.error("[unarchive] 取消归档失败:", error);
      bag.showToast("取消归档失败", String(error?.message ?? error).slice(0, 160));
    }
  }
bag.unarchiveThread = unarchiveThread as typeof bag.unarchiveThread;

  /** 删除会话的**无确认内核**：级联成员会话 + 引擎删除 + 本地缓存/侧栏清理 + 当前会话状态复位。
   *  拆出来是为了让「一键释放调度」（它有自己的确认文案）复用同一条级联链路 —— 删一个会话
   *  必须把它的**衍生状态**一起带走：专家团成员会话、会话缓存、供应商登记、当前会话的
   *  运行/计划/目标状态。⛔ 别在别处再写一份简版删除（漏一项就是孤儿）。 */
  async function deleteThreadCore(id: string) {
    await bag.cascadeTeamCluster(id, "delete");
    await window.codex.request("thread/delete", { threadId: id });
    bag.forgetThreadMood(id);
    bag.threadCacheRef.current.delete(id);
    bag.threadProviderRef.current.delete(id);
    bag.setThreads((current) => current.filter((entry) => entry.id !== id));
    if (bag.threadRef.current?.id === id) {
      bag.threadRef.current = null;
      bag.setThread(null);
      bag.setOptimisticInput(null);
      bag.setActiveTurnId(null);
      bag.markThreadStopped(id);
      bag.setWorkStartedAt(null);
      bag.setSystemEvents([]);
      bag.setPlanSteps([]);
      bag.setGoalText("");
    }
  }
bag.deleteThreadCore = deleteThreadCore as typeof bag.deleteThreadCore;

  async function deleteThread(id: string) {
    const cluster = bag.clusteredSidebar.clusters.find((entry) => entry.lead?.id === id);
    const memberCount = cluster?.members.length ?? 0;
    const extra = memberCount ? `\n\n这是「专家团」主会话，将同时永久删除其 ${memberCount} 条成员会话。` : "";
    if (!await bag.openAppConfirm("删除会话", `当前会话及其中的消息、工具记录将被永久删除，此操作无法撤销。${extra}`, "永久删除")) return;
    bag.setOpeningThread(id);
    try {
      await bag.deleteThreadCore(id);
    } catch (error: any) {
      bag.setNotice(`删除任务失败：${error.message}`);
    } finally {
      bag.setOpeningThread(null);
    }
  }
bag.deleteThread = deleteThread as typeof bag.deleteThread;

  /** ⛔ 一键释放调度（用户 09-17 要求：「在调度里面加一个主动释放功能，一键释放后删除旧的调度会话」）:
   *  把全局唯一的调度权从旧持有者手里**收回**，并**删除那条旧调度会话**（级联走 deleteThreadCore）。
   *
   *  为什么需要这个显式入口：持有者是从 thread-runtime 记录**派生**的（第一个 dispatch.enabled 的
   *  线程），而会话被归档/删除时历史上没有任何地方清这条记录 ⇒ 孤儿记录永久占着全局唯一的调度权，
   *  且那条会话往往在侧栏上已经找不到（用户原话：「都关掉了，怎么还提示被锁住了」）。
   *  自动自愈只覆盖「持有者已不在会话列表」的情形；持有者仍在侧栏、用户就是想把它清掉时靠这里。
   *
   *  顺序刻意是「**先释放、后删除**」：万一删除失败（比如引擎那边正在跑），用户至少已经拿回了调度权。
   *  这条路径也会连带清掉 thread-runtime 记录（主进程 thread/deleted 事件 → remove），不再留孤儿。 */
  async function releaseDispatchHolder() {
    const holderId = bag.dispatchOwnerId;
    if (!holderId) return;
    const holder = bag.threads.find((entry) => entry.id === holderId);
    const name = holder ? (cleanThreadDisplayTitle(holder.name, { preview: holder.preview })?.trim() || "另一个会话") : "";
    const who = holder ? `「${name}」` : "那条已不在列表里的旧会话";
    const note = holder ? "" : "（它已不在会话列表里，这里只会清掉残留的调度占用）";
    if (!await bag.openAppConfirm(
      "释放并删除调度会话",
      `将收回调度权限，并永久删除占用者${who}及其全部消息与工具记录 —— 此操作无法撤销。${note}`,
      "释放并删除",
    )) return;
    bag.setDispatchBusy(true);
    try {
      await window.codex.releaseDispatch(holderId);   // ① 先夺回调度权（即使②失败也已解锁）
      if (holder) await bag.deleteThreadCore(holderId);   // ② 再把旧会话连同衍生态一起删掉
      else {
        bag.threadCacheRef.current.delete(holderId);
        bag.setThreads((current) => current.filter((entry) => entry.id !== holderId));
      }
      bag.showToast("调度已释放", holder ? `「${name}」已删除，现在可以在本会话开启调度` : "残留的调度占用已清掉");
    } catch (error: any) {
      bag.setNotice(`释放调度失败：${error.message ?? error}`);
    } finally {
      bag.setDispatchBusy(false);
      await bag.refreshDispatchOwner().catch(() => undefined);
      void bag.refreshThreads();
    }
  }
bag.releaseDispatchHolder = releaseDispatchHolder as typeof bag.releaseDispatchHolder;

  async function deleteThreadsByCwd(cwd: string) {
    /* ⛔ 必须按**有效 cwd**（侧栏项目视图的归组口径）取目标 —— 09-25 加「被调度会话跟随主对话
       项目地址」后，一个项目组里含 own cwd 不同的被调度会话。仍按 entry.cwd 过滤会有两个错：
       ① 组里看得见的被调度会话删不掉（留在原地变孤儿行）② 反把 own cwd 命中但已归到**别的**
       项目下的会话删掉（用户没在该项目里看到它）。
       ⛔ 直接复用 part03 算好的 `bag.dispatchCwdMap`（**同一份口径**，别在这里重算）——
       重算等于留第二份会漂移的真相源（09-25 代码审查）。part08 在 part03 之后运行，映射已就绪。 */
    const cwdMap = bag.dispatchCwdMap ?? {};
    const ids = bag.threads.filter((entry) => (cwdMap[entry.id] ?? entry.cwd) === cwd).map((entry) => entry.id);
    if (!ids.length) { bag.setNotice("该项目下已无对话"); return; }
    if (!(await bag.openAppConfirm("删除整个项目", `项目「${basename(cwd)}」下的 ${ids.length} 条任务将被永久删除，此操作无法撤销。`, "永久删除"))) return;
    for (const id of ids) {
      try {
        await window.codex.request("thread/delete", { threadId: id });
    bag.forgetThreadMood(id);
        bag.threadCacheRef.current.delete(id);
      } catch (error: any) {
        bag.setNotice(`删除任务失败：${error.message ?? error}`);
      }
    }
    const removed = new Set(ids);
    bag.setThreads((current) => current.filter((entry) => !removed.has(entry.id)));
    if (bag.threadRef.current && removed.has(bag.threadRef.current.id)) {
      bag.threadRef.current = null;
      bag.setThread(null);
      bag.setOptimisticInput(null);
      bag.setActiveTurnId(null);
      for (const id of ids) bag.markThreadStopped(id);
      bag.setWorkStartedAt(null);
      bag.setSystemEvents([]);
      bag.setPlanSteps([]);
      bag.setGoalText("");
    }
    if (bag.projectFilter === cwd) bag.setProjectFilter(null);
  }
bag.deleteThreadsByCwd = deleteThreadsByCwd as typeof bag.deleteThreadsByCwd;

  /** 动态工具面（thread/start 与 thread/resume 共用）：引擎 resume 的 schema 实证也接受
   *  dynamicTools——不带上 = 旧会话恢复的是创建时的工具快照，新工具（如技能纪律四件套）
   *  永远进不去（Codex 反馈「我工具列表里没有 skill_search」的根因）。 */
  const buildDynamicTools = useCallback(async (): Promise<any[]> => {
    const builtinCfg = await window.codex.readBuiltinPlugins().catch(() => null);
    /* ⛔ 调度工具面的**完整来龙去脉**（10-04 用户拍板"调度开关就要对应生效工具"→ 引擎 0.157
       起 MCP 工具整批延迟暴露、不可达 → 10-05 改回渲染层注册 dynamicTools）见下方
       `agent_invoke` / `agent_archive_sessions` 两处注册上方的注释，那里是唯一真相源。 */
    return [
      /* 独立能力工具（10-09）：图像四件套各自注册成独立 dynamicTool（模型工具面里一眼可见，
         不再包一层 `harness_tools`；也不共用执行通道 —— 见下面 imageToolDefs 的头注）。
         ⛔ 原先的 `generate_image`（渲染层老实现）**已退役** —— 同一个能力挂两个名字，模型只会
            挑直白的那个、另一套被绕过（项目踩过：subagent_invoke 与 agent_invoke 并存）。
            生图统一走 `image_generate`（image-lab:generate，带「图像工坊」浮层联动）。 */
      ...imageToolDefs(),
      ...(builtinCfg?.vision?.enabled !== false && builtinCfg?.vision?.baseUrl ? [{
        type: "function",
        name: "describe_image",
        description: "当你看不清或无法解析用户提供的图片内容时，调用此工具让视觉模型描述图片并把结果作为依据继续回答。",
        inputSchema: { type: "object", properties: { imageUrl: { type: "string", description: "图片的本地文件路径或 http(s) 地址（本地图片直接传路径，会自动读取；生成/保存下来的图片就用它的路径）。⛔ 不要传 data URL —— 内联 base64 会把几 MB 文本灌进对话历史" }, prompt: { type: "string", description: "你想让视觉模型关注的问题，可省略" } }, required: ["imageUrl"] },
      }] : []),
      ...(bag.memoryEnabled ? [
        { type: "function", name: "memory_recall", description: "按当前任务查询相关的分类记忆。", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
        /* ⛔⛔ 10-05 统一记忆：工具名从 `memory_save` 改成 `memory_write`，**与被调度角色同名**。
           改造前主会话用 memory_save、角色用 role_memory_save（两套语义、两份说明书），
           模型得自己判断这次该用哪个 —— 那是「两套同名能力」的变体（项目踩过：
           agent_invoke 与 subagent_invoke 并存 ⇒ 专家团被绕过）。
           ⛔ 旧名 `memory_save` 仍可调用（主进程同一 handler），只是**不再出现在工具面里** ——
              留着的唯一理由是老会话的上下文里记着它。 */
        { type: "function", name: "memory_write", description: "保存一条记忆。两种作用域：session（默认）= 只属于本会话的私事，别的会话看不到；project = 全项目共享，所有会话与智能体（子智能体 / 专家 / 专家团）都能读到。⛔ project 是公共知识，别把一次性的中间结论写进去。分类沿用五类，别自造；相同内容会自动去重。", inputSchema: { type: "object", properties: { scope: { type: "string", enum: ["session", "project"], description: "记忆作用域：session=本会话私有（默认），project=全项目共享" }, category: { type: "string", enum: ["用户偏好", "项目背景", "工作流/SOP", "任务经验", "临时上下文"] }, content: { type: "string", description: "记忆正文（单条上限 2000 字）" }, weight: { type: "number", description: "重要性 0..1（省略则按分类取默认）" }, pinned: { type: "boolean", description: "钉住：蒸馏与裁剪时永不删除" } }, required: ["content"] } },
      ] : []),
      /* ── 调度工具面（10-05 修正；⛔ 这里是「调度开关 → 生效工具」联动的**唯一**落点）──────
         ⛔⛔ 10-04 拍板「三类对象统一走内置 MCP」本身没错，但**引擎 0.157 改了工具面策略**：
            内置 MCP（harness-dispatch）的工具整批不进模型工具面。隔离复现（2026-10-05，
            独立 CODEX_HOME + mock provider 截获引擎真实请求体）：`input[0].type==="additional_tools"`
            只有 functions / clock / collaboration 三组 11 个工具，`agent_invoke` 出现 **0** 次；
            而 `functions.exec` 的说明里明写「Some deferred nested tools may be omitted from this
            description … they are still available on the global `tools` object and listed in
            ALL_TOOLS」—— MCP 工具被"延迟暴露"了（引擎 feature `tool_search_always_defer_mcp_tools`
            已 removed=true，即该行为永久生效）。
            真机症状（用户 10-04 报「调度工具用不了」）：会话 01a1078e 里模型连调 `expert_list` /
            `agent_invoke` 都得到 `unsupported call`（codex_core::tools::router，23:36:22 / 23:36:32），
            而宿主同一时刻还注入了「【调度已开启】…可派对象：知微…」的告知 ⇒ 告知成了空头支票。
         ✅ 实测回到 dynamicTools 后（与宿主完全相同的 app-server 握手验证）：
              `agent_invoke` 会以**非延迟**条目出现在 exec 说明里（带完整签名，模型一眼看得见），
              模型调用后由引擎以 `item/tool/call {tool:"agent_invoke", arguments}` 发回宿主执行。
         ⛔⛔ **注册不带开关条件**：dynamicTools 只在 thread/start（新会话）与 thread/resume
            （切会话）生效，用户中途打开调度时工具面**不会重建** ⇒ 带条件就会出现
            「开关打开了却仍然没有工具」——那正是用户最初报的现象。开关的硬拦一律放执行端
            （canDispatchFrom + dispatchKindAllowed，拒绝文案自带「当前开启：X」），
            模型据此改派或如实回报，比"工具凭空消失"可解释得多。
         ⛔ 执行端复用 IPC（agents:invoke / agents:archive），**不新增通道** —— 与 MCP 执行端
            共用同一个 runDelegatedTask 硬闸（"被委派会话不许再套娃" + "按勾选拦 kind"）。
         ⛔ 这里曾注册过 `subagent_invoke`（subAgentTools）：那条通道与「调度」开关**完全脱钩**、
            还与 agent_invoke 形成两套调度工具 ⇒ 模型只挑名字最直白的它，专家/专家团永远被绕过
            （用户症状：「只能调度子智能体」）。已整体删除，⛔ 不许再加回来。 */
      {
        type: "function",
        name: "agent_invoke",
        description: bag.activeDispatch?.enabled && bag.dispatchInfoRef.current.description
          ? bag.dispatchInfoRef.current.description
          : DISPATCH_TOOL_DESC_FALLBACK,
        inputSchema: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["expert", "team", "member", "subagent"], description: "expert=单个专家, team=专家团, member=专家团某成员, subagent=子智能体。⛔ 只能传本会话已开启的类别" },
            name: { type: "string", description: "对象名称（专家名 / 团名 / 某成员名 / 子智能体名）" },
            query: { type: "string", description: "交给它的任务描述（必须自包含：它看不到你和用户的对话）" },
          },
          required: ["kind", "name", "query"],
        },
      },
      {
        type: "function",
        name: "agent_archive_sessions",
        description: "征得用户同意后，归档本次调度产生的临时会话（threadIds 传那些调度会话的 id；省略则归档本会话派出的全部）。",
        inputSchema: {
          type: "object",
          properties: { threadIds: { type: "array", items: { type: "string" }, description: "要归档的调度会话 id 列表" } },
          required: [],
        },
      },
      /* ⭐ 能力网关（10-05 立 / 10-09 收窄）：内置 MCP 的工具面在引擎 0.157 后整批「延迟暴露」，
         模型直接调用一律 `unsupported call` ⇒ 定时任务 / 知识库 / 组件库 / 视频 / 语音 / 工作流 /
         专家与子智能体管理 / 连接器注册这些能力对模型**全不可达**。dynamicTools 是唯一可见通道。
         ⛔ 10-09 用户三次点名的**最终粒度**：图像四件套（生图/修图/元信息/预览）拆成**独立工具**
            （见下面的 imageToolDefs，各自还有自己的 IPC）；**其余不逐个拆** —— 25 份 schema 全拆 =
            每次请求常驻约 25KB，得不偿失 ⇒ 仍收在**这一个网关工具**里：模型传 name + args 调它，
            主进程原样转发到既有执行端（同一套实现、同一套闸）。参数拿不准时先传 name="list"。
         ⛔ 有专用工具的那几个（agent_invoke / agent_archive_sessions）**不在**网关里 —— 一个能力挂
            两个名字，模型只会用最直白的那个、另一套被绕过（项目踩过一次：subagent_invoke）。 */
      {
        type: "function",
        name: "harness_tools",
        description:
          "调用宿主的其余内置能力。可用：scheduler_list / scheduler_save / scheduler_run / scheduler_delete（定时任务）；"
          + "knowledge_search / knowledge_add（项目知识库）；ui_component_search / ui_component_get（界面组件库）；"
          + "video_generate / video_status / video_concat（视频）；voice_generate（配音 WAV）；"
          + "voice_announce（**立刻念一句话**给用户听，≤120 字，不必等本轮回复结束；实时语音通话中不可用）/ voice_announce_stop（立刻停止播报、清掉排队）/ voice_speak_reply（把**本条回复的正文**边写边念 —— 不是每条都念，由你判断何时值得开口）；"
          + "workflow_read / workflow_writeback（工作流看板）；expert_list / expert_save / subagent_save（专家与子智能体管理）；"
          + "preview_3d（3D 模型预览：拿到 .glb/.gltf 后在应用内弹出可旋转查看的弹窗）；"
          + "wallpaper_set（壁纸：pattern/particles/vanta/custom 四类，Codex 可自助做图设壁纸）；"
          + "connector_register（注册 MCP 连接器）。传 name=\"list\" 可拿到每个能力的完整参数说明（不确定参数就先调它）。"
          + "⛔ 调度专家 / 专家团 / 子智能体请用专用工具 agent_invoke，不在这里。"
          + "⛔ 图像生成与编辑（image_generate / image_edit / image_info / image_view）是**各自独立的工具**，本工具里调不到 —— 直接按名字调它们。"
          + "⛔ 若你直接调用某个内置能力名（而不是走本工具）却报 unsupported call，说明**本会话的工具面是旧的**"
          + "（创建于能力网关之前）—— 直接告诉用户「这个任务需要新建一个才能用」，不要重试、不要换个名字再试。",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "工具名；传 \"list\" 返回全部能力与它们的参数说明" },
            args: { type: "object", description: "该工具的参数对象（没有参数就省略）" },
          },
          required: ["name"],
        },
      },
      // RPA 配方与任务清单：让 agent 能存配方/跑配方/维护清单/向用户提问
      { type: "function", name: "rpa_save", description: "把刚跑通的一条自动化流程保存为 RPA 配方，下次可直接复用执行。steps 按顺序写清每一步（网址/点击/输入/桌面操作等），kind 选 browser（浏览器）/desktop（桌面）/mixed。", inputSchema: { type: "object", properties: { name: { type: "string", description: "配方名称，如「每天导出日报」" }, desc: { type: "string", description: "一句话说明用途" }, kind: { type: "string", enum: ["browser", "desktop", "mixed"] }, steps: { type: "array", items: { type: "string" }, description: "按顺序的执行步骤" }, target: { type: "string", description: "起始网址或目标程序，可省略" } }, required: ["name", "steps", "kind"] } },
      { type: "function", name: "rpa_run", description: "列出已保存的 RPA 配方（不传 name），或按名称执行某条配方。执行时按 steps 逐步复现自动化流程。", inputSchema: { type: "object", properties: { name: { type: "string", description: "要执行的配方名称；省略则返回全部配方清单" } } } },
      { type: "function", name: "task_add", description: "把一条任务加入用户的任务清单（多步任务开工时先建清单；输入框上方的「步骤 N/M」胶囊实时展示这份清单，悬停可展开）。", inputSchema: { type: "object", properties: { text: { type: "string" }, priority: { type: "string", enum: ["low", "medium", "high"] } }, required: ["text"] } },
      { type: "function", name: "task_update", description: "更新任务清单：列出全部任务（不传任何参数）、改状态或删除。status 只有 todo/doing/done。⛔ 每完成一步立刻把那一步更新为 done（正在做的那步置 doing），别攒到最后一次性更新。", inputSchema: { type: "object", properties: { id: { type: "string" }, status: { type: "string", enum: ["todo", "doing", "done"] }, text: { type: "string" }, priority: { type: "string", enum: ["low", "medium", "high"] }, done: { type: "boolean", description: "删除任务" } } } },
      { type: "function", name: "agent_ask", description: "在对话里向用户展示一组选项并等待选择（提问时必须给出选项）。**单选还是多选由你根据问题性质决定**：答案互斥（选一条就够）传 multiple=false 或省略；多项可以并存（要改哪几个文件 / 勾选要处理的项）传 multiple=true 让用户勾选多条。用户先选中、再点确认按钮提交，勾选与自定义输入会用「；」拼接返回。options 里第一项会作为推荐项高亮，也可以留空让用户自由输入。", inputSchema: { type: "object", properties: { question: { type: "string", description: "要问用户的问题" }, options: { type: "array", items: { type: "string" }, description: "2-4 个候选选项，第一项为推荐" }, multiple: { type: "boolean", description: "true = 多选（用户可勾选多项）；false/省略 = 单选（只能选一项）。两种都是：用户先选中、再点「确认/提交」按钮才把答案回给你" }, allowFree: { type: "boolean", description: "是否允许自由输入，默认允许" } }, required: ["question", "options"] } },
      // 技能运用纪律：缺技能自主搜市场/安装，缺连接器先查模板（安装前必须 agent_ask 征得同意）
      { type: "function", name: "skill_search", description: "在内置技能市场按关键词搜索技能（返回名称/简介/安装状态）。当任务没有合适技能、你想找现成技能提效时调用。", inputSchema: { type: "object", properties: { query: { type: "string", description: "关键词，如 excel、爬虫、pdf" } }, required: ["query"] } },
      { type: "function", name: "skill_install", description: "从技能市场安装一个技能（不重启应用，下一回合即可用）。传 query 自动匹配最相似的技能；装完先读它的 SKILL.md 再按说明书使用。", inputSchema: { type: "object", properties: { query: { type: "string", description: "技能名或关键词，优先用 skill_search 结果里的准确名称" } }, required: ["query"] } },
      { type: "function", name: "connector_search", description: "列出内置 MCP 连接器模板与已配置状态（浏览器自动化、桌面自动化、GitHub 等）。需要某种外部服务能力但当前没有对应工具时调用。", inputSchema: { type: "object", properties: { query: { type: "string", description: "过滤关键词，可省略" } } } },
      { type: "function", name: "connector_install", description: "安装一个 MCP 连接器模板（写入配置并重启引擎，会中断当前回合）。必须先用 agent_ask 征得用户同意才能调用；安装后提醒用户重新发一条消息继续。", inputSchema: { type: "object", properties: { templateId: { type: "string", description: "connector_search 结果里的模板 id" } }, required: ["templateId"] } },
      /* ⭐ 前端开发（10-05 立；两轮改名：界面草图 → 手机前端UI → 前端开发。用户点名「涉及手机前端
         开发能主动调用这个工具做手机前端UI」+「网页版也有…工具内容也更新」）—— 读 + 写两个工具，
         操作的是用户在应用内摆的前端界面稿（m3e-canvas 画布：手机 / 电脑 / 网页三种形态）。
         ⛔ 写入**不碰画布存储**：渲染层会话（src/features/ui-sketch/sketch-session.mjs）把文档
            编码成上游自己的分享哈希（`#docz=` → hashchange → arrive()）挂到 iframe 上 ——
            走它自己的正门（有校验、可 Ctrl+Z 撤销）；直接改 localStorage 会绕过这两样。
         ⛔ 写入口**只有这一个名字**（项目踩过：一个能力挂两个工具名 ⇒ 模型只挑直白的那个，
            另一套被绕过）。⛔ 注册**不带开关条件**（理由同 agent_invoke：dynamicTools 只在
            thread/start 与 resume 时定死，带条件 = 中途变化不生效）。
         ⛔ 画布没打开时工具会**自动打开界面窗**（等就绪最多 15s）—— 用户点的那一下与模型
            发起的这一次共用同一条会话（sketch-session.mjs 是唯一状态源）。
         ⛔ 组件细节（44 种字段速查）在内置技能 frontend-canvas 里，描述只列名字 —— 全塞进
            description = 每轮请求都背着几 KB（渐进披露纪律，同第 12 条）。 */
      {
        type: "function",
        name: "frontend_get_doc",
        description:
          "读取「前端开发」画布上的完整设计文档（用户在应用内拼的前端界面稿：frames=屏、groups=部件组；手机屏 412×892、电脑屏 1280×800，platform 选 android/web）。"
          + "返回文档 JSON 与一句摘要。做手机端 / 电脑端 / 网页界面，或用户说「看看我的界面 / 继续拼这个 UI / 按它改」时先调它 —— "
          + "⛔ 不要凭想象描述画布内容，一切以本工具的返回为准。画布没打开时会自动打开。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        type: "function",
        name: "frontend_apply_doc",
        description:
          "把一份设计文档写回「前端开发」画布（用户实时看到，可继续手绘、可 Ctrl+Z 撤销）—— 拼装 / 迭代前端界面的正门。"
          + "用法：先 frontend_get_doc 拿当前文档，**在它的基础上改**（追加屏 / 加部件 / 调坐标 / 连导航），把改完的完整文档传回来。"
          + "要求：每屏 id/name/x/y（电脑屏另给 w:1280/h:800）；每组 id/x/y/axis(items 不能空)；每部件 id/kind/label/icon/variant。"
          + "kind 共 44 种：topAppBar / bottomNav / navRail / tabs / searchBar / stepper / button / iconButton / fab / extendedFab / splitButton / fabMenu / chip / segmentedButton / toolbar / card / listItem / box / bottomSheet / dialog / snackbar / expansionPanel / tooltip / textField / select / switch / checkbox / radio / slider / datePicker / timePicker / rating / text / image / avatar / skeleton / timeline / carousel / camera / map / divider / loadingIndicator / linearProgress / circularProgress；"
          + "variant 只认 filled / tonal / elevated / outlined / text。"
          + "坐标是画布坐标：手机屏 412×892、电脑屏 1280×800、屏与屏间距 80（放不下就往右排）。"
          + "⛔ 一次传整份文档，别多次小修；⛔ 别编造 get_doc 没返回过的字段（get 返回里的 promptEdit / promptOptions / customPalette / dynamicColor / theme 属用户侧设置，原样带回去别改）。"
          + "完整字段说明读内置技能 frontend-canvas。",
        inputSchema: {
          type: "object",
          properties: { doc: { type: "object", description: "完整的设计文档（frames + groups；结构照 frontend_get_doc 的返回）" } },
          required: ["doc"],
        },
      },
    ];
  }, [bag.memoryEnabled]);
bag.buildDynamicTools = buildDynamicTools as typeof bag.buildDynamicTools;

  async function createEmptyThread(): Promise<Thread | null> {
    const dynamicTools = await bag.buildDynamicTools();
    // 首次对话身份引导：**只在「从没打过招呼」时注入一次**（09-12 用户反馈修正）。
    // 旧判定用 `onboarded`（用户真的回答了才为 true）→ 不回答的用户每个新会话都被
    // 强制引导一遍。现在只要问过一次就落 `greeted=true`，后续新会话一律不带引导，
    // 直接开始干活。
    const shouldGreet = bag.identityGreeted === false;
    if (shouldGreet) {
      dynamicTools.push(IDENTITY_ONBOARD_TOOL as unknown as (typeof dynamicTools)[number]);
      // 落标记：本轮之后的新会话不再引导。失败也不影响本次发送（内存里也置 true）。
      void window.codex.markIdentityGreeted?.().catch(() => undefined);
      bag.setIdentityGreeted(true);
    }
    const memoryTools = dynamicTools.length ? { dynamicTools } : {};
    const onboardingInstructions = shouldGreet ? IDENTITY_ONBOARD_INSTRUCTIONS : null;
    // 新建会话即刻带上「会话作用域」（此时会话 ID 还没生成 → 块里标「未登记」，
    // thread/start 成功后由 pushSessionScope 用真实 ID 再补一发）。三段共存：全局基线 +
    // 会话作用域 + 引导语，顺序固定，避免把语言/内置工具说明或引导语顶掉。
    const scopeSeed = composeScopeInstructions(await bag.loadBaseInstructions(), sessionScopeBlock({
      threadId: "",
      model: bag.selectedModel?.model ?? modelName(bag.modelId) ?? "",
      provider: String(bag.customModel?.provider ?? ""),
      effort: String(bag.effort ?? ""),
      sandbox: String(bag.sandbox ?? ""),
      approval: String(bag.approvalPolicy ?? ""),
      workspace: String(bag.welcomeScratchDir ?? bag.workspace ?? ""),
    }));
    const developerInstructions = [scopeSeed, onboardingInstructions].filter(Boolean).join("\n\n");
    const started = await window.codex.request("thread/start", {
      model: bag.selectedModel?.model ?? modelName(bag.modelId),
      // 欢迎页「无项目」模式：本会话用自动创建的独立临时目录（每个会话单独一个）；
      // 正常模式跟随全局项目地址。会话建立后清掉 scratch 记录——下次再选「无项目」
      // 会新建另一个目录，实现「每次新建单独目录」。
      cwd: bag.welcomeScratchDir ?? bag.workspace,
      approvalPolicy: bag.approvalPolicy,
      sandbox: bag.sandbox,
      sandboxPolicy: sandboxPolicy(bag.sandbox, bag.welcomeScratchDir ?? bag.workspace),
      personality: bag.selectedModel?.supportsPersonality ? bag.personality : null,
      developerInstructions,
      ...bag.providerConfig,
      ...memoryTools,
    });
    if (bag.welcomeScratchDir) bag.setWelcomeScratchDir(null);
    const active = started.thread as Thread;
    bag.threadRef.current = active;
    bag.setThread(active);
    if (started?.thread?.id) {
      // ⛔ 多会话/多窗口作用域（09-13 收尾）：新建会话时把「创建那一刻的全局默认」
      // **烙成该会话自己的初始记录**（模型/effort/权限）。此后该会话的回填与重启兜底
      // 全部走会话级键，不再读全局——彻底切断「其他会话后来改全局默认」的污染路径。
      // （thread/start 传入的 model/effort/sandbox/approval 就是这些全局值，烙进去与
      //   引擎侧会话创建时的真实状态一致。）
      const tid = started.thread.id;
      if (!loadThreadModel(tid)) saveThreadModel(tid, bag.modelId);
      if (!loadThreadEffort(tid) && bag.effort) saveThreadEffort(tid, bag.effort);
      saveThreadPermissions(tid, bag.sandbox, bag.approvalPolicy);
      // 会话作用域用真实会话 ID 补发一发（thread/start 那发块里会话 ID 只能标「未登记」）：
      // 空会话此刻可能还没有 rollout，失败也无所谓——首次发消息时 updateThreadSettings 会再补。
      void bag.pushSessionScope(tid);
    }
    return active;
  }
bag.createEmptyThread = createEmptyThread as typeof bag.createEmptyThread;
  return { openThread, cascadeTeamCluster, archiveThread, renameThread, clearCurrentConversation, unarchiveThread, deleteThreadCore, deleteThread, releaseDispatchHolder, deleteThreadsByCwd, buildDynamicTools, createEmptyThread };
}
