[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ClientPath,
    [string]$OpenSslPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectDirectory = $PSScriptRoot
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
foreach ($relative in @('', '.tools', '.tools\node_modules', 'runtime', 'runtime\node_modules', '.cache', 'lab', 'lab\client', 'lab\setup', 'evidence', 'JLCEDA-DSH.exe')) {
    $candidate = if ($relative) { Join-Path $projectDirectory $relative } else { $projectDirectory }
    if (Test-Path -LiteralPath $candidate) {
        if ((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing redirected setup path: $candidate" }
    }
}
$sourceDirectory = (Resolve-Path -LiteralPath $ClientPath).ProviderPath
if (-not (Test-Path -LiteralPath (Join-Path $sourceDirectory 'lceda-pro.exe') -PathType Leaf)) { throw 'ClientPath must be a client installation directory containing lceda-pro.exe.' }
$targetExecutable = Join-Path $projectDirectory 'lab\client\lceda-pro.exe'
if (@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $targetExecutable }).Count) { throw 'Close this project''s copied client before running setup. The source installation need not be closed.' }
$bootstrapNode = (Get-Command node.exe -ErrorAction Stop).Source
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$npmCli = Join-Path (Split-Path $npmCommand -Parent) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCli)) { throw 'Cannot locate npm-cli.js beside npm.cmd. Install Node.js with npm first.' }
if (-not $OpenSslPath) {
    $sslCommand = Get-Command openssl.exe -ErrorAction SilentlyContinue
    if ($sslCommand) { $OpenSslPath = $sslCommand.Source }
    else {
        $gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
        if ($gitCommand) {
            $candidate = Join-Path (Split-Path (Split-Path $gitCommand.Source -Parent) -Parent) 'usr\bin\openssl.exe'
            if (Test-Path -LiteralPath $candidate) { $OpenSslPath = $candidate }
        }
    }
}
if (-not $OpenSslPath -or -not (Test-Path -LiteralPath $OpenSslPath -PathType Leaf)) { throw 'OpenSSL is required to create the local certificate. Install Git for Windows or supply -OpenSslPath.' }
$compilerDirectory = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $compilerDirectory 'csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework C# compiler is required to build the launcher.' }
$previousSsl = $env:JLC_OPENSSL
try {
    Write-Host 'Restoring build tools from lockfile...'
    & $bootstrapNode $npmCli ci --prefix (Join-Path $projectDirectory '.tools') --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Build tool dependency restore failed.' }
    $nodeExecutable = Join-Path $projectDirectory '.tools\node_modules\node-win-x64\bin\node.exe'
    Write-Host 'Checking the provided client and creating the independent copy...'
    & $nodeExecutable (Join-Path $projectDirectory 'scripts\setup-client.cjs') $sourceDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Client preparation failed. The source installation was not patched.' }
    Write-Host 'Restoring the DSH runtime from lockfile...'
    & $nodeExecutable $npmCli ci --prefix (Join-Path $projectDirectory 'runtime') --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'DSH dependency restore failed.' }
    & $nodeExecutable (Join-Path $projectDirectory 'host\dsh-profile.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Local JLCEDA plugin installation or profile registration failed.' }
    $env:JLC_OPENSSL = (Resolve-Path -LiteralPath $OpenSslPath).ProviderPath
    & $nodeExecutable (Join-Path $projectDirectory 'scripts\build-dsh-embed.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'DSH embedding build failed.' }
    & $nodeExecutable (Join-Path $projectDirectory 'scripts\build-dsh-sidebar.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'DSH sidebar build failed.' }
    Write-Host 'Building the silent Windows launcher...'
    $launcher = Join-Path $projectDirectory 'JLCEDA-DSH.exe'
    $launcherBuild = Join-Path $projectDirectory ('.cache\setup\launcher-' + [Guid]::NewGuid().ToString('N') + '.exe')
    & $compiler /nologo /target:winexe /platform:x64 /reference:System.Windows.Forms.dll "/out:$launcherBuild" (Join-Path $projectDirectory 'scripts\Launcher.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
    if (Test-Path -LiteralPath $launcher) { [IO.File]::Delete($launcher) }
    [IO.File]::Move($launcherBuild, $launcher)
    & $nodeExecutable (Join-Path $projectDirectory 'scripts\setup-client.cjs') --verify-source
    if ($LASTEXITCODE -ne 0) { throw 'Source installation integrity verification failed.' }
    & $nodeExecutable (Join-Path $projectDirectory 'scripts\setup-client.cjs') --complete
    if ($LASTEXITCODE -ne 0) { throw 'Setup completion verification failed.' }
    Write-Host "Setup complete. Start: $launcher"
    Write-Host 'Model credentials and conversations are configured locally on first use.'
    Write-Host 'The provided EDA client may request its own activation on first use; no activation data is imported.'
} finally {
    $env:JLC_OPENSSL = $previousSsl
}
