# 仓库拓扑与协作流程（Codex Harness Desktop ↔ PPcode）

> 本文档是**多仓协作的唯一上手入口**：仓库拓扑、核心功能更新后的同步流程、GitHub 推送规范、
> PPcode 发版全流程。步骤全部经过实跑验证（2026-10-10），按本文操作即可，无需额外口头说明。
> ⛔ 两仓的 `AGENTS.md` 是**逐字节镜像** —— 改任何一边必须同内容同步另一边（含本文档的指针行）。

## 一、仓库拓扑（先搞清四个"仓"）

| 本地路径 | GitHub 仓库 | 可见性 | 角色 |
|---|---|---|---|
| `D:\Codex Harness Desktop` | `PMZPZM0/codex-harness-desktop` | 私有 | **主应用**（Codex Harness Desktop）源码；主应用自身的发版也在这里（tag → 本仓 CI → 本仓 Release） |
| `D:\PPcode` | `PMZPZM0/ppcode-src` | 私有 | **PPcode 产品**源码（与主仓同构的副本，品牌不同） |
| —— | `PMZPZM0/PPcode` | **公开** | PPcode **发布仓**：只放 README + Releases。⛔ 应用内「检查更新」匿名拉它的 `/releases/latest`，所以它必须公开 —— **公开就不能放源码**，源码只在 ppcode-src |
| —— | 远端凭据 | — | 两仓远端都是 **SSH deploy key：只能推代码与 tag**。建 Release / 传资产只能在 Actions 里做（本机无 gh CLI、无 API token） |

关键事实（都有代码锚点，别凭记忆）：

- PPcode 应用内更新源：`electron/update-source.ts` → `DEFAULT_UPDATE_REPO = "PMZPZM0/PPcode"`
  （匿名拉 `/releases/latest`）。
- 主应用更新源：`electron/updates.ts` → `GITHUB_REPO = "PMZPZM0/codex-harness-desktop"`。
- 两仓 `.gitignore` 都忽略 `.workbuddy/`（含密临时文件、AI 记忆永不入库）。
- PPcode 与主仓的差异是**有意的品牌差异**，同步时按 §二.3 的例外清单处理，⛔ 不要"顺手统一"。

## 二、核心功能更新后的同步流程（主仓 → ppcode-src）

方向恒定：**主仓是开发主线，ppcode-src 是接收方**（反向需求 = 先在主仓实现再同步）。

```
主仓改动（check 绿 + 已提交）
→ ① 找上次同步点 → ② 生成补丁 → ③ 逐文件预检 → ④ 应用（品牌文件手工）
→ ⑤ ppcode 侧验证（tsc + 守卫 + check）→ ⑥ 提交 fix/feat(sync) → ⑦ 两仓推 origin
```

1. **找上次同步点**：`cd /d/PPcode && git log --grep="同步主仓" -1` —— 提交信息里写的
   `同步主仓 X..Y` 的 **Y** 就是上次同步点（主仓 commit）。
2. **生成补丁**（主仓）：
   `git diff <上次同步点>..HEAD > .workbuddy/tmp/sync-ppcodeN.patch`
   （临时产物一律放 `.workbuddy/tmp/`，它已 gitignore，永不入库）。
3. **逐文件预检**（ppcode）—— ⛔ 不许跳过直接整包 apply：
   ```bash
   P="/d/Codex Harness Desktop/.workbuddy/tmp/sync-ppcodeN.patch"
   for f in $(grep -oE '^\+\+\+ b/[^ ]+' "$P" | sed 's|^+++ b/||' | sort -u); do
     git apply --check --include="$f" "$P" >/dev/null 2>&1 && echo "OK   $f" || echo "FAIL $f"
   done
   ```
4. **应用**：全部 OK → `git apply "$P"`（⛔ `git apply` 是**原子的**：一个文件失败整包不进，
   所以才要逐文件预检）；品牌差异文件 FAIL → `git apply --exclude=<该文件> "$P"` 后**手工改同一处语义**。
   **已知品牌差异文件**（截至 2026-10-10）：
   - `electron/developer-instructions.ts` —— 品牌文案不同，只手工同步**同一处语义**；
   - `src/styles.css` —— 两仓样式编号序列独立，`@import` 尾行各自维护（新样式表文件本体可直接套）；
   - 含品牌字面量（PPcode / Codex Harness）的 hunk —— 只咬含品牌字面量的那几行。
5. **ppcode 侧验证**（顺序固定）：`unset NODE_OPTIONS && npx tsc -b` →
   受影响守卫单跑（如 `node scripts/guards/11q-live-edits.mjs`）→
   `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run check`（沙箱里 preflight 若被环境类挡住，
   **手动补跑链尾三项**：`check-bag-types` / `check-dead-imports` / `check-require-paths`）。
   基线 = **19 项环境类失败**（tomllib / type-stripping / before-pack 等沙箱固有项）；
   多出来的红 = 同步引入的问题，必须修。
6. **提交**：`feat(sync)/fix(sync): 同步原版<主题>`，正文写明：同步区间（主仓 X..Y）、
   文件数与"全部直接套 / 哪些手工"、副本差异、判据（tsc / check / 守卫计数）。
   ⛔ 提交信息含反引号或 `$(` 时必须 `Write` 落盘 + `git commit -F`（bash 会当命令替换）。
7. **两仓都推**：`git push origin main`（见 §三）。

### 同步时的已知坑位清单（每条都真实踩过）

- **换行符**：主仓工作区 LF、ppcode 副本 CRLF ⇒ 守卫里锚多行文本的正则必须写 `\r?\n`，
  锚死 `\n` 会让同一条断言主仓绿、副本假红。
- **守卫棘轮（【265】）**：在册守卫文件（06-app-behavior / 07-turn-fold / 09-structural /
  10-memory-audit 等）"只许缩不许长"，口径是**净代码行**（块注释续行必须以 ` * ` 开头才不算）。
  新断言放不在册的守卫（如 11q / 11m / 11p）。
- **bag-types 双处登记**：bag 新字段要改 `bag-types.ts` **两处**（类型登记 + seg 的 return）；
  类型串与实现不一致会被【93】抓。
- **AGENTS.md 镜像**：改一边必须同步另一边（含行数一致）。
- **`src/features/app-state/parts/bag-types.ts` 这类两仓同构文件**可直接套；主仓特有的
  生成物（`gen:ipc` 产物等）两仓都有，跟着补丁走。

## 三、GitHub 源码推送规范

1. **推什么**：只推 `main`（两仓）。**tag 只在发版时打**（推 `v*` tag = 触发 CI 发版，见 §四）。
2. **推送前提**：`npm run check` 全绿（含手动补跑的链尾三项）+ `git status` 干净
   （临时产物只在 `.workbuddy/tmp/`）+ 本次会话的关键 commit 已按上文规范写好。
3. **凭据纪律**（真事故）：Git for Windows 全局 `credential.helper=git-credential-manager`
   在无 GUI 会话里会**永久阻塞**——症状：`ls-remote`/`fetch` 秒过、**只有 push 卡住零输出**。
   绕行：`git -c credential.helper= -c core.askPass= ` + `GIT_ASKPASS=echo`，或
   `GIT_SSH_COMMAND="ssh -i <key> -o IdentitiesOnly=yes -o BatchMode=yes"`。
4. **网络三条链路**（按时序试）：直连 → `github-443`（`ssh.github.com:443`）→ SOCKS 代理。
   长推送写日志文件（后台会话会被回收）。
5. ⛔ **禁用"隔离索引 + read-tree"式提交**：曾把远端 main 的树截断成 1~10 个文件而 git 仍报
   "推送成功"（09-14 重大事故）。只提交自己的改动用 hunk 级 `git add`，不碰临时索引。
6. 推完必须 `git status -sb` 确认 `## main...origin/main` 无 ahead/behind。

## 四、PPcode 发新版本的完整流程

一句话：**版本对齐 → mac 适配审计 → 发版说明 → check → commit → 打 tag → 推 tag
→ CI 三端构建 → 跨仓发布到公开仓 → 匿名视角核验**。
（⛔ 本机不能建 Release：SSH 只能推代码/tag，发布全部在 CI。详细纪律同
`codex-harness-release-publish` 技能，本文与其一致。）

### 4.1 版本对齐（4 处，一处不漏；CI 会核对 tag 与版本一致，不一致硬失败）

| # | 位置 | 说明 |
|---|---|---|
| 1 | `package.json` | `version` |
| 2 | `package-lock.json` | **两处**：根 `version` + `packages[""].version` |
| 3 | `electron/whats-new-notes.ts` | 最新条目 `version` 与 package.json **逐字一致**（守卫【11r】钉） |
| 4 | `docs/releases/vX.Y.Z.md` | 新建；**CI 缺它直接硬失败**（它是应用内「发现新版本」弹窗正文） |

⛔ 版本号沿既有 `v0.0.x` 线递增，**别跳大版本**（v0.1.0 是已撤销版本，不要按它发）。

### 4.2 mac 适配审计（每次必做）

`node scripts/mac-audit.mjs [上版tag] [目标ref]` —— 扫新增行里的平台敏感模式
（写死 `\` 路径、只认 Windows、用 `;` 切 PATH 等）；脚本自带正则自证；
**结论（含"无真缺口"）必须写进发版说明**。

### 4.3 门禁与提交

`unset NODE_OPTIONS && export CODEBUDDY_SAFE_DELETE_ENABLED=0 && npm run check`
（链尾三项沙箱内手动补跑）；`git status` 干净后 commit，然后：

```bash
git tag vX.Y.Z                # 轻量 tag（与既有 tag 一致）
git push origin main
git push origin vX.Y.Z        # ⛔⛔ 只有 tag 触发 release.yml
```

### 4.4 CI 做什么（`.github/workflows/release.yml`，出问题看这里）

1. 核对 `GITHUB_REF_NAME == v${package.json.version}`，不一致 **error 退出**；
2. `docs/releases/vX.Y.Z.md` 不存在 ⇒ **error 退出**；
3. `mac` job（build-mac.yml：arm64 + x64 双芯片）+ `win` job（build-win.yml）并行构建；
4. `publish` job（needs 两者）：用 `secrets.PPCODE_RELEASE_TOKEN` **跨仓**发布到
   `PUBLISH_REPO = PMZPZM0/PPcode`；
   - release 已存在 → `gh release edit --notes-file`（覆盖重发；⛔ 只 `upload` 不换正文）+ 资产 `--clobber`；
   - **草稿转正兜底**：`isDraft=true` 时 `gh release edit --draft=false`
     （⛔ 删远端 tag 会让同名 release 退回草稿态，匿名不可见、更新器永远收不到 —— 能 bump 就别删 tag）；
5. 资产命名 = **更新器契约**：Win 取 `*.exe`；mac 必须同时含 `mac` + `.zip` + 架构名
   （`arm64`/`x64`），CI 强制规范化改名（错名症状 = 用户端静默「已是最新」）。

CI 约 20~30 分钟；进度看 Actions 的 workflow runs。

### 4.5 核验：必须**匿名视角**（带 token 会把草稿看成成功）

```bash
curl -s https://github.com/PMZPZM0/PPcode/releases.atom | grep vX.Y.Z   # 主判据（不吃 60 次/时/IP 限流）
curl -sIL -o /dev/null -w '%{http_code}\n' https://github.com/PMZPZM0/PPcode/releases/download/vX.Y.Z/<资产名>
```

- 资产 HEAD **必须 `-L` 跟随 302**（资产跳 objects.githubusercontent.com），否则对正常资产假 FAIL；
- ⛔ Git Bash 里带中文 `-w` 的 curl 返回 HTTP 000 是编码问题，别判"页面不存在"；
- 网络失败（ERR）与 404 必须区分（09-20 把网络失败当 404 空转 33 分钟）。

### 4.6 secret 管理

`PPCODE_RELEASE_TOKEN` = 只授 `PMZPZM0/PPcode` **contents:write** 的 fine-grained PAT，
配在 **ppcode-src 仓的 Actions secrets**。token 轮换时必须同步更新该 secret
（网页：Settings → Secrets and variables → Actions）。

### 4.7 主应用（Codex Harness Desktop）的发版

流程同构（版本对齐 / mac 审计 / check / tag / 匿名核验），差异只有两点：
发布目标是**本仓** `PMZPZM0/codex-harness-desktop` 的 Release（更新源 =
`electron/updates.ts` 的 `GITHUB_REPO`），用仓库自带 `GITHUB_TOKEN`，不需要跨仓 token。
详细纪律见 `codex-harness-release-publish` 技能（与本文互为备份，冲突时以 workflow 实文为准）。

## 五、发版后收尾

- 当日记忆（`.workbuddy/memory/YYYY-MM-DD.md`）+ `logs/` 结论档案；
- ppcode-src 的同步/发版提交信息里**始终写明主仓区间与判据** —— 下一次同步的起点靠它找（§二.1）。
