param([string]$Deck, [string]$Mp4, [int]$SecondsPerSlide = 10, [int]$Height = 720)
# Render the deck (animations + transitions) to MP4 with the installed PowerPoint, for motion QA.
$ErrorActionPreference = "Stop"
$app = New-Object -ComObject PowerPoint.Application
try {
  $p = $app.Presentations.Open((Resolve-Path $Deck).Path, $true, $false, $false)
  if (Test-Path $Mp4) { Remove-Item $Mp4 -Force }
  # CreateVideo(FileName, UseTimingsAndNarrations, DefaultSlideDuration, VertResolution, FramesPerSecond, Quality)
  $p.CreateVideo($Mp4, $false, $SecondsPerSlide, $Height, 24, 85)
  while ($p.CreateVideoStatus -eq 1 -or $p.CreateVideoStatus -eq 2) { Start-Sleep -Milliseconds 500 }
  "status: " + $p.CreateVideoStatus
  $p.Close()
} finally { $app.Quit() }
