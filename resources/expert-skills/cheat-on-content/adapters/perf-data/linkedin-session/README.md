# Adapter: linkedin-session（LinkedIn 单帖分析爬取）

被 `/cheat-retro` 在 `state.data_collection=adapter` + `platform=linkedin` 时自动调用。

> **来源**：架构照搬 `douyin-session`（Playwright 持久化登录态 + 读渲染后 DOM）。
> 单帖分析（impressions / reach / reactions / …）已在真实 LinkedIn 账号上端到端验证。

---

## 这个 adapter 是干嘛的

LinkedIn 单帖分析页（`/analytics/post-summary/`）**只对帖子作者本人可见**、且数据是
SSR/inline 进页面的——没有公开接口、没有稳定可拦的 voyager XHR，纯 HTTP / requests
（包括 Claude 的 WebFetch）拿不到任何数据。

linkedin-session 用 **Playwright + 持久化 Chromium context** 模拟真实浏览器：

- 你首次登录 LinkedIn（拿到 `li_at` cookie），cookie 存在**你的内容项目根目录** `.auth-linkedin/`
- 之后每次抓取直接复用 cookie，不用重新登录
- 导航到单帖分析页 → 读渲染后 DOM 文本 → 按已知标签锚点解析（**不逆向、不伪造请求**）
- 抓单帖的 10 个指标：展示 / 触达 / 反应 / 评论 / 转发 / 收藏 / 私信转发 / 社交互动 /
  帖子带来的主页访问 / 帖子带来的新增关注，外加帖子正文

输出写到**你的内容项目** `videos/<...>/report.md`（`cheat-retro` 读这个文件 → 摘要写到 prediction 复盘段）。
调试产物（DOM 文本 dump）写到 `.cheat-cache/linkedin-session-debug/`，避免散落在 skill 源码目录。

## 一个诚实的维护说明：LinkedIn 会随机切换 日/英

LinkedIn 同一账号、同一 session 内会在**日文界面**和**英文界面**之间随机切换
（标签会从 `Impressions` 变成 `インプレッション数`）。所以 `extract.py` 的 `POST_METRICS`
**每个指标都存两套别名**，解析时两套都试。如果你的界面是第三种语言，照着 `POST_METRICS`
把对应标签补进去即可（多语言别名是 list，加一项不影响已有的）。

## 安装（一次性）

```bash
# 1. 进你的内容项目根目录
cd ~/my-channel

# 2. 建虚拟环境（强烈建议——Playwright + Chromium 几百 MB，别污染 system Python）
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 3. 装 Playwright
pip install -r "$ADAPTER/requirements.txt"

# 4. 装 Chromium（首次必须）
playwright install chromium

# 5. 首次登录 LinkedIn
ADAPTER=$(find ~/cheat-on-content -name "linkedin-session" -type d 2>/dev/null | head -1)
python "$ADAPTER/crawler.py" login
# → 弹出 Chromium 窗口，登录 LinkedIn
# → 登录成功后窗口自动关闭，cookie(li_at) 存在 当前目录/.auth-linkedin/
```

> 提示：adapter 在 `~/cheat-on-content/adapters/perf-data/linkedin-session`（克隆源码处），
> 不在 `~/.claude/skills`（install.sh 只复制 skill，不复制 adapter）。

## 用法

cheat-retro 自动调用，你不需要手动跑。手动测试：

```bash
cd ~/my-channel
source .venv/bin/activate

# 抓特定帖子（给 activity_id 或整条帖子链接都行）
python "$ADAPTER/review.py" video 7470493738918920193 <video_folder>/script.md

# 输出在 当前目录/videos/<日期>_<activity_id>_<作者>/report.md
```

run.sh 是 cheat-retro 调用的 wrapper：

```bash
bash run.sh <activity_id_or_url> <video_folder> [<script_path>]
```

## 怎么拿到 activity_id

LinkedIn 帖子 URL 形态：

- `https://www.linkedin.com/feed/update/urn:li:activity:7470493738918920193/` → `activity_id = 7470493738918920193`
- 分析页 `https://www.linkedin.com/analytics/post-summary/urn:li:activity:7470493738918920193/` → 同上

adapter 会从整条链接里自动提取 activity_id（也接受直接给裸 id）。
cheat-publish 登记发布时把 activity_id 存到 prediction header，cheat-retro 启动时读这个字段。

## report.md 输出格式

由 `renderer.py` 生成，与 douyin-session 同形。包含：

- 帖子元信息（作者、发布距今、链接、抓取时间）
- 数据快照（展示 / 触达 / 反应 / 评论 / 转发 / 收藏 / 私信转发 / 社交互动 /
  帖子带来的主页访问 / 帖子带来的新增关注 + 派生比率：反应率 / 评论率 / 转发率 / 社交互动率）
- 帖子正文（从分析页 DOM 抽到时）
- 原始稿子（cheat-retro 传入）
- 评论（**LinkedIn 单帖分析页只给评论数、不给评论正文**——report.md 会标注，建议手动粘 top 评论）

## 失败模式（按概率从高到低）

| 症状 | 原因 | 处理 |
|---|---|---|
| `ensure_login` 超时 | cookie 过期或 LinkedIn 强制 reauth | 重新跑 `python crawler.py login` |
| 抓取被重定向到登录页 | `li_at` 失效 | 重新跑 `python crawler.py login` |
| `impressions` 为 None / 指标缺失 | LinkedIn 改了版式或换了第三种语言 | 看 `.cheat-cache/linkedin-session-debug/post_<id>.txt`，把新标签加进 `extract.py` 的 `POST_METRICS` |
| 看不到分析数据 | 该帖**不是你本人**发的（单帖分析仅作者可见） | 只能抓自己的帖子 |
| 正文没抓到 | 分析页 DOM 偶尔不含完整正文 | report.md 会标注；手动补正文 |
| Chromium 崩溃 / 卡死 | 通常是机器内存不足 | 关其他 Chromium；`playwright install chromium --force` 重装 |

**关键现实**：LinkedIn 没有给个人创作者的公开数据 API，单帖分析只能靠登录态读页面。
版式和界面语言都可能变——这个 adapter **需要持续维护**，第一步永远是看 debug 目录里的
`post_<id>.txt` 对照标签。

## 稳定性等级

★★ — Playwright + 登录态能拿到纯 HTTP 拿不到的数据，但解析依赖 DOM 文本版式 +
界面语言（日/英随机），比走 JSON 接口的 adapter 略脆。建议每月手动跑一次验证健康。

## 风险提示

- **冷启动用户慎装**：Playwright + Chromium ~500MB，新人容易劝退
- **TOS 风险**：用自己的 cookie 抓自己后台数据是个人用途；别滥用、别高频
- **不要把 `.auth-linkedin/` 提交到 git**：cookie(`li_at`) 等同你的 LinkedIn 会话凭据，
  泄露 = 他人能登录你的 LinkedIn 账号
- `.cheat-cache/linkedin-session-debug/` 也不应提交（里面是页面 DOM 文本 dump，可能含个人信息）

## 文件清单

```
adapters/perf-data/linkedin-session/
├── README.md           # 本文件
├── requirements.txt    # playwright>=1.44
├── crawler.py          # 抓取核心（登录 + 单帖分析页 DOM 抓取）
├── extract.py          # 纯函数 DOM 解析（双语 日/英 标签）
├── renderer.py         # 把抓回的数据渲染成 report.md
├── review.py           # CLI 入口（login / video <activity_id> [script]）
├── paths.py            # 项目根 / .auth-linkedin / debug 路径解析
├── test_extract.py     # extract.py 单元测试（合成样本，含双语）
├── .gitattributes      # *.sh / *.py eol=lf（防 Windows-CRLF 破坏脚本）
└── run.sh              # cheat-retro 调用的 wrapper
```

## 与其他 adapter 的关系

- `douyin-session` — 抖音，本 adapter 的架构来源
- `xhs-explore` — 小红书，同走 Playwright 被动路线
- `bilibili-stat` — B 站官方 stat 公开接口，最轻

如果你做多平台内容，**只装你实际用的 adapter**——不需要全装。
