/**
 * 12ci-attach-image-budget.mjs —— 附件图片体积治理 + 气泡附件去重（2026-11-23 立）。
 *
 * 用户实测三连：
 *   ①「发个图片，会话直接炸了」——`413 Payload Too Large: 请求体超过 32 MB 上限`；
 *   ②「前面展示 chip，后面还展示了粘贴图片」——同一张图在气泡里两颗 chip；
 *   ③「中间停止异常，后面再发消息就好慢了」——同源：body 里揣着几千万字节的 base64，每轮重传。
 *
 * 实测取证（本机真实文件）：用户粘贴的那张是 **5464×8192 PNG / 35MB**，base64 后约 47MB
 * ⇒ 单张就超过上游 32MB 硬限。治理后同图变成 **1366×2048 JPEG / 0.22MB**（降 99.4%，仍可解码）。
 *
 * ⛔ 判据只钉「结构性事实」（阈值、调用点、不改原文件、去重入口），不钉具体代码写法。
 * ⛔ 独立守卫（不进 check-preflight 计数）；挂进 package.json 的 check 链。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【attach-image】${message}`);
  if (!condition) fails++;
};

/* ── ① 治理模块本身 ── */
const mod = read("electron/attach-image.ts");
ok(/export async function shrinkAttachedImage\(/.test(mod),
  "存在统一的附件图片治理入口 shrinkAttachedImage（⭐ 所有落盘副本都该走它，别各处自己压）");
ok(/const MAX_EDGE = 2048;/.test(mod) && /const TARGET_BYTES = 2 \* 1024 \* 1024;/.test(mod),
  "阈值写死且可核：长边 2048 / 单图 2MB（视觉模型再大也只是浪费字节，上游按此量级内部缩放）");
ok(/if \(!overEdge && before <= TARGET_BYTES\) return \{ path: file, bytes: before, changed: false \}/.test(mod),
  "小图**原样返回**（不重编码 —— ⛔ 为了「治理」把所有图重压一遍是净损失）");
ok(/if \(buffer\.length >= before\) return \{ path: file, bytes: before, changed: false, note: "已是最小" \}/.test(mod),
  "压完反而更大 ⇒ 保留原图（⛔ 不许把用户的图压坏）");
ok(/image\.background\(0xffffffff\)/.test(mod) && /getBuffer\("image\/jpeg", \{ quality: 88 \}\)/.test(mod),
  "转 JPEG 前**铺白底**（⛔ 否则 PNG 透明区变黑）+ 质量 88（截图/实拍都够）");
ok(/return \{ path: target, bytes: buffer\.length, changed: true \}/.test(mod),
  "返回**最终路径**（PNG→JPEG 会换扩展名，调用方必须用它，⛔ 别继续用入参路径）");

/* ── ② 接线：只在「我们自己落盘的副本」上调用 ── */
const clip = read("electron/features/clipboard-ipc.ts");
ok(/import \{ shrinkAttachedImage \} from "\.\.\/attach-image";/.test(clip)
  && /const shrunk = await shrinkAttachedImage\(file\)/.test(clip)
  && /return shrunk\?\.path \?\? file;/.test(clip),
  "粘贴图片落盘后立刻治理体积，并返回最终路径（⛔ 用户拖进来的原始文件不碰 —— 那是他的资产）");
{
  /* 调用点只允许出现在 clipboard-ipc：多一处就说明有人开始改用户原图了。 */
  const hits = readdirSync(join(ROOT, "electron"), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && e.name !== "attach-image.ts")
    .map((e) => join(e.parentPath ?? e.path, e.name))
    .filter((f) => readFileSync(f, "utf8").includes("shrinkAttachedImage("));
  ok(hits.length === 1 && /clipboard-ipc\.ts$/.test(hits[0] ?? ""),
    `shrinkAttachedImage 只被 clipboard-ipc 调用（实测 ${hits.length} 处 —— ⛔ 别在「发用户原文件」的路径上调它）`);
}

/* ── ③ 气泡附件去重（同一张图不许两颗 chip） ── */
const umv = read("src/features/shared/UserMessageView.tsx");
ok(/let pathlessBudget = inlineImageSet\.size;/.test(umv) && /if \(pathlessBudget > 0\) \{ pathlessBudget -= 1; return false; \}/.test(umv),
  "没有路径的图片 part（引擎回读成 data URL）先认作文本 token 的同一张图 —— 按名额消耗，不再重复出 chip");
ok(!/const extraImages = images\.filter\(\(part: any\) => !refsImagePaths\.has\(part\.path\) && !inlineImageSet\.has\(part\.path\)\);/.test(umv),
  "⛔ 旧的单行去重已删（只比 part.path ⇒ data URL 与落盘路径永远不相等 ⇒ 双 chip 的根因）");

/* ── ④ 插队消息的图片可达性（11-23 用户：「插队消息带了图片，codex 看不到图片」） ──
   插队走 turn/steer，宿主入队时的 localImage 在「入队 → 队列回读 → steer」一路上无人保证被保住
   （引擎二进制、无 schema），实际表现是模型只看到文字 ⇒ 兜底把图片路径写进插队文本的附件段。 */
{
  const send = read("src/features/app-state/parts/part08/02-seg/send.tsx");
  ok(/const queuedImagePaths = \[\.\.\.new Set\(\[\.\.\.inlineImagePaths, \.\.\.sendImages\]\)\];/.test(send)
    && /const filePrefixLines = \[\.\.\.new Set\(\[\.\.\.inlineFilePaths, \.\.\.queuedImagePaths\]\)\];/.test(send),
    "插队/排队消息把图片路径并入 [附件文件] 段（模型可按路径读图，不看引擎是否保住 localImage）");
  ok(/messageText \|\| threadReferenceBlocks \|\| inlineFilePaths\.length \|\| queuedImagePaths\.length/.test(send),
    "「只有图片、没有文字」的插队也要产出 text part —— 否则路径段根本发不出去（等于没修）");
}

/* ── ⑤ 插队图片直达模型（11-23 用户：「希望模型直接看到图」）──
   探针实测：同一个不存在的 threadId 下，「只有 text」与「text + localImage」返回的错误**完全一致**
   （都是 thread not found）⇒ `turn/steer` 的 schema **接受** localImage。
   所以缺的不是引擎能力，而是宿主手里的带图 input（队列回读只剩文本）⇒ 入队记一份、派发覆盖。 */
{
  const lib = read("src/lib/queued-local-input.mjs");
  const sendSrc = read("src/features/app-state/parts/part08/02-seg/send.tsx");
  ok(/export function rememberQueuedInput\(/.test(lib) && /export function localQueuedInput\(/.test(lib) && /export function forgetQueuedInput\(/.test(lib),
    "本地原始 input 的三件套：登记 / 取用 / 释放（⛔ 只存内存 + 容量封顶，不落盘不膨胀）");
  ok(/const queueClientId = crypto\.randomUUID\(\);[\s\S]{0,200}?rememberQueuedInput\(queueClientId, input\);[\s\S]{0,300}?clientUserMessageId: queueClientId/.test(sendSrc),
    "入队时按 clientUserMessageId 记住**带 localImage 的**原始 input（同一个 id 贯穿 add 与派发）");
  const queue = read("src/features/app-state/parts/part04/03-seg/02-browser-queue-settings.tsx");
  ok(/const steerInput = localQueuedInput\(entry\.clientUserMessageId\) \?\? entry\.input;/.test(queue)
    && /input: steerInput,/.test(queue)
    && /forgetQueuedInput\(entry\.clientUserMessageId\);/.test(queue),
    "turn/steer 用本地原始 input（含图），成功后释放登记（⛔ 回落 entry.input 保底，老条目不会崩）");
}

console.log(fails ? `\n【attach-image】${checks} 条断言 / ${fails} 条失败` : `\n【attach-image】${checks} 条断言全部通过`);
process.exit(fails ? 1 : 0);
