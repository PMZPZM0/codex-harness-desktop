/**
 * 预检守卫组：13-drama-gen —— 画布「生成通道分流 + 配置引导 + 结果面板」。
 *
 * 立此组的原因（09-28 用户反馈三连）：
 *   · 「生图跟视频都没有区分开功能，流程都一样」→ 原来「生成视频」按钮**无条件**渲染在
 *     所有卡片上（笔记卡、剧本卡也有），用户分不清两条通道；
 *   · 「生图模型都没有配置的地方」→ 未配置时点了才 notice 报错，卡片上没有任何前置提示；
 *   · 「相册也没有」→ 生成结果只写在卡片 payload 里，没有一处能总览。
 * 三条都是**静态可查**的结构事实 ⇒ 用断言钉住，避免下次重构又退回原样。
 *
 * 共享面由 ./_ctx.mjs 注入。
 */
import { C, ROOT, join, ok, fail, readFileSync } from "./_ctx.mjs";

export async function run() {
  console.log(C.bold("\n【192】画布生成通道分流与结果面板"));

  const card = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaNodeCard.tsx"), "utf8");
  const canvas = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8");
  const panel = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaResultsPanel.tsx"), "utf8");
  const story = readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-story.ts"), "utf8");

  /* ① 生成按钮必须按节点类型分流 —— 判据锚「有映射表 + 无映射就 return null」，
        而不是锚某个 kind 字符串（那样改一个类型就假绿）。 */
  (/const GEN_CHANNELS: Record<string, Array<"image" \| "video" \| "audio">> = \{/.test(card) ? ok : fail)(
    "【192】卡片有「节点类型 → 可用生成通道」映射表（GEN_CHANNELS）"
  );
  (/const allowed = GEN_CHANNELS\[kind\];\s*\n\s*if \(!allowed\) return null;/.test(card) ? ok : fail)(
    "【192】映射表外的节点类型**不渲染**生成按钮（策划卡不该有生成图/视频）"
  );
  // ⛔ 负向断言：视频按钮不得再无条件渲染（原病根）
  (!/className="drama-canvas-btn"[^>]*onClick=\{\(e\) => \{ e\.stopPropagation\(\); void actions\.story\.generate\(id, "video"\); \}\}/.test(card) ? ok : fail)(
    "【192】没有「无条件渲染的生成视频按钮」（09-28 前的病根）"
  );

  /* ② 未配置 → 「去配置」而不是点了才报错 */
  (/const missing = needConfig\(what\);/.test(card) && /if \(missing\) \{ actions\.openGenSettings\(what\); return; \}/.test(card) ? ok : fail)(
    "【192】未配置通道时按钮改为跳「设置 → 插件」（不再点了才弹错）"
  );
  (/channels: DramaChannelState;/.test(story) && /refreshChannels/.test(story) ? ok : fail)(
    "【192】story 层暴露两条通道的就绪状态（卡片据此显示「去配置生图模型 / 去配置视频接口」）"
  );
  (/onOpenPluginSettings/.test(canvas) && /setSettingsPage\("plugins"\)/.test(readFileSync(join(ROOT, "src", "features", "app-view", "AppView.tsx"), "utf8")) ? ok : fail)(
    "【192】宿主把「设置 → 插件」页面接到了画布（onOpenPluginSettings → plugins 页）"
  );

  /* ③ 结果面板（相册）：状态 + 渲染 + 定位三处接线，光有组件不算数 */
  (/const \[resultsOpen, setResultsOpen\]/.test(canvas) ? ok : fail)(
    "【192】画布有结果面板开关状态"
  );
  (/resultsOpen \? \(/.test(canvas) && /<DramaResultsPanel/.test(canvas) ? ok : fail)(
    "【192】结果面板真的被渲染"
  );
  (/setResultsOpen\(true\)/.test(canvas) ? ok : fail)(
    "【192】顶栏有打开结果面板的入口"
  );
  (/payload\.image/.test(panel) && /payload\.video/.test(panel) ? ok : fail)(
    "【192】结果面板聚合卡片 payload 的 image/video（不扫盘 —— 扫盘判不准「谁生成的」）"
  );

  /* ④ 空画布引导（用户「新建了然后呢，有什么用」） */
  (/drama-canvas-blank-guide/.test(canvas) && /board\.nodes\.length === 0 \?/.test(canvas) ? ok : fail)(
    "【192】空画布有引导（说明画布/分镜表用途与两个起手按钮的区别）"
  );
  (/pointer-events: none/.test(readFileSync(join(ROOT, "src", "styles", "21-drama-canvas.css"), "utf8").split(".drama-canvas-blank-guide {")[1]?.slice(0, 700) ?? "") ? ok : fail)(
    "【192】引导层 pointer-events:none（不挡住画布的拖拽/框选）"
  );

  /* ⑤ 渲染层**不得** import 主进程逻辑模块（09-28 实测踩到，不只是预览问题）
        `src/lib/video-providers.mjs` 顶部 `import { createHmac } from "node:crypto"` ——
        渲染层没有 node 内置模块：vite dev 下解构导入直接抛 externalized 错误，
        生产构建只是侥幸不炸。视频配置卡需要的字段全部由 window.codex.videoProviders() 提供。 */
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const walk = (dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.tsx?$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const offenders = walk(join(ROOT, "src"))
      .filter((f) => /video-providers\.mjs/.test(fs.readFileSync(f, "utf8")) && !/^\s*[*\/]/.test(fs.readFileSync(f, "utf8").split(/\r?\n/).find((l) => l.includes("video-providers.mjs")) ?? ""))
      .map((f) => f.replace(ROOT, "").replace(/\\/g, "/"))
      .filter((f) => fs.readFileSync(join(ROOT, f.slice(1)), "utf8").split(/\r?\n/).some((l) => /^\s*import[\s\S]*video-providers\.mjs/.test(l)));
    (offenders.length === 0 ? ok : fail)(
      `【192】渲染层不 import 含 node:crypto 的 video-providers.mjs（厂商数据走 IPC）${offenders.length ? "：" + offenders.join(" / ") : ""}`
    );
    // 两份可选字段清单必须一致（渲染层副本 vs 适配层真相源）
    const adapter = /export const VIDEO_OPTIONAL_FIELDS = \[([^\]]*)\]/.exec(
      readFileSync(join(ROOT, "src", "lib", "video-providers.mjs"), "utf8"),
    )?.[1] ?? "";
    const adapterFields = [...adapter.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const localCopy = readFileSync(join(ROOT, "src", "features", "settings-plugins", "video-optional-fields.ts"), "utf8");
    const localFields = [...(/export const OPTIONAL_FIELDS = \[([^\]]*)\]/.exec(localCopy)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    (adapterFields.length > 0 && JSON.stringify(adapterFields) === JSON.stringify(localFields) ? ok : fail)(
      `【192】可选字段两份同源（适配层 [${adapterFields.join(",")}] vs 渲染层 [${localFields.join(",")}]）—— 不一致则用户填了保存不住`
    );
  }
}
