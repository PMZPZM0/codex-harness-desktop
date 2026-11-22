/**
 * download-sources —— 下载通道的**单一真相源**（11-22，用户令「镜像源必须做两种系统准备」）。
 *
 * 为什么要有这个文件：镜像候选此前散落在三处 —— 渲染层的 gh-mirror（前缀池）、
 * 安装脚本 install-runtimes.cjs 的 `chinaMirrorUrl()`（host 映射）、以及各处手写的
 * gh-proxy 字符串。三处独立演化 ⇒ 「Windows 能吃到 npmmirror、mac 吃到的不多」，
 * 而用户看到的症状是「mac 的镜像源都有问题」。
 *
 * 现在：
 *   · 通道清单按**平台**分开列（`channels.win32` / `channels.darwin`），没有该平台的通道就不列；
 *   · npmmirror 的 host 映射集中在一张表（Windows / mac 的资产都能受益，因为是按 URL 前缀替换）；
 *   · 自检（设置 → 开发工具 → 工具自检）与安装脚本读同一份 JSON。
 *
 * ⛔ 不在这里写"某个工具在哪个平台叫什么名字"——那是安装表（install-runtimes.cjs）的事。
 *   这里只管**通道**：怎么把官方 URL 换成国内可达的 URL。
 */
import path from "node:path";
import fs from "node:fs";

export type ChannelProbe = { label: string; prefix: string; probe: string };
type SourceFile = {
  probe: Record<string, string>;
  channels: Record<string, ChannelProbe[]>;
  npmmirror: Record<string, string>;
};

let cached: SourceFile | null = null;

/** 读表（懒加载 + 缓存；读不到就返回空表，调用方按「没有通道」降级，⛔ 不许抛错打断启动）。 */
function table(): SourceFile {
  if (cached) return cached;
  const candidates = [
    path.join(__dirname, "..", "scripts", "lib", "download-sources.json"),
    path.join(process.cwd(), "scripts", "lib", "download-sources.json"),
    path.join(process.resourcesPath ?? "", "tools", "download-sources.json"),
  ];
  for (const file of candidates) {
    try {
      cached = JSON.parse(fs.readFileSync(file, "utf8")) as SourceFile;
      return cached;
    } catch { /* 下一个位置 */ }
  }
  cached = { probe: {}, channels: {}, npmmirror: {} };
  return cached;
}

/** 当前平台的通道清单（mac 走 darwin 那份；未登记的平台返回空 = 只走直连）。 */
export function channelsForPlatform(): ChannelProbe[] {
  return table().channels[process.platform] ?? [];
}

/** 把官方 URL 换成 npmmirror 上的等价地址；没有映射就原样返回。 */
export function npmmirrorUrl(url: string): string | null {
  const map = table().npmmirror ?? {};
  for (const [from, to] of Object.entries(map)) {
    if (url.startsWith(from)) return to + url.slice(from.length);
  }
  return null;
}

/** 自检用的探测目标（`probe` 字段是键名，映射成真实 URL）。 */
export function probeUrlOf(key: string): string {
  return table().probe?.[key] ?? "";
}

/** 按通道前缀给官方 URL 生成候选（空前缀 = 直连；npmmirror 通道用 host 映射而不是拼前缀）。 */
export function candidatesThroughChannels(url: string): Array<{ label: string; url: string }> {
  const rows: Array<{ label: string; url: string }> = [];
  const mirrored = npmmirrorUrl(url);
  for (const channel of channelsForPlatform()) {
    if (channel.label.startsWith("npmmirror")) {
      if (mirrored) rows.push({ label: channel.label, url: mirrored });
      continue;
    }
    if (!channel.prefix) { rows.push({ label: channel.label, url }); continue; }
    /* gh 加速只处理 GitHub 资产：把前缀拼在完整 URL 前面 */
    if (url.includes("github.com/") || url.includes("githubusercontent.com")) {
      rows.push({ label: channel.label, url: channel.prefix + url });
    }
  }
  return rows;
}

/**
 * 自检目标：当前平台的每条通道 + 一条能代表它的探测地址。
 * ⛔ 探测地址必须**小**（几十 KB）：自检是用户手点的，不能为了测速拉几百兆。
 */
export function probeRows(): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  const seen = new Set<string>();
  for (const channel of channelsForPlatform()) {
    const base = probeUrlOf(channel.probe);
    if (!base) continue;
    const url = channel.prefix && channel.probe === "github" ? channel.prefix + base : base;
    if (seen.has(url)) continue;   // 两条直连通道的探测地址相同，只留一条
    seen.add(url);
    out.push({ label: channel.label, url });
  }
  return out;
}

