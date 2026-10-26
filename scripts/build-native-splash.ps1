$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework compiler is required to build the startup window.' }
$outputFile = Join-Path $projectDirectory 'build/startup/SVNX.Startup.exe'
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputFile)) | Out-Null
Push-Location $projectDirectory
try {
    & $compiler /nologo /target:winexe /platform:anycpu /optimize+ /debug- /utf8output /codepage:65001 /out:build\startup\SVNX.Startup.exe /win32icon:build\icon.ico /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /resource:public\startup-chase\atlas.png,atlas.png /resource:public\brand.png,brand.png native\StartupSplash.cs
    if ($LASTEXITCODE -ne 0) { throw 'Startup window compilation failed.' }
} finally { Pop-Location }
