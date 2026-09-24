---
name: ps-file-edit
description: 用 PowerShell / .NET API 安全读写本仓库文件的规程 —— 绝对路径、UTF-8 无 BOM、换行符（同仓库 LF/CRLF 混用！）、Replace 自检、只 add 自己的文件。任何「用脚本改源码/文档/配置」的活之前读它，否则会静默改错文件、或把 Replace 失败当成"锚点写错了"。
---

# 用 PowerShell / .NET 安全改仓库文件

## 何时用
- 要用脚本替换 / 追加 / 重写源码、文档、配置时（不是用编辑器手改时）

## 步骤
1. **一律绝对路径**（见「坑」第 1 条）：`$p='D:\Codex Harness Desktop-refactor\src\...'`
2. **先探三件事**（一条命令拿全）：
   ```powershell
   $p='<绝对路径>'; $b=[IO.File]::ReadAllBytes($p)
   "BOM: " + ($b[0] -eq 239 -and $b[1] -eq 187 -and $b[2] -eq 191)
   $t=[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)
   "CRLF: " + ([regex]::Matches($t,"`r`n")).Count + " / LF: " + ([regex]::Matches($t,"`n")).Count
   ```
3. **按探测结果拼换行**：CRLF 文件用 ``$nl="`r`n"``，LF 文件用 ``$nl=[char]10``（**同一个仓库里两种都有**）
4. **替换 + 自检**：
   ```powershell
   $n=$t.Replace($old,$new)
   if($n -eq $t){'NO-MATCH'}else{[IO.File]::WriteAllText($p,$n,(New-Object Text.UTF8Encoding($false)));'OK'}
   ```
5. **写完立刻读回验证**：`Select-String` 找新内容 + 旧内容 grep 计数为 0

## 坑
- ⛔ **`.NET IO` 的当前目录 ≠ PowerShell 的 `cd`**：`[IO.File]::ReadAllText('src\x.tsx')` 会解析到**进程启动目录**（实测报 `Could not find a part of the path 'D:\_Codex临时产物\src\x.tsx'`）。`cd` 只改 PS 的 location。**一律传绝对路径**（已踩两次）。
- ⛔ **同一仓库换行符混用**：实测 `MemoryPanels.tsx`=LF、`07-memory-panel.tsx`=CRLF、`vite.config.ts`=CRLF、`docs/*.md`=LF。跨行锚点用错换行 ⇒ `Replace` 返回 NO-MATCH，看起来像「锚点写错了」，实际是行尾不匹配（已踩两次，白跑两轮）。
- ⛔ **写回必须显式 UTF-8 无 BOM**：`Set-Content` 默认 ANSI 会毁中文 ⇒ `[IO.File]::WriteAllText($p,$t,(New-Object Text.UTF8Encoding($false)))`。
- **只改一段就用 Replace，别全量重写**：Replace 保留原编码/换行；全量重写会把整文件行尾统一成你写的那一种。
- **单条命令只做 1–4 处替换**：长多语句脚本易被 harness 策略整条拦截（`Rejected ... blocked by policy`）。
- ⛔ **跨行替换用数组切片，别用正则/长字符串锚点**（已踩两次：以为 16/18 空格实际 20/22；以为 16 实际 14）：
  ```powershell
  $lines = $t -split "`n"                 # 按行切（LF 文件；CRLF 用 "`r`n"）
  # 先程序定位行号：$lines | Select-String -Pattern '<锚点片段>' | Select -First 1 → .LineNumber
  $out = $lines[0..($s-2)] + '<新行>' + $lines[$e..($lines.Count-1)]
  ```
  多行 JSX 缩进深、正则非贪婪边界又难判，只有按行号拼接不碰缩进与换行匹配。
- ⛔ **多处替换要逐处验证**：`if($t -eq $o){'NO-CHANGE'}` 只说明「整批有没有变化」，**掩盖单处失败**（同批其它处成功就报 OK）。替换后立刻 `Select-String` 逐处确认。
- **改 React 组件 props 要同时改两处**：函数签名的**解构列表**与**类型字面量**——只改一处会 tsc 报 `TS2304`（别跳过 `npm run check` 直接提交）。
- **别用 `git add .`**（红线第 6 条）：本仓有并行写入者，只 add 自己改的文件。

## 判据
- 替换命令返回 `OK` 而不是 `NO-MATCH`
- 写完读回：新内容在、旧内容 grep 计数为 0
- 文件仍无 BOM（前 3 字节 ≠ `239,187,191`）
- `git diff --stat` 只列你预期的文件（多出来的 = 并行写入者，别一起提交）