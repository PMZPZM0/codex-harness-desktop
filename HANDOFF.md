# HANDOFF — 交接文档（2026-11-07 09:45）

> 写给**完全没有上下文**的新会话。三件事按顺序读：
> ① 本文 §1（**怎么连上机器**，连不上一切白搭）→ ② 根目录 `AGENTS.md`（怎么建 / 怎么同步三仓）
> → ③ `DESIGN.md`（长什么样）。
>
> 项目：Codex Harness Desktop（Electron 43 + React 19 + Vite 8，主进程 spawn `@openai/codex`
> app-server，stdio JSON-RPC）。
>
> 本文只放**当前主线**。历史（发版、服务器加固、手机远控、Caddy 日志轮转…）在 `logs/`
> （`node scripts/logs.mjs search <关键词>`）与 `.workbuddy/memory/YYYY-MM-DD.md`（逐日流水）。
> ⛔ 本文只留在主仓 `D:\Codex Harness Desktop`：PPcode / 云助手是代码镜像，不带文档。

---

## 0 三十秒速览

- **主线**：群聊（团队模式）功能丰富 + **上级协作的消息来源识别**（后者是用户插入的更高优先级任务，已完成收尾）。
- **最近提交**：主仓 `1d2ee053d`（来源识别）+ `da15dca5a`（结论档案）+ `6b820f735`（本文）；PP `33da5258` / `ac732a17`；云 `85f36dae` / `8ae2b99a`（**已部署**）。
- **代码状态**：三仓干净已推送、构建通过、主仓 `npm run check` **9137 行 / 0 红**、三仓 `verify:runtime` PASS、electron 残留 0。
- **服务器状态**（09:40 实测）：两台服务全 active，探活入口（ppz123.asia / 云助手 version.json / ppcode.pptoken.cc / `/remote/` / 18443 / 本机 80）**全 200**；tx 的 Caddy 日志已按 20MiB×30 滚动（当前 15M）；手机远控正常，⛔ 用户明令保留。
- **下一步**：群聊剩余三块（伙伴资料卡 / @ 候选面板 / 群内搜索），见 §6。

---

## 1 连接与环境（先看这节，连不上就什么都做不了）

### 1.1 两台服务器

| 代号 | 地址 / 登录 | 角色 | 上面跑什么 |
|---|---|---|---|
| **tx** | `ssh tx`（`~/.ssh/config` 里的别名）<br>实为 `ubuntu@<server-ip>`，密钥 `~/.ssh/123.pem` | 云助手 / 网关宿主机（腾讯云 `VM-0-15-ubuntu`） | **Caddy**（443 入口，多站点反代）、**wbm**、**chc-account**、wbm-guard.timer；⛔ **nginx 在这是 inactive**（别在这台找 nginx） |
| **客户机** | `ssh -i ~/.ssh/123.pem -p <ssh-port> root@<client-ip>` | PPCode 主站 + 手机远控 | **nginx**（80/443/**18443**）、**relay-gateway**（`127.0.0.1:18700`）、**ppcode-guard.timer**、**codex-cloud-admin**、8080 |

**怎么确认连上了**（只读，10 秒）：

```bash
ssh -o ConnectTimeout=8 tx 'hostname; systemctl is-active caddy wbm chc-account'
ssh -i ~/.ssh/123.pem -p <ssh-port> root@<client-ip> 'hostname; systemctl is-active nginx ppcode-guard.timer codex-cloud-admin'
```

⚠️ **凭据**：两台都走密钥免密（`~/.ssh/123.pem`）。若密钥失效需要口令，**向用户要，不要写进任何文件**。
⚠️ `~/.ssh/config` 里 `Host tx` 必须有 `IdentityFile ~/.ssh/123.pem` + `IdentitiesOnly yes`；
没有这个别名就手动用上面的完整命令。

**本机访问 GitHub 走 443**（`ssh.github.com`）：`~/.ssh/config` 已配 `Host github.com → ssh.github.com:443`，
因为本网络对 `github.com:22` 会直接 RST。⛔ 别把这段改回去，否则 `git push` 全挂。

### 1.2 本机环境（踩过就废半天）

- Node 走系统安装版；装原生包（better-sqlite3）**必须用应用自带 node 或 npmmirror**，否则 ABI 不匹配。
- 跑 `npm run check`、`npm run build`、任何 CDP/探针前：**`unset NODE_OPTIONS`**（不清会中途断链）、
  **`unset ELECTRON_RUN_AS_NODE`**（不清启动即崩）、**`unset http_proxy https_proxy`**（小写变体也要清，
  否则本机 `127.0.0.1` 被代理掉，CDP `fetch failed`）。

### 1.3 三仓

| 仓 | 路径 | 远端 | 生效方式 |
|---|---|---|---|
| 主仓 | `D:\Codex Harness Desktop` | `PMZPZM0/codex-harness-desktop`（`origin main`） | 本地 `npm run build` + 重启应用 |
| PPcode | `D:\PPcode` | `PMZPZM0/PPcode`（`origin main`） | 同主仓（本地构建） |
| 云助手 | `D:\Codex Assistant` | `PMZPZM0/codex-harness-cloud-src`（⛔ 推 `cloud main`，`origin` 指向主仓） | ⛔ **必须** `node scripts/deploy-cloud-ui.mjs`；只 build 用户看不到 |

**每轮固定流程**（10-13 用户令，三仓 `AGENTS.md` 顶部有逐字一致的判定表）：

```
改代码 → 主仓 build/check/真机验证 → 提交推送
      → 补丁同步另两仓（排除各仓自产文件，§8.2）
      → 每仓各自 npm run build（⛔ 主仓 build 不会替它们出产物）
      → 云助手 deploy → 各仓推送 → 每仓启动校验
```

判据：`stat -c %y dist/assets/index-*.css` ≥ 对应 CSS 源文件 mtime；产物里能 grep 到本轮新规则。

---

## 2 服务器：现状 · 加固 · 红线（运维手册）

> 这节是 11-07 09:40 的**实测**结果，不是回忆。改动前先按这里跑一遍再动手。

### 2.1 当前实测状态

**tx（<server-ip>）**

| 项 | 实测 |
|---|---|
| 服务 | `caddy` active · `wbm` active · `chc-account` active · `wbm-guard.timer` 每分钟 · `nginx` **inactive** |
| 站点 | `https://ppz123.asia/` 200 · `/cloud/app/version.json` 200 · `https://ppcode.pptoken.cc/` 200 |
| 日志 | `workbuddy-access.log` **15M**（09:39，仍被旧 key 空转刷）· `qoder-access` 2.2K · `qoder-bridge-access` 352K |
| 滚动 | `caddy adapt` 实测 `roll_size_mb: 20`×1 + `10`×2；`/etc/logrotate.d/caddy` **已不存在**（移走，⛔ 别放回） |
| 磁盘 | `/` 40G，用 30G，剩 8.4G（78%） |
| 定时器 | `logrotate.timer` 已回系统默认 daily（下次 11-08 00:00）；`wbm-guard.timer` 每分钟 |

**客户机（<client-ip>）**

| 项 | 实测 |
|---|---|
| 服务 | `nginx` active · `ppcode-guard.timer` active · `codex-cloud-admin` active |
| 端口 | 80 / 443 / **18443**（手机远控）×0.0.0.0 · `127.0.0.1:18700`（relay）· 8080（用途未核） |
| 站点 | `http://127.0.0.1/` 200 · `https://ppcode.pptoken.cc/` 200 · `/remote/` 200 · `18443` 200 |
| 防护 | `iptables -L INPUT -n \| grep -c DROP` = **43 条**（含段封与 guard 自动封） |
| 日志 | `ppcode-relay.access.log` 5.1K，属主 `www-data:adm 640`（guard 会扫它） |
| 磁盘 | 11T，用 34G（1%） |

**目录与端口对照（找东西用这张表）**

| 机器 | 路径 / 端口 | 是什么 |
|---|---|---|
| tx | `/etc/caddy/Caddyfile` | 所有站点入口（`ppz123.asia` 等）；同目录一堆 `.bak`，⛔ 别删别改 |
| tx | `/var/www/codex-harness-cloud/app` | 云助手前端静态站（`deploy-cloud-ui.mjs` 的目标目录） |
| tx | `/var/www/codex-harness-releases` | 客户端安装包 / Releases |
| tx | `/cloud-api/*` → `127.0.0.1:8091` | 账号服务 `chc-account`（只存身份） |
| tx | `/var/log/caddy/workbuddy-access.log` | 网关访问日志（**UTC**，见 §7 第 15 条） |
| 客户机 | `/etc/nginx/sites-enabled/ppcode.pptoken.cc` | PPCode 主站 + 443 `/remote/` |
| 客户机 | `/etc/nginx/sites-enabled/*.bak-20261106-harden` | ⛔ 加固前备份，被通配符 include 导致冲突（§2.1 末） |
| 客户机 | `/opt/codex-cloud-admin/web` | 云管理后台静态页 |
| 客户机 | `127.0.0.1:18700` | `relay-gateway.mjs`（手机远控被控端桥），⛔ 别动 |
| 客户机 | `/opt/ppcode-guard/guard.py` | 防爆破 / 扫描，`ppcode-guard.timer` 每分钟跑一次 |
| 客户机 | `/var/log/nginx/ppcode-relay.access.log` | relay 专用日志；guard 只对「这份日志 + 503」免 deny |

⚠️ `deploy-cloud-ui.mjs` 的注释里写「nginx: https://ppz123.asia/…」，**实际是 Caddy 在服务**
（tx 上 nginx inactive）——注释是旧口径，别被带偏。

**已知配置瑕疵（不是故障）**：客户机 `nginx -t` 通过，但有一条
`conflicting server name "ppcode.pptoken.cc" on [::]:443, ignored` —— 来自 `sites-enabled/` 里
11-06 加固前的两个 `.bak`（`nginx.conf` 用的是 `include sites-enabled/*` **通配符**，不看扩展名）。
当前生效的是正式配置（实测 200），但属隐患：**修法是把 `.bak` 移出 `sites-enabled`，再 `nginx -t && systemctl reload nginx`**。

### 2.2 这条线做过什么（别重复做，也别推翻）

1. **11-06 定向盗刷已止**：`<attacker-ip>` 累计 49,653 次 / 2.81B tokens，最后一条 11-06 18:47 CST；
   `<attacker-range>` 与 `.90` 已进 iptables 段封并写入 `/etc/iptables/rules.v4`；7 把旧 key 停用、7 把新 key 启用。
2. **通用扫描/爆破一直在**（换了一拨人，不是同一攻击者）：tx 的 `audit_logs` 每天百余条 `login_failed`，
   **零成功**，guard 自动封（11-07 已封 138 条）。⇒ 看到登录失败日志刷屏**属正常**，别当事故。
3. **tx 已卸载 magpie `/gw/*`**，并加了 wbm / ppcode guard、PPCode nginx 安全头、
   Docker `raw` 表封闭、iptables 段封、abuse 材料留档。
4. **relay 日志分流**（防止 guard 自封手机端）：`ppcode-remote.conf` 与 `ppcode.pptoken.cc` 的
   `/remote/` 各自写 `access_log /var/log/nginx/ppcode-relay.access.log`；`guard.py` 里
   **只有「relay 日志 + 503」不计 deny**，其余 4xx/5xx 照旧。⛔ 别把这个特例扩大成"relay 全部放行"。
5. **tx Caddy 日志轮转**：只让 **Caddy 内建 rolling** 管（`20MiB / roll_keep 30`；
   qoder 两个 `10MiB / 12`），`logrotate` 彻底退出这条链路。

### 2.3 仍然敞着的三件事（要用户点头才能动）

1. **旧 key 空转**：客户机 `tdai` 的 4 处配置（`/opt/tdai/repo/deploy/global-images/.env` 的
   `MEMORY_LLM_API_KEY` / `PROXY_UPSTREAM_API_KEY`、`tdai-gateway.yaml`、`proxy-config/config.yaml`）
   仍是停用的 `wbk_uTHA…`，每 ~1.3 req/s 打 tx 返回 403，Caddy 日志因此持续增长。
   修法 = 下发新 key 到 4 处并重启容器，或停掉 tdai 服务。**涉及业务凭据，必须用户授权。**
2. **`nginx -t` 的 `.bak` 冲突**（见 2.1）：删/移备份即可，但要先确认没有别的线在用那两个副本。
3. **guard 的 `LOGIN_RE`** 只认 `/login` 与 `/cloud-api/login`，relay 的 `/api/v1/auth/login`
   失败走 `deny>=100` 而不是 `LOGIN_FAIL_MAX=8`（补它会让输错 8 次密码就封，故未擅自收紧）。

### 2.4 ⛔ 红线（违了会掉站或被用户骂）

- ⛔ **别碰手机远控**：18443、443 的 `/remote/`、`127.0.0.1:18700` relay。用户 11-07 明令
  「手机远控要留着」，任何加固都绕开它。
- ⛔ **别清日志**：`/var/log/caddy/*.gz` 是审计证据（46,415 行历史 + 几次救援档），
  只许滚动，不许删；`/root/backup-*` 目录同理。
- ⛔ **别用 logrotate 管 Caddy 日志**：`copytruncate` 会让 Caddy 的 fd offset 不回到文件头，
  产出「stat 64.9MB / du 136KB / 前 4KB 全 NUL」的稀疏文件；再 gzip 该路径会让 fd 变 `(deleted)`，
  访问日志**彻底失联**（真踩过）。
- ⛔ **`caddy reload` 不会重建 logger**：同名文件复用旧 writer，改参数也不生效。要让配置生效只能
  `systemctl restart caddy`，并**只认 `caddy validate` 退出码**判成败（成功输出里也含 warn 字样）。
- ⛔ **`roll_size` 必须带单位**：Caddy 2.6.2 下 `roll_size 20` = **20 字节**（adapt 成 1MB），
  必须写 `20MiB`。`roll_keep_for` 要 `720h`，本轮干脆不写。
- ⛔ **别把备份放 `sites-enabled/` 或 `conf.d/`**：nginx 的 include 是通配符，`.bak` 也会被加载
  （2.1 那条冲突警告就是这么来的）。
- ⛔ **别整表刷 iptables**：43 条 DROP 是防护成果；只许追加/精确删除，改完存 `iptables-save`。
- ⛔⛔ **别用脚本猛刷服务器接口**：`guard.py` 的 `DENY_MAX=100` 按「4xx/5xx 次数」计数，
  攒够就把**你的出口 IP** `iptables -I INPUT -s <ip> -j DROP`。白名单只有
  `127.0.0.1 / ::1 / <client-ip> / <office-ip> / <office-range>` ——
  如果你的网络不在里面，反复试探 404/401 **会把自己封掉**（症状：ssh 突然 timeout、网站打不开，
  换手机热点就正常）。真被自己封了只能走云控制台 VNC 或让用户解。
  ⚠️ **本机（开发机）出口是 IPv6**（`<ipv6-prefix>…`），而白名单只有 IPv4 ⇒ 本机**天然不在白名单**，
  更不要从本机对服务器做扫描或压力测试。本机直连三个站点实测均 200（09:45），能打开 ≠ 在白名单。

### 2.5 只读排查命令（复制即用）

```bash
# tx：服务 + 站点 + 日志滚动
ssh tx 'systemctl is-active caddy wbm chc-account; \
        ls -lh /var/log/caddy/*.log | tail -3; \
        sudo caddy adapt --config /etc/caddy/Caddyfile | grep -o "\"roll_size_mb\":[0-9]*" | sort | uniq -c'

# 客户机：nginx + 手机远控 + 防守
ssh -i ~/.ssh/123.pem -p <ssh-port> root@<client-ip> \
  'systemctl is-active nginx ppcode-guard.timer codex-cloud-admin; \
   iptables -L INPUT -n | grep -c DROP; \
   tail -5 /var/log/nginx/ppcode-relay.access.log'

# 谁在扫（只读，别改）
ssh tx 'sudo -n tail -200 /var/log/caddy/workbuddy-access.log | awk "{print \$1}" | sort | uniq -c | sort -rn | head'
```

**连不上时的排查顺序**（按命中率排）：

1. **`ssh: connect to host ... timed out`** → 大概率是**你的 IP 被 guard 封了**（见 §2.4 最后一条）。
   换手机热点试；能连上就说明是 IP 被封，到控制台 VNC 里 `iptables -L INPUT -n | grep <你的IP>` 确认并删规则。
2. **`Permission denied (publickey)`** → 密钥不对：确认用的是 `~/.ssh/123.pem`、`ssh tx` 别名生效；
   仍不行向用户要当前口令（⛔ 别猜、别写进文件）。
3. **站点 502/503** → 后端进程挂了：tx 看 `systemctl status chc-account`（`/cloud-api/*`）与
   Caddy 的 `reverse_proxy` 目标；客户机看 `relay-gateway`（`127.0.0.1:18700`）。
4. **18443 / `/remote/` 返回 503 且页面写「电脑端未连接」** → **不是故障**，是手机要连的那台电脑没开，
   relay 如实回 503；只要 TLS 通就说明链路正常。
5. **`nginx -t` 报 conflicting server name** → 是 `.bak` 被通配符加载（§2.1 末），不影响当前生效配置。

---

## 3 我们在做什么

用户最初两条诉求，后一条优先级更高、已先做完：

1. **群聊功能丰富 + 界面优化**，参考桌面两份逆向报告：
   `C:\Users\Administrator\Desktop\飞书机器人群聊-逆向结论.md`（协议/表现层）、
   `C:\Users\Administrator\Desktop\豆包工作伙伴-团队模式-复刻方案.md`（治理/运行层）；
   进度表 `docs/TEAM-MODE-PLAN-2026-11-05.md`。
2. **上级协作的消息来源识别**（用户原话）：
   > 「准确区分每条消息是上级发送还是用户发送……不仅限群聊里面，外面对话框，专家团，中枢会话也是一样」

---

## 4 已完成的代码工作

### 4.1 消息来源结构化识别（主仓 `1d2ee053d`）

**病根**：调度链输入里**没有「谁发的」**，只有 `originThreadId`，空串一律当本地用户 ⇒
六种来源（模型自派 / 专家团 / 中枢 / 定时任务 / 群伙伴互 @ / 用户亲自打字）全被拼成
「发起方交给你的任务」，消费侧只能靠 `[SYSTEM TASK]` 标签 + 正文正则猜。

**解法**：身份结构化传，首任务需求体第一行写协议行 `发件人：supervisor · 青崖`
（五种：`user | supervisor | automation | member | system`）。真相源 `src/lib/message-origin.mjs`。

**生产端 6 处全覆盖**（漏一处 = 那类来源又变回用户消息）：

| 位置 | 场景 | sender |
|---|---|---|
| `electron/features/delegation.ts` | 模型自派 / IPC / 宿主工具 | supervisor |
| `electron/team-invoke.ts` | 专家团主理人 → 成员 | supervisor |
| `electron/features/teams-ipc.ts` | 团队首任务 / 成员直达首任务 | user / supervisor（两处） |
| `electron/boss-groups/runner.ts` | 中枢 → 群成员 | supervisor |
| `harness-team-ipc.ts` + `02-team-store.ts` | 群派活 | user / automation / member |
| `part08/02-seg/send.tsx` | 用户亲自在专家会话打字 | user（显式） |

**消费端**：`user-refs.ts` 统一解析（老会话回落旧标记）；`UserMessageView.tsx` 优先
`sender.isSuperior`；群消息落 `senderKind` 并投影到渲染行。

### 4.2 群视图（同一提交）

- 合成来源（定时任务/系统）**用徽标代替名字**——真机截图先暴露「定时任务 定时任务」重复、
  系统露英文 id，已修。
- 跨天分隔：`team-view.mjs`（`dayKeyOf`/`dayLabelOf`）+ `.team-msg__day`。

### 4.3 判据

| 项 | 结果 |
|---|---|
| `npm run build` | 三仓 ✓ |
| `npm run check` | 主仓 **9137 行 / 0 红**，预检通过，【93】【94】【96】真跑过 |
| 守卫 11f | **149/149**（本轮 +16 个断言调用，其中一个遍历 5 个生产点） |
| 守卫 11q | 主仓 131/131、云 130/130（两条旧断言改锚结构化身份） |
| 单测 | message-origin 7 / team-view 2 / team-models 29 |
| `verify:runtime` | 三仓 PASS（无 ErrorBoundary） |
| 真机 | 隔离 profile + 种子群截图：`data-sender` = user/member/automation/system，日期分隔正常 |

归档：`logs/2026/11/2026-11-07-decision-消息来源结构化识别上级-定时任务-伙伴-用户.md`（三仓同步，索引已重建）。

---

## 5 当前卡在哪（都是既有遗留，不是本轮引入）

1. **PP 仓 3 条 cloud 断言红**：`scripts/guards/12q-cloud-account.mjs`（首启登录页 cloud 模式 /
   云账号选项卡 / 登录方式卡选中态）。已用 `git stash push -u` 在 HEAD 复现 ⇒ **既有状态**。
   它让 PP 的 `npm run check` 在这一步中断，尾部判据（preflight / bag-types / dead-imports /
   require-paths）要**手动补跑**。
2. **云仓缺 `resources/tools/automation-tools.zip`**：`verify-packaged-tools` 与 `check-preflight`
   停在这一步（缺件，不是断言失败）。需先有 `resources/tools/npm-global/node_modules`，
   再 `node scripts/pack-automation.cjs`。
3. **项目 `MEMORY.md` 9908 字符 / 上限 10000**（安全线 9500）：宿主会**静默截断尾部**，
   只剩 92 字符余量。下次写记忆前先外置一条。
4. **服务器三件遗留**（§2.3）：旧 key 空转、`nginx .bak` 冲突、guard 的 `LOGIN_RE` 边界。

---

## 6 下一步计划

### 6.1 群聊丰富（用户最初那条，还剩三块）

已落地：成员栏、消息卡片（角色条 + 复制/追问/来源）、@ 高亮、团成员展开、运行态与停止键、
群菜单、群调度、按天分隔、来源标记。

1. **伙伴资料卡**（飞书 §2.1）：新建独立组件 `src/features/harness-team/14-team-profile-card.tsx`
   （⛔ 别往 `04-team-group-view.tsx` 里顺手加块，`ARCHITECTURE-RULES.md` §2.2 要求新功能独立板块）。
   数据必须真实：`group.members`（targetKind / targetKey / targetProfession）、群台账
   `harness-team-ledger.json`、`team-runtime.mjs`、`listDispatchCatalog`。⛔ 不编假数据。
2. **@ 候选面板**（飞书 §4）：入口 `10-team-composer.tsx`。纯函数
   `mentionTriggerOf` / `matchMentionCandidates` / `applyMention` 写过但**提交前被删**（git 里没有），
   需重写。边界：前一个字符须为空白/行首/中文标点（否则 `a@b`、`C:\x@y` 误触发）、
   词内不许再有 `@` 或空白、最长 40 字、caret 越界按末尾处理。
3. **群内搜索**（豆包 append-only 日志）：`searchGroupRows` 同样被删过，重写后把 key 对到
   消息 DOM 的 `data-item-id` 做跳转。

### 6.2 收尾杂项

- PP 的 3 条 cloud 红：修，或给 `12q` 加"本仓无 cloud 面"的**显式跳过**（⛔ 别静默放行）。
- 云仓补齐 `automation-tools.zip` 后重跑完整 check。
- `MEMORY.md` 外置一条拉回安全线。
- （需授权）旧 key 下发 / 停 tdai；`.bak` 移出 `sites-enabled`。

---

## 7 踩过的坑（别踩第二次）

1. **`npm run check` 前必须 `unset NODE_OPTIONS`**，否则链提前中断，尾部 `bag-types`/`dead-imports`/
   `require-paths` 全不跑。收尾看**输出末尾**确认【93】【94】【96】真跑过。
2. **`npm run check | tail` 的退出码是 `tail` 的**。`EXIT=0` 不代表通过——要看有没有 `✗`、链有没有跑到底。
3. **守卫会"自洽地错"**：11q 两条断言钉的是旧实现字面量，代码一改就红。要改锚到新不变量，
   ⛔ 不是删断言或放宽。
4. **`src/vite-env.d.ts` 是生成物、每仓自产**：补丁到另两仓必冲突 ⇒ 排除它，各跑 `npm run gen:ipc`。
5. **`09-structural.mjs` 的 `GIANT_CAP` 按实测、每仓独立**：口径 = 非空且非 `//`、`/*`、`*` 开头的行；
   量出实测值写进 cap 并注明来历，⛔ 别照抄别仓数字。
6. **`send.tsx` 三仓上下文不完全一致**，补丁会冲突 ⇒ 手工合并（1 行 import + 1 行模板串）。
7. **`projectGroupLog` 按 `at` 排序**：同刻消息先后不属于契约，单测按 id 取再比。
8. **合成身份不能改 `authorKind`**（它还管折叠/卡片/动作条）⇒ 走独立的 `senderKind`。
9. **不许留"写了没接"的模块**：`team-view.mjs` 一开始 8 个派生函数只有 2 个有消费方，收尾删了 6 个。
10. **真机截图是必要判据**：本轮两个显示缺陷只有截图看得见，守卫与单测全绿。用隔离 profile，⛔ 别动真实 userData。
11. **老会话兼容双向**：读不到协议行要能回落旧标记；用户自己打的 `上级：…` 不能被误判（只认正文第一行）。
12. **怀疑"是我弄红的"先 `git stash push -u` 在 HEAD 复现**（PP 那 3 条就是这么排除的）。
13. **三仓同步别 `git add -A` 了事**：先看 `git status` 有没有别人的 hunk（10-31 踩过），有就按 `parallel-hunk-commit` 只提交自己的。
14. **数字必须实测**：写"9137 行 / 0 红""29 条单测"之前真的跑过、数过。
15. **服务器时间戳**：Caddy 访问日志写 **UTC**，系统与数据库是 **CST**，差 8 小时。
    拿它直接比会凭空造出"攻击还在继续/没发生过"两种错判 ⇒ 权威口径用 DB 的 unix `ts`。

---

## 8 常用命令

### 8.1 本仓

```bash
cd "D:/Codex Harness Desktop"
unset NODE_OPTIONS
npm run build                      # 唯一可信的类型判据（tsc -b 会假绿）
npm run check                      # 看末尾【93】【94】【96】
node --test tests/message-origin.test.mjs tests/team-view.test.mjs tests/team-models.test.mjs
npm run verify:runtime             # 真机探针：ErrorBoundary / .app-shell / 会话行
node .workbuddy/memory/check-budget.mjs
```

### 8.2 三仓同步

```bash
git format-patch -1 --stdout > /tmp/x.patch
# 另两仓：
git apply --check --stat /tmp/x.patch
git apply --exclude=scripts/guards/09-structural.mjs \
          --exclude=src/vite-env.d.ts \
          --exclude=src/features/app-state/parts/part08/02-seg/send.tsx /tmp/x.patch
npm run gen:ipc                    # 重生成 vite-env.d.ts
# 手工合并 send.tsx 与 09-structural 的 cap（按本仓实测）
npm run build && npm run check
# 云助手额外：node scripts/deploy-cloud-ui.mjs --skip-build
# 推送：主 origin main / PP origin main / 云 cloud main
```

### 8.3 真机看群视图（本轮实际用过）

```js
const h = new ElectronHarness({
  name: "sender-badge-" + Date.now(),
  seedProfile: (dir) => writeFileSync(join(dir, "harness-teams.json"), JSON.stringify(seed)),
});
await h.launch();                                  // mkdtemp 临时 userData，不碰真实数据
await h.clickByTitle("群聊");
await h.eval(`document.querySelectorAll(".team-mode__group")[0].click()`);
const shot = await h.screenshot("sender-badge");   // → .e2e-artifacts/shots/
await h.close();
```

种子结构：`{ version, groups: [{ id, name, leadId, members }], messages: { <gid>: [{ id, threadId,
authorId, authorKind, senderKind, at, kind, text, mentions }] } }`。
伙伴消息的 `threadId` 必须非空（假的用 `thread:seed-1`）。
⚠️ `ElectronHarness({ name })` **不会**建持久 profile（实测走 mkdtemp）；要复用传 `profileName`。

### 8.4 收尾四步

① 审查 diff ② `npm run build` ③ 拉起应用跑探针 ④ 关掉应用并确认 `electron.exe` 残留 = 0。
⛔ 启动与检查要在**同一次 shell 调用**里（GUI 进程会被会话 job 回收）。

---

## 9 关键文件地图

| 关注点 | 文件 |
|---|---|
| 发送者身份（唯一真相源 + 类型） | `src/lib/message-origin.mjs` / `.d.mts` |
| 用户消息解析 / 渲染 | `src/lib/user-refs.ts` / `src/features/shared/UserMessageView.tsx` |
| 调度主闸 | `electron/features/delegation.ts` |
| 专家团 / 团队 / 中枢派活 | `electron/team-invoke.ts` / `teams-ipc.ts` / `boss-groups/runner.ts` |
| 群消息落库 | `electron/features/harness-team-ipc.ts` |
| 群消息模型（投影 + `senderKindOf`） | `src/lib/team-models.mjs` / `.d.mts` |
| 群视图 / 群输入框 | `src/features/harness-team/04-team-group-view.tsx` / `10-team-composer.tsx` |
| 群样式 | `src/styles/61-team-mode.css` |
| 日期派生 | `src/lib/team-view.mjs` |
| 守卫 | `scripts/guards/11f-dispatch-integrity.mjs` / `11q-live-edits.mjs` / `09-structural.mjs` |
| 云助手部署 | `D:/Codex Assistant/scripts/deploy-cloud-ui.mjs` |
| 结论档案 | `logs/2026/11/2026-11-07-decision-消息来源结构化识别上级-定时任务-伙伴-用户.md` |

---

## 10 接手第一步

1. 跑一遍 §1.1 的两条 ssh，确认两台都连得上（连不上先找用户要凭据，别猜）。
2. 跑一遍 §2.1 的探活，确认四个站点 200、`iptables` DROP 条数在（43 左右波动属正常）。
3. `cd` 主仓 → `git log -3 --oneline` + `git status` → `npm run build && npm run check`（先 `unset NODE_OPTIONS`），确认基线绿。
4. 从 §6.1 挑一块，按「纯函数 + 单测 → 接线 → 守卫 → 真机截图 → 三仓同步 → 部署」推进。
