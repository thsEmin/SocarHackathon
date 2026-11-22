param([string]$Deck, [string]$OutDir, [int]$Width = 1600)
# Export every slide of $Deck to PNG with the installed PowerPoint (final state of each slide).
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $OutDir | Out-Null
Get-ChildItem $OutDir -Filter *.png | Remove-Item -Force
$wasRunning = [bool](Get-Process POWERPNT -ErrorAction SilentlyContinue)
$app = New-Object -ComObject PowerPoint.Application
try {
  $p = $app.Presentations.Open((Resolve-Path $Deck).Path, $true, $false, $false)   # read-only, no window
  $h = [int]($Width * 9 / 16)
  foreach ($s in $p.Slides) { $s.Export((Join-Path $OutDir ("slide{0}.png" -f $s.SlideIndex)), "PNG", $Width, $h) }
  $p.Close()
} finally {   # never close the user's open decks (Protected View windows are not in Presentations)
  if ($app.Presentations.Count -eq 0 -and $app.ProtectedViewWindows.Count -eq 0 -and -not $wasRunning) { $app.Quit() }
}
