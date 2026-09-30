/**
 * 控件皮肤 · 库正文懒加载（gzip → DecompressionStream → 内存缓存）
 *
 * 正文按类目 gzip 存于 data/<cat>.html.gz（ingest 脚本产出，MIT 源）。
 * ⛔ 显式 `?url` 静态导入（别用 import.meta.glob：它编译成 `new URL("x.gz", import.meta.url)`，
 *   不带 assets/ 前缀，before-pack 的可达闭包认不出 ⇒ 打包期被当死重删光，【151】实测踩过）。
 *   小于 64KB（assetsInlineLimit）的类目会被内联成 data URI——同样可达。
 * ⛔ 解压失败绝不 throw 到 UI：返回空数组并在结果里带 error，工坊显示可读错误。
 */

import buttonsUrl from "./data/Buttons.html.gz?url";
import cardsUrl from "./data/Cards.html.gz?url";
import checkboxesUrl from "./data/Checkboxes.html.gz?url";
import formsUrl from "./data/Forms.html.gz?url";
import inputsUrl from "./data/Inputs.html.gz?url";
import notificationsUrl from "./data/Notifications.html.gz?url";
import patternsUrl from "./data/Patterns.html.gz?url";
import radioUrl from "./data/Radio-buttons.html.gz?url";
import togglesUrl from "./data/Toggle-switches.html.gz?url";
import tooltipsUrl from "./data/Tooltips.html.gz?url";
import loadersUrl from "./data/loaders.html.gz?url";

const urlOf: Record<string, string> = {
  Buttons: buttonsUrl,
  Cards: cardsUrl,
  Checkboxes: checkboxesUrl,
  Forms: formsUrl,
  Inputs: inputsUrl,
  Notifications: notificationsUrl,
  Patterns: patternsUrl,
  "Radio-buttons": radioUrl,
  "Toggle-switches": togglesUrl,
  Tooltips: tooltipsUrl,
  loaders: loadersUrl,
};

const cache = new Map<string, Promise<{ items: { id: string; author: string; name: string; html: string }[]; error?: string }>>();

async function gunzip(buf: ArrayBuffer): Promise<string> {
  // Chromium/Electron 43 自带 DecompressionStream；缺失时给出可读错误而不是白屏
  const DS = (globalThis as { DecompressionStream?: new (fmt: string) => TransformStream }).DecompressionStream;
  if (!DS) throw new Error("运行环境缺少 DecompressionStream（需要 Chromium ≥ 103）");
  const stream = new Blob([buf]).stream().pipeThrough(new DS("gzip"));
  return new Response(stream).text();
}

export function loadCategory(cat: string): Promise<{ items: { id: string; author: string; name: string; html: string }[]; error?: string }> {
  const hit = cache.get(cat);
  if (hit) return hit;
  const job = (async () => {
    const url = urlOf[cat];
    if (!url) return { items: [], error: `类目 ${cat} 没有打包数据` };
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(await gunzip(await res.arrayBuffer())) as { id: string; author: string; name: string; html: string }[];
      return { items: json };
    } catch (error) {
      return { items: [], error: error instanceof Error ? error.message : String(error) };
    }
  })();
  cache.set(cat, job);
  return job;
}
