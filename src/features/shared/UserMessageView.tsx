/** UserMessageView（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { ThreadItem } from "../../lib/thread-item";
import { Turn } from "../../lib/turn";
import { useUserName, UserAvatar } from "../../components/UserAvatar";
import { useState, useEffect, useMemo } from "react";
import { justSentIds } from "../../lib/just-sent-ids";
import { claimSendAnimation } from "../../lib/claim-send-animation";
import { itemText } from "../../lib/item-text";
import { parseUserRefs, userDisplayText, formatThreadReferenceBlock } from "../../lib/user-refs";
import type { ParsedUserRefs } from "../../lib/user-refs";
import { isImagePart, promptImagePaths, imagePartSrc, splitPromptSegments } from "../../lib/prompt-images";
import { stripAttachmentTokens, splitAttachmentSegments } from "../../lib/composer-attachments.mjs";
import { lookupMessageOriginal } from "../../lib/user-message-originals.mjs";
import { isImagePath } from "../../lib/is-image-path";
import { basename } from "../../lib/basename";
import { attachChipName } from "../../lib/attach-chip-name.mjs";
import { User, Sparkles, FileText } from "lucide-react";
import { UserRefsRow } from "./InlineCards";
import { ImportedRecordCard } from "./ImportRecords";
import { openImageLightbox } from "../../lib/ui-channels";
import { MessageFooter } from "./MessageFooter";
import { hk } from "../../lib/hk";
import { COMPOSER_CHIP_ICON } from "./COMPOSER_CHIP_ICON";
import { imageDisplaySrc } from "../../lib/image-src.mjs";

export function UserMessageView({ item, turn, fallbackWindow, pending, onCopy, onQuote, onImageCopy, onEditSubmit, onOpenFile, onOpenThread }: { item: ThreadItem; turn?: Turn; fallbackWindow?: number; pending?: boolean; onCopy: (text: string) => void; onQuote: (text: string) => void; onImageCopy?: (path: string) => void; onEditSubmit?: (item: ThreadItem) => void; onOpenFile?: (path: string) => void; onOpenThread?: (id: string) => void }) {
  // 「你」的名字（09-17 用户「人也要有名字和头像，位置跟 Codex 一样」）：走外部 store，
  // 与 Codex 名字同一套机制。⛔ 必须与其它 hook 一起放在 early return 之前（注释见下）。
  const userName = useUserName();
  const [editing, setEditing] = useState(false);
  // 首帧同步判定（useState 惰性初始化）：just-sent class 随首帧 DOM 一起出现，入场动画
  // 必定从挂载瞬间播放。旧版在 effect 里补 class：晚一帧、且与钉顶程序化滚动同帧，
  // 动画被滚动/重排吞掉——表现为「发消息没有过渡动画」（09-05 反馈）。
  // ⛔ 09-17：乐观气泡（pending）看 justSentIds；**真实消息自己认领**本次发送的动画
  //   （否则气泡消失瞬间动画被腰斩，见 claimSendAnimation 注释）。
  //   认领拿到的不是布尔而是「距发送已流逝的毫秒」，下面用它做负 animation-delay **续播相位**，
  //   这样气泡那一段与真实节点这一段首尾相接，不会"顿一下再从 0% 重飞"。
  //   两条路互斥、互不干扰。
  const [sendAnimDelay] = useState<number | null>(() => (pending
    ? (justSentIds.has(String(item.id ?? "")) ? 0 : null)
    : claimSendAnimation(itemText(item))));
  const justSent = sendAnimDelay != null;
  useEffect(() => {
    // 播过即清登记，历史消息/切会话重挂载不会误播
    if (justSent && pending) justSentIds.delete(String(item.id ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // hooks 必须在 early return 之前按固定顺序调用，否则编辑时 hook 数量变化会触发 React error #300
  const rawText = itemText(item);
  const refs = useMemo<ParsedUserRefs>(() => parseUserRefs(rawText), [rawText]);
  // 引擎回读的图片 part 可能是 localImage / local_image / image(data URL) 三种形态（见 prompt-images.ts isImagePart）
  const images = (item.content ?? []).filter(isImagePart);
  if (editing) {
    const originalText = itemText(item);
    const originalRefs = parseUserRefs(originalText);
    const originalImages = (item.content ?? []).filter(isImagePart);
    return (
      <UserMessageEditor
        initial={userDisplayText(originalText)}
        onCancel={() => setEditing(false)}
        onSubmit={(text) => {
          setEditing(false);
          // 保存时把引用段按发送格式重建，避免编辑导致文件/技能/上下文引用丢失
          const filePrefix = originalRefs.files.length ? `\n\n[附件文件]\n${originalRefs.files.map((path) => `- ${path}`).join("\n")}\n[附件结束]\n` : "";
          const skillPrefix = originalRefs.skills.length ? `\n\n[本轮已引用技能]\n${originalRefs.skills.map((skill) => `- ${skill.name}：${skill.description}`).join("\n")}\n[请按上述技能工作流执行]\n` : "";
          const contextPrefix = originalRefs.contexts.length ? `\n\n[用户指定的对话上下文]\n${originalRefs.contexts.map((ctx, index) => `(${index + 1}) ${ctx.role}：${ctx.text}`).join("\n\n")}\n[上下文结束]\n` : "";
          const threadReferencePrefix = originalRefs.threadReferences.map(formatThreadReferenceBlock).join("\n\n");
          onEditSubmit?.({ ...item, content: [{ type: "text", text: `${text}${contextPrefix}${skillPrefix}${filePrefix}${threadReferencePrefix ? `\n\n${threadReferencePrefix}` : ""}` }, ...originalImages] });
        }}
      />
    );
  }
  const refsImagePaths = new Set(refs.files.filter(isImagePath));
  // 文本占位符里出现过的图片以内联 chip 渲染在正文里，附件列表去重避免双份
  const inlineImageSet = new Set(promptImagePaths(rawText));
  const extraImages = images.filter((part: any) => !refsImagePaths.has(part.path) && !inlineImageSet.has(part.path));
  // 附件 chip：**内联接在正文文字之后**，与输入框里「文字 + chip」的形态逐字一致。
  // ⛔ 09-18 用户三次纠正后的定稿结论（别再走弯路）：
  //    ① 「文件和图片会在用户名字上面」→ 附件不能在名字之前；
  //    ② 「都靠右，自适应排序啊，靠左多丑」→ 不能分成图片/文件两组做左右分区；
  //    ③ 「谁让你单独一行靠右了，我要的是像输入框那样，内联在里面」→ **不要另起一行**，
  //       必须像输入框那样跟着文字走、粘贴在哪就排在哪（用同一个 `.composer-image-chip-inline`）。
  //    曾试过"气泡下方单独一行、整行右对齐"以及"方形缩略图"两版，均被否决：
  //    附件行一旦独立成行，就与用户输入时看到的形态不一致（输入框里它明明在文字流里）。
  const inlineAttachItems: { path: string; name: string; image: boolean }[] = [];
  /** chip 原始位置注解（09-25）：发送时 token 被剥离 ⇒ 默认只能堆到尾部；命中本地注解
   *  （key = 剥离后核心文本的指纹）就用带 token 的原文渲染，chip 回到用户放置的位置。 */
  const annotatedText = lookupMessageOriginal(stripAttachmentTokens(refs.cleanText ?? ""));
  const annotatedPaths = new Set<string>();
  if (annotatedText) {
    for (const seg of splitPromptSegments(annotatedText)) {
      if (seg.kind !== "text") annotatedPaths.add(seg.path);
    }
  }
  {
    const seen = new Set<string>(annotatedPaths);
    for (const path of refs.files) {
      // 已在文本占位符里内联渲染过的图片跳过（否则同一张图出现两次）
      if (inlineImageSet.has(path) || seen.has(path)) continue;
      seen.add(path);
      inlineAttachItems.push({ path, name: basename(path) || path, image: isImagePath(path) });
    }
    for (const part of extraImages as any[]) {
      const src = imagePartSrc(part) ?? "";
      const key = String(part?.path ?? src);
      if (!key || inlineImageSet.has(key) || seen.has(key)) continue;
      seen.add(key);
      // 名字必须走 attachChipName：直接对 src 取 basename 时，data URL 形态会显示成
      // `q842iQAAAABJRU5ErkJggg==` 这种 base64 尾巴（09-18 代码审查抓到的真缺陷）。
      inlineAttachItems.push({ path: src, name: attachChipName(part, src), image: true });
    }
  }
  return (
    <div className="user-message-stack">
      {/* 「你」的头部：名字 + 头像（09-17 用户「人也要有名字和头像，位置跟 Codex 一样」）。
          右对齐、头像在名字**右边** —— 与 Codex 的「头像 + 名字」（左对齐）镜像对称；
          头像用圆形（Codex 是圆角方形）以示区分。气泡内的 .avatar 本就是 display:none
          的布局占位，所以这里不会重复出头像。 */}
      <div className="user-head">
        <span className="user-head-name">{userName}</span>
        <UserAvatar size={22} />
      </div>
      <div
        className={`message user-message${pending ? " pending" : ""}${justSent ? " just-sent" : ""}`}
        data-ruler-mark="user"
        data-turn-id={turn?.id}
        data-item-id={item.id}
        // 负延迟 = 从「气泡已经播到的相位」接着播（见 claimSendAnimation 注释）；
        // 0（气泡自身）不加延迟，从 0% 正常入场。
        style={sendAnimDelay ? { animationDelay: `-${sendAnimDelay}ms` } : undefined}
      >
        <div className="avatar"><User size={15} /></div>
        <div className="message-body">
          <UserRefsRow refs={refs} onOpenFile={onOpenFile} onQuote={onQuote} hideFiles />
          {refs.imported ? <ImportedRecordCard note={refs.imported.note} content={refs.imported.content} /> : null}
          {refs.threadReferences.map((reference) => <ImportedRecordCard key={reference.id} note={reference.note} content={reference.content} kind="thread" sourceId={reference.id} onOpenSource={onOpenThread} />)}
          {refs.teamTask ? (
            <div className="user-message-team-task" title="已作为团队/成员会话发起需求提交">
              <div className="user-message-team-task-tag">
                <Sparkles size={11} />
                <span>{refs.teamTask.kind === "team" ? "团队会话 · 需求已发起" : "成员会话 · 需求已发起"}</span>
              </div>
              <div className="user-message-team-task-body">{refs.teamTask.requirement}</div>
            </div>
          ) : (refs.cleanText || inlineAttachItems.length) ? (
            <p className="user-message-text">
              {/* 命中位置注解 ⇒ 用带 token 的原文按 splitAttachmentSegments 拆（图片+文件都内联，
                  与输入框 rebuild 同款拆分器）；未命中 ⇒ 老行为（splitPromptSegments 只拆图片 token）。 */}
              {(annotatedText ?? refs.cleanText ?? "").length ? (annotatedText
                ? splitAttachmentSegments(annotatedText)
                : splitPromptSegments(refs.cleanText ?? "")
              ).map((seg: any, index: number) => seg.kind === "text"
                ? <span key={index}>{seg.text}</span>
                : <MessageAttachChip
                    key={index}
                    name={attachChipName({ path: seg.path }, seg.path)}
                    source={seg.path}
                    image={annotatedText ? seg.kind === "image" : true}
                    onOpenImage={openImageLightbox ?? undefined}
                    onOpenFile={annotatedText ? onOpenFile : undefined}
                  />) : null}
              {/* 附件 chip 内联在正文文字之后，与输入框同一个 `composer-image-chip-inline` —— 
                  「发送前看到的样子 == 发送后显示的样子」（09-18 用户定稿）。 */}
              {inlineAttachItems.map((att, index) => (
                <MessageAttachChip
                  key={`att-${index}`}
                  name={att.name}
                  source={att.path}
                  image={att.image}
                  onOpenImage={openImageLightbox ?? undefined}
                  onOpenFile={onOpenFile}
                />
              ))}
            </p>
          ) : null}
        </div>
        <div className="user-message-footer">
          <MessageFooter item={item} turn={turn} fallbackWindow={fallbackWindow} onCopy={onCopy} onQuote={onQuote} onEdit={() => setEditing(true)} />
        </div>
      </div>
    </div>
  );
}

function UserMessageEditor({ initial, onCancel, onSubmit }: { initial: string; onCancel: () => void; onSubmit: (text: string) => void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <div className="edit-message">
      <textarea value={draft} autoFocus onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) onSubmit(draft); }} placeholder="编辑消息内容" />
      <div className="edit-actions">
        <span>{hk("Ctrl+Enter")} 发送 · Esc 取消</span>
        <button className="ghost" onClick={onCancel}>取消</button>
        <button disabled={!draft.trim()} onClick={() => onSubmit(draft)}>保存并重新发送</button>
      </div>
    </div>
  );
}
function MessageAttachChip({ name, source, image, onOpenImage, onOpenFile }: {
  name: string;
  source: string;
  image: boolean;
  onOpenImage?: (source: string, name: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  // 悬停预览的弹出方向：默认在上方（贴着文字流更自然），上方空间不够时翻到下方。
  // ⛔ 必须翻：聊天区的滚动容器（`.timeline`）有 overflow 裁剪，靠近顶部的那条消息
  //    如果硬往上弹，预览会被切掉上半截（09-18 真机实测 `top: -101`，等于看不见）。
  const [previewBelow, setPreviewBelow] = useState(false);
  const decideDirection = (el: HTMLElement) => {
    const preview = el.querySelector(".message-attach-preview") as HTMLElement | null;
    const img = preview?.querySelector("img");
    // 所需高度：图片已加载就用实测高度，否则按 CSS 上限（240）留足余量，避免"先判定在上、
    // 图片随后撑高 → 又被裁"的时序问题。
    const measured = preview ? preview.getBoundingClientRect().height : 0;
    const need = (img?.naturalWidth ? measured : 0) > 0 ? measured : 240;
    const budget = need + 16;
    // 以最近的滚动/裁剪容器为"可视上界"
    let box: HTMLElement | null = el.parentElement;
    while (box && box !== document.body) {
      const s = getComputedStyle(box);
      if (/(auto|scroll|hidden|clip)/.test(`${s.overflowY}${s.overflow}`)) break;
      box = box.parentElement;
    }
    const limitTop = (box ?? document.documentElement).getBoundingClientRect().top;
    setPreviewBelow(el.getBoundingClientRect().top - limitTop < budget);
  };
  return (
    <button
      type="button"
      className={`composer-image-chip-inline message-attach-chip${image ? " is-image" : ""}${previewBelow ? " preview-below" : ""}`}
      title={image ? `点击查看大图：${name}` : name}
      onClick={(event) => {
        // ⛔ 指针点击后要**释放焦点**：chip 一旦留着焦点，`:focus-visible` 会让预览继续挂着——
        //    用户点开大图 → Esc 关掉 → 小预览却又自己冒出来（而且 Esc 属键盘操作，会把
        //    Chromium 的焦点渲染切到"键盘模式"，让刚点过的按钮开始命中 :focus-visible）。
        //    键盘激活（Enter/Space）的 click 事件 `detail === 0`，此时**保留焦点**给无障碍用。
        if (event.detail > 0) event.currentTarget.blur();
        if (image) onOpenImage?.(source, name);
        else onOpenFile?.(source);
      }}
      onMouseEnter={(event) => decideDirection(event.currentTarget)}
      onFocus={(event) => decideDirection(event.currentTarget)}
    >
      {image
        ? <span className="composer-image-chip-icon" dangerouslySetInnerHTML={{ __html: COMPOSER_CHIP_ICON }} />
        : <FileText size={13} style={{ color: "var(--link)", flex: "none" }} />}
      <span className="composer-image-chip-name">{name}</span>
      {/* 悬停小预览：只给图片。尺寸由 CSS 的 max-width/max-height + 浏览器保持原始宽高比决定，
          所以"自适应"是天然的——不用按图片比例写任何分支。 */}
      {image && (
        <span className="message-attach-preview" aria-hidden="true">
          <img src={imageDisplaySrc(source)} alt="" />
        </span>
      )}
    </button>
  );
}
