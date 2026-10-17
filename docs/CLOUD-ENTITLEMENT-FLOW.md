# 云端权益「开通 → 预热 → 使用」真实流程映射

> 2026-10-16。**本文按服务端真实代码与现网数据写成，不是设计稿。**
> 实现落点：`tx:/home/ubuntu/chc-account/server.js`（账号服务，端口 8091，对外 `https://ppz123.asia/cloud-api`）。
> ⛔ 每条映射都标明**证据来源**；没验证过的一律标「未验证」。

---

## 0. 一句话

**扣积分 → 写权益 → 异步预热建资源 → 用的时候再兜底一次。** 未开通时**不建库、不发钥匙**。

---

## 1. 参与方（外部服务）

| 代号 | 真实地址 | 作用 | 凭据来源 |
|---|---|---|---|
| 账号服务 | `tx:8091` ↔ `https://ppz123.asia/cloud-api` | 权益、积分、凭据签发 | — |
| WeKnora | `WEKNORA_BASE`（`kb.ppz123.asia`） | 知识库本体 + 只读检索 MCP 端点 | `weknora-admin-key`（systemd 加密凭据） |
| Memory Hub | `https://mem.ppz123.asia`（管理）/ `https://memapi.ppz123.asia`（调用） | 记忆平台 | `memhub-admin-key` |
| 记忆网关 | NAS Docker：`tdai-memory-core:8420` · `tdai-proxy:8096` | 记忆抽取/召回 + 转发模型 | 各自的 yaml 配置（见 §7） |
| 模型上游 | `https://ppz123.asia/cloud-api/proxy/v1` | 真正的模型调用 | **云代理令牌**（每用户一把，会轮换） |

---

## 2. 路由表（权益相关，均为实测行号）

| 行 | 方法与路径 | 谁用 | 作用 |
|---|---|---|---|
| 1536 | `GET /entitlements` | 用户 | 我的权益 + 价格表 |
| 1543 | `POST /entitlements/activate` | 用户 | **自助开通（扣积分）** |
| 1564 | `GET /admin/entitlements` | 管理员 | 全部账号权益总览 |
| 1569 | `POST /admin/entitlements` | 管理员 | 开通 / 续期 / 改额度 / 停用 |
| 1587 | `POST /admin/pricing` | 管理员 | 改价格表（热生效） |
| 1607 | `GET /integrations` | 客户端 | **领凭据**（唯一的凭据出口，带权益闸门） |
| 1392/1408/1432/1455/1478/1520 | `/kb/docs` `/kb/file` `/kb/doc` `/kb/search` `/kb/upload` `/kb/delete` | 客户端 | 知识库消费面（每个入口都先 `ensureKnowledgeFor`） |
| 1630 | `GET /points/me` | 用户 | 积分余额 + 流水 |

---

## 3. 时序映射：用户点「开通」

以 `POST /entitlements/activate {feature:"memory"}` 为例，逐步映射到代码：

| # | 步骤 | 代码位置 | 外部调用 | 落库 |
|---|---|---|---|---|
| 1 | 鉴权 | `accountWho()` | — | — |
| 2 | 限流 | `rateLimit('ent:<user>', 10, 60s)` | — | — |
| 3 | 取价 | `pricingOf()[feature]` | — | 读 `db.pricing`（无则用 `DEFAULT_PRICING`） |
| 4 | 查余额 | `pointsOf(user).balance` | — | — |
| 5 | **余额不足 ⇒ 402** | `insufficient-points` | — | ⛔ 到此为止，**不扣分、不建资源** |
| 6 | **扣积分** | `addPoints(user, -points, "entitlement", ref, note)` | — | `db.points[user].txns[]`（ref 幂等） |
| 7 | **写权益** | `grantFeature(user, feature, {days, quotaMb, quota, note})` | — | `db.entitlements[user][feature]` |
| 8 | **异步预热** | `provisionFor(user, feature)` | 见 §4 | `db.integrations[user]` |
| 9 | 立刻回包 | `{ok, feature, state, balance, entitlements}` | — | — |

⛔ **第 8 步不等结果**：远端建库 1~3 秒，让「开通」按钮干等就是坏体验。失败只 `console.warn`。

---

## 4. 预热映射：`provisionFor` → `ensure*`

```
provisionFor(user, feature)
 ├─ knowledge → ensureKnowledgeFor(user)
 └─ memory    → ensureMemoryFor(user)
```

### 4.1 知识库 `ensureKnowledgeFor`

| 顺序 | 动作 | 外部调用 | 落 `db.integrations[user]` |
|---|---|---|---|
| 1 | 缺凭据直接退 | — | ⛔ `knowledge-not-configured` |
| 2 | **自愈检查 库** | `GET /api/v1/knowledge-bases/{kbId}` | `weknoraAlive === false` ⇒ 清空 `kbId/endpointId/mcpToken/mcpUrl` |
| 3 | **自愈检查 端点** | `GET /api/v1/mcp-endpoints/{endpointId}` | 同上 |
| 4 | 建库 | `POST /api/v1/knowledge-bases {name:"u-<user>", type:"document"}` | `kbId`、`kbName` |
| 5 | 挂模型 | `PUT /api/v1/initialization/config/{kbId}` | `vlmModelId` |
| 6 | 建只读端点 | `POST /api/v1/mcp-endpoints {tools:[6个], rate_limit_per_minute:120}` | `endpointId`、`mcpToken`、`mcpUrl` |

⛔ **`weknoraAlive` 必须三态**（112 行注释原文）：`true` 在 / `false` **确定 404** / `null` 未知。
把网络抖动当删除 ⇒ **重复建库**。这是真实踩过的坑。

### 4.2 记忆 `ensureMemoryFor`

| 顺序 | 动作 | 外部调用 | 落 `db.integrations[user]` |
|---|---|---|---|
| 1 | 缺凭据直接退 | — | ⛔ `memory-not-configured` |
| 2 | 已有 key 就复用 | — | 幂等：`if (!cur.memKey)` |
| 3 | 建记忆用户 | `POST {MEMHUB}/api/v1/meta/user/create {username:"chc-<user>"}` | `memKey`（`sk-mem-…`）、`memUserId` |

⛔ 建失败（拿不到 `default_user_key`）**抛错**，不写半截缓存。

---

## 5. 使用映射：`GET /integrations`（唯一凭据出口）

```
if (!who) → 401
ent = entitlementsSummary(user)
out.knowledge / out.memory 默认 = { ok:false, error:"not-activated" }

if (ent.knowledge.enabled) try { ensureKnowledgeFor(user) } catch { 脱敏错误 }
if (ent.memory.enabled)    try { ensureMemoryFor(user)    } catch { 脱敏错误 }
```

**这就是双保险的第二道**：预热失败/资源被删/权益刚续期 ⇒ 客户端下一次拉 `/integrations` 时自动补建。

下发内容：

| 面 | 字段 |
|---|---|
| 知识库 | `{ok, kbId, kbName, mcpUrl, mcpToken}` ⇒ MCP 端点 `https://kb.ppz123.asia/mcp/<endpointId>` |
| 记忆 | `{ok, baseUrl:"https://memapi.ppz123.asia/v1", userKey:"sk-mem-…", instanceId:"default", apiKeyHeader:"X-Tdai-User-Key"}` |

---

## 6. 状态机

```
                   ┌─────────────── 停用（enabled=false，⛔ 不删资源，续期即恢复）
                   ▼
未开通 ──扣积分成功──▶ 已开通(到期 T) ──T 到──▶ 已过期 ──再开通──▶ 已开通(T'+叠加或重置)
   │                      │
   │                      └─ grantFeature 期间：days 缺省 = 只改额度（保留 T）
   │                                          days=0   = 永久
   │                                          days>0   = **叠加**续期
   └─ 未开通期间：`/integrations` → not-activated，⛔ 不建库、不发钥匙
```

**额度两个维度**（`db.entitlements[user][feature]`）：

| 字段 | 含义 | 默认 |
|---|---|---|
| `expiresAt` | 到期时刻 ms；`0` = 永久 | 开通时 now + days |
| `quotaMb` | 存储容量 MB | 1024 |
| `quota` | 检索**次数**上限（仅记忆用；知识库为 0 = 不限） | 记忆 2000 / 知识库 0 |
| `usedMb` / `usedCount` | 已用量，**由调用侧累计** | 0 |

**默认价目**（`DEFAULT_PRICING`，后台可改、热生效）：

| 功能 | 积分 | 时长 | 容量 | 次数 |
|---|---|---|---|---|
| 知识库 | 500 | 30 天 | 1024 MB | 不限 |
| 记忆 | 300 | 30 天 | 1024 MB | 2000 |

---

## 7. ⚠️ 已知断点（2026-10-16 实测并已修）

**记忆网关的上游凭据是「令牌快照」，会过期。**

| 文件（NAS 宿主路径） | 字段 | 服务 |
|---|---|---|
| `/vol1/docker/agentmemory/config/tdai-gateway.yaml` | `llm.apiKey` | `tdai-memory-core:8420` |
| `/vol1/docker/agentmemory/config/proxy-config.yaml` | `upstream.apiKey` | `tdai-proxy:8096`（`memapi` 那一层） |

- 两处都指向 `https://ppz123.asia/cloud-api/proxy/v1`，各存一份 `wap_…` 令牌快照。
- **代理令牌每次「重签密钥并同步」都会轮换** ⇒ 快照过时 ⇒ 调用恒 `401 invalid-proxy-token`。
- 已修（换成当前有效令牌 + 重启两个容器），验证：`POST memapi/v1/chat/completions` 返回正常 `chat.completion`。
- ⛔ **会复发**：再次点「重签密钥」就换令牌。日常同步不轮换（`needToken = force || !hasProxyToken`）。
- **根治方向**：账号服务保留每用户**最近 N 把**令牌（令牌环），或给记忆网关发**长期服务令牌**。
  当前服务端只存 hash ⇒ **取不回已签发的令牌**，所以只能轮换。

---

## 8. 现网实证（2026-10-16 22:2x 实查 `data.json`）

| 账号 | 权益 | 生成的知识库 | 生成的记忆 |
|---|---|---|---|
| `pzm11` | 知识库✅ 记忆✅ | `kbId 769e0fa7…` / 端点 `15557a71…` / 库名 `u-pzm11` | `memKey sk-mem-O8a2…` / `usr-acxif6i2rf` |
| `admin` | 知识库✅ 记忆✅ | `kbId 8d48f3bc…` / 端点 `ed0c1678…` | `memKey sk-mem-1Q0b…` / `usr-91kxzd7f3o` |
| `it-probe-1016` | 知识库✅ 记忆✅ | `kbId 8adfb40e…` / 端点 `7d318e73…` | `memKey sk-mem-dUXA…` / `usr-9y55evkjp0` |
| `qingnanshi` | **未开通** | — **一格都没有** | — **一格都没有** |

⛔ `qingnanshi` 那行是**闸门有效的直接证据**：未开通 ⇒ `db.integrations` 里连条目都不存在。

---

## 9. 存储结构（易看错，务必注意）

```jsonc
db.integrations["pzm11"] = {          // ⛔ **每账号一格扁平**，不是按 feature 嵌套
  "kbId": "769e0fa7-…",
  "kbName": "u-pzm11",
  "endpointId": "15557a71-…",
  "mcpToken": "mcp_0hIo…",
  "mcpUrl": "https://kb.ppz123.asia/mcp/15557a71-…",
  "vlmModelId": "…",
  "memKey": "sk-mem-O8a2…",
  "memUserId": "usr-acxif6i2rf"
}

db.entitlements["pzm11"]["memory"] = { enabled, expiresAt, quotaMb, quota, usedMb, usedCount }
db.points["pzm11"] = { balance, txns: [ … ] }
db.pricing = { knowledge: {points,days,quotaMb,quota}, memory: {…} }
```

⛔ 我第一版按「按 feature 嵌套」去 dump，结果全空，差点得出「没建资源」的错误结论。
**结构要按代码里的 `integrationSlot()` 读**（105 行）。
