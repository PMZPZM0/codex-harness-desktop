/**
 * custom-model-store（10-03 从 `features/model-custom-ipc/01-openai-login.ts` **下沉到基座层**）
 *
 * 为什么下沉：`withModels` / `isLocalEndpoint` / `publicCustomModel` 是 **custom-model 域**的口径，
 * 却定义在 openai 域的文件里；按前缀拆成两个板块后 ⇒ 必须落到两域之外的基座层。
 *
 * ⛔⛔ 两处判定必须同源（`publicCustomModel` 显示 与 `custom-model:save` 落盘）：
 *   不一致就会出现「存成启用、界面显示停用」这种自相矛盾的状态（09-19 用户反馈修过）。
 * ⛔ `withModels` 是 contextWindow 的**唯一写入口**（09-19 用户实测：两处各写各的 ⇒
 *   界面显示 12% 而用户以为 4%）。改这三处前先读文件头注释里的实证记录。
 */
import { normalizeProvider } from "./main";
import type { CustomModelFile } from "./features/custom-model-types";

export function withModels(entry: CustomModelFile, extra?: string): CustomModelFile {
  const normalized = normalizeProvider(entry);
  let result = normalized;
  if (extra) {
    const existing = normalized.models ?? [];
    if (!existing.some((m) => m.id === extra)) {
      const cloned = [...existing];
      cloned.unshift({ id: extra, contextWindow: entry.contextWindow });
      result = { ...normalized, models: cloned };
    }
  }
  // ⛔ 单一真相源（09-19 用户实测：「`custom-model.json` 该模型写 1000000、`custom-models.json` 同一供应商
  //   顶层写 128000，这个修一下，怎么又出现这个问题」）：
  //   两个字段表达的是同一件事，却由**两个不同来源**写 —— 模型自己的 `contextWindow` 来自内置规格表
  //   （新建供应商时的真实能力值），顶层那个只是**新建模型时的默认值**（UI 默认 128000，用户多半没动过），
  //   而引擎侧 catalog 读的是**模型自己的**值。两处各写各的 ⇒ 每次新建/保存供应商都会留下一对打架的数字，
  //   界面按大值算（显示 12%），用户按小值理解（以为只剩 4%），谁也不知道哪个是真。
  //   这里在**唯一写入点**收口：顶层恒等于生效模型自己的值（模型没有自己的值时才保留顶层输入）。
  //   ⇒ `custom-model.json` 顶层、`custom-models.json` 里那条记录顶层、catalog、界面显示四处永远一致。
  const effectiveWindow = result.model
    ? (result.models ?? []).find((m) => m.id === result.model)?.contextWindow
    : undefined;
  return effectiveWindow ? { ...result, contextWindow: effectiveWindow } : result;
}

export function isLocalEndpoint(baseUrl: unknown): boolean {
  const raw = String(baseUrl ?? "").trim();
  if (!raw) return false;
  let host = "";
  try { host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, ""); }
  catch { host = ""; }
  if (!host) {
    // 没写协议时 URL 解析会失败（用户常直接填 127.0.0.1:11434）→ 退化成字符串判断
    host = (raw.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? "").split(":")[0].toLowerCase();
  }
  if (!host) return false;
  if (host === "localhost" || host === "::1" || host === "0.0.0.0" || host.endsWith(".localhost")) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

export function publicCustomModel(value: CustomModelFile | null) {
  if (!value) return null;
  const { encryptedKey, ...config } = value;
  const hasKey = Boolean(encryptedKey);
  // ⛔ 未配置密钥的第三方供应商**不得视为已启用**（09-19 用户：「首次安装启动、没配置供应商时，
  //   默认不要启用任何供应商，要不然会跟新配置的供应商同时启用」）。
  //   ⚠️ 两个例外：① `openai-official` 靠 ChatGPT 登录凭据，本来就没有 API Key；
  //   ② 本机/内网自建服务（见 isLocalEndpoint）—— 它们本来就不需要 Key。
  //   ⛔ 两处判定必须同源：这里（显示）与 custom-model:save（落盘）不一致的话，
  //   会出现「存成启用、界面显示停用」这种自相矛盾的状态。
  const keylessThirdParty = !hasKey && value.provider !== "openai-official" && !isLocalEndpoint(value.baseUrl);
  return { ...config, enabled: keylessThirdParty ? false : value.enabled !== false, hasKey };
}
