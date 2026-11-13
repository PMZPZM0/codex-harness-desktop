param(
  [Parameter(Mandatory = $true)][string]$OutFile,
  [Parameter(Mandatory = $true)][string]$StopFile,
  [int]$IntervalMs = 25
)

# RPA keyboard/mouse recorder (Windows). ASCII only.
# Writes one JSON object per line to OutFile (UTF-8, no BOM).
# Stops when StopFile appears or after 30 minutes.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class RpaNative {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
try { [RpaNative]::SetProcessDPIAware() | Out-Null } catch { }

$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Event([hashtable]$obj) {
  $json = $obj | ConvertTo-Json -Compress
  [System.IO.File]::AppendAllText($OutFile, $json + "`n", $utf8)
}
function Is-Down([int]$vk) {
  return ((([RpaNative]::GetAsyncKeyState($vk)) -band 0x8000) -ne 0)
}
function Get-Title {
  $h = [RpaNative]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder(512)
  [void][RpaNative]::GetWindowText($h, $sb, $sb.Capacity)
  return $sb.ToString()
}

$keys = @()
$keys += 8, 9, 13, 16, 17, 18, 19, 20, 27, 32, 33, 34, 35, 36, 37, 38, 39, 40, 45, 46
$keys += 48..57
$keys += 65..90
$keys += 96..123
$keys += 144, 145
$keys += 160..165
$keys += 186..192
$keys += 219..222
$keys = $keys | Sort-Object -Unique

$mouseButtons = @(
  @{ vk = 1; name = "left" },
  @{ vk = 2; name = "right" },
  @{ vk = 4; name = "middle" },
  @{ vk = 5; name = "x1" },
  @{ vk = 6; name = "x2" }
)

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$screenW = [RpaNative]::GetSystemMetrics(0)
$screenH = [RpaNative]::GetSystemMetrics(1)
Write-Event @{ type = "meta"; t = 0; width = $screenW; height = $screenH; os = "win32"; at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }

$keyState = @{}
foreach ($vk in $keys) { $keyState[$vk] = (Is-Down $vk) }
$mouseState = @{}
foreach ($b in $mouseButtons) { $mouseState[$b.name] = (Is-Down $b.vk) }

$lastTitle = $null
$lastX = -100000
$lastY = -100000
$lastMoveAt = 0

while (-not (Test-Path -LiteralPath $StopFile)) {
  if ($sw.Elapsed.TotalMinutes -gt 30) { break }
  $t = [int]$sw.Elapsed.TotalMilliseconds

  $title = Get-Title
  if ($title -ne $lastTitle) {
    Write-Event @{ type = "focus"; t = $t; title = $title }
    $lastTitle = $title
  }

  $pos = [System.Windows.Forms.Cursor]::Position
  $dx = $pos.X - $lastX
  $dy = $pos.Y - $lastY
  if (($dx * $dx + $dy * $dy) -gt 36 -and ($t - $lastMoveAt) -gt 70) {
    Write-Event @{ type = "move"; t = $t; x = $pos.X; y = $pos.Y }
    $lastX = $pos.X
    $lastY = $pos.Y
    $lastMoveAt = $t
  }

  $shift = (Is-Down 16)
  $ctrl = (Is-Down 17)
  $alt = (Is-Down 18)
  $win = ((Is-Down 91) -or (Is-Down 92))
  $caps = [System.Windows.Forms.Control]::IsKeyLocked("CapsLock")

  foreach ($vk in $keys) {
    $down = (Is-Down $vk)
    if ($down -ne $keyState[$vk]) {
      $kind = "keyup"
      if ($down) { $kind = "keydown" }
      Write-Event @{ type = $kind; t = $t; vk = $vk; shift = $shift; ctrl = $ctrl; alt = $alt; win = $win; caps = $caps }
      $keyState[$vk] = $down
    }
  }

  foreach ($b in $mouseButtons) {
    $down = (Is-Down $b.vk)
    if ($down -ne $mouseState[$b.name]) {
      $kind = "up"
      if ($down) { $kind = "down" }
      $p = [System.Windows.Forms.Cursor]::Position
      Write-Event @{ type = $kind; t = $t; button = $b.name; x = $p.X; y = $p.Y }
      $mouseState[$b.name] = $down
    }
  }

  Start-Sleep -Milliseconds $IntervalMs
}

$endT = [int]$sw.Elapsed.TotalMilliseconds
Write-Event @{ type = "end"; t = $endT }
exit 0
