$p = Join-Path $PSScriptRoot '..\experiment\sample_drop\studio'
$p = [System.IO.Path]::GetFullPath($p)
Write-Output ('path=' + $p)
Write-Output ('exists=' + (Test-Path -LiteralPath $p))
Write-Output ('all_files=' + (Get-ChildItem -LiteralPath $p -File -ErrorAction SilentlyContinue | Measure-Object).Count)
Write-Output ('wav_filter=' + (Get-ChildItem -LiteralPath $p -File -Filter '*.wav' -ErrorAction SilentlyContinue | Measure-Object).Count)
Write-Output ('recurse_root=' + (Get-ChildItem -Path 'D:\*' -File -ErrorAction SilentlyContinue | Measure-Object).Count)

$incl = @('*.wav')
Write-Output ('include_test=' + (Get-ChildItem -Path (Join-Path 'D:\' '*') -Recurse -File -Include $incl -ErrorAction SilentlyContinue | Measure-Object).Count)
