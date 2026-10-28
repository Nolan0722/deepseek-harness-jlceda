$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path $PSScriptRoot -Parent
$nodeExecutable = Join-Path $projectDirectory '.tools\node_modules\node-win-x64\bin\node.exe'
& $nodeExecutable (Join-Path $PSScriptRoot 'setup-client.cjs') --verify-source
if ($LASTEXITCODE -ne 0) { throw 'The provided source client no longer matches the setup integrity record.' }
