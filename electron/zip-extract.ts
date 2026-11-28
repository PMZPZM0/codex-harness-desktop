/**
 * 零依赖 zip 解压（11-28，OrenCut 按需下载用）。
 *
 * 为什么自己写：项目里没有声明过任何解压依赖（`unzipper`/`tar` 只是传递依赖，
 * 打包裁剪时会被漏掉 ⇒ 运行时炸）；而 OrenCut 是 GitHub 的普通 zip，只需要
 * stored(0) 与 deflate(8) 两种算法 —— 用 node:zlib 就够，不必引包。
 *
 * 支持：普通 zip（含目录项）；⛔ 不支持 zip64 / 加密 / 分卷（GitHub 的仓库包都不属于这些）。
 * ⛔ 路径穿越防护：entry 名里带 `..` 或绝对路径的一律跳过（解压到 destDir 之内）。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** 解压 zip 到 destDir（返回解出的文件数）。任一 entry 失败只跳过该项，不中断整体。 */
export function extractZip(buffer: Buffer, destDir: string): number {
  const eocd = findEocd(buffer);
  if (eocd < 0) throw new Error("不是有效的 zip（找不到目录结束标记）");
  const total = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  fs.mkdirSync(destDir, { recursive: true });
  let written = 0;

  for (let i = 0; i < total; i += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CEN_SIG) break;
    const method = buffer.readUInt16LE(cursor + 10);
    const compSize = buffer.readUInt32LE(cursor + 20);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLen);
    cursor += 46 + nameLen + extraLen + commentLen;

    const target = safeJoin(destDir, name);
    if (!target) continue;                       // 路径穿越 / 绝对路径 ⇒ 跳过
    if (name.endsWith("/")) { fs.mkdirSync(target, { recursive: true }); continue; }
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOC_SIG) continue;

    const locNameLen = buffer.readUInt16LE(localOffset + 26);
    const locExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + locNameLen + locExtraLen;
    const raw = buffer.subarray(dataStart, dataStart + compSize);

    let content: Buffer;
    if (method === 0) content = raw;
    else if (method === 8) content = zlib.inflateRawSync(raw);
    else continue;                               // 不支持的算法（如 bzip2）跳过

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    written += 1;
  }
  return written;
}

/** 从尾部往前找 EOCD（注释最长 65535 字节）。 */
function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/** 解析 entry 目标路径；越界或绝对路径返回 ""（调用方跳过）。 */
function safeJoin(root: string, name: string): string {
  const clean = name.replace(/\\/g, "/");
  if (!clean || clean.startsWith("/") || /^[a-zA-Z]:/.test(clean) || clean.split("/").includes("..")) return "";
  const target = path.resolve(root, clean);
  const base = path.resolve(root);
  return target === base || target.startsWith(base + path.sep) ? target : "";
}
