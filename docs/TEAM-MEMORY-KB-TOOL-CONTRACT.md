
---

## 10. 桌面端落地：团队工作模式（2026-10-24 · 主仓 `0f0169a`）

⚠️ **本节推翻 §6.4 的"给 memory_write 加 scope 参数"方案**。原因见 §6.3 与 10-16 实测：
记忆中枢 `memapi` **没有任何记忆读写路由**，记忆由对话上游（tdai-proxy）在请求层自动注入 / 写入，
按 `userKey` 隔离。⇒ 做 `team_memory_write` 这类工具是不可能的（无接口可包），
**正确接法是把对话上游切到团队 userKey**，记忆即对全部对话生效。

### 10.1 实际做法（`electron/features/team-mode.ts`，域 id `team`）

| 动作 | 通道 | 效果 |
|---|---|---|
| 列出我的团队 | `team:list` | `GET /teams`（服务端已按成员身份过滤） |
| 进入团队模式 | `team:enter {teamId}` | ① `GET /teams/:id/integrations` ② `setMemoryUpstream({baseUrl, 团队 userKey})` → 对话走团队记忆 ③ 团队库写成 `cloud-kb-team` 连接器（MCP），并**停用个人 `cloud-kb`** ④ 落 `cloudHome()/team-context.json`（记 `prevKbEnabled`） |
| 退出 | `team:exit` | 清记忆上游（回落纯模型）→ 停团队库连接器 → 按 `prevKbEnabled` 用个人 integrations 重建 `cloud-kb` |
| 状态 | `team:status` | 记忆三态（team / personal / model）+ 两个连接器状态 |

### 10.2 三条必须知道的约束

1. **记忆通道是独占的**：同一个 `memory-upstream.json`，进入团队 = 个人记忆暂停。
   退出后个人记忆**不会自动回来**（去云账号页点一次「同步记忆」）。
2. **团队库与个人库不能同时接**：两个连接器都是 WeKnora，工具名（`search_knowledge` 等）相同 ⇒ 撞名。
   进入团队时自动停用个人库，退出时按原状态恢复。
3. **团队空间没开通就如实报"未开通"**（`missing[]` 回给界面），⛔ 不伪造空连接器 / 假开关。

### 10.3 UI

设置 → 云账号 → 「团队工作模式」区块（`src/features/settings-cloud/TeamModeSection.tsx`）：
`AppSelect` 选团队 → 进入 / 退出；三段状态常显；底部常驻一句「进入团队 = 个人记忆暂停」。

### 10.4 仍未做（下一轮）

| 项 | 说明 |
|---|---|
| 按工作区绑定团队 | 现在是一次全局选择（一个人同一时间只在一个团队里干活）；要支持"这个目录属于团队 A、那个属于 B"，需按 `workspace` 存选择并在切换目录时提示 |
| 团队记忆的内容级检索 | MemHub 无 CRUD ⇒ 做不了 `team_memory_search`；只能靠对话层自动召回 |
| 团队库上传的桌面端入口 | 现在只能网页端上传（云端 `/teams/:id/kb/upload` 已实现且有计费） |
| 用量上报 | `/teams/:id/points/report` 接口在，桌面端未接（记忆读写由上游代做，桌面端看不见次数） |
