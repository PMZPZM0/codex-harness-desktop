# desktop-uia.ps1 -- Windows UI Automation bridge (no third-party binaries; uses the
# UIAutomation assemblies that ship with Windows PowerShell 5.1).
#
# Actions:
#   -Action windows
#   -Action snapshot -ProcessId 1234 | -Title "Name"   [-Limit 300]
#   -Action invoke   -ProcessId 1234 -Index 7
#   -Action value    -ProcessId 1234 -Index 7 -Text "hello"
#
# Output: one compact JSON object on stdout. Errors are ALSO returned as JSON (ok=false)
# so the MCP layer can pass them through without parsing stderr.
#
# STOP Keep this file ASCII-only. Windows PowerShell 5.1 reads a BOM-less .ps1 as the system
#    ANSI codepage (GBK on zh-CN), where a multi-byte character's trailing byte can swallow
#    the next ASCII quote/brace -> "string missing terminator" parse errors (hit in
#    development on 2026-10-04). Non-ASCII text belongs in harness-uia.mjs, which localizes.
# STOP Read-only actions (windows/snapshot) never mutate UI state; invoke/value are writes and
#    the MCP layer requires an explicit confirm flag.
param(
  [Parameter(Mandatory = $true)][ValidateSet("windows", "snapshot", "invoke", "value")][string]$Action,
  [int]$ProcessId = 0,
  [string]$Title = "",
  [int]$Index = -1,
  [string]$Text = "",
  [int]$Limit = 300
)

$ErrorActionPreference = "Stop"

# STOP Force UTF-8 on the output stream. Windows PowerShell writes redirected stdout with the
#    system ANSI codepage (GBK on zh-CN), and a GBK trail byte can be 0x5C ('\') or 0x22 ('"'),
#    which silently breaks the JSON we emit for window titles containing Chinese characters.
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch { /* may be unavailable when there is no console host; ignore */ }

function Out-Json($obj) { return (ConvertTo-Json -InputObject $obj -Depth 6 -Compress) }

# Off-screen / minimized windows report an Empty rectangle whose coordinates are +/-Infinity,
# and bare `Infinity` is not valid JSON -> the whole snapshot would fail to parse. Emit null
# ("geometry unknown") instead; callers still get the offscreen flag.
function Round-Geom($value) {
  if ($null -eq $value) { return $null }
  $d = [double]$value
  if ([double]::IsNaN($d) -or [double]::IsInfinity($d)) { return $null }
  return [math]::Round($d)
}

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch {
  Write-Output (Out-Json @{ ok = $false; code = "uia_assembly_unavailable"; error = $_.Exception.Message })
  exit 0
}

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$TrueCond = [System.Windows.Automation.Condition]::TrueCondition

function Top-Windows {
  $kids = $AE::RootElement.FindAll($TS::Children, $TrueCond)
  $out = @()
  for ($i = 0; $i -lt $kids.Count; $i++) {
    $e = $kids.Item($i)
    if ($e.Current.ControlType.ProgrammaticName -notlike "*Window*") { continue }
    if ([string]::IsNullOrWhiteSpace($e.Current.Name)) { continue }
    $r = $e.Current.BoundingRectangle
    $out += [pscustomobject]@{
      hwnd       = [int64]$e.Current.NativeWindowHandle; name = $e.Current.Name; class = $e.Current.ClassName
      pid        = $e.Current.ProcessId; x = Round-Geom($r.X); y = Round-Geom($r.Y)
      w          = Round-Geom($r.Width); h = Round-Geom($r.Height); offscreen = [bool]$e.Current.IsOffscreen
    }
  }
  return , $out
}

function Find-Window {
  $list = Top-Windows
  if ($ProcessId -gt 0) { $hit = @($list | Where-Object { $_.pid -eq $ProcessId }) }
  elseif ($Title -ne "") { $hit = @($list | Where-Object { $_.name -like "*$Title*" }) }
  else { $hit = @($list) }
  if ($hit.Count -eq 0) { return $null }
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty, [int]$hit[0].hwnd)
  return $AE::RootElement.FindFirst($TS::Children, $cond)
}

function Patterns-Of($e) {
  $acts = @()
  foreach ($pair in @(
      @("invoke", [System.Windows.Automation.InvokePattern]),
      @("value", [System.Windows.Automation.ValuePattern]),
      @("toggle", [System.Windows.Automation.TogglePattern]),
      @("scroll", [System.Windows.Automation.ScrollPattern]),
      @("expand", [System.Windows.Automation.ExpandCollapsePattern]),
      @("select", [System.Windows.Automation.SelectionItemPattern]),
      @("range", [System.Windows.Automation.RangeValuePattern])
  )) {
    try { if ($e.IsPatternSupported($pair[1]::IdentifyPattern())) { $acts += $pair[0] } } catch { }
  }
  return , $acts
}

function Collect($window) {
  $all = $window.FindAll($TS::Descendants, $TrueCond)
  $items = @()
  for ($i = 0; $i -lt $all.Count; $i++) {
    $e = $all.Item($i)
    $acts = Patterns-Of $e
    $name = $e.Current.Name
    if ([string]::IsNullOrWhiteSpace($name) -and $acts.Count -eq 0) { continue }
    $r = $e.Current.BoundingRectangle
    $items += [pscustomobject]@{
      index = $items.Count; ct = ($e.Current.ControlType.ProgrammaticName -replace "ControlType.", "")
      name = $name; class = $e.Current.ClassName; automationId = $e.Current.AutomationId
      x     = Round-Geom($r.X); y = Round-Geom($r.Y); w = Round-Geom($r.Width); h = Round-Geom($r.Height)
      actions = $acts; offscreen = [bool]$e.Current.IsOffscreen; enabled = [bool]$e.Current.IsEnabled
    }
    if ($items.Count -ge $Limit) { break }
  }
  return @{ rawCount = $all.Count; items = $items; cache = $all }
}

try {
  if ($Action -eq "windows") {
    Write-Output (Out-Json @{ ok = $true; action = "windows"; windows = (Top-Windows) })
    exit 0
  }
  $win = Find-Window
  if ($null -eq $win) {
    Write-Output (Out-Json @{ ok = $false; code = "window_not_found"; error = "no matching window (pass -ProcessId or -Title)"; windows = (Top-Windows) })
    exit 0
  }
  if ($Action -eq "snapshot") {
    $c = Collect $win
    Write-Output (Out-Json @{
      ok = $true; action = "snapshot"; rawCount = $c.rawCount; count = $c.items.Count
      truncated = ($c.items.Count -ge $Limit)
      window    = @{ name = $win.Current.Name; class = $win.Current.ClassName; pid = $win.Current.ProcessId }
      elements  = $c.items
    })
    exit 0
  }
  $c = Collect $win
  $pick = @($c.items | Where-Object { $_.index -eq $Index })
  if ($pick.Count -eq 0) {
    Write-Output (Out-Json @{ ok = $false; code = "index_out_of_range"; error = "index $Index not in current list (UI may have changed; snapshot again)"; count = $c.items.Count })
    exit 0
  }
  $info = $pick[0]
  $target = $c.cache.Item($Index)
  if ($Action -eq "invoke") {
    if (-not ($info.actions -contains "invoke")) {
      Write-Output (Out-Json @{ ok = $false; code = "pattern_unsupported"; error = "element does not support invoke; try value or a coordinate click"; actions = $info.actions })
      exit 0
    }
    $pat = $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::IdentifyPattern())
    $pat.Invoke()
    Write-Output (Out-Json @{ ok = $true; action = "invoke"; invoked = @{ index = $Index; ct = $info.ct; name = $info.name } })
    exit 0
  }
  if ($Action -eq "value") {
    if (-not ($info.actions -contains "value")) {
      Write-Output (Out-Json @{ ok = $false; code = "pattern_unsupported"; error = "element does not support value"; actions = $info.actions })
      exit 0
    }
    $pat = $target.GetCurrentPattern([System.Windows.Automation.ValuePattern]::IdentifyPattern())
    $pat.SetValue($Text)
    Write-Output (Out-Json @{ ok = $true; action = "value"; set = @{ index = $Index; name = $info.name; text = $Text } })
    exit 0
  }
} catch {
  Write-Output (Out-Json @{ ok = $false; code = "bridge_exception"; error = $_.Exception.Message })
}
