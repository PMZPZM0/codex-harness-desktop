# config.toml 实证审查报告（2026-09-16）

用 `codex-engine-config-probe` 技能的方法论做的一次审查：**不信代码、不信注释、不信既有文档结论，只信真实 `codex.exe app-server` 的实测行为**。

- 引擎：`node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe`（Electron 44.2.0 同批）
- 手段：独立 `CODEX_HOME` + 手写 config.toml + 真实 app-server（`initialize` / `config/read` / `permissionProfile/list` / `mcpServerStatus/list` / 真实 `turn/start` + mock Responses 上游）
- 审查对象：应用**真实生成**的那份 `%APPDATA%\Codex Harness Desktop\codex-home\config.toml`（9757 B / 131 行 / 12 段）

---

## 结论速览

| # | 问题 | 严重级 | 可达性 |
|---|---|---|---|
| 1 | MCP 工具权限（deny/ask/allow）写出**非法配置**，引擎判定整份 config 作废 | **高** | 连接器页点一下权限格 |
| 2 | 引擎**根本没有** per-tool `mcp__server__tool` 权限映射，该功能等于没生效 | **高** | 同上 |
| 5 | `escapeToml` 不处理换行/控制字符 → 粘贴带换行的值写坏**整份** config | **高** | 粘贴一个带换行的 URL/模型名/参数 |
| 6 | 段级"所有权"过粗 → 用户手写的同段子键被**静默删除** | 中高 | 手写 `[features]`/`[otel]`/`[permissions]` 等段的额外子键 |
| 3 | 用户手写的顶层键被拼进 `[mcp_servers.*]` 段，静默失效 | 中高 | 手改 config.toml |
| 10 | **任意命令执行**：数值字段 `model_max_output_tokens = ${maxOut}` 无类型校验、无转义 → 注入 `[mcp_servers.*]` → 引擎 `thread/start` 时真的 spawn 它 | **高（RCE 级）** | 任何人改 `userData/model-specs.json` 或 `custom-models.json` |
| 12 | `max` 档位被白名单静默丢弃/替换（甚至「只声明 max」会回落成整套默认档） | 中高 | 模型支持 `max` 时（内置 `gpt-6-astra` 就声明了） |
| 11 | 「引擎按 catalog 的 `supported_reasoning_levels` 校验 effort」**被证伪**：连内置模型的 `effort=bogus` 都照收 | 中 | 每次改动档位逻辑时 |
| 8 | 现存线程「双重悬空」：provider 段缺失 + rollout 丢失 → 会话永久打不开，且无任何检测/清理机制 | 高 | 已发生（4/4 线程） |
| 9 | 引号包裹的合法 MCP 服务器名（含空格/中文/`@`/`:`/`+`）被静默删除 | 高 | 手写 `[mcp_servers."我的服务"]` 后保存一次模型 |
| 7 | 设置页「会话记录」占用**恒为 0**：量的是不存在的 `codexHome/rollouts`，真实数据在 `codexHome/sessions/` | 中 | 设置 → 数据管理 |
| 4 | 技能点名的 5 个脚本已不存在（含"必跑"的回归门禁）；`npm run check` 不校验 config.toml 合法性 | 中 | 每次改配置生成逻辑 |
| 13 | **导入原生 `.jsonl` 会话后打不开**：文件名被改写成非 canonical（`rollout-imported-…`），引擎 `thread/resume` 直接拒；而侧栏照样显示 → 导入报成功、点开报错 | **中高** | 会话 →「导入会话备份」选一个原生 `.jsonl` |
| 14 | 侧栏会话标题未剥离 harness 注入块 → 显示**专家团内部提示词/记忆块**，与备份·导出口径不一致 | 中低 | 专家团会话（样本 36 条里 4 条中招） |
| — | 当前配置生成的 happy path 本身**健康** | — | — |

> **修复状态（09-16 晚）**：以上 14 条**已全部修复**并落地代码（口径以 `AGENTS.md` 的
> 「config.toml 写入面 + 会话/rollout 面大修」条目为准，那里记了每条的实际修法与实证）。
> 回归网 = 预检 **【28】**（40+ 条：真 tomllib 解析样例 config + `require dist-electron/*.js`
> 跑真函数 + 真跑 rollout worker）。Bug 8 的口径在本轮修复过程中被**进一步校正**
> （见该条的「修复时校正」小节）。

---

## 先说好消息：现状的 12 个段全部合法且被引擎解析

把应用真实产物**原样**丢给引擎：

```
tomllib            : OK sections= 12
initialize         : OK（配置被引擎加载）
permissionProfile/list : OK
config/read        : OK
真实 turn          : 完成 ✓
实际上游请求       : POST /v1/responses
```

`[windows] sandbox` / `[tools] web_search` / `[otel] exporter` / `[sandbox_workspace_write] network_access` /
`[shell_environment_policy(+.set)]` / `[features] browser_use` / `[mcp_servers.*]` / `[model_providers.*]`
在 `config/read` 里都能读回预期值 → 这些键都是引擎认可并真实生效的。
`model_auto_compact_token_limit_scope = "model"`、`request_max_retries` 等 provider 段内键也不报错
（注：provider 段对未知键是**宽松**的 —— 塞一个绝不存在的键进去也不报错，所以"能加载"**不能**反推"键合法"，这是本报告 Bugs 2/3 能长期潜伏的原因）。

---

## Bug 1（高）MCP 工具权限会写出非法配置，把整份 config 打废

`electron/main.ts` 的 `permissionsToml()` 只输出 `[permissions.allow/ask/deny]`，**从不输出 `default_permissions`**。

实测（引擎 stderr 原文）：

```
ERROR codex_app_server: Invalid configuration; using defaults.
config defines `[permissions]` profiles but does not set `default_permissions`
```

凡是要读配置的 RPC 全部硬失败：

| 调用 | 结果 |
|---|---|
| `config/read` | ✗ `failed to resolve feature override precedence: config defines [permissions] profiles but does not set default_permissions` |
| `mcpServerStatus/list` | ✗ `failed to reload config: ...does not set default_permissions` |
| `initialize` / `permissionProfile/list` / `thread/start` / `turn/start` | 仍可用（所以问题不会表现为"起不来"，而是"配置层静默降级"） |

对照实验（同一份 config，只差 `default_permissions` 一行）：

| 形态 | 引擎判定 |
|---|---|
| 只有 `[permissions.deny]` | ✗ INVALID |
| `+ default_permissions = ":workspace"` | ✓ 有效 |
| `+ default_permissions = ":read-only"` | ✓ 有效 |
| `+ default_permissions = "deny"` | ✓ 有效（deny 是该档位的名字） |
| `+ default_permissions = "read-only"` | ✗ `refers to undefined profile`（**不带冒号不行**） |
| `+ default_permissions = "allow"` | ✗ `refers to undefined profile`（该档位未定义时不行） |

⇒ 合法值必须引用**已定义**的档案名：内置的是 `:read-only` / `:workspace` / `:danger-full-access`，自定义段产生的就是段名（`allow`/`ask`/`deny`）。

**可达性**：`src/App.tsx:18691` 有活的 UI 控件（点击在 `allow → ask → deny → 清除` 之间循环）
→ `window.codex.setMcpToolPermission` → IPC `mcp-servers:set-tool-permission`（`electron/main.ts:5916`）
→ `applyCustomModel()` → 写出上述非法形态并 `server.restart()`。
**用户点一下权限格，下次引擎重启就把配置层打废。**

---

## Bug 2（高）引擎没有 per-tool 权限映射，这个功能从来没生效过

即便补上 `default_permissions`，写进去的工具规则也**不会被解析**：

```toml
default_permissions = ":workspace"
[permissions.allow]
"mcp__nuphus__desktop_screenshot" = true
```

`config/read` 读回：

```json
"permissions": {"allow": {"description": null, "extends": null, "workspace_roots": null,
                          "filesystem": null, "network": null}}
```

工具键**不在解析结果里**（不是"读不回"，是整个 key 被丢弃）。旁证：

1. 二进制里 `struct PermissionProfileToml with 5 elements`，与上面 5 个字段完全对应 —— **该 struct 没有承载"工具→档位"映射的字段**。
2. 空档案对照：`[permissions.allow]` 下写 `"dummy" = 1` 也是全 null，证明未知键被静默忽略（不报错）。
3. 换别的表达方式也不行：
   - `[permissions.deny.filesystem]` 下写工具名 → ✗ `data did not match any variant of untagged enum FilesystemPermissionToml`（该字段要的是路径/glob）
   - `[permissions.deny.network]` → 解析成 `NetworkPolicyToml`（proxy/domains/unix_sockets），工具名被忽略
4. 工具级审批的粒度开关确实存在，但形态是 `GranularApprovalConfig with 5 elements`（`sandbox_approval` / `skill_approval` / `request_permissions` / `mcp_elicitations` …），**不是 per-tool map**。
5. 二进制里 `mcp__` 的命中只有 6 处，全都是别的东西（JS 工具名归一化示例、一个格式串、文档字符串），**没有** 权限解析路径。

⇒ 结论：**在本机这版引擎上，`[permissions.<profile>] "mcp__server__tool" = true` 不产生任何效果。**
技能把这条记为「已验证」是不完整的 —— 它当初只用 `permissionProfile/list` 看到 `allow/ask/deny` 三个档位名出现就下了结论，而**档位名来自段头、工具规则来自段内容，两者是两回事**。

> 若该机制在更早的引擎版本上真的有效，那是版本漂移；但**发布版用的就是这版引擎**，所以当前形态必须视为失效。

---

## Bug 3（中高）用户手写的顶层键会被拼进 MCP 段，静默失效

`preserveUserConfig()`（`electron/config-toml.ts`）按原顺序保留「非 harness 拥有的段」**和顶层标量**；
而 `applyCustomModel()` 把它们拼在**文件末尾**，前面紧挨着 `[mcp_servers.nuphus]`：

```js
...mcpExtra.flatMap((section) => [section, ""]),
...(preservedConfig ? [preservedConfig, ""] : []),   // ← 顶层键从这里开始，已经身处 MCP 段内
```

TOML 语义下，段头之后的所有裸键都属于该段。实测（`preserveUserConfig` 用编译产物 `dist-electron/config-toml.js` 跑的，注入顶层 `approval_policy = "never"`，然后 tomllib 解析）：

```
顶层键    : ['model', 'model_provider']          ← approval_policy 不在顶层了
nuphus 段 : ['approval_policy', 'args', 'command']  ← 跑到这里了
nuphus 段里的 approval_policy = never
```

再验证「这样写引擎读不读得到」（同内容放对位置 vs 放错位置）：

| 键 | 放顶层（正确） | 放进 `[mcp_servers.fake]` |
|---|---|---|
| `hide_agent_reasoning` | `true` | `false`（默认） |
| `model_verbosity` | `"high"` | `null` |
| `approval_policy` | `"on-request"` | `null` |
| `file_opener` | `"cursor"` | `"vscode"` |
| `show_raw_agent_reasoning` | `true` | `null` |

⇒ 用户的设置**静默失效**，且 engine 不报错。

代码里其实已经有一个同类守卫，但它只覆盖 harness 自己的键：

```ts
/** 错位孤儿键清理：这些顶层键若出现在某个 section 内……一律丢弃 */
if (scalar && HARNESS_CONFIG_KEYS.has(scalar[1])) continue;
```

`HARNESS_CONFIG_KEYS` 只有 7 个键，**任何其它用户顶层键都会漏过去**。
（触发条件：`codex config set approval_policy never` 之类的 CLI 写入，或用户手改 config.toml —— 应用明确支持手改并承诺原样保留。）

---

## Bug 4（中）技能点名的脚本已不存在，且没有 config.toml 合法性门禁

技能正文点名、但磁盘上**不存在**的文件：

| 技能里的原话 | 文件 | 状态 |
|---|---|---|
| 「参考 `scripts/probe-permissions-config.cjs`」 | `scripts/probe-permissions-config.cjs` | ✗ 缺失（这是权限段的参考实现） |
| 「改完 config.toml 生成逻辑**必跑** `scripts/check-main-ipc.cjs`」 | `scripts/check-main-ipc.cjs` | ✗ 缺失（**强制的回归门禁没了**） |
| config-toml.ts 头部注释自指 | `scripts/check-config-toml.cjs` | ✗ 缺失 |
| — | `scripts/probe-marketplace-local.cjs` | ✗ 缺失 |
| — | `scripts/verify-ponytail-seed.cjs` | ✗ 缺失 |

连带后果：`npm run check` = 构建 + `check-preflight.mjs`，而 `check-preflight.mjs` 里
**没有任何 TOML 解析**（全仓 `tomllib` 的命中都在 `resources/tools/python/Lib/site-packages` 里，是第三方包）。
预检里 `permissions` / `mcp_servers` / `wire_api` 的命中都是**对源码文本的结构断言**，不是"把生成的 config.toml 拿去解析"。

⇒ 而 `config-toml.ts` 自己的注释写着「harness 每次保存模型/个性化都会整份重写 config.toml，
**写错一个字节引擎就起不来**」—— 恰恰是这个最危险的面，**当前没有任何自动化门禁**。
Bug 1 能长期潜伏正是因为这条网没了。

---

## 建议的修法（需用户拍板，因为涉及行为语义）

**Bug 1（必须先修，否则 Bug 2 的修法无意义）**：`permissionsToml()` 在输出任何 `[permissions.*]` 时，
同时输出顶层 `default_permissions = "<某个已定义档案名>"`。
选哪个档案是**产品决策**：`:workspace`（默认读写工作区，最贴近现状）需要用户确认；
若用户本意是"默认拒绝、逐个放开"，则应选 `deny`（=`[permissions.deny]` 这个名字，前提是该段存在）。

**Bug 2**：既然引擎没有工具级权限映射，当前这条路走不通。可选方向：
① 用引擎真正支持的粒度（`GranularApprovalConfig` 的 `mcp_elicitations` 等）重做，语义会变；
② 把工具级 deny/ask/allow 做成**应用层拦截**（在主进程/调度侧拦 MCP 调用），不写 config；
③ 若确认要靠引擎能力，需要先向用户澄清拿不到的能力边界。
**不建议继续写 `[permissions.allow] "mcp__x__y"` —— 实测无效，且（缺 default_permissions 时）有害。**

**Bug 3**：把 `preservedConfig` 里的**顶层标量**挪到"第一个段头之前"（与 harness 自己的顶层键同处），
或者对保留下来的裸键做一次"若其前一行是段头则补一个空段终止"的处理。
最小改法：在 `preserveUserConfig` 返回时，若 kept 以裸键开头，则在前面插入一个不冲突的终止标记 —— 但 TOML 没有"回到顶层"的语法，
所以**唯一正确做法是把顶层键输出在第一个段头之前**。

**Bug 4**：给 `scripts/check-preflight.mjs` 补一条**真解析**断言：
用内置 python `tomllib` 解析「按生成逻辑拼出来的 config.toml 样例」，断言合法；
并补 `default_permissions` 与"顶层键必须在段头之前"两条结构守卫。技能里那 5 个失效引用同步删掉/改写。

---

## Bug 5（高）`escapeToml` 不处理换行 → 粘贴一下就写坏整份 config

```ts
function escapeToml(value: string) { return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"'); }
```

只转义 `\` 和 `"`。TOML 单行基本字符串里**裸换行是非法字符**（除 tab 外的控制字符都必须转义），
所以任何值里出现 `\n` / `\r` 就会把整份 config 写坏。实测：

| 输入 | `escapeToml` 输出 | 拼进 `base_url = "..."` 后 |
|---|---|---|
| `https://api.x.com/v1` | 原样 | ✓ TOML 合法 |
| `https://api.x.com/v1\n`（粘贴带尾换行） | 原样保留 `\n` | ✗ `Illegal character '\n'` |
| `a\nb` | 原样保留 `\n` | ✗ `Illegal character '\n'` |

**真实引擎行为**（把这份坏配置喂给 app-server）：

```
initialize  : OK            ← 这一关挡不住坏配置
config/read : ✗ failed to read configuration layers: ...config.toml:7:6: key with no value, expected `=`
引擎 stderr : ERROR codex_app_server: Invalid configuration; using defaults.
```

⇒ 引擎**整份配置作废**（`using defaults`），且只有 stderr 有痕迹。

**⚠️ 严重度校正（Bug 10 那一轮实测后补）**：我一开始怀疑换行穿透能升级成「注入任意段」，
实测**不能** —— 换行入口（`base_url` / connector 的 `env` 值 / `env` 键）都在段的**中间**，
注入后模板剩下的键会变成裸行 ⇒ **只会得到非法 TOML**，不会形成合法的新段（详见 Bug 10 的对照表）。
所以本条的后果是**「整份配置作废、应用功能全废且静默」**，不是注入。
真正能注入的是 Bug 10 那条「段内最后一行 + 完全不转义」的数值位。

所有经 `escapeToml` 的值都在风险面上：`base_url`、model id、provider `name`、路径、连接器的
`command` / `args` / `url` / `env` 值、`developer_instructions` 块。

**可达性**：保存链路对各字段普遍只做 `.trim()`（去掉首尾空白），**内嵌换行一律留存**：
- `custom-model:save`：`input.baseUrl.trim().replace(/\/$/,"")` → 内嵌换行留存；`new URL()` 校验收不到（URL 规范会**主动剥掉** ASCII 换行/制表符，所以校验通过、但落盘的是**未剥除**的原始串）。
- `custom-model:save`：`input.model.trim()` → model id 内嵌换行留存。
- `connectors:save`：`command` / `args[]` / `url` / `headers` / `env` 全是 `.trim()`，内嵌换行留存。
- **连接器的 `env` 键完全没有转义**（模板是 `env = { ${key} = "${escapeToml(value)}" }`，只有值转义）。

实测 env 键注入：键名 `A" , X = "y` → ✗ `Expected '=' after a key in a key/value pair`。
这不止是"写坏"，理论上还能**往配置里注入任意键/值**（可构造出闭合 `}` 再开新键）。

**修法**：`escapeToml` 补上控制字符转义（至少 `\n`→`\\n`、`\r`→`\\r`、`\u0000-\u0008`/`\u000b`/`\u000c`/`\u000e-\u001f`/`\u007f` 走 `\uXXXX`），
键名一律走同一个转义函数；更稳妥的是**在保存入口就拒绝/剥除控制字符**（用户也几乎不可能有意输入换行）。

---

## Bug 6（中高）段级"所有权"过粗 → 用户手写的同段子键被静默删除

`HARNESS_CONFIG_SECTIONS` 是**段级**的所有权声明：

```ts
export const HARNESS_CONFIG_SECTIONS = new Set(["model_providers","windows","tools",
  "sandbox_workspace_write","shell_environment_policy","features","mcp_servers","otel","permissions"]);
```

`preserveUserConfig` 一旦看到段头就整段丢弃（`skipping = HARNESS_CONFIG_SECTIONS.has(head)`）——
但 harness **实际只写这些段里的少数子键**。结果是：段内任何 harness 不写的子键，**每次保存都被静默删除**。

实测（用户手写配置喂给 `preserveUserConfig`）：

| 用户写的 | 保留？ |
|---|---|
| `approval_policy = "never"`（顶层） | ✓ 保留（但见 Bug 3，位置会错） |
| `[permissions.my-profile]` + `[permissions.my-profile.filesystem]` | ✗ **被删** |
| `[features] memories = true` / `user_own_feature = true` | ✗ **被删** |
| `[otel] trace_exporter = "none"` | ✗ **被删** |
| `[sandbox_workspace_write] exclude_tmpdir_env_var = true` | ✗ **被删** |
| `[shell_environment_policy] exclude = ["SECRET_*"]` | ✗ **被删** |
| `[windows] sandbox_private_desktop = true` | ✗ **被删** |
| `[projects.'d:\myproj']`（非 harness 段） | ✓ 保留 |
| `model_context_window`（harness 键） | ✓ 按预期丢弃 |

再验证"删掉确实是损失"（同内容让引擎读回）：

| 子键 | 只写 harness 的子键 | 用户额外写好 |
|---|---|---|
| `features.memories` | `false` | **`true`** |
| `otel.trace_exporter` | `null` | **`"none"`** |
| `otel.metrics_exporter` | `null` | **`"none"`** |
| `sandbox_workspace_write.exclude_tmpdir_env_var` | `false` | **`true`** |
| `sandbox_workspace_write.exclude_slash_tmp` | `false` | **`true`** |
| `shell_environment_policy.exclude` | `null` | **`["SECRET_*"]`** |
| `windows.sandbox_private_desktop` | `null` | **`true`** |

⇒ 引擎**确实支持并读取**这些子键，所以删除是真实的功能丢失，不是无害清理。
注意 `config-toml.ts` 自己的注释写的是"其余段落（**用户手工配置的** projects / marketplaces / plugins 等）原样保留"——
**意图与实现不一致**：`features`/`otel`/`permissions` 这些段里也有用户手工配置。

**修法方向（架构层）**：把所有权从"段"细化到"键"，或者在重写前把段内**非 harness 子键**读出来再合并回去。
（顺带：这也是"用户手工 `[permissions]` 档位会被删"的原因 —— 引擎其实原生支持
`[permissions.<profile>.filesystem/.network]` 这类路径/域名策略，只是 harness 不认识它。）

---

## Bug 7（中）设置页「会话记录」占用恒为 0 —— 量的是一个不存在的目录

```ts
// electron/main.ts:3435  app:storage-info
const rolloutsDir = path.join(codexHome, "rollouts");
const [imagesBytes, engineLogBytes, rolloutsBytes] = await Promise.all([..., dirSize(rolloutsDir)]);
// → { key: "rollouts", label: "会话记录（rollout 原档，含全部历史）", bytes: rolloutsBytes, deletable: false }
```

实测：

```
codexHome/rollouts  存在: false      ← 被量的目录根本不存在
codexHome/sessions  存在: true       ← rollout 真实落点（引擎 threads.rollout_path 指向它）
```

`dirSize()` 对不存在的目录 `try/catch` 吞掉 → 返回 `0` ⇒ 这一项在设置页里**恒为 0 字节**，
与真实占用无关（当前 sessions 恰好是空的，所以数字"碰巧"也对；但结构上它**不可能**正确）。

旁证这是笔误而非有意：**同一个项目**的 `electron/thread-backup.ts` 用的是正确路径
（`{ root: path.join(codexHome, "sessions") }` + `archived_sessions`），
且 `threads` 表的 `rollout_path` 实际就是 `<codexHome>/sessions/2026/09/14/rollout-*.jsonl`。

**修法**：`path.join(codexHome, "sessions")` + `archived_sessions` 两处求和。

---

## Bug 8（高）现存会话「双重悬空」：provider 段缺失 + rollout 丢失 → 永久打不开

这一条是**已经在发生**的，不是理论风险。证据链：

**(1) 引擎的权威线程表**（`codex-home/state_5.sqlite` 的 `threads` 表，带 `model_provider` 与 `rollout_path` 两列）：

```
threads 总数: 4        model_provider 分布: {"custom906": 4}
config 里的 provider 段: ["custom166", "harness"]
⇒ provider 缺失的线程数: 4 / 4
```

**（2）rollout 文件全部不存在**（`sessions/` 目录实测 0 个文件）：

```
01a09e40-db15-77f1  provider=custom906  rollout存在=false
01a09e40-db15-77f1  provider=custom906  rollout存在=false
01a09e40-db16-7f23  provider=custom906  rollout存在=false
01a09e42-e31c-7f52  provider=custom906  rollout存在=false
```

**（3）真实引擎的两种失败**（隔离 `CODEX_HOME` 拷入权威状态后起真 app-server）：

| 调用 | 结果 |
|---|---|
| `thread/start` 指定不存在于 config 的 provider `custom906` | ✗ `failed to load configuration: Model provider \`custom906\` not found` |
| `thread/resume <4 个线程 id>` | ✗ **全部** `no rollout found for thread id ...` |

⇒ 这 4 个会话现在**点开就是空的/打不开**。交叉验证同时证实了代码注释的前提是对的
（provider 段缺失 = 引擎硬错误），也就是「历史会话别名段」这套机制**有存在的必要**——
但它的**唯一数据源已经没了**：

```
collectSessionProviderIds() 读的是 <codexHome>/sessions/**/*.jsonl
真实 profile 实测：sessions 树 0 项、archived_sessions 0 项
⇒ 该函数返回空集 ⇒ applyCustomModel 永远不会补出 [model_providers.custom906]
```

**这是一个架构脆弱点，不只是"这次倒霉"**：别名机制把「历史会话引用了哪些 provider」
全押在 rollout 文件上，而 rollout 是**最容易被清理/迁移/意外丢失**的产物；
一旦它没了，机制静默失效（没有日志、没有告警），且同时失去的还有会话正文本身。

**另外缺失的能力（功能完整性铁律的角度）**：引擎 `threads` 表里留着 `rollout_path` 指向不存在文件的行，
harness 侧**没有任何机制**去发现/提示/清理这种"悬空线程"——引擎自己也只是在 resume 时报
`no rollout found`，而这行错误不会出现在会话列表里（列表中会话照样显示，点开才发现没了）。

> ⚠️ **归因说明（不臆测）**：我查到应用的两条清理链都**不会**删 rollout ——
> `app:storage-clear` 明确注释「rollout 原档 = 全部会话历史，绝不在此处提供删除」，
> `thread-backup.ts` 也声明「只操作 rollout 文件本身 + 只读扫描，绝不动 state_5 / 索引 DB」。
> 引擎侧的 `rollout_migration_state` / `rollout_migration_skipped_rollouts` 两张表都是**空的**（无迁移记录）。
> **所以"rollout 是谁删的"我没有证据，不下结论。** 但上面三条（provider 缺失、rollout 缺失、
> resume 全失败）是直接观测到的客观状态，与归因无关。

### ✅ 修复时校正（2026-09-16 晚，修完之后才实证到的事实）

上面那句「列表中会话照样显示，点开才发现没了」**对本机这版引擎不成立** —— 修复过程中做的
端到端实验（真起应用：建会话 → 跑一回合 → 删掉它的 rollout → 再查 `thread/list`）：

| 步骤 | 观测 |
|---|---|
| 删除 rollout 前 | `thread/list{archived:false}` 返回该条，带 `path`，文件存在 |
| 删除 rollout 后 | 该 id **整条不再出现**（不是"还在但打不开"） |
| 按 id `thread/resume` | ✗ `no rollout found for thread id ...` |

⇒ **引擎会把 rollout 丢失的线程直接从 `thread/list` 里隐藏**，用户侧的真实症状是
**会话静默消失**（不是"可见但点开报错"）。连带两个推论，都已落进代码注释与文档：

1. **`markMissingRollouts` 是防御性标记**（`session-tools.ts`，预检【28】有纯函数单测）：
   当前引擎不会触发它；它的价值是「若某版引擎仍返回带 `path` 的条目」时侧栏显示「记录丢失」
   而不是让用户点开才吃引擎原始报错。
2. **那类会话的 provider id 任何来源都取不到**（引擎不说、rollout 没了）——
   但它们本来也打不开（缺的是 rollout，不是 provider 段），所以
   「别名段机制」修不修都不影响这个 case；改以引擎索引为权威源的收益是
   **覆盖归档会话 + 不再依赖文件内容**（旧实现只扫 `sessions/` 首行，归档会话一律漏掉）。

另外核实了**不会误报**：`thread/start` 之后还没跑回合的新会话在 `thread/list` 里**根本不出现**
（引擎只在有内容后才列出），一旦出现其 rollout 文件就已存在 ⇒ 新会话不会被标成「记录丢失」。

---

## Bug 9（高）合法 MCP 服务器名被静默删除

`collectMcpServerNames`（`electron/config-toml.ts`）的正则：

```ts
/^\s*\[mcp_servers\.\s*([A-Za-z0-9_'".-]+)\s*\]\s*(?:#.*)?$/
//                          ^^^^^^^^^^^^^^^^^^^ 没有空格、没有非 ASCII、没有 @ : + 等
```

字符类只覆盖 `字母数字 _ ' " . -`。名字里有**空格 / 中文 / `@` / `:` / `+`** 的服务器
采不到名字 → 而 `preserveUserConfig` 因为 `mcp_servers` 属 harness 所有会**整段丢弃** →
`readUserConfigSplit` 又只能靠这个名字列表把用户段捡回来 ⇒ **用户手写的 MCP 服务器在下次保存模型时凭空消失**。

实测名字矩阵（`collectMcpServerNames` 用编译产物 `dist-electron/config-toml.js` 直接调用）：

| 写法 | 采集结果 | 引擎是否接受 |
|---|---|---|
| `[mcp_servers.myserver]` | ✓ `["myserver"]` | ✓ |
| `[mcp_servers.my-server]` / `my_server` / `my.server` | ✓ | ✓ |
| `[mcp_servers."my server"]` | **✗ `[]`** | **✓ `mcp_servers=["my server"]`** |
| `[mcp_servers."我的服务"]` | **✗ `[]`** | **✓ `mcp_servers=["我的服务"]`** |
| `[mcp_servers."@scope/pkg"]` | **✗ `[]`** | **✓ `mcp_servers=["@scope/pkg"]`** |
| `[mcp_servers."a:b"]` / `"a+b"` | **✗ `[]`** | ✓ |

⇒ 「引擎接受 → 用户在用 → 但 harness 采不到 → 被删」这条链是完整的。
**触发概率不低**：中文用户给服务器起中文名（`[mcp_servers."我的服务"]`）、或任何带空格的显示名
（`"My Server"`）、`@scope/pkg` 风格的包名 —— 都是完全合法的 TOML 且引擎认。

端到端复现（原始用户配置 → 走 `readUserConfigSplit` 的收集逻辑 → 按 `applyCustomModel` 的顺序重拼 → tomllib 语义比对）：

```
原文 mcp_servers: ["files", "my server", "dotted"]
重建 mcp_servers: ["nuphus", "files", "dotted"]      ← "my server" 整个没了，无任何报错
```

**修法**：把正则的字符类放宽到「引号内任意非引号字符」——例如先匹配
`\[mcp_servers\.\s*("([^"]*)"|'([^']*)'|([A-Za-z0-9_.-]+))\s*\]`，再按捕获组取名字。
（注意别顺手把裸非 ASCII 也放进来：TOML **裸键**只允许 `A-Za-z0-9_-`，
`[mcp_servers.我的服务]` 本身就是非法 TOML，不该救。）

> 附带确认：同一个字符类还让 `[mcp_servers.<a>.<b>]` 这类子表名被当成一个整名采集
> （`dotted.name`），但 `extractMcpSection` 能按字面表头正确抽出、语义不变 —— 这条**不是** bug。

---

## Bug 10（高，RCE 级）数值字段不校验不转义 → 可注入任意段 → 引擎执行任意命令

`electron/main.ts:1544`：

```ts
...(maxOut ? [`model_max_output_tokens = ${maxOut}`] : []),
```

`maxOut` 来自 `models[].maxOutputTokens`，类型上写的是 `number`，但**运行时没有任何校验**
（不是 `Number()`、不是 `parseInt`、更不是 `escapeToml` —— 同段的 `name` / `base_url` 都过了 `escapeToml`，
偏偏这个是裸插值）。模板字面量直接把值糊进 TOML。

**两段验证**（这一条同时解释了「为什么换行入口走不到这里」）：

| 步骤 | 结果 |
|---|---|
| ① 把 `maxOut` 换成 `393216\n[mcp_servers.pwn]\ncommand="<node>"\nargs=["-e","<写标记文件>"]\nstartup_timeout_sec = 8` | tomllib **解析通过**，配置里多出一个合法的 `[mcp_servers.pwn]`（`keys` 多出 `mcp_servers`） |
| ② 用这份配置起真引擎 → `initialize` → `thread/start` → 等 3s | **标记文件被创建** ⇒ 注入的 `command` **真的被引擎 spawn 了** |

```
initialize 后  标记存在: false
thread/start 成功，threadId=01a0a993-…
  等待 3000ms 后 标记存在: true
结论: ⚠️ 注入的命令被引擎执行了（任意命令执行）
```

**为什么偏偏是这一行能被注入**（关键区别，别和 Bug 5 混为一谈）：
`model_max_output_tokens` 是 provider 段的**最后一行**，它后面紧跟的是下一个段头（`[model_providers.X]`）
——而段头本身就是合法的表声明。换行注入出去的裸键正好归属我注入的那个段，所以**整体仍是合法 TOML**。
反观 Bug 5 的换行入口（`base_url`、connector 的 `env` 值/键）都在段**中间**，注入后模板剩下的键会变成裸行 → **非法 TOML**。
实测三个换行入口**全部只产生非法 TOML、命令未被执行**：

```
① base_url 内嵌换行        TOML=非法  命令被执行=否
② connector env 的值内嵌换行  TOML=非法  命令被执行=否
③ connector env 的键（不转义） TOML=非法  命令被执行=否
```

⇒ **Bug 5 的后果是「整份配置作废」（功能全废、静默），Bug 10 的后果是「任意命令执行」。**

**入口在哪（本机可达性，不夸大）**：
- `userData/model-specs.json` —— 应用**明确设计成用户可编辑**（`src/lib/model-specs.ts:63`「数据与代码分离，
  更新模型数据无需改代码重新构建」）；`setExternalSpecs()` 只校验了 `contextWindow > 0`，
  **`maxOutputTokens` 原样透传**（`maxOutputTokens: rule.maxOutputTokens`），随后被用来预填供应商编辑器并落盘。
- `userData/custom-models.json` —— 明文 JSON，用户可手工编辑（同目录已存在 `.bad-*` / `.bak` 文件，说明确实有人改）。
- 渲染层 `custom-model:save` 的 `models` 数组**原样收下**（`mergedModels.push(... : m)`），IPC 层无类型校验。

⇒ 这是**本地配置文件到代码执行的越权边界**，不是远程可利用漏洞（要能写这些 JSON）。
但「一个数字字段没做 `Number()` 也不转义，就能让引擎执行任意命令」这个模式必须堵死。

**修法（两层都要）**：
1. 写 TOML 时**所有非字符串值一律先 `Number()` 并 `Number.isFinite` 校验**，不合格就不写该行（而不是原样插值）。
   更稳的是把「拼 TOML」换成「序列化器」——每行都过同一个 `tomlValue()` 出口，禁止裸插值。
2. 入口侧校验：`setExternalSpecs` 对 `maxOutputTokens` / `contextWindow` 做 `Number.isFinite`；
   `custom-model:save` 对 `models[]` 的每个数值字段做同样校验。

> 顺带：这也说明为什么「配置面」值得单独建门禁 —— 这条链跨了
> **渲染层 JSON → IPC → custom-models.json → config.toml → 引擎 spawn**，
> 中间任何一环做一次类型校验都能拦住，但四环全都没有。

---

## Bug 11（中）一条被证伪的引擎行为声明：引擎**不校验** effort

代码里多处写着同一个前提：

> `electron/main.ts` 1347 行附近：「**引擎按 catalog 的 `supported_reasoning_levels` 校验 effort**，UI 也按它显示选项」
> ……「UI 能选的档 catalog 必须声明，**否则 turn/start 被拒**」
> 注释还把它当作白名单逻辑与「UI/主进程同规则」的理由。

**实测证伪。** 用真实 config + mock 上游跑真实 turn：

| 实验 | 结果 |
|---|---|
| 自定义模型（catalog 声明 `low/medium/high/ultra/xhigh`，**无 minimal**），`effort="minimal"` | turn **正常完成**，上游收到 1 个请求 |
| 同上，`effort="bogus-level"` | turn **正常完成** |
| 内置模型 `gpt-6-astra`（引擎自己的 `models_cache.json` 声明 `low/medium/high/xhigh/max/ultra`），`effort="minimal"` / `effort="bogus"` | **都正常完成** |

**先排除了「catalog 没被读」这个可能**——正向对照：把真实 catalog 里该模型的 `context_window`
改成哨兵值 `555000`，跑真实 turn 后读引擎自己写进 rollout 的 `model_context_window`：

```
catalog 里该模型的 context_window 已改成哨兵值 555000
rollout 上报的 model_context_window = [555000]        ← catalog 确实被读取并生效
```

⇒ **catalog 读了、`context_window` 生效了，但 `effort` 根本没被校验**（内置模型也一样）。
所以「UI 能选的档必须 catalog 声明，否则被拒」这条理由不成立；
`buildModelCatalog` 里那段 `EFFORT_WHITELIST` + `legacyAuto`（旧三档补 `xhigh`）逻辑
以及 `src/lib/effort.ts` 的「同规则」同步，**建立在一个不成立的前提上**。

> 这不是"用户会看到报错"的 bug（没有任何合法档位被拒），但它把**过滤**从"必要的收口"变成了"纯损失"——
> 见 Bug 12。也说明项目记忆里那条「UI 能选、引擎拒绝」的旧事故，在当前引擎上已不再复现（可能是更早的引擎版本）。

---

## Bug 12（中高）`max` 档被静默丢弃，甚至被替换成别的档

`src/lib/effort.ts:21`：

```ts
export const ALL_EFFORTS = ["minimal", "low", "medium", "high", "ultra", "xhigh"] as const;  // ← 没有 "max"
```

`declaredModelEfforts()` 会用它过滤用户/规格声明的档位（`allowed.includes(effort)`），
`buildModelCatalog` 里的 `EFFORT_WHITELIST` 是同一份清单。而**引擎自己的模型定义里 `max` 是真实档位**：

```
codex-home/models_cache.json → gpt-6-astra.supported_reasoning_levels
  = low / medium / high / xhigh / max / ultra
```

实测（用 `typescript` 现场编译真实 `src/lib/effort.ts` 后执行，不是复述逻辑）：

| 输入（声明支持哪些档） | `declaredModelEfforts` 实际返回 |
|---|---|
| `["low","medium","high","max"]` | `["low","medium","high","xhigh"]` ← **`max` 被换成 `xhigh`** |
| `["max"]` | `["low","medium","high","xhigh"]` ← **`max` 全丢，回落成一整套默认档** |
| `["low","medium","high","max","ultra","xhigh"]` | `["low","medium","high","ultra","xhigh"]` ← max 消失 |
| 内置 `gpt-6-astra` 的完整档位 | `["low","medium","high","xhigh","ultra"]` ← max 消失 |

⇒ 两个后果：
1. **声明了 `max` 的模型，UI 里没有 `max` 可选**（能力静默缺失）——而引擎并不拦，属于"自己把能用的档关掉了"。
2. **更糟的是「只声明 max」这条**：过滤后为空 → 回落成 `CUSTOM_MODEL_EFFORTS`（`low/medium/high/xhigh`），
   等于**替用户换成了一套他没声明的档位**（且这些档可能该模型根本不支持）。

**修法**：把 `max` 加进 `ALL_EFFORTS` 与 `EFFORT_WHITELIST`（两处必须同源），
并核对 `normalizeEffort` / `pickDefaultEffort` 的回落值；`legacyAuto` 的「补 xhigh」判定也要把 `max` 纳入考虑
（现在 `["low","medium","high","max"]` 会被判成 legacyAuto 而多补一个 xhigh）。

---

## Bug 13（中高）导入原生 `.jsonl` 会话：报成功、看得见、**打不开**

`threads:import`（`main.ts:6123`）对 `.jsonl` 走 `backupFromRolloutFile()`，而它把文件名**改写**成：

```ts
// thread-backup.ts:137
const rel = `sessions/imported/rollout-imported-${id}.jsonl`;
```

问题在于**引擎要求 rollout 文件名是 canonical 形态**。用真引擎跑完整链路（应用自己的两个函数），只改文件名/目录两个变量：

| 文件名 | 目录 | `thread/resume` |
|---|---|---|
| `rollout-<时间戳>-<uuid>.jsonl`（原生） | `sessions/2026/09/16/` | ✓ 成功（turns=12） |
| `rollout-<时间戳>-<uuid>.jsonl`（原生） | `sessions/imported/` | ✓ 成功 |
| `rollout-imported-<uuid>.jsonl`（**现行实现**） | `sessions/imported/` | ✗ `paginated rollout path … does not have a canonical rollout filename` |
| `rollout-imported-<uuid>.jsonl` | `sessions/2026/09/16/` | ✗ 同上 |

⇒ **只有文件名有关，目录随便放都行**。

**canonical 规则（矩阵实测）**：必须严格是 `rollout-<YYYY-MM-DDTHH-MM-SS>-<uuid>.jsonl`。

| 候选名 | 结果 |
|---|---|
| `rollout-2026-09-12T09-27-09-<uuid>.jsonl` | ✓ |
| `rollout-2026-01-01T00-00-00-<uuid>.jsonl`（时间戳与实际日期不符） | ✓ 只要**格式对**即可 |
| `rollout-<uuid>.jsonl`（无时间戳段） | ✗ |
| `<uuid>.jsonl`（无前缀） | ✗ |
| `foo-2026-09-12T09-27-09-<uuid>.jsonl`（前缀不是 `rollout`） | ✗ |
| `rollout-2026-09-12T09-27-09-imported-<uuid>.jsonl`（多一段） | ✗ |
| `rollout-…-<uuid>.jsonl.jsonl` | ✗ |

引擎侧出处：二进制里 `thread-store/src/local/thread_history_materialization.rs:143` 的
`paginated rollout path \`…\` does not have a canonical rollout filename`，紧邻格式串 `%Y-%m-%dT%H-%M-%S`。

**用户看到的现象**：导入对话框报「导入 1 条成功」，侧栏（兜底扫描）**立刻出现这条会话**，
点开却报错 —— 一个「成功」的假象。这正好是最近才加的功能（`用户反馈 #10` 要求支持 `.jsonl`），
加了最后一步没打通。

**修法**：`backupFromRolloutFile` 的 `rel` 改成 canonical 形态，时间戳取 `session_meta` 的
`timestamp`（拿不到就用文件 mtime），即 `sessions/imported/rollout-${YYYY-MM-DDTHH-MM-SS}-${id}.jsonl`。
同时 `safeRel` 应补一条「文件名必须 canonical」的校验，避免别的来源再写进非法名。
另外 `applySessionsBackup` 对 `.json` 备份也应做同样校验（老备份里如果已经存了非 canonical 名，
再导入进来就是坏的）。

---

## Bug 14（中低）侧栏标题不剥 harness 注入块 → 会话标题显示内部提示词

同一份 rollout，两套「同口径」实现给出不同标题（36 条样本里 **4 条**不一致）：

```
侧栏(worker) : "# 交易分析专家团\n\n你是本专家团的主理人 执舵（首席策略官）。…"
备份/导出     : "用不超过 120 字给出当前 A 股市场情绪判断与两条操作建议。"
```

原因：`electron/rollout-worker.cjs:52-65` 直接拿**原始文本**当标题，只过滤三个前缀
（`# AGENTS.md` / `<environment_context>` / `<filesystem>`）：

```js
const injected = text.startsWith("# AGENTS.md") || text.startsWith("<environment_context>") || text.startsWith("<filesystem>");
```

而 `thread-backup.ts` 的 `extractMeta` 先过 `stripHarnessBlocks()`（`stripSystemTaskWrapper` 会把
`[SYSTEM TASK …] === 用户需求 === … === END ===` 里的**用户原文**抽出来），再配一份更全的
`MD_INJECT_PREFIXES`。实测原文确实是「一坨编排提示词 + 末尾嵌着 `=== 用户需求 ===` 块」，
剥了之后才剩用户真正输入的那 32 个字。

**影响**：专家团/调度类会话在侧栏显示的是一屏机器提示词（还会被截断成一长条），
用户看起来就是「标题坏了」。`thread-backup.ts:52` 的注释写着「与 `listRolloutThreads` 同口径」——
**实际已经漂移**，两处必须同源（或直接把 `stripHarnessBlocks` 的判定也搬进 worker）。

**顺带**：worker 里 `preview` 会被 `task_complete` 的 `last_agent_message` 覆盖（`:66-69`），
所以 `name` 的兜底顺序 `title || preview || "未命名任务"` 在没抓到 title 时会显示 AI 的最后一句回复。

---

## 本轮已排除的假设（查过，没问题，记下来免得下次重查）

| 假设 | 结论 |
|---|---|
| `applySessionsBackup` 导入时能用 `rel: "sessions/../../x.jsonl"` 之类的路径穿越写任意文件 | ✗ 不成立。`safeRel()`（`thread-backup.ts:148`）**拒一切含 `..` 的路径** + 前缀白名单（`sessions/`、`archived_sessions/`）+ 必须 `.jsonl` 结尾 + 先 `path.normalize`，四道都在。 |
| `developer_instructions = """…"""` 的块字符串能被用户内容闭合（→ 任意配置注入） | ✗ 不成立。`tomlSafe()`（`developer-instructions.ts:79`）转义 `\`→`\\`、`"`→`\"`、归一行尾、剔除除 `\n`/`\t` 外的控制字符 —— 对 TOML 多行基本字符串**是正确的**；而且这段内容**全是生成的**（`mediaCommand` 由 `toolsRoot()` 拼），无用户可控插值。 |
| `aliasIds`（来自 rollout 的 `model_provider`）拼进表头能**注入任意段**（进而 RCE） | ✗ 不成立。表头模板后面还跟着 10 行 `name/base_url/...`，注入串会让 TOML **非法**而不是越权成段。但暴露两个真问题：① id 含**换行** → 整份配置非法（Bug 5 家族，入口不同）；② id 含**点** → TOML 合法但语义错位（凭空生成一个 `a` provider，`a.b` 仍找不到）。可达性低：应用生成的 provider id 有 `^[a-zA-Z0-9_-]+$` 约束。 |
| 会话模型键 `custom:<provider>:<model>` 用 `split(":")` 解析 → 模型 id 含冒号就串味 | ✗ 不成立。provider 取 `split(":")[1]`（provider id 禁冒号），model 走 `split(":").slice(2).join(":")`（`src/App.tsx:1442`），冒号安全。 |
| `[mcp_servers.<a>.<b>]` 子表被错切 | ✗ 不是 bug，见 Bug 9 末尾说明。 |
| 换行穿透（Bug 5）能升级成注入 | ✗ 不成立，只会得到非法 TOML；能注入的是 Bug 10 的数值位。 |
| 归档的会话会被「rollout 兜底扫描」复活回活动列表 | ✗ 不成立。真引擎实测：`thread/archive` 会把 rollout **移动**到 `archived_sessions/`（`sessions/2026/09/16/rollout-…` → `archived_sessions/rollout-…`），兜底扫描按目录判归档态，`mergeThreadList(…, archived=false)` 返回 0 条。设计是对的。 |
| 兜底扫描的文件名正则 `[0-9a-f]{8}-[0-9a-f-]{27,}` 会漏掉引擎的 rollout 文件名 | ✗ 不成立。引擎 `threads.rollout_path` 的 4 个基名 **4/4** 命中；`.e2e-profile` 里 36 个真实 rollout **36/36** 命中。 |
| `rollout-worker-source.ts`（生成物）可能与 `rollout-worker.cjs`（源）漂移 | ✗ 不成立。`scripts/gen-rollout-worker.mjs` 在 `build:electron` 里**无条件重写**生成物，不存在「跳过」分支。（曾因 `| head` 在这个 shell 里不可用导致管道断裂、误判成「脚本不存在」——探针自身的坑。） |
| 「只有 rollout 文件、引擎索引里没有行」的会话（备份导入/换机拷贝）是坏的 | ✗ 不成立。真引擎实测：`thread/list` 确实**不认**（0 条，索引只来自 DB），但 `thread/resume` **可以打开**（turns=12），且 resume 会**补写** `state_5.sqlite` 的 `threads` 行（从「无 state_5.sqlite」变成 1 行）；随后 `thread/archive` 成功并把文件移进 `archived_sessions/`，`thread/unarchive` 也能还原。⇒ 兜底扫描把这类会话显示出来是**合法设计**（file-first），不是「显示了但打不开」。 |
| `sessions/` 里同一线程会有多个 rollout 文件（fork/分支）导致标题不确定 | ✗ 样本里 36 个会话**没有一个**是多文件；Bug 14 的标题差异另有原因（见该条）。 |
| `preserveUserConfig` 会连带误删别的用户段（`[projects.'d:\my app']`、`[my.'s p'.sub]`、`["我的配置"]` 等带空格/中文/反斜杠的段名） | ✗ 不成立。9 类用户段逐个 + 批量追加实测**全部保活**，保留下来的文本 TOML 依然合法。**唯一被丢的是 `mcp_servers.*`** —— 那是设计（由 `readUserConfigSplit` 按覆盖表拼回），而它丢的那些名字恰好就是 Bug 9 覆盖的带引号名。⇒ 这条反向**收紧了 Bug 9 的范围**：不是「正则普遍脆弱」，而是「只有 `collectMcpServerNames` 这一处漏了带引号/带空格的名字」。 |
| `enrichThreadWithRolloutTools` 不幂等（每次 resume 历史越滚越多）或产生重复 id | ✗ 不成立。真引擎 resume + 真 worker：3 个线程各连跑 3 次，`items/tools` 数字**完全稳定**（60→73、18→18、8→9），重复 id **0**。 |
| enrich 的「最佳匹配」启发式会把工具卡片挂到**错误的回合** | ✗ 不成立。用 rollout 原文的 `metadata.turn_id` 当权威归属逐条比对：4 个线程共 **14 个可核对工具，0 个挂错**。工具卡片确实补进来了（11→24，把引擎索引里缺的调用补回）。 |

---

## 复现方式（本报告的探针已按"验完即删"清理，下面是复现要点）

1. **真实产物加载测试**：隔离 `CODEX_HOME`（`mkdtemp`）→ 拷贝真实 `config.toml` + `model-catalog.json` →
   `spawn codex.exe app-server --listen stdio://` → `initialize` → `config/read` / `permissionProfile/list`。
2. **必须跑真实 turn**：`thread/start` + `turn/start` 打本地 mock（`POST /v1/responses` 回最小 SSE）。
   理由：`initialize` 通过**不代表**配置有效 —— Bug 1 的非法配置 `initialize` 照样 OK，
   只有 `config/read` / `mcpServerStatus/list` 才暴露，而引擎只在 **stderr** 里写 `Invalid configuration; using defaults`。
3. **写探针的坑（本人实测踩了两次）**：顶层键必须放在**第一个段头之前**。
   把 `default_permissions` / 被测键拼在配置末尾，它们会落进上一个段里，导致"基线测的其实也是 bug 形态"，
   得出完全错误的结论。同理，剥段别用「非贪婪匹配到下一个 `[`」的正则 —— 会留残渣把 TOML 写坏
   （引擎报 `unquoted keys cannot be empty`）。要按行做段级删除。
4. 环境：spawn 前删 `NODE_OPTIONS` / `ELECTRON_RUN_AS_NODE` / `CODEBUDDY_SAFE_DELETE*`；
   清 `HTTP(S)_PROXY`（否则本机代理会把 loopback 也带走）。
5. **查引擎的权威会话状态（本轮新发现的路子，比读 rollout 可靠）**：
   引擎的真实线程索引在 `<codexHome>/state_5.sqlite` 的 `threads` 表，字段含
   `id / model_provider / cwd / rollout_path / archived / has_user_event / title / sandbox_policy / model`。
   Node 22 自带 `node:sqlite`（`new DatabaseSync(path, {readOnly:true})`，需 `--no-warnings`）可直接只读查询，
   **不必**拼 `sessions/*.jsonl`。`thread_history_1.sqlite` 只是 rollout 的分页投影（有 `rollout_byte_offset` 列），不是替代品。
6. **忠实复现某台机器的问题**：不要对用户的真实 `codexHome` 起引擎（会和正在跑的应用抢锁/写状态）。
   把**权威状态**拷进一个临时 `CODEX_HOME` 即可 —— 需要的是
   `config.toml` + `model-catalog.json` + `state_5.sqlite{,-wal,-shm}` + `thread_history_1.sqlite{,-wal}` + `AGENTS.md`，
   再手动 `mkdir sessions`。这样 `thread/list` / `thread/resume` 的行为与真机一致。
7. **用「文件名矩阵」反推引擎的隐式约束**（Bug 13 的破法）：只改文件名/目录一个变量，跑真引擎看报错，
   就能把「canonical 形态」钉死。引擎的报错原文本身就是最好的规格说明书
   （`does not have a canonical rollout filename`），再从二进制里找相邻的格式串（`%Y-%m-%dT%H-%M-%S`）互相印证。
8. **「同口径」的两处实现必须交叉验证**（Bug 14 的破法）：`rollout-worker.cjs` 与 `thread-backup.ts` 的注释都写着
   「同口径」，但只要把**同一份真实 rollout**分别喂给两者、比对输出即可发现漂移。
   `buildSessionsBackup()` / `backupFromRolloutFile()` / `applySessionsBackup()` 都是纯函数，可以直接
   `ts.transpileModule` 编译后 `new Function` 加载来跑（注意要开 `esModuleInterop`，否则报 `path_1.default` 未定义）。
9. **本机 shell 的坑**：这个环境的 Bash shim 下 `| head` / `| tail` 会因 `command not found` 断管道 →
   **输出全空、退出码却是 0**，非常容易误判成「文件不存在」。拿证据一律走「写文件 + Read 读文件」。
