# 云端账号 · 邀请码体系设计说明

> 2026-10-16。用途：**注册来源可监控 + 每个码的额度可管**。
> 实现落点：账号服务 `tx:/home/ubuntu/chc-account/server.js`（数据与接口）+
> 云助手仓 `cloud/web/account.html`（用户注册表单 + 管理端界面）。
> ⛔ 桌面端（主仓）只提供入口链接，不参与判定。

---

## 1. 一句话模型

**一个邀请码可以被 N 个账号使用；一个账号注册时最多属于一个邀请码。** 额度与来源都记在码上，账号侧只留一个 `inviteCode` 指针。

---

## 2. 字段范围

### 2.1 邀请码 `db.invites[<code>]`

| 字段 | 类型 | 范围 / 约束 | 说明 |
|---|---|---|---|
| `code` | string | **8 位小写十六进制**，全库唯一 | 主键。生成即固定，**不可改**（改了等于换码） |
| `note` | string | ≤ 40 字符，可空 | **来源标记**：「谁给的、给哪一渠道」。这就是"监控注册来源"的抓手 |
| `createdBy` | string | 管理员用户名 | 谁生成的（审计） |
| `createdAt` | number | epoch ms | 生成时间 |
| `maxUses` | number | 整数 **0–10000**；**0 = 不限** | 可注册账号数上限 |
| `usedCount` | number | ≥ 0，单调递增 | **累计**成功注册数（含后来被删的账号）—— 额度判定读它 |
| `usedBy` | string[] | 用户名快照，≤ 200 条 | 溯源用（谁用过这个码）；超出只保留最早 200 条，`usedCount` 仍准确 |
| `disabled` | boolean | 默认 false | 停用后不再接受注册，**已注册的账号不受影响** |
| `expiresAt` | number | epoch ms；**0 = 不过期** | 过期后不再接受注册 |
| `lastUsedAt` | number | epoch ms；0 = 从未使用 | 最近一次使用时间（表格排序/巡检用） |

### 2.2 账号侧新增字段 `db.users[i].inviteCode`

| 字段 | 类型 | 说明 |
|---|---|---|
| `inviteCode` | string | 注册时用的码；`""` = 无邀请来源（历史账号 / 环境变量主码） |

⛔ **不反向存整个邀请码对象**：两处各存一份必然漂移（项目纪律：单一真相源）。

### 2.3 环境变量（部署层，不进表）

| 变量 | 默认 | 作用 |
|---|---|---|
| `HARNESS_REGISTER_MAX_PER_IP` | 5 | 每 IP **累计**注册上限（压总量） |
| `HARNESS_REGISTER_INVITE_CODE` | 空 | **全局主码**：兜底通道，⛔ **不计数、不出现在邀请码列表**，用它注册的账号 `inviteCode` 记 `""` |
| `HARNESS_SIGNUP_POINTS` | 1000 | 注册赠送积分 |

---

## 3. 关联关系与限制规则

### 3.1 关联

```
邀请码 (1) ──< 账号 (N)          db.users[].inviteCode → db.invites[code]
```

- **码 → 账号**：正查（管理端"这个码注册了哪些账号"）走 `usedBy` + `db.users` 反查用户名。
- **账号 → 码**：反查（"这个账号从哪来"）读 `user.inviteCode`。
- 码**不随账号删除而回收额度**：`usedCount` 只增不减 —— 否则"注册→删除→再注册"可以无限刷额度。

### 3.2 注册判定顺序（服务端 `POST /register`）

| # | 判定 | 不通过时 |
|---|---|---|
| 1 | 每 IP 每小时 ≤ 3 次 | `429` 注册太频繁 |
| 2 | 每 IP 累计 ≤ `REGISTER_MAX_PER_IP` | `429 register-ip-limit` |
| 3 | **邀请码要求是否开启**：`表非空 ∥ 主码非空` ⇒ 必填 | `403 invite-required` |
| 4 | 码在**表内**？→ 校验 `disabled` / `expiresAt` / `maxUses` | `403` + 具体原因 |
| 5 | 不在表内但是**主码**？→ 放行（不计数） | — |
| 6 | 用户名格式 / 密码强度 / 唯一性 | `400` / `409` |
| 7 | 建号 + 赠送积分 + `usedCount++` + `usedBy.push` + 写 `user.inviteCode` | — |

⛔ 3–5 步**必须在读 body 之后、建号之前**：失败路径不能留下任何副作用（这次实测确认了顺序）。

### 3.3 归一化

`code` 与用户输入都做 **去空白 + 转小写 + 只留 `[0-9a-f]`**。⛔ 不做"自动纠错到某个相似码"（会让人误用别人的码）。

---

## 4. 接口

### 4.1 用户侧

| 方法 | 路径 | 入参 | 返回 |
|---|---|---|---|
| POST | `/register` | `{username, password, invite}` | `{ok, token, account, points}` / `{ok:false, error, message}` |
| GET | `/invite/check?code=` | — | `{ok, valid, reason}` ⛔ **不回剩余额度**（防探测额度） |

### 4.2 管理侧（`me.role === "admin"`）

| 方法 | 路径 | 入参 | 返回 |
|---|---|---|---|
| GET | `/admin/invites` | `?q=`（可选，按 code/note 过滤） | `{ok, invites:[…], totals:{codes,activeCodes,uses,accounts}}` |
| POST | `/admin/invites` | `{note, maxUses, expiresInDays}` | `{ok, invite}` |
| POST | `/admin/invites/update` | `{code, disabled?, maxUses?, note?, expiresInDays?}` | `{ok, invite}` |
| GET | `/admin/invites/accounts` | `?code=` | `{ok, code, accounts:[{username, createdAt, lastLogin, disabled, balance}]}` |
| GET | `/admin/users` | — | 每行**增加** `inviteCode` 字段 |

`invites[]` 每项的**派生字段**：

| 字段 | 算法 | 为什么要它 |
|---|---|---|
| `remaining` | `maxUses === 0 ? null : max(0, maxUses - usedCount)` | 界面直接显示"还剩几个" |
| `registeredCount` | `db.users.filter(u => u.inviteCode === code).length` | **在册**账号数。⛔ 与 `usedCount` 并列显示：两者不等 = 有账号被删过（这本身就是有用的信号） |
| `expired` | `expiresAt !== 0 && Date.now() >= expiresAt` | 状态列不用前端算时间 |

---

## 5. 数据展示方式（管理端界面）

管理端在 **`account.html#admin`** 的「用户 · 权益 · 积分」区下方新增一张**邀请码**卡：

```
[生成]  备注(来源) [____] 可用次数 [10] 有效期(天) [30]   (生成邀请码)

邀请码        备注            已用/上限        在册   状态      最近使用      操作
a1b2c3d4     B站-3月推广      3/10  ▓▓▓░░░      3     生效      2 小时前     [复制][账号][停用]
ffee0011     内测群           1/不限          1     生效      3 天前       [复制][账号][停用]
9c0d1e2f     旧渠道           5/5   ▓▓▓▓▓▓      4     额度用尽   8 天前      [复制][账号][恢复]
```

- **状态**四态：`生效` / `已停用` / `已过期` / `额度用尽`（颜色：绿 / 灰 / 红 / 橙）。
- **已用/上限**带进度条；`不限` 时进度条不显示。
- **在册**列与"已用"不一致时，单元格加 `title` 说明"有 N 个账号已被删除"。
- 点「账号」→ 行下方展开该码注册的账号列表（用户名 / 注册时间 / 最近登录 / 积分余额 / 状态）。
- 点「复制」复制码本身。
- 用户表新增「来源」列：显示 `inviteCode`（空 ⇒ 显示 `—`）。

---

## 6. 安全与反滥用边界

| 面 | 规则 |
|---|---|
| 码本身 | 8 位十六进制（32 bit 随机）。⛔ 不是"口令"，**不承诺抗暴力枚举**；枚举防护靠第 1–2 条 IP 限流 |
| 额度泄露 | `/invite/check` 只回 `valid/reason`，不回剩余额度 |
| 主码 | 只在服务端环境变量，⛔ 不落库、不回传、日志只打前缀 |
| 停用 | 停用**不影响已注册账号**（不能拿"停码"当"封号"用） |
| 删除账号 | 不回收 `usedCount`（防"注册→删除→再注册"刷额度） |
| 审计 | 生成/改额度/停用都写 `createdBy` 与操作日志 |

---

## 7. 与既有机制的关系

- **每 IP 累计上限**（`HARNESS_REGISTER_MAX_PER_IP`）与邀请码是**两层独立闸门**，都要过：前者防"一台机器批量开号"，后者管"来源与额度"。
- **RESTRICT 现状**：邀请码要求是否开启由"表非空 ∥ 主码非空"决定 —— 全新部署（两者都空）时**回归开放注册**，避免把自己锁死在门外。
- **桌面端**：主仓「设置 → 云账号」与首启登录页都只提供**跳转到用户中心**的入口（用户中心里完成注册），⛔ 不在客户端内置注册表单（否则又是一份要同步的账号逻辑）。
