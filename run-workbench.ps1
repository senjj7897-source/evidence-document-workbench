[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 4180,
    [string]$DataDirectory = ''
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not $DataDirectory) { $DataDirectory = Join-Path $workspaceRoot 'workbench-data' }

if (Test-Path -LiteralPath $bundledNode) {
    $nodeExecutable = $bundledNode
} else {
    $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
}

Set-Location -LiteralPath $workspaceRoot
if (-not (Test-Path -LiteralPath (Join-Path $workspaceRoot 'node_modules\@firecrawl\anydoc'))) {
    throw '尚未安装运行依赖。首次使用请运行 .\install-and-run.ps1。'
}
$env:WORKBENCH_PORT = [string]$Port
$env:WORKBENCH_DATA_DIR = [System.IO.Path]::GetFullPath($DataDirectory)
Write-Host "Evidence Workbench: http://127.0.0.1:$Port/"
Write-Host "Local data directory: $($env:WORKBENCH_DATA_DIR)"
& $nodeExecutable 'src\server.mjs'
