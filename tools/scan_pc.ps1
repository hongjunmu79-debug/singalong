param([string]$Out = "tools\pc_audio.txt", [int]$MaxLines = 4000)

$ErrorActionPreference = 'SilentlyContinue'
$ext = @('.mp3', '.flac', '.m4a', '.ape', '.ogg', '.aac', '.wma', '.opus', '.wav')

$roots = @(
  'D:\',
  "$env:USERPROFILE\Music",
  "$env:USERPROFILE\Downloads",
  "$env:USERPROFILE\Desktop",
  "$env:USERPROFILE\Documents",
  'C:\Users\Public\Music'
)

$lines = New-Object System.Collections.Generic.List[string]
$byDir = @{}
$count = 0
$bytes = [int64]0
$truncated = $false

foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  $lines.Add('### ' + $root)

  $found = Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $ext -contains $_.Extension.ToLower() }

  foreach ($f in $found) {
    $count++
    $bytes += $f.Length
    $d = $f.DirectoryName
    if ($byDir.ContainsKey($d)) { $byDir[$d]++ } else { $byDir[$d] = 1 }
    if ($lines.Count -lt $MaxLines) {
      $lines.Add($f.FullName + ' | ' + [math]::Round($f.Length / 1MB, 2) + ' MB')
    } else {
      $truncated = $true
    }
  }
}

$summary = New-Object System.Collections.Generic.List[string]
$summary.Add('TOTAL FILES: ' + $count)
$summary.Add('TOTAL SIZE GB: ' + [math]::Round($bytes / 1GB, 2))
$summary.Add('TRUNCATED: ' + $truncated)
$summary.Add('')
$summary.Add('=== TOP DIRECTORIES ===')
$byDir.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 25 | ForEach-Object {
  $summary.Add($_.Value.ToString().PadLeft(6) + '  ' + $_.Key)
}
$summary.Add('')
$summary.Add('=== FILES ===')
$summary.AddRange($lines)

$full = Join-Path (Get-Location).Path $Out
[System.IO.File]::WriteAllLines($full, $summary, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ('DONE files=' + $count + ' gb=' + [math]::Round($bytes / 1GB, 2))
