# 记忆系统横向对比与整改方案

> 2026-10-17。对比对象：**SkillHub 5 个热门记忆技能** + **GitHub/MCP 生态主流记忆项目**。
> ⛔ 所有外部事实来自 2026-10-17 的实际检索（来源见文末）；本项目现状来自实读代码。

---

## 一、我们站在哪（先给结论）

**我们的独特点（别人没有的）：**

| 我们的做法 | 生态里的对照 |
|---|---|
| **L0–L7 八层金字塔 + 显式注入预算（90000 字符）** | Letta 是三层（core/recall/archival）但**无字符预算**（靠模型分页）；mem0 按 token 报告（6900/次）；多数项目**没有预算概念** |
| **「日志 vs 记忆」的显式判据 + 代码闸门**（`shouldRememberLine`） | ⛔ **没在别处看到**。mem0 的官方缺点就是「**自动抽取会捕获噪音**——不仔细配置就记一堆没用的」；我们有判据 |
| **四类分类 + 纠错永不淘汰 + 注入顺序纠错最前** | Letta 也自管理，但不分类；SkillHub 的 memory-keeper 分四类（事实/偏好/项目/假设），**但无优先级** |
| **记忆=是什么 / 技能=怎么做 的分工** | 独特 |
| **多后端（内置金字塔 / MCP）+ 装了才让位 + 不双写** | 生态里少见（多数只有一个后端） |

**我们明显落后的（对比后才看出来的）：**

| # | 缺什么 | 谁有 | 严重度 |
|---|---|---|---|
| 1 | ⛔⛔ **敏感信息拦截** | SkillHub 的 `memory-keeper-studio`「敏感信息如账号密码与完整证件号**拦截**」、`agent-memory-keeper`「敏感信息**默认不记**」 | **P0 — 真实隐私风险** |
| 2 | ⛔ **召回质量口径** | `agent-memory-systems`「记忆的质量**等于召回的质量**，不是存了多少」+ 可测的**召回准确率口径** | **P0** |
| 3 | 冲突消解 | memory-keeper「**冲突询问**」；Zep 的双时间有效性窗口；agent-memory-keeper「冲突留版本」 | P1 |
| 4 | 遗忘粒度 | memory-keeper「**三级粒度遗忘**（单条/主题/全局）」；OMEGA「智能遗忘」 | P1 |
| 5 | 时间维度 | **Zep/Graphiti 的双时间**（事实何时为真 + 系统何时得知）—— 能答"Q1 时我们以为预算多少" | P2 |
| 6 | 模型自管记忆 | **Letta 的 `core_memory_replace` / `archival_memory_search`** —— 模型自己决定什么进上下文 | P2 |
| 7 | 语义检索 | OMEGA（ONNX 本地 embedding）、Basic Memory（FastEmbed + 重排）、mem0（向量+图） | P2 |
| 8 | 导出 / 标准格式 | **`mcp-memory` 用 Google OKF v0.2**（跨 Agent 共享）、Basic Memory「退出方式就是 git」 | P3 |
| 9 | 记忆图谱 | 官方 reference server（实体+有向关系+观测）、Basic Memory（wikilink 成图） | P3 |
| 10 | 质量自检 / 健康度 | `smart-memory-agent` 的「**体检**：出健康度报告」 | ✅ 我们刚补了 `memory-audit`，但只覆盖"流水账" |

---

## 二、逐项对比（外部事实 ← 2026-10-17 检索）

### 2.1 GitHub / MCP 生态

| 项目 | 架构 | 亮点 | 已知缺点（**引文**） |
|---|---|---|---|
| **mem0**（~48K★） | 向量 + 图 + KV，**自动抽取** | 生态最大、接入最快、token 高效 | 「**自动抽取……可能捕获噪音**，除非仔细配置什么值得留」；无时间推理；图谱需 Pro |
| **Zep / Graphiti** | **双时间知识图谱**（Apache-2.0） | 事实随时间变化的场景最强；知道"何时为真/何时失效" | 需 Neo4j；建模成本高；对简单聊天是过度设计 |
| **Letta / MemGPT** | **OS 式三层**（core/recall/archival）+ **模型自管** | 长时间自治；上下文满了**归档而非截断** | 是**运行时不是库**（框架锁定）；调试要靠理解模型推理 |
| **Basic Memory**（4.1K★） | **Markdown 为唯一真相源** + 观测/wikilink 成图 + 语义检索 | 人机共编同一份文件；工具带**行为标签**（read-only/destructive/idempotent） | AGPL（内嵌受限）；同步靠手动或付费云 |
| **mcp-memory**（~200★） | **Google OKF v0.2** markdown + **SQLite FTS5 索引** | **跨 Agent 共享的标准化格式**；Git 可 diff | 很新；仅 5 个工具 |
| **官方 reference memory** | **知识图谱**（实体+有向关系+观测），JSONL | 零配置、一个可读文件 | 「`search_nodes` 是**大小写不敏感的子串匹配，无 embedding**」 |
| **mcp-memory-service**（2K★） | SQLite/云，**类型化边**（causes/contradicts）+ **固化旧记忆** | 多 agent 共享（X-Agent-ID）、REST + dashboard | 组件多；默认只绑 localhost |
| **OMEGA** | 本地 SQLite + ONNX embedding | 零依赖、**AES-256 加密**、**智能遗忘** | 社区小 |

**benchmark 参考（LongMemEval，GPT-4o）**：Hindsight 91.4% · Zep 63.8% · mem0 49.0% · 无记忆基线 ~20-30%。
⛔ **我们没有任何召回指标** —— 这一栏是空的。

### 2.2 SkillHub 热门记忆技能

| 技能 | 核心主张 | 我们该学的 |
|---|---|---|
| **agent-memory-systems**（Agent记忆系统设计） | 「记忆的质量**等于召回的质量**，不是存了多少」；记忆类型/分块/混合检索/重排/**衰减与冲突消解**/可测**召回准确率口径** | ⛔ **补召回口径**（我们现在只测"写不写"） |
| **memory-keeper-studio**（记忆管家） | 临时上下文 vs 长期记忆分开；四类（事实/偏好/项目/假设）打标签；**三级粒度遗忘**；**敏感信息拦截**；质量控制（**拒绝歧义短句、重复检测、冲突询问、定期自检**）；**自动记忆保守模式（默认不自动写，只建议候选并询问）** | ⛔ **敏感拦截**（P0）· **保守模式**思想（我们默认全自动捕获）· 冲突询问 |
| **memory-hub**（记忆中枢） | 三层统一入口：全局画像 / 项目防漂移 / 人格记忆（自研 Stemem MCP） | 与我们 L0/L1-L6/session 三作用域**同构** —— 说明分层方向对 |
| **smart-memory-agent** | 四个动作：**记住 / 回忆（带出处）/ 复盘（从日志蒸馏规律）/ 体检（健康度报告）** | 「**带出处**」—— 我们的召回没有来源标注；「体检」我们刚有雏形 |
| **agent-memory-keeper** | 四类（事实/偏好/**承诺**/流程）；**承诺优先核销**；**冲突留版本**；**敏感信息默认不记** | 「承诺」是一类我们**没有**的记忆；「冲突留版本」 |

---

## 三、⛔ 最严重的一条：敏感信息会原样写进记忆

**现状（实读）**：`buildLogEntry` 每轮把「需求 + 回合重点摘要」写进 L4 日志，**没有任何敏感信息过滤**。
用户如果在对话里贴了 API key、数据库密码、证件号，**会被原样落盘**并**每轮注入进上下文**。

项目里已有的 `sanitize()` 只作用于**服务端日志**（`wbt_/wbk_/wap_/sk-mem-/mcp_`），**不覆盖记忆落盘**。

**而 SkillHub 两个成熟技能都把它当默认行为**：「敏感信息如账号密码与完整证件号**拦截**」「敏感信息**默认不记**」。
⇒ **这是我们与成熟做法最实打实的差距，且是隐私风险，不是功能缺失。**

---

## 四、整改方案（按优先级）

### P0-1 敏感信息闸门（**本轮已实现**）

- 位置：`electron/memory-lessons.ts` 新增 `shouldRememberLine` 之前的一道 `scanSensitive(text)`
- 拦截对象：私钥块（`-----BEGIN … PRIVATE KEY-----`）、常见 API key 前缀（`sk-` / `sk-ant-` / `ghp_` / `AKIA` / `AIza` / `xoxb-` / `Bearer …`）、
  `password= / passwd: / token: / secret:` 后跟值、中国大陆身份证 18 位、银行卡 16-19 位、`postgres://user:pass@` 这类带凭据的 URL
- **动作：拒写（不是脱敏后写）** —— 脱敏会留下"这里曾经有个密钥"的痕迹，且容易漏；**拒写 + 留痕**更安全
- ⛔ 只拦 L2/L4 的**落盘**，不改用户的原文；⛔ 不拦用户明确要求"记住这个"的显式指令（那是用户的明确意图，但要提示风险）

### P0-2 召回口径（**本轮已实现最小版**）

- 现在只测"写不写"；补一个 **`memory-recall.mjs`**：给一组（query → 期望命中的条目）构造用例，跑 `memory-store.search`
  与 bigram 检索，输出 **命中率 / 首位命中率**，作为"记忆有没有用"的**可测口径**。
- ⛔ 不追求 benchmark 分数（我们没那个资源），只求**回归可测**：改动不许让召回变差。

### P1-1 冲突消解（写入时）
- 同主题已有条目 → **不静默覆盖**：落成"新条目 + `supersedes: <旧条目 key>`"，或提示用户确认。
- 参照：agent-memory-keeper「冲突留版本」、Zep 的有效性窗口。

### P1-2 遗忘粒度
- 现在只有 TTL / 容量 / 按天丢。补 **按主题遗忘**（同一 dedupeKey 前缀的全组删除）与 **单条遗忘**（记忆面板已有入口，需接上）。

### P2 时间维度 / 模型自管 / 语义检索
- **时间维度**：给 L2 条目加 `validFrom/validTo`（现在只有 `YYYY-MM-DD` 前缀），支持"当时以为…"。
- **模型自管**：给模型一组记忆工具（`memory_list_mine` / `memory_forget`），而不是只能靠捕获链——参照 Letta。
- **语义检索**：先不引入 embedding（依赖重）；等召回口径跑起来、确证"词面检索不够"再上。

### P3 标准化与导出
- 把 L2 条目格式对齐 **OKF v0.2** 的 frontmatter 子集（`type/key/tags/status/generated`），
  这样**能被别的 Agent 工具读**，也让"退出=git"成立。

---

## 五、一句话总结

**我们的强项在"入口治理"（判据、分层、预算、分类），弱项在"出口质量"（召回指标）与"安全"（敏感信息）。**
生态里最成熟的两条经验我们都没做：**敏感信息默认不记**、**记忆质量用召回衡量而不是存量**。
⇒ 本轮先补这两条（P0），其余按 P1→P3 排。

---

## 来源

- `parametric-memory.dev` / `robot.xitain.com` / `omegamax.co` / `seodatapulse.com` / `docs.mintmcp.com`（2026-07 前后对比文，含 LongMemEval 数据）
- `coworker.ai/blog/best-mcp-memory-servers`（9 个 MCP 记忆服务对比，2026）
- `tomrochette.com/agents/memory/basic-memory/`（Basic Memory 评估）
- `quidproquo.cc`（mcp-memory / OKF v0.2）
- SkillHub 检索（2026-10-17）：`agent-memory-systems` / `memory-hub` / `memory-keeper-studio` / `smart-memory-agent` / `agent-memory-keeper`
