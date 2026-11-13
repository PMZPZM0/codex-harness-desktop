param(
  [Parameter(Mandatory = $true)][string]$InputFile,
  [Parameter(Mandatory = $true)][string]$StopFile,
  [int]$RecipeWidth = 0,
  [int]$RecipeHeight = 0
)

# RPA recorded-action player (Windows). ASCII only.
# Input JSON: { "actions": [ { type, t, ... } ], "screen": { "width", "height" } }
# Exit codes: 0 completed, 2 stopped by user, 1 failed.

$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RpaPlay {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
try { [RpaPlay]::SetProcessDPIAware() | Out-Null } catch { }

$raw = [System.IO.File]::ReadAllText($InputFile, [System.Text.Encoding]::UTF8)
$doc = $raw | ConvertFrom-Json
$actions = @($doc.actions)
if ($actions.Count -eq 0) { exit 1 }

$curW = [RpaPlay]::GetSystemMetrics(0)
$curH = [RpaPlay]::GetSystemMetrics(1)
$scaleX = 1.0
$scaleY = 1.0
if ($RecipeWidth -gt 0 -and $RecipeHeight -gt 0 -and $curW -gt 0 -and $curH -gt 0) {
  $scaleX = [double]$curW / [double]$RecipeWidth
  $scaleY = [double]$curH / [double]$RecipeHeight
}

$shell = New-Object -ComObject WScript.Shell
$lastT = 0
$extendedKeys = @(33, 34, 35, 36, 37, 38, 39, 40, 45, 46, 91, 92, 93, 144)
$mouseFlags = @{
  "left-down" = 0x0002; "left-up" = 0x0004
  "right-down" = 0x0008; "right-up" = 0x0010
  "middle-down" = 0x0020; "middle-up" = 0x0040
  "x1-down" = 0x0080; "x1-up" = 0x0100
  "x2-down" = 0x0200; "x2-up" = 0x0400
}

Start-Sleep -Milliseconds 350

foreach ($a in $actions) {
  if (Test-Path -LiteralPath $StopFile) { exit 2 }
  $type = [string]$a.type
  $t = [int]$a.t
  $delay = $t - $lastT
  if ($delay -gt 0) {
    if ($delay -gt 3000) { $delay = 3000 }
    Start-Sleep -Milliseconds $delay
  }
  $lastT = $t

  if ($type -eq "focus") {
    $title = [string]$a.title
    if ($title) {
      try { [void]$shell.AppActivate($title); Start-Sleep -Milliseconds 120 } catch { }
    }
  } elseif ($type -eq "move") {
    $x = [int]([double]$a.x * $scaleX)
    $y = [int]([double]$a.y * $scaleY)
    [void][RpaPlay]::SetCursorPos($x, $y)
  } elseif ($type -eq "down" -or $type -eq "up") {
    $x = [int]([double]$a.x * $scaleX)
    $y = [int]([double]$a.y * $scaleY)
    [void][RpaPlay]::SetCursorPos($x, $y)
    $key = ([string]$a.button) + "-" + $type
    if ($mouseFlags.ContainsKey($key)) {
      $data = 0
      if ([string]$a.button -eq "x1") { $data = 1 }
      if ([string]$a.button -eq "x2") { $data = 2 }
      [RpaPlay]::mouse_event([uint32]$mouseFlags[$key], 0, 0, [uint32]$data, [UIntPtr]::Zero)
    }
  } elseif ($type -eq "keydown" -or $type -eq "keyup") {
    $vk = [byte]([int]$a.vk)
    $flags = [uint32]0
    if ($type -eq "keyup") { $flags = [uint32]0x0002 }
    if ($extendedKeys -contains [int]$vk) { $flags = $flags -bor [uint32]0x0001 }
    [RpaPlay]::keybd_event($vk, 0, $flags, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 12
  }
}

exit 0
