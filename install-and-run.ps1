[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 4180,
    [string]$DataDirectory = ''
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$bundledPnpm = Join-Path $runtimeRoot 'bin\fallback\pnpm.cmd'
$dependencyPath = Join-Path $workspaceRoot 'node_modules\@firecrawl\anydoc'
if (-not $DataDirectory) { $DataDirectory = Join-Path $workspaceRoot 'workbench-data' }

Set-Location -LiteralPath $workspaceRoot

if (-not (Test-Path -LiteralPath $dependencyPath)) {
    if (Test-Path -LiteralPath $bundledPnpm) {
        & $bundledPnpm 'install' '--frozen-lockfile'
    } elseif (Get-Command pnpm -ErrorAction SilentlyContinue) {
        & pnpm 'install' '--frozen-lockfile'
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
        & npm 'install'
    } else {
        throw '未找到 pnpm 或 npm。请先安装 Codex Desktop 或 Node.js 20+。'
    }
    if ($LASTEXITCODE -ne 0) { throw "依赖安装失败（退出码 $LASTEXITCODE）。" }
}

$bundledPython = Join-Path $runtimeRoot 'python\python.exe'
if (Test-Path -LiteralPath $bundledPython) {
    $pythonExecutable = $bundledPython
} else {
    $pythonExecutable = (Get-Command python -ErrorAction Stop).Source
}

& $pythonExecutable '-c' 'import openpyxl, pypdf, docx'
if ($LASTEXITCODE -ne 0) {
    Write-Host '正在安装文档解析依赖…'
    & $pythonExecutable '-m' 'pip' 'install' '-r' (Join-Path $workspaceRoot 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Python 文档解析依赖安装失败。' }
}
$env:WORKBENCH_PYTHON = $pythonExecutable

& (Join-Path $workspaceRoot 'run-workbench.ps1') -Port $Port -DataDirectory $DataDirectory
