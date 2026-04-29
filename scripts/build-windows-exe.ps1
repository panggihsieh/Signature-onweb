$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dist = Join-Path $root "dist\Signature-onweb-windows"
$zip = Join-Path $root "dist\Signature-onweb-windows.zip"
$compiler = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path $compiler)) {
  $compiler = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (-not (Test-Path $compiler)) {
  throw "csc.exe was not found. Cannot build Windows exe."
}

if (Test-Path $dist) {
  Remove-Item -LiteralPath $dist -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dist "scripts") | Out-Null

Copy-Item -LiteralPath (Join-Path $root "index.html") -Destination $dist
Copy-Item -LiteralPath (Join-Path $root "app.js") -Destination $dist
Copy-Item -LiteralPath (Join-Path $root "styles.css") -Destination $dist
Copy-Item -LiteralPath (Join-Path $root "server.js") -Destination $dist
Copy-Item -LiteralPath (Join-Path $root "package.json") -Destination $dist
Copy-Item -LiteralPath (Join-Path $root ".env.example") -Destination $dist
Copy-Item -Path (Join-Path $root "*.md") -Destination $dist
Copy-Item -LiteralPath (Join-Path $root "scripts\google-oauth-token.js") -Destination (Join-Path $dist "scripts")

& $compiler /nologo /target:winexe /out:"$dist\Signature-onweb.exe" /reference:System.Windows.Forms.dll /reference:System.dll "$root\tools\SignatureOnwebLauncher.cs"

if (Test-Path $zip) {
  Remove-Item -LiteralPath $zip -Force
}

Compress-Archive -Path "$dist\*" -DestinationPath $zip -Force

Write-Host "Windows package created:"
Write-Host $zip
