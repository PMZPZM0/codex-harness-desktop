/** UserMessageView（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { ThreadItem } from "../../lib/thread-item";
import { Turn } from "../../lib/turn";
import { useUserName, UserAvatar } from "../../components/UserAvatar";
import { getAliasState, subscribeAliases, supervisorLabelOfAliases } from "../session-alias/alias-store.mjs";
import { USER_TITLE } from "../../lib/session-names.mjs";
import { useState, useEffect, useMemo, useSyncExternalStore } from "react";
import { justSentIds } from "../../lib/just-sent-ids";
import { claimSendAnimation } from "../../lib/claim-send-animation";
import { itemText } from "../../lib/item-text";
import { isHiddenNoticeBlock } from "../../lib/visible-group-blocks.mjs";
import { parseUserRefs, userDisplayText, formatThreadReferenceBlock } from "../../lib/user-refs";
import type { ParsedUserRefs } from "../../lib/user-refs";
import type { GroupEventBlock } from "../../lib/group-event-text.mjs";
import { isImagePart, promptImagePaths, imagePartSrc, splitPromptSegments } from "../../lib/prompt-images";
import { stripAttachmentTokens, splitAttachmentSegments } from "../../lib/composer-attachments.mjs";
import { lookupMessageOriginal } from "../../lib/user-message-originals.mjs";
import { isImagePath } from "../../lib/is-image-path";
import { basename } from "../../lib/basename";
import { attachChipName } from "../../lib/attach-chip-name.mjs";
import { User, Sparkles, FileText, Film, Music2, Box, Bot } from "lucide-react";
import { UserRefsRow } from "./InlineCards";
import { FileRefCard } from "../../components/FileRefCard";
import { ImportedRecordCard } from "./ImportRecords";
import { openImageLightbox, openMediaPreview } from "../../lib/ui-channels";
import { mediaKindOf } from "../../lib/media-kind.mjs";
import { MessageFooter } from "./MessageFooter";
import { hk } from "../../lib/hk";
import { COMPOSER_CHIP_ICON } from "./COMPOSER_CHIP_ICON";
import { imageDisplaySrc } from "../../lib/image-src.mjs";

export function UserMessageView({ item, turn, threadId, fallbackWindow, pending, onCopy, onQuote, onImageCopy, onEditSubmit, onOpenFile, onOpenThread }: { item: ThreadItem; turn?: Turn; /** 10-31：本会话 id —— 上级气泡用它查「我的上级主管是谁」（笔名快照） */ threadId?: string; fallbackWindow?: number; pending?: boolean; onCopy: (text: string) => void; onQuote: (text: string) => void; onImageCopy?: (path: string) => void; onEditSubmit?: (item: ThreadItem) => void; onOpenFile?: (path: string) => void; onOpenThread?: (id: string) => void }) {
  // 「你」的名字（09-17 用户「人也要有名字和头像，位置跟 Codex 一样」）：走外部 store，
  // 与 Codex 名字同一套机制。⛔ 必须与其它 hook 一起放在 early return 之前（注释见下）。
  const userName = useUserName();
  /* 10-31: live supervisor alias (parent rename reflects here immediately). */
  const aliasState = useSyncExternalStore(subscribeAliases, getAliasState);
  const liveSupervisor = threadId ? supervisorLabelOfAliases(aliasState, threadId) : "";
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
  /* 群广播（10-26 用户令「方案就按只广播这个完成」）：中枢会话里的 `[群事件] …` 是成员汇总
     进来的**群消息**，不是用户说的话 ⇒ 不能再套用户气泡（右对齐、名字写"你"、看不出谁交的活）。
     整条交给群气泡渲染：成员头像 + 名字 + 内容；系统类事件走居中灰行。 */
  if (refs.groupEvents?.length) {
    /* ⛔⛔ 10-26 用户实测（指挥中枢会话）：「这个刻度线跟消息和滚轮没有联动，滚动消息，刻度线没反应」
       —— 群广播在引擎侧**就是一条 userMessage**（刻度尺也按 userMessage 出刻度），
       但这里直接 return 了 GroupFeed，**没带 `data-ruler-mark="user"` / data-item-id**
       ⇒ 中枢会话里几乎每条消息都是群事件 ⇒ 刻度尺一个参照点都找不到，
       currentItemId 永远为 null，高亮与波浪都不动。
       包一层只承载定位属性的 div（⛔ 不加类名、不带样式，避免动到群卡的布局）。 */
    /* ⛔ 10-26 用户：「刻度线要对应消息和群里展示的事件，不要对应那些不展示的」——
       全是已废弃刷屏通知的群事件**连外壳都不渲染**（GroupFeed 本来会返回 null，
       但外层 div 还留着定位属性 ⇒ DOM 里一堆空壳，刻度尺会以为那里有条消息）。 */
    const visibleBlocks = refs.groupEvents.filter((block) => !isHiddenNoticeBlock(block));
    if (!visibleBlocks.length) return null;
    return (
      <div data-ruler-mark="user" data-turn-id={turn?.id} data-item-id={item.id}>
        <GroupFeed blocks={visibleBlocks} onOpenFile={onOpenFile} />
      </div>
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
    // ⛔ 去重集合必须用与下面渲染**同一个**拆分器（splitAttachmentSegments，图片+文件都认）。
    //    曾经用 splitPromptSegments（只认图片 token）收：文件 token 进不了集合 ⇒ 同一个文件
    //    「按原位置内联一次 + refs.files 追加到末尾一次」，气泡里出现两颗 chip（09-27 用户截图）。
    for (const seg of splitAttachmentSegments(annotatedText)) {
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
  /* ⛔⛔ 10-31 用户令：「主会话向被调度的子会话发送消息时，不能以用户视角显示在右侧头像位置，
     必须同样显示在左侧，并以主会话自身的身份发出」。
     ⛔ 只对 **`调度会话`** 这一种壳改位置：它是 delegation 派活时**主进程**拼的，确实是"上级发来的任务"。
         `团队成员 / 成员会话` 这两种壳还兼着"用户在成员会话里自己打的字"（send.tsx 那条路径），
         一律左移会把用户自己的话伪造成上级发言 —— 所以那几种维持原样。
     左对齐 + 身份写「主会话」：宿主没有把上级会话名传下来（只有 threadId），
     名字留待后续接（见 docs/FEATURE-LEDGER 同名条），这里先把"不属于用户"这件事表达出来。 */
  const isParentTask = refs.teamTask?.label === "调度会话";
  if (isParentTask) {
    return (
      <div className="parent-task-stack" data-ruler-mark="user" data-turn-id={turn?.id} data-item-id={item.id}>
        <div className="parent-task-head">
          <span className="parent-task-avatar"><Bot size={13} /></span>
          {/* ⛔ 10-31 用户令：「子会话上级就默认是某某主管」——上级名字由 delegation 写进首任务
              （`上级主管：青崖主管（…）`），这里优先显示；**并优先用笔名快照**：父会话改名后
              广播一到达这里就换成新名字（不然只有新派的任务才更新，老任务还挂旧名）。
              两处都没有才退回通用「主会话」。 */}
          <span className="parent-task-name">{liveSupervisor || refs.teamTask?.supervisor || "主会话"}</span>
          <span className="parent-task-hint">派发任务</span>
        </div>
        <div className="parent-task-body">{refs.teamTask?.requirement}</div>
      </div>
    );
  }
  return (
    <div className="user-message-stack">
      {/* 「你」的头部：名字 + 头像（09-17 用户「人也要有名字和头像，位置跟 Codex 一样」）。
          右对齐、头像在名字**右边** —— 与 Codex 的「头像 + 名字」（左对齐）镜像对称；
          头像用圆形（Codex 是圆角方形）以示区分。气泡内的 .avatar 本就是 display:none
          的布局占位，所以这里不会重复出头像。 */}
      <div className="user-head">
        <span className="user-head-name">{userName}</span>
        {/* ★ 10-31 用户令：「用户就是总经理身份」——职级标在名字旁边（会话侧是「XX主管」）。 */}
        <span className="user-head-rank" title="你在公司架构里的职级">{USER_TITLE}</span>
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
                {/* 10-26：壳上的原始标签原样展示（团队会话 / 成员会话 / 群成员会话 / 调度会话…），
                    旧实现写死两种 ⇒ 群成员与调度会话都被标成"成员会话"。 */}
                <span>{(refs.teamTask.label ?? (refs.teamTask.kind === "team" ? "团队会话" : "成员会话")) + " · 需求已发起"}</span>
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

/* ── 群广播卡（10-26 用户令：「这个群事件展示优化一下，现在太丑了」
   +「我看不见方案内容」+「放到消息下面，不要放上面」+「其他对话框里面可以文件预览的吧」）

   四个诉求合成一张卡：
   ① **成品全文可预览** ⇒ 成员交活时主进程已把正文落盘成 `群交付/*.md`，
      这里出**文件卡**（与其它会话的产物卡同一套：点开 → 右栏预览）；
      气泡里只留一行摘要，不再铺几千字。
   ② **不再丑** ⇒ 去掉「左侧粗竖条 + 面板底色 + 内外双层方框」的三重框，
      改成一张轻卡片：成员头像 + 名字 + 徽标 + 标题，正文小字灰。
   ③ **位置** ⇒ 由 TurnView 决定：群广播渲染在**消息下方**（回合卡之后），不在消息上方。
   ⛔ 成员之间不互读（用户令：只广播）—— 这里纯展示，不影响任何上下文。 */

/** 书名号包裹（⛔ 幂等）：任务标题常常**自己就带《》**（`出《口播视频制作规范》`），
 *  再包一层就成了 `《出《口播视频制作规范》》` —— 10-26 截图实测的丑点。
 *  ⛔ 判据不能只看首尾字符：`出《…》` 首字是「出」、尾字是「》」，仍会重复嵌套 ⇒
 *     只要标题里**已经含有**一对书名号，就原样返回。 */
function booked(title: string | undefined | null): string {
  const text = String(title ?? "").trim() || "任务";
  return /《[^》]+》/.test(text) ? text : `《${text}》`;
}

/** 刷屏类系统提示 = **已废弃的一次性提醒**（10-26 用户：「一直刷屏…给我删掉这玩意」）。
 *  宿主侧 `2349990bb` 起不再产生（预算静默执行、看门狗整体删除），但**历史消息仍在 rollout 里**
 *  （改不动引擎数据）—— 界面也不再展示：同一句重复 N 遍没有任何信息量。
 *  ⛔ 判据走 `visible-group-blocks`（刻度尺共用同一份，⛔ 不在这里另写一份正则副本）——
 *     它覆盖预算 80%/用尽 + 停滞看门狗 + 待审看门狗三类。
 *  ⛔ 只过滤这三类：成员进出 / 失败 / 超时这些系统事件仍要看得见。 */
function GroupFeed({ blocks, onOpenFile }: { blocks: GroupEventBlock[]; onOpenFile?: (path: string) => void }) {
  const shown = blocks.filter((b) => !isHiddenNoticeBlock(b));
  if (!shown.length) return null;
  /* ⛔ 纯系统事件（没有任何成员汇报/结论）**不套卡片**：用户截图里一屏 7 张「群汇报」空卡，
     就是「只有一行居中灰字」也硬套了细边框 + 极淡底 + 卡头 ⇒ 看着像一堆警告条。
     这类就按群聊惯例渲染成紧凑系统行。 */
  if (shown.every((b) => b.type === "notice")) {
    return (
      <div className="group-sys-stack">
        {shown.map((b, index) => <div className="group-sys" key={index}>{(b as { text: string }).text}</div>)}
      </div>
    );
  }
  const deliverCount = shown.filter((b) => b.type === "deliverable" || b.type === "batch").length;
  const verdictCount = shown.filter((b) => b.type === "verdict").length;
  /* 有文件卡时，成品全文已经在文件里 ⇒ 评审行不再重复挂一份全文（避免同屏两份正文）。 */
  const hasFile = shown.some((b) => (b.type === "deliverable" && Boolean(b.file)) || (b.type === "batch" && b.items.some((i) => Boolean(i.file))));
  return (
    <div className="group-feed">
      <div className="group-feed-head">
        <span className="group-feed-tag">群汇报</span>
        {deliverCount > 0 ? <span className="group-feed-count">{deliverCount} 份成品</span> : null}
        {verdictCount > 0 ? <span className="group-feed-count">{verdictCount} 条结论</span> : null}
      </div>
      {shown.map((block, index) => {
        if (block.type === "deliverable") {
          return (
            <div className="group-msg" key={index}>
              <span className="group-avatar" style={{ ["--group-hue" as any]: hueOf(block.who) }} aria-hidden>{initialOf(block.who)}</span>
              <div className="group-msg-main">
                <div className="group-msg-head">
                  <b className="group-msg-name">{block.who}</b>
                  <span className="group-msg-badge is-deliver">交活</span>
                  <span className="group-msg-title">{booked(block.title)}</span>
                </div>
                {block.body ? <div className="group-msg-body">{excerpt(block.body)}</div> : null}
                {block.file ? <GroupFileCard path={block.file} onOpenFile={onOpenFile} /> : null}
              </div>
            </div>
          );
        }
        if (block.type === "batch") {
          return (
            <div className="group-msg" key={index}>
              <span className="group-avatar" style={{ ["--group-hue" as any]: 205 }} aria-hidden>群</span>
              <div className="group-msg-main">
                <div className="group-msg-head">
                  <b className="group-msg-name">本轮交活</b>
                  <span className="group-msg-badge is-deliver">{block.count} 份</span>
                </div>
                <ul className="group-msg-list">
                  {block.items.map((item, i) => (
                    <li key={i}>
                      <div className="group-msg-head">
                        <b className="group-msg-name">{item.who}</b>
                        <span className="group-msg-title">{booked(item.title)}</span>
                      </div>
                      {item.summary ? <div className="group-msg-body">{excerpt(item.summary)}</div> : null}
                      {item.file ? <GroupFileCard path={item.file} onOpenFile={onOpenFile} /> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        }
        if (block.type === "verdict") {
          /* ⛔ 审查结论 = **成员汇报结果**（10-26 用户令）⇒ 走成员气泡（头像+名字+结论徽标），
             不是居中灰行 —— 让人一眼看出"谁的活被认可/被打回"。 */
          return (
            <div className={`group-msg group-msg-verdict ${block.passed ? "is-pass" : "is-reject"}`} key={index}>
              <span className="group-avatar" style={{ ["--group-hue" as any]: hueOf(block.who) }} aria-hidden>{initialOf(block.who)}</span>
              <div className="group-msg-main">
                <div className="group-msg-head">
                  <b className="group-msg-name">{block.who}</b>
                  <span className={`group-msg-badge ${block.passed ? "is-pass" : "is-reject"}`}>{block.passed ? "通过" : "打回"}</span>
                  <span className="group-msg-title">{booked(block.title)}{block.reviewer ? ` · ${block.reviewer}判定` : ""}</span>
                </div>
                {block.reasons ? <div className="group-msg-body">{block.reasons}</div> : null}
              </div>
            </div>
          );
        }
        if (block.type === "review") {
          /* ⛔ 待审请求是**给中枢的机器指令**（含验收标准）⇒ 主体只留一行提示；
             但**成品正文要看得见**（用户原话：「我看不见方案内容」）⇒ 折叠展开。 */
          return (
            <div className="group-msg" key={index}>
              <span className="group-avatar" style={{ ["--group-hue" as any]: 205 }} aria-hidden>群</span>
              <div className="group-msg-main">
                <div className="group-msg-head">
                  <b className="group-msg-name">中枢评审</b>
                  <span className="group-msg-badge">待评审</span>
                  <span className="group-msg-title">
                    {block.count > 1
                      ? `${block.count} 条任务`
                      : booked(block.titles[0])}
                  </span>
                </div>
                {block.output && !hasFile ? (
                  <details className="group-more">
                    <summary>查看成品全文</summary>
                    <div className="group-msg-body group-msg-body-full">{block.output}</div>
                  </details>
                ) : null}
              </div>
            </div>
          );
        }
        return <div className="group-sys" key={index}>{block.text}</div>;
      })}
    </div>
  );
}

/** 群广播里的**文件卡**（成品）—— 点开即预览全文，与其它会话的产物卡同一套手感。
 *  ⛔ 默认走**居中预览**（`onOpenFile` → 文件预览弹窗，.md 走 Markdown 渲染）——
 *     群交付文件在群项目目录里，不在当前会话的工作区树内 ⇒ 走右栏树会找不到位置。 */
function GroupFileCard({ path, onOpenFile }: { path: string; onOpenFile?: (path: string) => void }) {
  return (
    <div className="group-file">
      <FileRefCard
        path={path}
        title={`预览成品全文：${path}`}
        onOpen={onOpenFile ? () => onOpenFile(path) : undefined}
        onOpenEditor={onOpenFile}
      />
    </div>
  );
}

/** 气泡里的正文只留一行摘要（全文在文件卡里）—— 群汇报是索引，不是正文墙。 */
function excerpt(text: string): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
}

/** 头像色相：按名字散列 ⇒ 同一成员每次同色（切会话 / 重开都不变，⛔ 不用"列表下标"配色）。 */
function hueOf(name: string): number {
  let hue = 0;
  for (let i = 0; i < name.length; i += 1) hue = (hue * 31 + name.charCodeAt(i)) % 360;
  return hue;
}

function initialOf(name: string): string {
  const text = String(name ?? "").trim();
  return text.length ? text.slice(0, 1) : "?";
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
  const mediaKind = image ? "" : mediaKindOf(source);
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
      className={`composer-image-chip-inline message-attach-chip${image ? " is-image" : ""}${mediaKind ? " is-media" : ""}${previewBelow ? " preview-below" : ""}`}
      title={image ? `点击查看大图：${name}` : mediaKind ? `点击${mediaKind === "model" ? "预览 3D" : "播放"}：${name}` : name}
      onClick={(event) => {
        // ⛔ 指针点击后要**释放焦点**：chip 一旦留着焦点，`:focus-visible` 会让预览继续挂着——
        //    用户点开大图 → Esc 关掉 → 小预览却又自己冒出来（而且 Esc 属键盘操作，会把
        //    Chromium 的焦点渲染切到"键盘模式"，让刚点过的按钮开始命中 :focus-visible）。
        //    键盘激活（Enter/Space）的 click 事件 `detail === 0`，此时**保留焦点**给无障碍用。
        if (event.detail > 0) event.currentTarget.blur();
        if (image) onOpenImage?.(source, name);
        else if (mediaKind) openMediaPreview({ source, kind: mediaKind, title: name });
        else onOpenFile?.(source);
      }}
      onMouseEnter={(event) => decideDirection(event.currentTarget)}
      onFocus={(event) => decideDirection(event.currentTarget)}
    >
      {image
        ? <span className="composer-image-chip-icon" dangerouslySetInnerHTML={{ __html: COMPOSER_CHIP_ICON }} />
        : mediaKind === "video" ? <Film size={13} style={{ color: "var(--accent)", flex: "none" }} />
          : mediaKind === "audio" ? <Music2 size={13} style={{ color: "var(--ok, var(--accent))", flex: "none" }} />
          : mediaKind === "model" ? <Box size={13} style={{ color: "var(--orange, var(--accent))", flex: "none" }} />
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
