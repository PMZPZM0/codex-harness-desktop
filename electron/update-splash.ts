/**
 * 更新安装提醒小窗（11-16 用户令：「做一个好看的更新进度安装小窗口提醒」）
 *
 * 应用退出后就没有界面了 —— 用户会以为卡死、反复点启动。做法：退出前拉起一个
 * 独立的 PowerShell **WinForms 自绘卡片**（不属于本应用进程，app.quit 不会关它）：
 *   · 深色圆角卡片 + 顶部渐变条 + 应用图标 + 版本号 + 滑动进度条；
 *   · 文案：正在安装更新 / 请勿重复启动 / 安装完成后自动打开；
 *   · 旧进程退出、新版本进程出现后自动关；超时改成「更新未完成」并留关闭按钮；
 *   · 安装器仍用 /S 静默，用户看到的就是这一张卡片。
 *
 * ⛔ 脚本必须保持**纯 ASCII**：PowerShell 5.1 对脚本编码很挑（UTF-8/UTF-16 BOM 实测都可能乱码）。
 *    中文一律 base64 注入、运行时 UTF-8 解码。
 * ⛔ 不用 WPF：这台 Win10 上透明 WPF 窗口不显示、非透明 XAML 也偶发不创建 HWND；
 *    WinForms 实测稳定（GDI+ 自绘，ClearType 正常）。
 * ⛔ spawn 参数数组、不开 shell；只 Windows 调用；脚本写 userData，不随包。
 */
import { spawn } from "node:child_process";
import { app } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const B64 = (value: string) => Buffer.from(value, "utf8").toString("base64");
const TXT_TITLE = B64("正在安装更新");
const TXT_SUB = B64("请勿重复启动，安装完成后会自动打开");
const TXT_HINT = B64("安装通常需要 5–20 秒，期间请不要重复启动");
const TXT_FAIL_TITLE = B64("更新未完成");
const TXT_FAIL_SUB = B64("安装似乎没有完成，请手动重新打开应用。");
const TXT_FAIL_HINT = B64("若仍失败，请重新运行安装包；安装包已保留在下载目录。");

const SPLASH_SCRIPT = String.raw`
param(
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$AppExe,
  [Parameter(Mandatory=$true)][string]$AppName,
  [int]$TimeoutSeconds = 240
)
$ErrorActionPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class HarnessSplashNative {
  [DllImport("user32.dll")] public static extern bool ReleaseCapture();
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
}
"@

function T([string]$x) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($x)) }
function RoundPath([int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$cText = [System.Drawing.ColorTranslator]::FromHtml("#F5F7FA")
$cSub = [System.Drawing.ColorTranslator]::FromHtml("#98A2B3")
$cHint = [System.Drawing.ColorTranslator]::FromHtml("#6F7A8A")
$cAccent = [System.Drawing.ColorTranslator]::FromHtml("#4C8DFF")
$cDanger = [System.Drawing.ColorTranslator]::FromHtml("#E5484D")
$cIconBg = [System.Drawing.ColorTranslator]::FromHtml("#232B38")
$cTrack = [System.Drawing.ColorTranslator]::FromHtml("#2A313D")
$cClose = [System.Drawing.ColorTranslator]::FromHtml("#7C8798")

$form = New-Object System.Windows.Forms.Form
$form.Text = "Codex Harness Update"
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = New-Object System.Drawing.Size(420, 176)
$form.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#171C24")

$accent = New-Object System.Windows.Forms.Panel
$accent.SetBounds(1, 1, 418, 3)
$accent.BackColor = $cAccent

$iconBox = New-Object System.Windows.Forms.PictureBox
$iconBox.SetBounds(18, 22, 42, 42)
$iconBox.BackColor = $cIconBg
$iconBox.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
try {
  $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($AppExe)
  if ($ico -ne $null) { $iconBox.Image = $ico.ToBitmap() }
} catch { }

$title = New-Object System.Windows.Forms.Label
$title.Text = (T("5q2j5Zyo5a6J6KOF5pu05paw")) + "  v$Version"
$title.SetBounds(74, 18, 330, 26)
$title.ForeColor = $cText
$title.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 12, [System.Drawing.FontStyle]::Bold)
$title.BackColor = [System.Drawing.Color]::Transparent

$sub = New-Object System.Windows.Forms.Label
$sub.Text = T("6K+35Yu/6YeN5aSN5ZCv5Yqo77yM5a6J6KOF5a6M5oiQ5ZCO5Lya6Ieq5Yqo5omT5byA")
$sub.SetBounds(74, 46, 330, 20)
$sub.ForeColor = $cSub
$sub.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)
$sub.BackColor = [System.Drawing.Color]::Transparent

$track = New-Object System.Windows.Forms.Panel
$track.SetBounds(20, 92, 380, 6)
$track.BackColor = $cTrack

$fill = New-Object System.Windows.Forms.Panel
$fill.SetBounds(-110, 0, 120, 6)
$fill.BackColor = $cAccent
$track.Controls.Add($fill)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = T("5a6J6KOF6YCa5bi46ZyA6KaBIDXigJMyMCDnp5LvvIzmnJ/pl7Tor7fkuI3opoHph43lpI3lkK/liqg=")
$hint.SetBounds(20, 108, 380, 18)
$hint.ForeColor = $cHint
$hint.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 8)
$hint.BackColor = [System.Drawing.Color]::Transparent

$close = New-Object System.Windows.Forms.Label
$close.Text = [string][char]0x2715
$close.SetBounds(386, 8, 26, 26)
$close.ForeColor = $cClose
$close.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$close.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$close.Cursor = [System.Windows.Forms.Cursors]::Hand
$close.BackColor = [System.Drawing.Color]::Transparent
$close.Add_Click({ $form.Close() })

$form.Controls.AddRange(@($accent, $iconBox, $title, $sub, $track, $hint, $close))

$script:ticks = 0
$script:phase = -110
$script:exitedOnce = $false
$script:timedOut = $false
$script:startedAt = Get-Date
$exeName = [System.IO.Path]::GetFileNameWithoutExtension($AppExe)

$form.Add_Shown({
  try {
    $form.Region = New-Object System.Drawing.Region((RoundPath 0 0 420 176 14))
  } catch { }
})

$drag = {
  param($sender, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    [void][HarnessSplashNative]::ReleaseCapture()
    [void][HarnessSplashNative]::SendMessage($form.Handle, 0xA1, [IntPtr]0x2, [IntPtr]::Zero)
  }
}
foreach ($c in @($form, $accent, $iconBox, $title, $sub, $track, $hint)) {
  $c.Add_MouseDown($drag)
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 33
$timer.Add_Tick({
  $script:ticks = $script:ticks + 1
  if (-not $script:timedOut) {
    $script:phase = $script:phase + 7
    if ($script:phase -gt 380) { $script:phase = -120 }
    $fill.Left = $script:phase
  }
  if (($script:ticks % 20) -eq 0) {
    $procs = @(Get-Process -Name $exeName -ErrorAction SilentlyContinue)
    if ($procs.Count -eq 0) { $script:exitedOnce = $true }
    if ($script:exitedOnce -and $procs.Count -gt 0) {
      $timer.Stop()
      $form.Close()
      return
    }
    if (-not $script:timedOut -and ((Get-Date) - $script:startedAt).TotalSeconds -gt $TimeoutSeconds) {
      $script:timedOut = $true
      $title.Text = T("5pu05paw5pyq5a6M5oiQ")
      $sub.Text = T("5a6J6KOF5Ly85LmO5rKh5pyJ5a6M5oiQ77yM6K+35omL5Yqo6YeN5paw5omT5byA5bqU55So44CC")
      $hint.Text = T("6Iul5LuN5aSx6LSl77yM6K+36YeN5paw6L+Q6KGM5a6J6KOF5YyF77yb5a6J6KOF5YyF5bey5L+d55WZ5Zyo5LiL6L2955uu5b2V44CC")
      $fill.Left = 0
      $fill.Width = 380
      $fill.BackColor = $cDanger
    }
  }
})
$timer.Start()

[System.Windows.Forms.Application]::EnableVisualStyles()
$form.ShowDialog() | Out-Null
`;

/** macOS：更新包打开前弹原生通知（mac 没有 NSIS 静默安装，实际是拖进「应用程序」）。 */
export function showMacUpdateReminder(version: string): void {
  if (process.platform !== "darwin") return;
  const title = "Codex Harness 更新";
  const body = `新版本${version ? ` v${version}` : ""}已下载并校验通过。请打开下载的压缩包，把应用拖进「应用程序」完成更新。`;
  const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
  try {
    spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
  } catch { /* 通知失败不影响下载/打开 */ }
}

/** 在应用退出前拉起安装提醒小窗（Windows）；失败静默不影响安装。 */
export function showUpdateSplash(version: string, timeoutSeconds = 240): void {
  if (process.platform !== "win32") return;
  try {
    const scriptPath = path.join(app.getPath("userData"), "update-splash.ps1");
    mkdirSync(path.dirname(scriptPath), { recursive: true });
    /* ⛔ 脚本是纯 ASCII（中文走 base64 解码），不依赖 BOM。 */
    writeFileSync(scriptPath, SPLASH_SCRIPT, "utf8");
    spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      "-Version", String(version || app.getVersion()),
      "-AppExe", process.execPath,
      "-AppName", app.getName(),
      "-TimeoutSeconds", String(timeoutSeconds),
    ], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch { /* 小窗失败不能挡住安装 */ }
}
