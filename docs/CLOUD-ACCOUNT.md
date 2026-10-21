# 云账号 · 云端模型同步 · 云端知识库/记忆（接入与使用）

> 2026-10-16 落地。本文是这套能力的**接口手册 + 使用教程**；改动相关代码时请同步本文。
> 域清单：`cloud-auth` / `cloud-models` / `cloud-kb` / `cloud-memory`（各一个板块，一个域前缀）。
> 基座：`electron/cloud-api.ts`（凭据与请求**唯一**入口）、`electron/cloud-provider.ts`（模型档案写入）、
> `electron/cloud-mcp.ts`（MCP 连接器写入）。

---

## 一、它是什么

一条**中转站式**的云账号登录：用户在应用里填账号密码 → 登录成功后

1. **自动同步云端模型**到本机模型下拉框，并**每 10 分钟自动保持更新**；
2. 把**云端知识库**接成 MCP 连接器（引擎可直接检索）；
3. 取回**云端记忆**凭据并加密缓存（记忆中枢暂无 MCP 端点，见 §8）。

**10-22「登录即用」**：登录与「一键同步 / 修复」走同一个编排器
`src/lib/cloud-provision.mjs`，一次把模型 / 知识库 / 记忆配齐（未开通的跳过并写明原因）；
**已配置别的供应商时不抢生效位**（只同步、不切换）。页面只保留一张登录卡 + 就绪清单，
重签 / 连通测试 / 上传下载会话等手动流程收进「手动流程 / 高级设置」折叠；新手教程在页内与
侧栏「新手教程 → 云账号」各一份。服务器云管理里改了勾选或权益：模型走主进程 10 分钟轮询，
知识库/记忆由 `CloudAccountSyncBridge` 每 10 分钟刷新**已经接通**的资源（⛔ 不把用户手动关掉的又打开）。

⛔ **不是配对流程**：服务端 `accountWho()` 同时认「网页会话令牌」与「设备令牌」，两者都从
`Authorization: Bearer` 进 ⇒ `POST /login` 拿到的令牌可直接当 Bearer 用。配对（`/pair-ticket`）
是给"没有登录会话的壳"准备的，桌面版不需要。

---

## 二、生效链路

```
用户填账号密码
   └─ cloud-auth:login ──► POST {base}/login ──► 会话令牌（safeStorage 加密 → userData/cloud/auth.json）
          │
          ├─ cloud-models:sync ──► GET /models（含每模型勾选状态与积分倍率）
          │                     └─ POST /proxy/token ──► 代理令牌（加密 → userData/cloud/proxy-token）
          │                     └─► 写 custom-models.json（列表）+ custom-model.json（生效档案）
          │                            └─► 引擎 config.toml ──► 底栏模型下拉框
          │
          └─ cloud-kb:sync ──► GET /integrations ──► knowledge.mcpUrl + mcpToken
                                  └─► userData/connectors.json 写入连接器 cloud-kb
                                         └─► 引擎 [mcp_servers.cloud-kb]（令牌走环境变量，⛔ 不落 config.toml）
```

---

## 三、接口清单（渲染层照抄即可）

全部经 `window.codex.<方法名>` 调用（类型见生成的 `src/vite-env.d.ts`）。

### cloud-auth（4）

| 方法 | 入参 | 返回 | 用途 |
|---|---|---|---|
| `cloudAuthLogin(input)` | `{ baseUrl?, username, password }` | `{ ok, account?, error? }` | 登录。`baseUrl` 省略走默认（见 §5） |
| `cloudAuthLogout(id?)` | `id?: string` | `{ ok, loggedIn, baseUrl, active }` | 退出（省略 id = 退出当前生效账号）。**最后一个账号被删时才收摊** |
| `cloudAuthSwitch(id)` | `id: string` | `{ ok, loggedIn, baseUrl, active }` | 多账号时切换生效账号 |
| `cloudAuthStatus()` | — | `{ loggedIn, baseUrl, active, accounts[], defaultBaseUrl }` | 登录态。⛔ 只回账号与"有没有"，**不回令牌** |

### cloud-models（5）

| 方法 | 入参 | 返回 | 用途 |
|---|---|---|---|
| `cloudModelsCatalog()` | — | 服务端 `/models` 原样透传 | 面板展示（勾选状态 + 倍率） |
| `cloudModelsSync(input?)` | `{ force? }` | `{ ok, models, changed, promoted, error? }` | **唯一同步入口**。`force` 会重签代理令牌 |
| `cloudModelsToken(input?)` | `{ force? }` | `{ ok, token, reused, error? }` | 单独取令牌（"Key 掉了"的修复入口） |
| `cloudModelsSetEnabled(input)` | `{ ids: string[] }` | `{ ok, enabledCount?, sync?, error? }` | 勾选写**服务端**，写完立刻同步到本机 |
| `cloudModelsStatus()` | — | `{ loggedIn, registered, enabled, models, hasToken, lastSyncAt }` | 只读本地状态，**不联网** |

### cloud-kb / cloud-memory（各 2）

| 方法 | 返回 | 用途 |
|---|---|---|
| `cloudKbSync()` | `{ ok, action, url?, kbName?, error? }` | 拉集成凭据 → 写/停用连接器 `cloud-kb` |
| `cloudKbStatus()` | `{ exists, enabled, url, hasToken, connectorId, tool }` | 只读本地 |
| `cloudMemorySync()` | `{ ok, mode: "mcp"\|"rest-only"\|"not-activated", error? }` | 取凭据并缓存；当前恒为 `rest-only` |
| `cloudMemoryStatus()` | `{ connectorId, connector, hasCredentials, mode, note }` | 只读本地 |

---

## 四、落盘位置

| 数据 | 位置 | 形态 |
|---|---|---|
| 云账号（多账号） | `userData/cloud/auth.json` | 令牌 safeStorage 加密，目录 0700 / 文件 0600 |
| 代理令牌缓存 | `userData/cloud/proxy-token` | safeStorage 加密 |
| 云端记忆凭据 | `userData/cloud/memory-integration.json` | userKey 加密 |
| 云供应商行 | `custom-models.json`（列表）+ `custom-model.json`（生效） | ⛔ **两份都要写**，见 §7 |
| MCP 连接器 | `userData/connectors.json` | 令牌在 `encryptedSecrets`（密文） |
| 引擎 MCP 配置 | `$CODEX_HOME/config.toml` | **生成物，不含任何令牌** |

---

## 五、怎么用

### A. 在应用里（用户操作路径）

**两个入口，都能登录：**

1. **首次启动的登录页** → 第 5 张卡「云账号」（`src/features/auth/LoginScreen.tsx`）。
   填账号/密码 → 「登录并自动配置」→ 自动同步模型 + 接通知识库/记忆、把「云端模型」设为生效供应商、进主界面。
2. **设置 → 账户与模型 → 云账号**（`src/features/settings-cloud/CloudAccountSection.tsx`）。
   未登录只有一张「登录即用」卡；已登录是「就绪清单 + 一键同步 / 修复」，手动操作在「手动流程 / 高级设置」里。

1. 填**账号 / 密码** → 点「登录并自动配置」（服务地址默认 `https://ppz123.asia/cloud-api`，自建部署展开「服务地址」改）。
2. 登录成功后**自动配置一次**（模型 → 知识库 → 记忆 → 生效位，顺序见 §五 C）；模型随即出现在
   **设置 → 模型 → 供应商「云端模型」** 的下拉框里。
3. 需要手动控制时展开「手动流程 / 高级设置」：重签密钥、连通测试、上传/下载会话、切换供应商都在那里。
4. 想立刻跟上云端的勾选变化 → 点「一键同步 / 修复」；怀疑密钥失效 → 高级里的「重签密钥并同步」。

⛔ 「重签密钥并同步」只在**真的掉 Key** 时用：它会作废旧代理令牌（旧令牌立即失效，正在跑的请求会断）。

### B. 渲染层接线（自己写页面时）

```ts
const api = window.codex;

// 1) 登录
const r = await api.cloudAuthLogin({ username, password });
if (!r.ok) return showError(r.error);

// 2) 登录成功后同步一次（会写本机供应商行）
const sync = await api.cloudModelsSync({ force: false });
// sync.models = 下拉框里应出现的条目数

// 3) 刷新渲染层供应商状态（下拉框的开启条件是 customModel 非空）
(window as any).__refreshProviders?.();

// 4) 云端知识库接通（未开通权益会返回 ok:false + not-activated，属正常）
await api.cloudKbSync();
```

多账号：

```ts
const s = await api.cloudAuthStatus();      // s.accounts[]
await api.cloudAuthSwitch(id);
await api.cloudAuthLogout(id);              // 退出某一个
```

### B. 服务端基址怎么定

优先级（`electron/cloud-api.ts` 的 `accountsBase()`，**全仓唯一一份**）：

1. 环境变量 `HARNESS_ACCOUNTS_BASE`
2. 账号库里最近一次登录用的 `baseUrl`（即登录时填的那个）
3. 默认 `https://ppz123.asia/cloud-api`

登录时 `cloudAuthLogin({ baseUrl })` 可显式指定（自建部署用）。

### C. 登录即用自动配置（10-22）

入口：`src/lib/cloud-provision.mjs` 的 `provisionCloud(api, options)` —— 登录页与设置页**共用同一套顺序**：

1. `cloudModelsSync({force:false})`：模型目录 + 代理令牌（401 自愈；⛔ 不无条件 force 重签）；
2. `cloudKbSync()` → `kbBackendSet("cloud")`：连接器与知识库后端一起切（缺一个工具面就到不了）；
3. `cloudMemorySync()` → `setMemoryBackend("cloud")`：只在**已开通且已生效**时切（未开通只报告）；
4. `cloudModelsActivate()`：**放最后**（会重启引擎）。`onlyIfEmpty` 默认 true ——
   本机已有别的供应商就保持原样，只回「云端已就绪、未生效」。

返回 `{ ok, steps[], models, kb, memory, activated }`，设置页按步骤渲染回执。
登录页传 `activate:false`：生效位交给 `onLogin` 的保存链（它本来会重启一次），避免重复重启。

### D. 不改代码自测云端（排查用）

```bash
# 登录换令牌
curl -s -X POST "$BASE/login" -H 'Content-Type: application/json' \
  -d '{"username":"...","password":"..."}'

# 用令牌读目录 / 积分 / 集成凭据
curl -s "$BASE/models"          -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/points/me"       -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/integrations"    -H "Authorization: Bearer $TOKEN"
```

---

## 六、保持更新的机制

| 触发 | 说明 |
|---|---|
| 登录成功后 | `provisionCloud()` 一次配齐模型 / 知识库 / 记忆（见 §五 C） |
| **模型定时轮询** | 默认 **10 分钟**；`HARNESS_CLOUD_SYNC_MINUTES` 可调（最小 1）。⛔ 只在已登录时打网络，失败**静默** |
| **知识库/记忆联动** | `CloudAccountSyncBridge`（AppView 挂载，返回 null）每 10 分钟刷新**已接通**的资源；切回窗口时 ≥60s 节流补一次。⛔ 只刷新，不把用户手动关掉的又打开 |
| 手动刷新 | `cloudModelsSync({ force: true })` —— 重签代理令牌 + 重拉目录 |
| 勾选落盘后 | `cloudModelsSetEnabled()` 内部自动同步一次 |

⛔ **幂等**：判据 = `models` 深比较 + `baseUrl` + `model` + `enabled` + **令牌串是否变化**。
没变就不写盘 —— 否则每次轮询都会改配置时间戳，还会和渲染层的保存操作打架。

---

## 七、排查手册

| 症状 | 原因 | 处置 |
|---|---|---|
| **设置页「测试」全部 401（自动生成的供应商永远测不通）** | 测试用的是编辑器**草稿**里的 apiKey，而草稿里那把恒为空串（界面写"已安全保存，留空则不修改"）⇒ 请求不带 Authorization | 已修：`custom-model:probe` 在 apiKey 为空时**回落已保存的 Key**。判据见 §7 末 |
| **云端模型「已注册」但用不上／旧会话打不开** | 供应商行进了 `custom-models.json`，但 `config.toml` 没重生成 ⇒ 缺 `[model_providers.cloud]` 段（旧线程 rollout 记着 provider 名 ⇒ resume 报 Model provider not found） | 已修：档案变更后自动 `refreshEngineProviders()` |
| 云端模型注册了但**没生效**（下拉框还是别家） | 自动同步**刻意不抢生效位**（你可能正用着别的供应商） | 面板上点**「设为当前供应商」**（`cloud-models:activate`，会重启引擎） |
| **勾了 N 个，下拉框是别的数量** | 只写了复数列表、没同步**单数生效档案**（10-16 事故根因） | 确认改动走 `cloud-provider.ts` 的 `applyCloudProvider`（它内部 `alignActiveFile` 会补） |
| 下拉框整只是灰的、点不动 | 生效位为空 ⇒ `disabled={!customModel}` | `applyCloudProvider` 的 `promoteIfVacant` 会自动补（仅当生效位空着） |
| 界面显示"已保存"但调用一直 401 | 代理令牌**轮换**了，行里还是上一枚 | `cloudModelsSync({ force: true })`（判据必须比令牌串，不能只看"有没有 key"） |
| 报"上游限流/断流" | `baseUrl` 以 `/v1` 结尾 ⇒ 拼成 `/v1/v1/...` ⇒ 404 | `baseUrl` **只到 `/proxy`** |
| 知识库连接器没出现 | 权益未开通（服务端**不建库不发钥匙**） | 服务端开通权益（`/entitlements/activate` 或管理员 `/admin/entitlements`）后重跑 `cloudKbSync()` |
| 记忆没有连接器 | **设计如此**：记忆中枢无 MCP 端点，且它自身打不通上游 | 见 §8 |
| 界面显示「上次同步 从未」 | 该值原先只在进程内存里，重启就归零 | 已修：落盘 `userData/cloud/sync-state.json` |
| `not-logged-in` | 未登录 / 令牌读不出（换机后 safeStorage 密钥不同） | 重新登录 |
| `secure-unavailable` | 系统安全存储不可用 | 本能力**拒绝写明文**：先修好系统钥匙串 / DPAPI |

---

## 八、边界与未做

- **记忆的 MCP**：**服务端目前打不通，客户端做不了**。实测（用真实账号凭据）：
  - `memapi.ppz123.asia/health` → 200，且回执自述 `upstream = https://ppz123.asia/cloud-api/proxy/v1`；
  - 但 `POST /v1/chat/completions`、`POST /v1/memory/search` **一律 401 `invalid-proxy-token`**
    —— 带 `X-Tdai-User-Key` 也带 `Authorization: Bearer <代理令牌>` 都不行。说明**记忆中枢拿不到能过
    上游的有效凭据**（它转发的就是上游那条 401）。
  - 记忆中枢本身不在本机也不在应用服务器上：`mem.ppz123.asia` / `memapi.ppz123.asia` 经 Caddy →
    `127.0.0.1:18080` → **frps** 隧道到别处（用户的 NAS）。
  ⇒ **要接通得先修服务端**：让记忆中枢用**网关凭据**（而非用户代理令牌）访问上游，或由账号服务给它签发服务凭证。
    在那之前客户端只做「取凭据 + 加密缓存 + 如实回报 `rest-only`」，⛔ 不伪造一个连不上的连接器。
  - 服务端将来若在 `/integrations` 的 `memory` 里补上 `mcpUrl`，`cloud-memory` 域**无需改动**即自动切换。
- **渲染层 UI**：已交付两处 —— ① 首启登录页的「云账号」卡；② 「设置 → 账户与模型 → 云账号」页
  （自包含，⛔ 不吃 app props、不动 bag）。尚未做的是**云助手的「云端管理」面板迁进桌面仓**
  （那面板的 12 处 `fetch("/api/cloud-*")` 打的是云助手仓的本机 HTTP 桥，桌面仓没有那层）。
- **与本地知识库/记忆并存**：本地那份是**项目级**（随项目走），云端那份**跨设备共享**。
  两者不是替换关系。
- **两条登录线互不干扰**：本机既有「中转站（PPtoken）账号」与本「云账号」是并列的两条线，
  配置各自独立，⛔ 不互相覆盖。
