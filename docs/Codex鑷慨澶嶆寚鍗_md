# Codex Harness 终端用户自修指南

> 用法：把下面各问题的「发给 Codex 的指令」整段复制，粘贴到用户的应用对话框里发送即可。
> Codex 会自己执行文件修改，改完按提示重启应用生效。
> （这些修复已进入官方代码库，之后的新版本安装包会原生带上；老版本用户可先用本指南自修。）

---

## 问题 1：机器人删除后，重新扫码还是旧的 / 无法重新扫码

**原因**：渠道登录凭据是全局的（`weixin-account.json` / `telegram-account.json`），删除机器人只删了界面记录，网关会话还在——新建同渠道机器人会被判定「已连接」直接复用旧会话。

**发给 Codex 的指令**：

```
我的 Codex Harness 机器人删除后重新绑定还是旧会话。请帮我清理渠道网关的残留凭据：

1. 删除这个文件（微信）：C:\Users\我的用户名\AppData\Roaming\Codex Harness Desktop\weixin-accounts\weixin-account.json
   （实际路径以 %APPDATA%\Codex Harness Desktop\weixin-accounts\ 为准）
2. 如果我也用了 Telegram 机器人，同时删除：C:\Users\我的用户名\AppData\Roaming\Codex Harness Desktop\telegram-account.json
3. 删完提醒我：完全退出并重启 Codex Harness Desktop，然后新建机器人重新扫码绑定即可。
```

> 提示：让 Codex 用 `%APPDATA%` 环境变量定位路径更稳，直接说「删除 %APPDATA%\Codex Harness Desktop\ 下的 weixin-accounts\weixin-account.json 和 telegram-account.json」它就能自己找到并删除。

---

## 问题 2：视觉插件识图报 502（跑半天也没结果）

**原因**：视觉模型配的 `gpt-5.5` 在网关上上游权限被拒（连纯文本都 502）。实测 `gpt-5.6-luna` 可正常识图。

**发给 Codex 的指令**：

```
我的 Codex Harness 视觉插件识图一直 502。请帮我修改视觉模型配置：
编辑 "%APPDATA%\Codex Harness Desktop\builtin-plugins.json"，
把 vision.model 的值从 "gpt-5.5" 改成 "gpt-5.6-luna"，其他字段都不要动。
改完告诉我：无需重启，下次识图自动生效。
```

---

## 问题 3：识图时让 AI 看本地图片报 400 / 卡很久

**原因**：旧版视觉脚本只接受图片 URL/dataURL，而 AI 手里的图片是本地路径，直接传会 400，AI 只能自己先转 base64 绕路（很慢）。

**方案 A（不改文件，立刻能用）**——发给 Codex 的指令：

```
以后你需要识图且图片是本地路径时，不要把路径直接传给 harness-media vision，
也不要自己慢慢转 base64。用这一条命令快速转成 data URL 再传：

node -e "const fs=require('fs');const p=process.argv[1];const mime=/\.jpe?g$/i.test(p)?'image/jpeg':/\.gif$/i.test(p)?'image/gif':/\.webp$/i.test(p)?'image/webp':'image/png';process.stdout.write('data:'+mime+';base64,'+fs.readFileSync(p).toString('base64'))" "<图片路径>"

把命令输出的 data: 开头的整个字符串作为 harness-media.mjs vision 的图片参数。
```

**方案 B（一劳永逸，推荐）**——发给 Codex 的指令：

```
我的 harness-media.mjs 识图不支持本地图片路径。请帮我打补丁：
找到文件 <我的安装目录>\resources\tools\harness-media.mjs（%APPDATA% 下应用安装目录里，
或开始菜单快捷方式指向的位置），在 vision 分支构造 content 之前加入：
如果 target 不以 http/data 开头且文件存在，就读取该文件转成 base64 data URL 赋给 target
（按扩展名决定 mime：jpg/jpeg→image/jpeg，gif→image/gif，webp→image/webp，其余→image/png）。
改完用一张本地图片实测 vision 调用，确认返回描述文本。
```

> 方案 B 让 Codex 自己改代码并自测，改完识图一次调用直达（约 30 秒出结果，之前要几分钟）。

---

## 问题 4：生图插件

实测正常，无需修复。生成的图以 data URL 返回，应用内可直接显示。

---

## 附：这些修复在官方代码库的状态

| 问题 | 修复提交 | 说明 |
|---|---|---|
| 机器人残留会话 | b7d3d90 | 删除/更换渠道自动断开网关并清凭据 |
| 视觉模型 502 | 配置调整 | 视觉模型改为 gpt-5.6-luna |
| vision 本地路径 400 | ed28852 + 3518c8a | 脚本支持本地路径 + 引擎说明书同步 |

下一个安装包版本发布后，以上全部原生内置，无需再手动修复。
