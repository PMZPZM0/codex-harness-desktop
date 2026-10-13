#!/usr/bin/env node
/**
 * 12m-builtin-secrets —— 内置插件（生图 / 视觉）密钥的**落盘卫生**守卫（10-13 体检 P0-1）。
 *
 * 守的不变量：`builtin-plugins.json` 里**永远不许出现明文密钥**。
 *   起因：这份文件过去用裸 `JSON.stringify` 写 `apiKey`，任何进程 / 截图 / 目录列表 / 备份
 *   都能直接读到；而同一应用的 `custom-models.json` 早就走 safeStorage 加密（`encryptedKey`）。
 *   同一条链路两套口径 —— 典型「新加的这条没跟上」。
 *
 * ⛔ 这条不能只做静态断言：**"落盘到底是不是密文" 是运行期事实**（静态看代码只能看到
 *   调了个 encrypt，看不到文件里到底写进去什么）。所以主体是**真跑**：
 *   用夹具 userData + 假 safeStorage 跑 `dist-electron/main/09-agents-plugins.js` 的真函数。
 * ⛔ 还有一条容易被"顺手简化"掉的约束：**命令行兜底 `harness-media.mjs` 拿不到 safeStorage**
 *   ⇒ 密钥必须由主进程注入**引擎进程 env**（`CODEX_HARNESS_IMAGE_API_KEY` 等），
 *   否则配置文件一加密，命令行那条路就再也生不了图（本守卫同时钉住这条供给链）。
 * ⛔ 安全护栏：夹具**只敢用临时目录** —— 先断言解析出来的路径在临时根之内，否则直接中止。
 */
import Module, { createRequire } from "node:module";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);

let checks = 0;
let fails = 0;
const ok = (cond, label) => {
  checks++;
  if (!cond) fails++;
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}`);
};
const read = (p) => {
  try { return readFileSync(path.join(ROOT, p), "utf8"); } catch { return ""; }
};
/** 负向断言一律先剥注释（本文件头注就在讲这些坑，裸 `!/…/` 会被自己打成假红）。 */
const codeOnly = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .filter((line) => !/^\s*\/\//.test(line))
  .map((line) => line.replace(/\s\/\/[^'"`]*$/, ""))
  .join("\n");

const pluginsSrc = read("electron/main/09-agents-plugins.ts");
const pluginsCode = codeOnly(pluginsSrc);
const ipcSrc = codeOnly(read("electron/features/builtin-ipc.ts"));
const bootSrc = codeOnly(read("electron/features/boot.ts"));
const serverSrc = codeOnly(read("electron/codex-server.ts"));
const cliSrc = read("resources/tools/harness-media.mjs");

console.log("【① 落盘侧：密钥只以密文存在】");
ok(/safeStorage\.encryptString\(/.test(pluginsSrc) && /encryptedKey/.test(pluginsSrc),
  "写盘把密钥加密成 encryptedKey（safeStorage，与 custom-models 同一方案）");
ok(/export async function writeBuiltinPlugins/.test(pluginsCode) && !/builtinPluginsFile/.test(ipcSrc),
  "⛔ 文件唯一写入点在 09-agents-plugins（域不再自己 JSON.stringify —— 那正是明文的老路）");
ok(/JSON\.stringify\(cfg/.test(pluginsCode) === false,
  "⛔ 负向：没有任何一处再把内存态配置直接 stringify 落盘");

console.log("【② 读取侧：既要解密新形态，也要容忍存量明文】");
ok(/export async function readBuiltinPlugins/.test(pluginsCode) && /decryptKey\(encryptedKey\)/.test(pluginsCode),
  "读盘对 encryptedKey 解密");
ok(/encryptedKey \? decryptKey\(encryptedKey\) : String\(apiKey \?\? ""\)/.test(pluginsCode),
  "⛔ 没有 encryptedKey 时原样返回 apiKey（老文件与 verify-image-plugin 夹具都是明文，不能打红）");
ok(/safeStorage\?\.isEncryptionAvailable\?\.\(\)/.test(pluginsSrc),
  "⛔ safeStorage 一律可选链（守卫 stub / 非 Electron 宿主里它可能整个不存在，抛了就整条读挂掉）");

console.log("【③ 存量明文必须被就地升级（启动自愈）】");
ok(/export async function migrateBuiltinPluginSecrets/.test(pluginsCode) && /delete entry\.apiKey/.test(pluginsCode),
  "迁移函数把明文 apiKey 换成 encryptedKey 并删掉明文");
ok(/migrateBuiltinPluginSecrets\(\)/.test(bootSrc),
  "启动链调用它（否则老用户的明文永远躺在那儿）");
{
  const mig = bootSrc.indexOf("migrateBuiltinPluginSecrets()");
  const start = bootSrc.indexOf("server.start(");
  ok(mig >= 0 && start >= 0 && mig < start, "⛔ 迁移排在 server.start 之前（引擎起来前落定）");
}
ok(!/\.bak/.test(pluginsCode) || !/migrateBuiltinPluginSecrets[\s\S]{0,800}\.bak/.test(pluginsCode),
  "⛔ 负向：迁移不写 .bak（备份里躺一份明文等于没修）");

console.log("【④ 密钥供给链：命令行兜底拿不到 safeStorage，必须走引擎 env】");
ok(/export function builtinPluginEnv/.test(pluginsCode) && /CODEX_HARNESS_IMAGE_API_KEY/.test(pluginsSrc),
  "09-agents-plugins 导出 builtinPluginEnv（密钥 → env 的唯一口径）");
ok(/CLI 拿不到 safeStorage|拿不到 Electron 的 safeStorage/.test(pluginsSrc),
  "该函数注释写明**为什么**必须走 env（否则下一轮会有人把它删掉）");
ok(/setBuiltinPluginEnv\(/.test(ipcSrc) && ipcSrc.indexOf("setBuiltinPluginEnv") < ipcSrc.indexOf("server.restart()"),
  "⛔ 保存配置时在 restart **之前**注入 env（spawn 之后再设对已起进程无效）");
ok(/setBuiltinPluginEnv\(/.test(bootSrc),
  "启动时也注入一次（用户没再点保存，命令行那条路也得能取到密钥）");
ok(/private builtinEnv/.test(serverSrc) && /\.\.\.this\.builtinEnv/.test(serverSrc),
  "codex-server 把 builtinEnv 并进 spawnEnv（与 externalEnv **分开**：后者被多处整体替换）");
ok(/ENV_KEY\s*=\s*\{[\s\S]{0,120}CODEX_HARNESS_IMAGE_API_KEY/.test(cliSrc)
  && /process\.env\[ENV_KEY\[kind\]\] \|\| conf\.apiKey/.test(cliSrc),
  "harness-media.mjs 优先读 env、回落读文件明文（两个来源取先有的那个）");
ok(!/明文 apiKey 优先/.test(cliSrc),
  "⛔ 负向：CLI 里那句过期的「明文 apiKey 优先」注释已删（它声称的行为代码里从来不存在）");

console.log("【⑤ 真跑：加密落盘 / 明文兼容 / 迁移幂等 / env 下发】");
{
  const root = mkdtempSync(path.join(os.tmpdir(), "builtin-secrets-guard-"));
  const userData = path.join(root, "userData");
  mkdirSync(userData, { recursive: true });
  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === "electron") {
      return {
        app: { getPath: (n) => (n === "userData" ? userData : path.join(root, n)), isPackaged: false, on() {}, once() {}, whenReady: () => Promise.resolve() },
        safeStorage: {
          isEncryptionAvailable: () => true,
          // 假加密：可逆、可判别 —— 测试只需证明「落盘不是明文」
          encryptString: (value) => Buffer.from("ENC::" + value, "utf8"),
          decryptString: (buf) => Buffer.from(buf).toString("utf8").replace(/^ENC::/, ""),
        },
        BrowserWindow: function () {}, nativeTheme: { shouldUseDarkColors: false },
        ipcMain: { handle() {}, on() {}, removeHandler() {} }, shell: {}, dialog: {}, clipboard: {}, net: {},
      };
    }
    return origLoad.apply(this, arguments);
  };
  try {
    const E = path.join(ROOT, "dist-electron");
    const rp = require(path.join(E, "runtime-paths.js"));
    rp.initRuntimePaths();
    // ⛔ 安全护栏：解析出来的必须是我们自己的临时目录，否则立刻中止（绝不碰真实用户文件）
    if (!String(rp.builtinPluginsFile).startsWith(root)) {
      ok(false, `夹具路径不在临时目录内，已中止：${rp.builtinPluginsFile}`);
    } else {
      const mod = require(path.join(E, "main", "09-agents-plugins.js"));
      const onDisk = () => JSON.parse(readFileSync(rp.builtinPluginsFile, "utf8"));

      writeFileSync(rp.builtinPluginsFile, JSON.stringify({ image: { enabled: true, baseUrl: "https://x/v1", apiKey: "sk-plain-123", model: "m1" } }, null, 2), "utf8");
      ok((await mod.readBuiltinPlugins()).image?.apiKey === "sk-plain-123",
        "真跑：存量**明文**仍读得回来（老文件 / 端到端夹具不被打红）");

      ok((await mod.migrateBuiltinPluginSecrets()) === true, "真跑：迁移返回 true");
      ok(onDisk().image.encryptedKey && onDisk().image.apiKey === undefined,
        "真跑：🔑 落盘只剩 encryptedKey（明文 apiKey 已删）");
      ok(!JSON.stringify(onDisk()).includes("sk-plain-123"), "真跑：文件里搜不到明文密钥");
      ok((await mod.readBuiltinPlugins()).image?.apiKey === "sk-plain-123", "真跑：迁移后仍能解出原密钥");
      ok((await mod.migrateBuiltinPluginSecrets()) === false, "真跑：迁移幂等（第二次 false）");

      await mod.writeBuiltinPlugins({ image: { enabled: true, baseUrl: "https://x/v1", apiKey: "sk-new-456", model: "m2" } });
      ok(onDisk().image.encryptedKey && onDisk().image.apiKey === undefined, "真跑：新写入同样是密文");
      ok((await mod.readBuiltinPlugins()).image?.apiKey === "sk-new-456", "真跑：新密钥读得回来");

      const env = mod.builtinPluginEnv(await mod.readBuiltinPlugins());
      ok(env.CODEX_HARNESS_IMAGE_API_KEY === "sk-new-456", "真跑：密钥进 env（命令行兜底的唯一来源）");
      ok(mod.builtinPluginEnv({ vision: { baseUrl: "b", apiKey: "", model: "m" } }).CODEX_HARNESS_VISION_API_KEY === undefined,
        "真跑：空密钥不注入（不留空串变量）");
    }
  } catch (error) {
    ok(false, `真跑段抛异常：${String(error && error.stack || error).slice(0, 300)}`);
  } finally {
    Module._load = origLoad;
    try { rmSync(root, { recursive: true, force: true }); } catch { /* 临时目录，删不掉无妨 */ }
  }
}

console.log("");
console.log(fails === 0 ? `12m 内置插件密钥守卫：全部通过（${checks}/${checks}）` : `12m 内置插件密钥守卫：${fails} 项未通过（共 ${checks} 项）`);
process.exit(fails === 0 ? 0 : 1);
