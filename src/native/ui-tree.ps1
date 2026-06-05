# powershell/ui-tree.ps1
# Dumps the UI Automation tree for a window as JSON.
# Invoked from Node — pure PowerShell, no extra deps. Ships with the package.
#
# Args:
#   -Hwnd <int>   Window handle (decimal). Required unless -Foreground is set.
#   -Foreground   Use the current foreground window.
#   -MaxDepth <int>  Default 8.
#   -MinSize <int>   Skip elements smaller than this (px). Default 0.
#   -OnlyInteractive  Filter to clickable/editable controls.

[CmdletBinding()]
param(
  [int]$Hwnd = 0,
  [switch]$Foreground,
  [int]$MaxDepth = 8,
  [int]$MinSize = 0,
  [switch]$OnlyInteractive
)

$ErrorActionPreference = 'Stop'
# Force UTF-8 output so non-ASCII names (Chinese, emoji) survive the pipe.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName PresentationCore  # provides System.Windows.Rect
Add-Type -AssemblyName UIAutomationTypes

# Resolve target window
if ($Foreground) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class W { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }
'@
  $Hwnd = [int][W]::GetForegroundWindow()
}
if ($Hwnd -eq 0) { throw "Specify -Hwnd or -Foreground" }

$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
if ($null -eq $root) { throw "FromHandle returned null for handle $Hwnd" }

# Control type whitelist for -OnlyInteractive
$interactive = @{
  'Button'=1; 'CheckBox'=1; 'ComboBox'=1; 'Edit'=1; 'Hyperlink'=1;
  'List'=1; 'ListItem'=1; 'MenuItem'=1; 'RadioButton'=1; 'Slider'=1;
  'Spinner'=1; 'SplitButton'=1; 'Tab'=1; 'TabItem'=1; 'Text'=1; 'Tree'=1;
  'TreeItem'=1; 'Document'=1;
}

function Get-PatternSummary($el) {
  # Wrap in a typed list so ConvertTo-Json always emits a JSON array,
  # even when it contains 0 or 1 element (PS5 default would collapse to scalar).
  $patterns = [System.Collections.Generic.List[string]]::new()
  if ($el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsInvokePatternAvailableProperty)) { $patterns.Add('invoke') }
  if ($el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsValuePatternAvailableProperty)) { $patterns.Add('value') }
  if ($el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsTogglePatternAvailableProperty)) { $patterns.Add('toggle') }
  if ($el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsSelectionItemPatternAvailableProperty)) { $patterns.Add('select') }
  if ($el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsExpandCollapsePatternAvailableProperty)) { $patterns.Add('expand') }
  return ,$patterns  # comma forces array wrapping
}

$nextId = 0
function Walk($el, $depth) {
  $info = $el.Current
  $rect = $info.BoundingRectangle

  # UIA returns Rect.Empty (with -Infinity coords) for off-screen/hidden elements.
  # Treat those as zero-sized so [int] casts don't blow up.
  # [double]::IsFinite is .NET Core only — use the classic check for PS 5.1 compat.
  $hasRect = $true
  foreach ($v in @($rect.X, $rect.Y, $rect.Width, $rect.Height)) {
    if ([double]::IsNaN($v) -or [double]::IsInfinity($v)) { $hasRect = $false; break }
  }
  if ($hasRect) {
    $rx = [int]$rect.X; $ry = [int]$rect.Y
    $w = [int]$rect.Width; $h = [int]$rect.Height
  } else {
    $rx = 0; $ry = 0; $w = 0; $h = 0
  }

  $skip = $false
  if ($MinSize -gt 0 -and ($w -lt $MinSize -or $h -lt $MinSize)) { $skip = $true }
  $type = $info.LocalizedControlType
  if ($OnlyInteractive -and -not $interactive.ContainsKey($type)) {
    # Walk children even if filtered out — useful controls often nested.
  }

  $node = $null
  if (-not $skip) {
    $script:nextId++
    $id = $script:nextId
    $patterns = Get-PatternSummary $el
    $kids = [System.Collections.Generic.List[object]]::new()
    $node = [PSCustomObject]@{
      id        = $id
      role      = $type
      name      = $info.Name
      automationId = $info.AutomationId
      className = $info.ClassName
      enabled   = [bool]$info.IsEnabled
      offscreen = [bool]$info.IsOffscreen
      keyboardFocusable = [bool]$info.IsKeyboardFocusable
      rect      = [ordered]@{ x = $rx; y = $ry; width = $w; height = $h }
      patterns  = $patterns
      children  = $kids
    }
  }

  if ($depth -lt $MaxDepth) {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($el)
    while ($null -ne $child) {
      $cnode = Walk $child ($depth + 1)
      if ($null -ne $cnode -and $null -ne $node) {
        [void]$kids.Add($cnode)
      } elseif ($null -ne $cnode) {
        # Parent was skipped — bubble children up as siblings (flattening).
        return $cnode
      }
      $child = $walker.GetNextSibling($child)
    }
  }
  return $node
}

$tree = Walk $root 0
# Force depth-friendly JSON; compress=$false for human-readable; depth high enough for deep apps.
$tree | ConvertTo-Json -Depth 64 -Compress
