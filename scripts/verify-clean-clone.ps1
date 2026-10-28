[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ClientPath,[Parameter(Mandatory=$true)][string]$Destination,[string]$ActivationFile)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path $PSScriptRoot -Parent
$destinationDirectory = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationDirectory) { throw 'Destination must be a new directory.' }
$providedClient = (Resolve-Path -LiteralPath $ClientPath).ProviderPath.TrimEnd('\')
if ($destinationDirectory.TrimEnd('\') -ieq $providedClient -or $destinationDirectory.StartsWith($providedClient + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'The validation clone must be outside the provided client installation.' }
$nodeExecutable = Join-Path $projectDirectory '.tools\node_modules\node-win-x64\bin\node.exe'
$sourceRepository = Join-Path $projectDirectory ('.cache\source-repo-' + [Guid]::NewGuid().ToString('N'))
& $nodeExecutable (Join-Path $PSScriptRoot 'export-source.cjs') $sourceRepository
if ($LASTEXITCODE -ne 0) { throw 'Source export failed.' }
& git -C $sourceRepository init -q
if ($LASTEXITCODE -ne 0) { throw 'Local Git initialization failed.' }
& git -C $sourceRepository add --all
if ($LASTEXITCODE -ne 0) { throw 'Local Git staging failed.' }
& git -C $sourceRepository -c user.name=SetupValidation -c user.email=setup-validation@example.invalid commit -qm 'Local source-only reconstruction test'
if ($LASTEXITCODE -ne 0) { throw 'Local Git commit failed.' }
& git clone --quiet -- $sourceRepository $destinationDirectory
if ($LASTEXITCODE -ne 0) { throw 'Local Git clone failed.' }
foreach ($relative in @('lab','evidence','vendor','.cache','.tools\node_modules','runtime\node_modules','JLCEDA-DSH.exe')) {
    if (Test-Path -LiteralPath (Join-Path $destinationDirectory $relative)) { throw "Clone unexpectedly includes local generated data: $relative" }
}
& (Join-Path $destinationDirectory 'setup.ps1') -ClientPath $ClientPath
if ($LASTEXITCODE -ne 0) { throw 'Clean clone setup failed.' }
$cloneNode = Join-Path $destinationDirectory '.tools\node_modules\node-win-x64\bin\node.exe'
$runtimeArguments = @((Join-Path $destinationDirectory 'scripts\verify-portable-runtime.cjs'))
if ($ActivationFile) { $runtimeArguments += @('--activation-file', (Resolve-Path -LiteralPath $ActivationFile).ProviderPath) }
& $cloneNode @runtimeArguments
$runtimeResult = Get-Content -LiteralPath (Join-Path $destinationDirectory 'evidence\portable-runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
@{passed=$runtimeResult.passed;setupPassed=$true;destination=$destinationDirectory;sourceRepository=$sourceRepository;githubPushed=$false;runtime=$runtimeResult} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $projectDirectory 'evidence\clean-clone.json') -Encoding utf8
if (-not $runtimeResult.passed) { throw ('Clean clone runtime regression incomplete: ' + $runtimeResult.error) }
