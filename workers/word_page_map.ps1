param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$ForensicPath
)

$ErrorActionPreference = "Stop"
$word = $null
$document = $null
$mapped = 0
$unmapped = 0

function Release-ComObject([object]$Value) {
  if ($null -ne $Value -and [System.Runtime.InteropServices.Marshal]::IsComObject($Value)) {
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value)
  }
}

function Search-Text([object]$Block) {
  if ($Block.type -eq "table" -and $null -ne $Block.rows) {
    foreach ($row in $Block.rows) {
      foreach ($cell in $row) {
        $candidate = [string]$cell.text
        if (-not [string]::IsNullOrWhiteSpace($candidate)) { return $candidate }
      }
    }
  }
  return [string]$Block.text
}

try {
  $forensic = Get-Content -Encoding UTF8 -Raw -LiteralPath $ForensicPath | ConvertFrom-Json
  if ($forensic.kind -ne "docx") {
    [pscustomobject]@{ ok = $true; status = "not_applicable" } | ConvertTo-Json -Compress
    exit 0
  }

  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.Documents.Open($InputPath, $false, $true)
  $document.Repaginate()
  $cursor = 0
  $documentEnd = $document.Content.End

  foreach ($block in $forensic.blocks) {
    $raw = (Search-Text $block) -replace "[\r\n\t]+", " " -replace "\s+", " "
    $raw = $raw.Trim()
    if ([string]::IsNullOrWhiteSpace($raw)) { continue }
    $needle = $raw.Substring(0, [Math]::Min(100, $raw.Length))
    $range = $null
    $finder = $null
    try {
      $range = $document.Range($cursor, $documentEnd)
      $finder = $range.Find
      $finder.ClearFormatting()
      $finder.Text = $needle
      $finder.Forward = $true
      $finder.Wrap = 0
      $finder.MatchCase = $false
      $finder.MatchWildcards = $false
      $found = $finder.Execute()
      if (-not $found -and $needle.Length -gt 32) {
        Release-ComObject $finder
        Release-ComObject $range
        $range = $document.Range($cursor, $documentEnd)
        $finder = $range.Find
        $finder.ClearFormatting()
        $finder.Text = $needle.Substring(0, 32)
        $finder.Forward = $true
        $finder.Wrap = 0
        $finder.MatchCase = $false
        $finder.MatchWildcards = $false
        $found = $finder.Execute()
      }
      if ($found) {
        $page = [int]$range.Information(3)
        $block.location | Add-Member -NotePropertyName page -NotePropertyValue $page -Force
        $block.location | Add-Member -NotePropertyName pageSource -NotePropertyValue "word-layout" -Force
        $cursor = [Math]::Max($cursor, [int]$range.End)
        $mapped += 1
      } else {
        $unmapped += 1
      }
    } finally {
      Release-ComObject $finder
      Release-ComObject $range
    }
  }

  $pageCount = [int]$document.ComputeStatistics(2)
  if ($null -eq $forensic.statistics) { $forensic | Add-Member -NotePropertyName statistics -NotePropertyValue ([pscustomobject]@{}) -Force }
  $forensic.statistics | Add-Member -NotePropertyName pages -NotePropertyValue $pageCount -Force
  $forensic.statistics | Add-Member -NotePropertyName pageMappedBlocks -NotePropertyValue $mapped -Force
  $forensic.statistics | Add-Member -NotePropertyName pageUnmappedBlocks -NotePropertyValue $unmapped -Force
  $json = $forensic | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($ForensicPath, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
  [pscustomobject]@{ ok = $true; status = "mapped"; pages = $pageCount; mapped = $mapped; unmapped = $unmapped } | ConvertTo-Json -Compress
} finally {
  if ($null -ne $document) { $document.Close(0) }
  if ($null -ne $word) { $word.Quit() }
  Release-ComObject $document
  Release-ComObject $word
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
