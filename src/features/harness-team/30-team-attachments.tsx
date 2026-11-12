/**
 * 工作伙伴 · 群聊消息里的附件（图片 / 文件）与正文清洗。
 *
 * 用户 11-12（截图 + 「这啥玩意啊」）：「把群里的图片和文件展示，还有其他所有同步主对话框」——
 * 群消息正文把宿主拼的 `[附件文件]\n- path\n[附件结束]` 信封**当文字原样画出来**（用户/伙伴的
 * 气泡与「回复 @某人」引用块都是），而主对话里同一段会被解析成图片 / 文件 chip。
 *
 * ⇒ 两件事（与主对话同一份口径，⛔ 不另写一套解析）：
 *   ① 可见正文：走 `parseUserRefs().cleanText` 把附件/技能/上下文等引用段剥掉；
 *   ② 附件：`parseUserRefs().files` 里的路径渲染成主对话同款 `MessageAttachChip`（图片灯箱 / 文件预览）。
 *
 * ⛔ 单独成文件：`04-team-group-view.tsx` 已顶满 >1000 行棘轮，不要再往里堆。
 */
import { parseUserRefs } from "../../lib/user-refs";
import { stripVoiceScript } from "../../lib/voice-script.mjs";
import { openImageLightbox } from "../../lib/ui-channels";
import { isImagePath } from "../../lib/is-image-path";
import { basename } from "../../lib/basename";
import { MessageAttachChip } from "../shared/UserMessageView";
import { TeamMentionText, type MentionFace } from "./17-team-mention-text";

/** 群消息可见正文。
 *  用户消息：剥掉附件/技能/上下文等引用段（与主对话 userDisplayText 同口径），
 *  伙伴消息：只剥 ```voice 播报稿（正文本来就是伙伴自己写的，⛔ 不要按用户信封再解析一遍）。 */
export function teamMessageBodyText(raw: string, isBot: boolean): string {
  if (isBot) return stripVoiceScript(String(raw ?? ""));
  return parseUserRefs(String(raw ?? "")).cleanText;
}

/** 群消息附件：把 `[附件文件]` 段解析出的路径渲染成主对话同款 chip
 *  （图片点开灯箱、文件点开右栏预览）。没有附件时返回 null，不留空壳。 */
export function TeamAttachmentChips({ raw, onOpenFile }: { raw: string; onOpenFile?: (path: string) => void }) {
  const files = parseUserRefs(String(raw ?? "")).files;
  if (!files.length) return null;
  // 附件行落在气泡正文之后；对齐交给父级弹性布局（不写死左右，避免与群「消息排版」设置打架）。
  return (
    <div className="team-msg__attachments">
      {files.map((path, index) => (
        <MessageAttachChip
          key={`att-${index}`}
          name={basename(path) || path}
          source={path}
          image={isImagePath(path)}
          onOpenImage={openImageLightbox}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}

/** 群消息正文 + 附件一整块（气泡与引用块共用）。
 *  正文走群的 `@` 渲染器（行内艾特带头像），用户消息再在其后追一行附件 chip。 */
export function TeamMessageBody({
  raw,
  isBot,
  onOpenFile,
  candidates,
  faceOfId,
  nameOf,
  onPick,
  excludeId,
  className,
}: {
  /** 原始正文（含宿主的 `[附件文件]` 信封，内部会剥） */
  raw: string;
  isBot: boolean;
  onOpenFile?: (path: string) => void;
  candidates: { id: string; name: string }[];
  faceOfId: (id: string) => MentionFace;
  nameOf: (id: string) => string;
  onPick: (id: string) => void;
  excludeId?: string;
  className?: string;
}) {
  return (
    <>
      <TeamMentionText
        text={teamMessageBodyText(raw, isBot)}
        candidates={candidates}
        faceOfId={faceOfId}
        nameOf={nameOf}
        onPick={onPick}
        excludeId={excludeId}
        {...(className ? { className } : {})}
      />
      {!isBot ? <TeamAttachmentChips raw={raw} onOpenFile={onOpenFile} /> : null}
    </>
  );
}
