$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputDirectory = Join-Path $projectDirectory 'build'
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$bitmap = New-Object Drawing.Bitmap 460,220,([Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$logo = [Drawing.Image]::FromFile((Join-Path $projectDirectory 'public/brand.png'))
$chase = [Drawing.Image]::FromFile((Join-Path $projectDirectory 'public/startup-chase/atlas.png'))
$titleFont = New-Object Drawing.Font 'Segoe UI',28,([Drawing.FontStyle]::Bold)
$bodyFont = New-Object Drawing.Font 'Microsoft YaHei UI',13
$detailFont = New-Object Drawing.Font 'Microsoft YaHei UI',10
$textBrush = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#e8e8e8'))
$mutedBrush = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#b0b0b0'))
$accentBrush = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#a1baff'))
$border = New-Object Drawing.Pen ([Drawing.ColorTranslator]::FromHtml('#414141'))
try {
  $graphics.Clear([Drawing.ColorTranslator]::FromHtml('#242424'))
  $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.DrawRectangle($border,0,0,459,219)
  $graphics.DrawImage($logo,44,40,64,64)
  $graphics.DrawString('SVNX',$titleFont,$textBrush,124,45)
  $graphics.DrawString('正在启动，请稍候…',$bodyFont,$textBrush,44,126)
  $graphics.DrawString('正在准备运行环境',$detailFont,$mutedBrush,44,159)
  $catDestination = New-Object Drawing.Rectangle 303,112,74,86
  $mouseDestination = New-Object Drawing.Rectangle 384,166,44,38
  $graphics.DrawImage($chase,$catDestination,0,0,443,512,[Drawing.GraphicsUnit]::Pixel)
  $graphics.DrawImage($chase,$mouseDestination,0,512,443,375,[Drawing.GraphicsUnit]::Pixel)
  $graphics.FillRectangle($accentBrush,44,195,372,3)
  $bitmap.Save((Join-Path $outputDirectory 'portable-splash.bmp'),[Drawing.Imaging.ImageFormat]::Bmp)
} finally {
  $border.Dispose(); $accentBrush.Dispose(); $mutedBrush.Dispose(); $textBrush.Dispose()
  $detailFont.Dispose(); $bodyFont.Dispose(); $titleFont.Dispose(); $logo.Dispose(); $chase.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
