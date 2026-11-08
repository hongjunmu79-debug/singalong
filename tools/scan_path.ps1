param(
  [string]$Chain = "",
  [int]$MaxDepth = 3,
  [string]$Out = "tools\phone_scan.txt"
)

$ErrorActionPreference = 'Continue'
$lines = New-Object System.Collections.Generic.List[string]

$shell = New-Object -ComObject Shell.Application
$pc = $shell.NameSpace(17)
$phone = $pc.Items() | Where-Object { $_.Name -like 'HUAWEI*' } | Select-Object -First 1
if (-not $phone) { $lines.Add('NO_PHONE') } else {

  $hops = @()
  if ($Chain.Trim().Length -gt 0) { $hops = $Chain.Split('>') }

  $node = @($phone.GetFolder.Items() | Where-Object { $_.IsFolder }) | Select-Object -First 1
  $lines.Add('ROOT: ' + $node.Name)
  foreach ($h in $hops) {
    $f = $node.GetFolder
    if ($null -eq $f) { $lines.Add('FAIL: cannot open ' + $node.Name); break }
    $next = @($f.Items() | Where-Object { $_.IsFolder -and $_.Name -ieq $h }) | Select-Object -First 1
    if ($null -eq $next) {
      $lines.Add('FAIL: ' + $h + ' not found under ' + $node.Name)
      $lines.Add('  available: ' + ((@($f.Items() | Where-Object { $_.IsFolder }) | ForEach-Object { $_.Name }) -join ' | '))
      break
    }
    $node = $next
  }
  $lines.Add('START: ' + $node.Name)

  $audioExt = @('.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac', '.ape', '.wma', '.opus')
  $script:totalAudio = 0

  function Walk($item, $depth) {
    if ($depth -ge $MaxDepth) { return }
    $folder = $item.GetFolder
    if ($null -eq $folder) { return }

    $audio = @()
    $dirs = @()
    foreach ($i in @($folder.Items())) {
      if ($i.IsFolder) { $dirs += $i }
      else {
        $ext = [System.IO.Path]::GetExtension($i.Name).ToLower()
        if ($audioExt -contains $ext) { $audio += $i }
      }
    }

    $pad = '    ' * $depth
    if ($audio.Count -gt 0) {
      $script:totalAudio += $audio.Count
      $script:lines.Add($pad + '[' + $item.Name + ']  audio=' + $audio.Count)
      $audio | Select-Object -First 3 | ForEach-Object { $script:lines.Add($pad + '  - ' + $_.Name) }
    }
    foreach ($d in $dirs) {
      $script:lines.Add($pad + '+ ' + $d.Name)
      Walk $d ($depth + 1)
    }
  }

  $script:lines = $lines
  Walk $node 0
  $lines.Add('TOTAL AUDIO IN SUBTREE: ' + $script:totalAudio)
}

$full = Join-Path (Get-Location).Path $Out
[System.IO.File]::WriteAllLines($full, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ('WROTE ' + $lines.Count + ' lines')
