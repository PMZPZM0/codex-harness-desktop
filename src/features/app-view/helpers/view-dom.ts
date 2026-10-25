/**
 * app-view/helpers/view-dom（09-22 架构改造：从 helpers.tsx 按功能域拆出，纯搬迁）
 *
 * 域：视图交互支撑（附件 chip / 发送动画 / 滚动定位 / 揭晓步进）
 * 符号（4）：createInlineAttachmentChip / armSendAnimationClaim / jumpToTurn / revealStepFor
 *
 * 代码与拆分前逐字一致；依赖边经 AST 依赖图核对，**不跨模块** ⇒ 本文件不 import 同目录其他模块。
 */
import { armSendAnimationClaim as armSendAnimationClaimLib } from "../../../lib/send-anim.mjs";
import { basename } from "../../../lib/basename";
import { COMPOSER_CHIP_ICON } from "../../../features/shared/COMPOSER_CHIP_ICON";
import { sendAnimStore } from "../../../lib/send-anim-store";
import { COMPOSER_FILE_CHIP_ICON } from "../constants";
import { imageDisplaySrc } from "../../../lib/image-src.mjs";



export /** 生成内联附件 chip（contenteditable=false）：点主体打开/预览，点 X 删除；**按住可拖动排序**。
 *  图片与文件同一套外形：图片用真实缩略图、文件用图标。
 *  ⛔ 拖动用 Pointer Events（HTML5 draggable 在 contenteditable 里会被编辑器吞掉，实测拖不动）。 */
function createInlineAttachmentChip(kind: "image" | "file", path: string, onRemove: (path: string) => void, onOpen: (path: string) => void, onChange: () => void): HTMLElement {
  const image = kind === "image";
  const chip = document.createElement("span");
  chip.className = `composer-image-chip-inline composer-attach-chip-${kind}`;
  chip.setAttribute("contenteditable", "false");
  chip.setAttribute("data-attach-kind", kind);
  chip.setAttribute("data-attach-path", path);
  const iconHtml = image
    ? `<img class="composer-image-chip-thumb" src="${imageDisplaySrc(path)}" alt="" draggable="false">`
    : COMPOSER_FILE_CHIP_ICON;
  chip.innerHTML = `<span class="composer-image-chip-icon">${iconHtml}</span><span class="composer-image-chip-name"></span><button type="button" class="composer-image-chip-close" title="${image ? "移除图片" : "移除文件"}">×</button>`;
  chip.querySelector(".composer-image-chip-name")!.textContent = basename(path);
  let moved = false;
  chip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".composer-image-chip-close")) return;
    const root = chip.parentElement;
    if (!root) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const rect0 = chip.getBoundingClientRect();
    const grabX = startX - rect0.left;
    const grabY = startY - rect0.top;
    let dragging = false;
    let gap: HTMLElement | null = null;
    moved = false;
    try { chip.setPointerCapture(event.pointerId); } catch { /* 合成事件下不可捕获 */ }
    const placeGapAtPointer = (x: number, y: number) => {
      if (!gap) return;
      let ref: Node | null = null;
      for (const child of Array.from(root.childNodes)) {
        if (child === gap) continue;
        const range = document.createRange();
        range.selectNode(child);
        const rect = range.getBoundingClientRect();
        const sameLine = y >= rect.top - 2 && y <= rect.bottom + 2;
        if (y < rect.top || (sameLine && x < rect.left + rect.width / 2)) { ref = child; break; }
      }
      try { root.insertBefore(gap, ref); } catch { /* 非法落点忽略 */ }
    };
    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      if (!dragging) {
        dragging = true;
        moved = true;
        chip.classList.add("dragging");
        /* 真·跟手：原 chip 自己 fixed 跟随指针，原位留一个等宽虚线占位（不用克隆，避免被重建吞掉）。 */
        gap = document.createElement("span");
        gap.className = "composer-chip-gap";
        gap.style.width = `${rect0.width}px`;
        gap.style.height = `${rect0.height}px`;
        root.insertBefore(gap, chip);
        chip.style.position = "fixed";
        chip.style.left = `${rect0.left}px`;
        chip.style.top = `${rect0.top}px`;
        chip.style.width = `${rect0.width}px`;
        chip.style.margin = "0";
        chip.style.zIndex = "9999";
        document.body.appendChild(chip);
      }
      chip.style.left = `${ev.clientX - grabX}px`;
      chip.style.top = `${ev.clientY - grabY}px`;
      placeGapAtPointer(ev.clientX, ev.clientY);
      ev.preventDefault();
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      chip.classList.remove("dragging");
      if (gap) {
        try { root.insertBefore(chip, gap); } catch { root.appendChild(chip); }
        gap.remove();
        gap = null;
      }
      chip.style.position = "";
      chip.style.left = "";
      chip.style.top = "";
      chip.style.width = "";
      chip.style.margin = "";
      chip.style.zIndex = "";
      if (dragging) onChange();
    };
    /* ⛔ 必须挂 window（capture）：chip 为跟手会挪到 body，元素级监听会随 DOM 移动/重建失联。 */
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
  });
  chip.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (moved) { moved = false; return; }
    if ((event.target as HTMLElement).closest(".composer-image-chip-close")) {
      chip.remove();
      onRemove(path);
      onChange();
      return;
    }
    onOpen(path);
  });
  return chip;
}

export /** 官方订阅额度徽标：当前供应商是 openai-official 时显示，5 分钟轮询 wham/usage 与官方同步；弹窗看原始明细。 */
/** wham/usage → 可视化面板数据：主/次窗口用量、档位、状态（官方字段变动手动适配） */
/** 重置倒计时：官方 reset_at（epoch 秒）→「X 小时 Y 分后重置（HH:mm）」 */
/** 中转站余额徽标：当前供应商是中转站生成的（relay-active-v1）时显示套餐余量或账户余额；点击弹明细。 */
/** 分组名清洗：去掉站方加的装饰性 emoji/符号，截断超长名（完整名走 title 悬停查看）。 */
/** OpenAI 官方订阅卡：ChatGPT 设备码登录（引擎原生 codex login --device-auth，无需本地回调端口）。
 *  启用后引擎配置不写 model_provider，走内置 openai + auth.json 的 ChatGPT 凭据（订阅额度）。 */
/** 额度 JSON → 进度条数据：宽松收集 percent 字段（官方结构变动时自动适配），最多 5 条 */
/** OpenAI 订阅页（设置 → 账户 → OpenAI 订阅）：监控面板 + 多账号批量管理。 */



/** 导入的会话记录卡：随首条消息附上的外部对话记录折叠成一行备注，点开看全文。
 *  pending 模式 = 尚未发送的预览（新会话第一条消息发出前展示在消息区顶部）；
 *  已发送的消息卡由 UserMessageView 按 refs.imported 渲染（pending=false）。 */

/** 空会话（导入后、尚未发送）的消息区顶部预览：只挂载一次即读回记录全文，避免大文本参与流式渲染 */

/** 刚发送出去的用户消息 id 集合（渲染层特效锚点）：send/编辑重发创建乐观气泡时登记，
 *  UserMessageView 挂载命中即播放「发送出去」入场特效并从集合删除——历史消息/切会话
 *  重挂载不会误播，乐观消息被服务端消息替换后（id 不同）也不会重复播放。 */
function armSendAnimationClaim(messageText: string) {
  armSendAnimationClaimLib(sendAnimStore, messageText, Date.now());
}

export /** 真实消息挂载时认领入场动画：返回**距发送已流逝的毫秒数**（供负 animation-delay 续播相位），
 *  不认领/该跳过时返回 null。详见 src/lib/send-anim.mjs 的说明。 */

/** 消息里的内联附件 chip：外观与输入框**逐字一致**（同一个 `composer-image-chip-inline`），
 *  另外加上两件输入框里不需要、但消息里需要的能力：
 *   ① **点击** → 图片走大预览（灯箱）、文件走打开文件；
 *   ② **悬停** → 图片弹出自适应小预览（`.message-attach-preview`，绝对定位浮层，不占布局）。
 *  ⛔ 必须是**模块级**组件（写成内联箭头函数会每次 render 换身份 → 图片子树重挂、预览闪烁）。 */


/** 刻度尺滚轮一次滑动多少刻度 = 消息懒加载的一页（与 TURNS_PAGE 同值；MessageRuler 是
 *  模块级组件、取不到 App 内的常量，故此处再声明一份，改懒加载页大小时两处一起改）。 */


/** 刻度尺跳转：与 App 状态无关，提到模块级保证引用恒定（memo 才拦得住打字时的重渲染） */
function jumpToTurn(id: string) {
  document.getElementById(`turn-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export /** 刻度尺只反映用户消息：agent 出字时 turns 每帧换引用，若照单全收，
 *  刻度尺会每帧重渲染（遍历全部消息），白吃掉一帧预算。
 *  改成比较用户消息指纹——纯字符串拼接，远便宜于重渲染整棵刻度尺。 */
function revealStepFor(remaining: number) {
  // 超大输出（命令日志等可能几万字符）：≤1.5s 追完，不拖沓
  if (remaining > 3600) return Math.max(32, Math.ceil(remaining / 90));
  if (remaining > 1200) return 10;   // 长文：快速追（约 625 字符/秒）
  if (remaining > 300) return 4;     // 中段：平稳流出（约 250 字符/秒）
  return 2;                          // 尾段：精细逐字（约 125 字符/秒，打字感）
}