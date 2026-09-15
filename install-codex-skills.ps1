[CmdletBinding()]
param(
    [string]$Destination = ''
)

$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceSkills = Join-Path $packageRoot 'skills'
if (-not $Destination) {
    if ($env:CODEX_HOME) {
        $Destination = Join-Path $env:CODEX_HOME 'skills'
    } else {
        $Destination = Join-Path $env:USERPROFILE '.codex\skills'
    }
}
$skillInstallRoot = [System.IO.Path]::GetFullPath($Destination)

New-Item -ItemType Directory -Path $skillInstallRoot -Force | Out-Null
$installed = @()
Get-ChildItem -LiteralPath $sourceSkills -Directory | ForEach-Object {
    $targetSkill = Join-Path $skillInstallRoot $_.Name
    if (Test-Path -LiteralPath $targetSkill) {
        throw "目标 Skill 已存在：$targetSkill。请先备份或指定新的安装目录。"
    }
    Copy-Item -LiteralPath $_.FullName -Destination $targetSkill -Recurse
    $installed += $_.Name
}

[pscustomobject]@{
    destination = $skillInstallRoot
    installed = $installed
    next = '重新启动 Codex，使新 Skills 被发现。'
} | ConvertTo-Json -Depth 4
