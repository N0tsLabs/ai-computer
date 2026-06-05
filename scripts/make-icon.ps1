# scripts/make-icon.ps1
# Generate a minimal 256x256 .ico for the screenpilot overlay.
# No external tools required — uses System.Drawing.

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\overlay\src-tauri\icons'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

# Draw a 256x256 cyan-glow circle with "sp" text.
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode    = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

# Outer glow disk
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point 0,0),
  (New-Object System.Drawing.Point $size,$size),
  [System.Drawing.Color]::FromArgb(255,  35, 220, 255),
  [System.Drawing.Color]::FromArgb(255,  10,  90, 200)
)
$g.FillEllipse($bgBrush, 8, 8, $size-16, $size-16)

# Inner highlight
$inner = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(180, 255, 255, 255)), 4
$g.DrawEllipse($inner, 18, 18, $size-36, $size-36)

# Text "sp"
$font = New-Object System.Drawing.Font 'Segoe UI', 120, ([System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment     = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString('sp', $font, $textBrush, (New-Object System.Drawing.RectangleF 0, 4, $size, $size), $fmt)

# Save as ICO via direct binary write (System.Drawing has no built-in ICO encoder).
# Build a minimal single-entry ICONDIR around the PNG-encoded bitmap.
$pngMs = New-Object System.IO.MemoryStream
$bmp.Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngMs.ToArray()

$icoPath = Join-Path $outDir 'icon.ico'
$out = [System.IO.File]::Open($icoPath, 'Create')
$bw = New-Object System.IO.BinaryWriter $out

# ICONDIR
$bw.Write([uint16]0)        # Reserved
$bw.Write([uint16]1)        # Type: 1 = icon
$bw.Write([uint16]1)        # Count: 1 image

# ICONDIRENTRY (16 bytes)
$bw.Write([byte]0)          # Width: 0 means 256
$bw.Write([byte]0)          # Height: 0 means 256
$bw.Write([byte]0)          # Color count
$bw.Write([byte]0)          # Reserved
$bw.Write([uint16]1)        # Planes
$bw.Write([uint16]32)       # Bits per pixel
$bw.Write([uint32]$pngBytes.Length)  # Bytes in PNG
$bw.Write([uint32]22)       # Offset where PNG starts (6 + 16)

# PNG body
$bw.Write($pngBytes)
$bw.Close()
$out.Close()

Write-Host "Wrote $icoPath ($($pngBytes.Length + 22) bytes)"
