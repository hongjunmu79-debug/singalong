param([int]$MaxDepth = 2, [string]$Out = "tools\phone_scan.txt")

$ErrorActionPreference = 'Continue'
$lines = New-Object System.Collections.Generic.List[string]

$shell = New-Object -ComObject Shell.Application
$pc = $shell.NameSpace(17)
$phone = $pc.Items() | Where-Object { $_.Name -like 'HUAWEI*' } | Select-Object -First 1
if (-not $phone) {
  [System.IO.File]::WriteAllLines((Resolve-Path -LiteralPath ".").Path + "\" + $Out, @("NO_PHONE"), (New-Object System.Text.UTF8Encoding($false)))
  exit 1
}
$lines.Add("DEVICE: " + $phone.Name)

$audioExt = @('.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac', '.ape', '.wma', '.opus')

function Walk($item, $depth) {
  if ($depth -ge $MaxDepth) { return }
  $folder = $item.GetFolder
  if ($null -eq $folder) { return }

  $audio = @()
  $dirs = @()
  foreach ($i in @($folder.Items())) {
    if ($i.IsFolder) {
      $dirs += $i
    } else {
      $ext = [System.IO.Path]::GetExtension($i.Name).ToLower()
      if ($audioExt -contains $ext) { $audio += $i }
    }
  }

  $pad = '  ' * $depth
  if ($audio.Count -gt 0) {
    $lines.Add($pad + "[" + $item.Name + "]  audio=" + $audio.Count)
    $audio | Select-Object -First 3 | ForEach-Object { $lines.Add($pad + "  - " + $_.Name) }
  }
  foreach ($d in $dirs) {
    $lines.Add($pad + "+ " + $d.Name)
    Walk $d ($depth + 1)
  }
}

Walk $phone 0

$full = Join-Path (Get-Location).Path $Out
[System.IO.File]::WriteAllLines($full, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("WROTE " + $lines.Count + " lines to " + $full)
