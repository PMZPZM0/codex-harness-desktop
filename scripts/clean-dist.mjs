/**
 * 清空 dist/（仅供 `npm run check` 用，⛔ 日常 `npm run build` 不许调它）。
 *
 * 为什么 check 要清：vite 的 emptyOutDir=false（09-23 决定，保运行中实例不断腿）意味着
 * 源码一变、产物 hash 全变，旧 hash 文件全部留在 dist 里累积（实测一轮就攒出 103 个）。
 * 【151】的「真跑可达闭包」把陈旧残留全算成 dead ⇒ 228/331 假红 —— 验收必须从干净 dist 开始。
 *
 * 为什么日常 build 不清：运行中的实例正从 dist 加载 chunk，清掉 = 正在用的懒加载页
 * Failed to fetch dynamically imported module（09-23 崩溃）。保留旧产物 + vite:preloadError 自愈。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
fs.rmSync(dist, { recursive: true, force: true });
console.log("[clean-dist] 已清空", dist);
