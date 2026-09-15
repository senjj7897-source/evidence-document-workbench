[CmdletBinding()]
param(
    [string]$Version = '0.2.0',
    [string]$SkillVersion = '1.0.0',
    [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repositoryRoot 'dist' }
$releaseOutputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $releaseOutputRoot) {
    throw "发布目录已存在：$releaseOutputRoot。为防止覆盖旧制品，请改用新的 -OutputDirectory。"
}

$stageRoot = Join-Path $releaseOutputRoot 'staging'
$applicationFolderName = "evidence-document-workbench-v$Version"
$applicationStage = Join-Path $stageRoot $applicationFolderName
$skillOutput = Join-Path $releaseOutputRoot 'skills'
New-Item -ItemType Directory -Path $applicationStage -Force | Out-Null
New-Item -ItemType Directory -Path $skillOutput -Force | Out-Null

foreach ($directory in @('app', 'src', 'schemas', 'docs', 'skills', 'workbuddy-skills')) {
    Copy-Item -LiteralPath (Join-Path $repositoryRoot $directory) -Destination (Join-Path $applicationStage $directory) -Recurse
}

$workersStage = Join-Path $applicationStage 'workers'
New-Item -ItemType Directory -Path (Join-Path $workersStage 'xlsx-runtime') -Force | Out-Null
foreach ($file in @('extract.py', 'word_page_map.ps1', 'export_work_docx.py')) {
    Copy-Item -LiteralPath (Join-Path $repositoryRoot "workers\$file") -Destination (Join-Path $workersStage $file)
}
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'workers\xlsx-runtime\export_xlsx.mjs') -Destination (Join-Path $workersStage 'xlsx-runtime\export_xlsx.mjs')

$toolsStage = Join-Path $applicationStage 'tools'
New-Item -ItemType Directory -Path $toolsStage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'tools\search-knowledge-base.mjs') -Destination (Join-Path $toolsStage 'search-knowledge-base.mjs')

foreach ($file in @('package.json', 'pnpm-lock.yaml', 'requirements.txt', 'README.md', 'PRIVACY.md', 'SECURITY.md', 'install-and-run.ps1', 'run-workbench.ps1', 'install-workbuddy-skills.ps1', 'install-codex-skills.ps1')) {
    Copy-Item -LiteralPath (Join-Path $repositoryRoot $file) -Destination (Join-Path $applicationStage $file)
}

$forbidden = Get-ChildItem -LiteralPath $applicationStage -File -Recurse | Where-Object {
    $_.FullName -match '(?i)[\\/](?:node_modules|workbench-data|knowledge-base|outputs|artifacts|tmp|\.git)[\\/]' -or
    $_.Extension -match '(?i)^\.(?:docx|docm|xlsx|xlsm|pdf|zip|log|pyc)$'
}
if ($forbidden) { throw "公开包包含禁止内容：$($forbidden.FullName -join '; ')" }

$applicationManifest = [pscustomobject]@{
    package = $applicationFolderName
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    publicBoundary = 'No imported documents, project data, knowledge base, outputs, style memory, logs, caches, or office binaries.'
    files = Get-ChildItem -LiteralPath $applicationStage -File -Recurse | ForEach-Object {
        [pscustomobject]@{
            path = $_.FullName.Substring($applicationStage.Length + 1).Replace('\', '/')
            bytes = $_.Length
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
        }
    }
}
$applicationManifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $applicationStage 'PACKAGE-MANIFEST.json') -Encoding UTF8
$applicationZip = Join-Path $releaseOutputRoot "$applicationFolderName.zip"
Compress-Archive -LiteralPath $applicationStage -DestinationPath $applicationZip -CompressionLevel Optimal

$skillNames = Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'skills') -Directory | Select-Object -ExpandProperty Name
foreach ($skillName in $skillNames) {
    Compress-Archive -LiteralPath (Join-Path $repositoryRoot "skills\$skillName") -DestinationPath (Join-Path $skillOutput "$skillName-codex-v$SkillVersion.zip") -CompressionLevel Optimal
    Compress-Archive -LiteralPath (Join-Path $repositoryRoot "workbuddy-skills\$skillName") -DestinationPath (Join-Path $skillOutput "$skillName-workbuddy-v$SkillVersion.zip") -CompressionLevel Optimal
}

Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'skills') -Directory | Select-Object -ExpandProperty FullName) -DestinationPath (Join-Path $skillOutput "evidence-workbench-skills-codex-v$SkillVersion.zip") -CompressionLevel Optimal
Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'workbuddy-skills') -Directory | Select-Object -ExpandProperty FullName) -DestinationPath (Join-Path $skillOutput "evidence-workbench-skills-workbuddy-v$SkillVersion.zip") -CompressionLevel Optimal

$artifacts = Get-ChildItem -LiteralPath $releaseOutputRoot -File -Recurse -Filter '*.zip'
$checksumPath = Join-Path $releaseOutputRoot 'SHA256SUMS.txt'
$artifacts | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($releaseOutputRoot.Length + 1).Replace('\', '/')
    "$((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant())  $relative"
} | Set-Content -LiteralPath $checksumPath -Encoding UTF8

[pscustomobject]@{
    version = $Version
    application = $applicationZip
    skillArchives = (Get-ChildItem -LiteralPath $skillOutput -Filter '*.zip').Count
    checksums = $checksumPath
} | ConvertTo-Json -Depth 4
