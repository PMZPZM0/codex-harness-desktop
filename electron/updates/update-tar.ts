/**
 * update-tar —— GitHub 源码归档的最小 tar.gz 解包（10-13，为 ponytail 在线更新所写）。
 *
 * 为什么单独一个文件、为什么不用 `tar -xzf` / 外部解压器：
 *   ① **安全**：归档里的文件名是不可信输入，`tar -xzf` 遇到 `../..` 会真的写出来
 *      （这是 tar 历史上真实出现过的任意写 CVE）。自己解析才能在落盘前逐条路径做穿越检查。
 *   ② **少依赖**：收敛到 **node:zlib + 本级解析** —— 不依赖系统 tar、不依赖 7z
 *      （顺带一提 7z 本身也是"要被更新的组件"之一，回滚路径上不该依赖它）。
 *   ③ **可测**：单独成文件，守卫能直接对本模块做「恶意归档」验证。
 *
 * ⛔ 只认普通文件（typeflag '0' / '\0'）与目录项：符号链接、设备节点**一律跳过**
 *    —— 归档不可信，任何非普通文件的条目都可能把 sets engine 指向目录外。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export type UntarResult = {
  files: number;
  /** 因路径穿越或类型不受支持而被跳过的条目数 —— ⛔ 必须回传给调用方，静默跳过 = 埋雷 */
  skipped: number;
  skippedNames: string[];
};

/**
 * 解 tar.gz 到目标目录。
 * @returns 写出的文件数与被跳过的条目（含名字）
 */
export async function extractTarGz(archive: Buffer, destDir: string): Promise<UntarResult> {
  const tar = gunzipSync(archive);
  const root = path.resolve(destDir);
  await fs.mkdir(root, { recursive: true });
  let files = 0;
  const skippedNames: string[] = [];

  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    // 全零块 = 归档结束（这是 tar 格式约定，不是可选的）
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (!name) break;
    const sizeRaw = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeRaw, 8) || 0;
    const typeflag = String.fromCharCode(header[156] ?? 0);
    offset += 512;

    // 目录项：记一笔但不 mkdir（后续文件写入时自会建出目录），避免为归档里的空目录瞎铺一遍
    if (typeflag === "5") continue;
    // ⛔ 只认普通文件：符号链接 / 设备 / hardlink 一律跳过（归档是不可信输入）
    if (typeflag !== "0" && typeflag !== "\0") {
      skippedNames.push(`${name}（类型 ${typeflag.trim() || "空"} 不受支持）`);
      offset += Math.ceil(size / 512) * 512;
      continue;
    }

    // ⛔⛔ 穿越检查：解出来的每个路径都必须还在 destDir 之内
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) {
      skippedNames.push(`${name}（路径逃出目标目录）`);
      offset += Math.ceil(size / 512) * 512;
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, tar.subarray(offset, offset + size));
    files += 1;
    offset += Math.ceil(size / 512) * 512;
  }

  return { files, skipped: skippedNames.length, skippedNames };
}
