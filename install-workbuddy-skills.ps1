[CmdletBinding()]
param(
    [string]$Destination = ''
)

$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceSkills = Join-Path $packageRoot 'workbuddy-skills'
if (-not $Destination) {
    $Destination = Join-Path $env:USERPROFILE '.workbuddy\skills'
}
$skillInstallRoot = [System.IO.Path]::GetFullPath($Destination)

if (-not (Test-Path -LiteralPath $sourceSkills)) {
    throw '未找到 skills 目录。请在完整发布包根目录运行此脚本。'
}

New-Item -ItemType Directory -Path $skillInstallRoot -Force | Out-Null
$installed = @()
Get-ChildItem -LiteralPath $sourceSkills -Directory | ForEach-Object {
    $targetSkill = Join-Path $skillInstallRoot $_.Name
    if (Test-Path -LiteralPath $targetSkill) {
        throw "目标 Skill 已存在：$targetSkill。请先备份或改用 WorkBuddy 的 ZIP 导入更新流程。"
    }
    Copy-Item -LiteralPath $_.FullName -Destination $targetSkill -Recurse
    $installed += $_.Name
}

[pscustomobject]@{
    destination = $skillInstallRoot
    installed = $installed
    next = '重启或重新加载 WorkBuddy Skills，然后在对话中调用对应 Skill。'
} | ConvertTo-Json -Depth 4
