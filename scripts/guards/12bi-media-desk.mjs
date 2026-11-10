/**
 * 自媒体工作台（11-09）：**原样嵌入**开源 dsh-media-desk 的接线与安全判据。
 *
 * 用户令「开源啥样就复刻啥样」⇒ 界面与流程 = 它的原版客户端 + 宿主源码（随包，MIT），
 * 我们只提供宿主适配（模型/密钥/静态目录）与一个只监听 127.0.0.1 的本地服务。
 * 这里钉住四类「接漏了还看不出来」的点：
 *   ① 域/桥/设置页仍可达（composition / manifest / registry / preload / d.ts / 三处入口）；
 *   ② 随包产物齐备（client.js / index.html / glue.js / host/host.js / React 包 / 封面素材）；
 *   ③ 安全：只绑 127.0.0.1、数据目录经 DSH_HOME 重定向、域不直取 safeStorage、采集拒绝内网；
 *   ④ Codex 能直接跑整条流程（media_desk 工具 → 本地服务）。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, codeOnly } from "./_ctx.mjs";

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const has = (rel) => existsSync(path.join(ROOT, rel));
let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks += 1;
  if (condition) { console.log(`  ✓ ${message}`); return true; }
  fails += 1;
  console.log(`  ✗ ${message}`);
  return false;
};

export async function run() {
  const composition = read("electron/composition.json");
  const manifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
  const registry = read("electron/ipc-registry.ts");
  const preload = read("electron/preload.ts");
  const dts = read("src/vite-env.d.ts");
  const embed = read("electron/features/media-desk/embed.ts");
  const ipc = read("electron/features/media-desk/ipc.ts");
  const catalogs = read("src/features/app-view/helpers/catalogs.ts");
  const help = read("src/components/HelpDialog.tsx");
  const pageCandidates = [
    "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/pages/capabilities.tsx",
    "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx",
    "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/02-settings-content.tsx",
  ];
  const pageSrc = (() => { for (const rel of pageCandidates) { try { return read(rel); } catch { /* 换下一个 */ } } return ""; })();
  const board = read("src/features/media-desk/index.tsx");
  const boardCss = read("src/styles/63-media-desk.css");
  const dispatchCore = read("electron/features/dispatch-core.ts");
  const dispatchRpc = read("electron/features/dispatch-rpc.ts");
  const tool = read("electron/features/media-desk/tool.ts");
  const pkg = JSON.parse(read("package.json"));

  const channels = manifest.channels.filter((c) => String(c.channel).startsWith("media-desk:"));
  ok(/"id": "media-desk"/.test(composition) && /features\/media-desk\/ipc\.ts/.test(composition),
    "组合表已挂载 media-desk 域");
  ok(channels.length === 1 && channels[0].channel === "media-desk:endpoint" && /prefix: "media-desk", count: 1/.test(registry),
    `桥只有 endpoint 一条（实测 ${channels.length}，界面走本地服务，不再铺 10 条数据通道）`);
  ok(/mediaDeskEndpoint/.test(preload) && /mediaDeskEndpoint\(\): Promise<string>/.test(dts),
    "桥三件套齐备（preload / vite-env 都有 mediaDeskEndpoint）");
  ok(/\["media-desk", "自媒体工作台"/.test(catalogs) && /\{ page: "自媒体工作台"/.test(help)
    && /"media-desk": \{ render:/.test(pageSrc),
    "设置页可到达：导航 + 帮助总览 + 页面注册三处都在");

  ok(has("resources/media-desk/client.js") && has("resources/media-desk/index.html") && has("resources/media-desk/glue.js")
    && has("resources/media-desk/react.bundle.js") && has("resources/media-desk/host/host.js") && has("resources/media-desk/host/package.json")
    && has("resources/media-desk/assets"),
    "随包产物齐备（原版客户端 / 页面 / React 包 / 宿主源码 / 封面素材）");
  ok(JSON.stringify(pkg.build?.extraResources ?? []).includes("resources/media-desk"),
    "打包会带上 resources/media-desk（extraResources）");
  ok(/listen\(0, "127\.0\.0\.1"/.test(embed) && /process\.env\.DSH_HOME = path\.join\(app\.getPath\("userData"\), "media-desk-host"\)/.test(embed),
    "本地服务只绑 127.0.0.1，数据目录经 DSH_HOME 落到 userData");
  ok(/const TOKEN = randomBytes\(18\)\.toString\("hex"\)/.test(embed)
    && /const PREFIX = `\/t\/\$\{TOKEN\}`/.test(embed)
    && /url\.pathname !== PREFIX && !url\.pathname\.startsWith\(PREFIX \+ "\/"\)/.test(embed),
    "页面与接口都挂在随机令牌前缀下（本机其它网页猜不到地址）");
  ok(/String\(req\.headers\.host \?\? ""\) !== `127\.0\.0\.1:\$\{boundPort\}`/.test(embed),
    "Host 头必须是本机这一跳（挡 DNS rebinding / 跨站打到本地服务）");
  ok(/new Function\("specifier", "return import\(specifier\);"\)/.test(embed) && /nativeImport\(pathToFileURL/.test(embed),
    "随包 host.js 用原生动态 import 加载（⛔ tsc 会把 import() 降级成 require，file:// 与 ESM 都读不了）");
  ok(/op: "add_item", \.\.\.item/.test(tool) && !/op: "add_item", item/.test(tool),
    "上游 op 用扁平字段（⛔ 不是 {op, item:{…}}，套一层会被判「灵感内容为空」）");
  ok(/try \{\s*key = secureHost\.decryptString[\s\S]{0,80}catch \{\s*key = ""/.test(embed),
    "解密失败按「无 Key」继续（⛔ 密钥库换过 / 档案拷来不许让整个工作台起不来）");
  ok(/AbortSignal\.timeout\(30_000\)/.test(embed) && /serverPromise = null;[\s\S]{0,40}throw error/.test(embed),
    "工具请求有 30s 超时；启动失败会清掉 Promise 允许重试");
  ok(/new URL\(`media-desk\/\$\{pathname\.replace/.test(embed),
    "工具请求拼上 media-desk/ 前缀（与界面同一套上游路由）");
  ok(/src="\.\/react\.bundle\.js"/.test(read("resources/media-desk/index.html")),
    "页面用相对路径加载随包脚本（令牌前缀下也能取到）");
  ok(/dsh-media-desk 2\.6\.2/.test(read("THIRD_PARTY_NOTICES.md")) && /woniuniuniu\/dsh-media-desk/.test(read("THIRD_PARTY_NOTICES.md")),
    "第三方声明登记了随包的 dsh-media-desk（MIT + 上游地址）");
  ok(!/safeStorage/.test(codeOnly(ipc)) && !/safeStorage/.test(codeOnly(embed)) && /secure/.test(embed),
    "⛔ 域不直取 safeStorage（密钥走宿主 secure 接缝）");
  ok(/<iframe className="media-desk-frame"/.test(board) && /mediaDeskEndpoint/.test(board),
    "渲染层用 iframe 打开原版界面（不再自绘一套）");
  ok(/dsh-media-desk（MIT）/.test(board) && /数据只存本机/.test(board) && /排期不会自动发布/.test(board)
    && /openExternal\(SOURCE_URL\)/.test(board) && /github\.com\/woniuniuniu\/dsh-media-desk/.test(board),
    "页面写明开源声明（MIT / 数据只存本机 / 排期不自动发布）并有「开源项目」跳转按键");
  ok(/\.media-desk-note\b/.test(boardCss) && /\.media-desk-link:hover/.test(boardCss) && /height: calc\(100vh - 190px\)/.test(boardCss),
    "声明与跳转按键有样式（且 iframe 高度为底部说明让位）");
  ok(/action: \{ type: "string", enum: \["state", "capture", "draft", "produce", "schedule", "metric", "insights", "style", "delete", "undo"\]/.test(dispatchCore)
    && /name === "media_desk"/.test(dispatchRpc) && /runMediaDeskTool/.test(dispatchRpc) && /mediaDeskRequest/.test(tool),
    "Codex 可直接跑整条流程（media_desk 工具 → 本地服务，与界面同一份数据）");
  ok(/metric 需要 platform/.test(tool) && /case "insights"/.test(tool) && /mediaDeskRequest\("insights"\)/.test(tool),
    "记数据必须带平台（上游 drop 非法平台会报「数据需要平台」）+ 复盘可读（insights）");
  ok(/capture-url/.test(tool) && /op: "set_style"/.test(tool) && /op: "schedule_item"/.test(tool) && !/angleId/.test(tool),
    "工具语义对齐上游：链接走 capture-url、风格走 set_style、已有稿改期走 schedule_item（不复用 angleId）");
  ok(!/images: \{ type/.test(dispatchCore) && !/what: \{ type/.test(dispatchCore) && !/inspirationId/.test(dispatchCore) && !/collection: \{ type/.test(dispatchCore),
    "工具 schema 不再宣传未实现的参数（images / what / inspirationId / collection）");
  ok(/media_desk（自媒体工作台/.test(read("src/features/app-state/parts/part08/01-seg.tsx")),
    "能力网关 description 点名 media_desk（⛔ 不写进描述 = 模型不知道它能用）");
  ok(/const wireApi = target\.wireApi === "responses" \? "responses" : "chat";/.test(read("electron/features/media-desk/ai.ts"))
    && /const body = wireApi === "responses"/.test(read("electron/features/media-desk/ai.ts"))
    && /\/responses/.test(read("electron/features/media-desk/ai.ts"))
    && /wireApi: active\.wireApi === "responses"/.test(embed),
    "文本模型两种协议都支持（responses / chat；只认 chat 会让 responses 供应商的成稿退化成结构草稿）");
  ok(/productionSummary/.test(tool) && (tool.match(/production\?\.status === "failed"/g) ?? []).length >= 2,
    "成稿失败如实回 ok:false（draft / produce 都要判失败）+ 生产结果只给摘要（原文可达 20 万字）");

  /* 行为：随包的采集闸真的拦内网、放公网（IP 字面量，避免测试依赖 DNS）。 */
  try {
    const mod = await import(pathToFileURL(path.join(ROOT, "resources", "media-desk", "host", "harvest.js")).href);
    const rejects = async (url) => { try { await mod.assertPublicUrl(url); return false; } catch { return true; } };
    ok((await rejects("http://127.0.0.1/x")) && (await rejects("http://10.0.0.5/")) && (await rejects("http://192.168.1.2/"))
      && (await rejects("http://172.20.0.1/")) && (await rejects("http://localhost/")) && (await rejects("file:///C:/x"))
      && !(await rejects("http://8.8.8.8/")),
      "采集链接：本机 / 内网 / 非 http(s) 一律拒绝，公网 IP 放行");
  } catch (error) {
    ok(false, `随包采集闸没跑起来：${String(error?.message ?? error).slice(0, 80)}`);
  }

  console.log(`\n【media-desk】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
  return fails;
}

const failed = await run();
if (failed) process.exit(1);
