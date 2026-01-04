$ErrorActionPreference = "Stop"

$API = "http://localhost:3001"

$MY_COUNT = 8
$OTHER_COUNT = 40

$species = @("Guppy","Betta","Discus","Angelfish","Neon Tetra","Cherry Shrimp","Corydoras")
$locations = @("Brisbane","Gold Coast","Sydney","Melbourne","Perth","Adelaide")
$categories = @("Fish","Shrimp","Snails","Plants","Equipment")

$myTokens = @{}

# Track used commons files across the whole seeding run (reduces repeats across listings)
$script:UsedCommonsFiles = New-Object 'System.Collections.Generic.HashSet[string]'

function RandFrom($arr) {
  return $arr | Get-Random
}

function GetStockImages(
  [string]$species,
  [int]$min = 1,
  [int]$max = 3
) {
  if ($max -lt $min) { $max = $min }
  $count = Get-Random -Minimum $min -Maximum ($max + 1)

  # Candidate search terms per species (not filenames) so we can fetch real, existing files.
  $queryMap = @{
    "Guppy"         = @("Poecilia reticulata", "guppy aquarium fish")
    "Betta"         = @("Betta splendens", "Siamese fighting fish")
    "Discus"        = @("Symphysodon discus", "discus fish aquarium")
    "Angelfish"     = @("Pterophyllum scalare", "freshwater angelfish")
    "Neon Tetra"    = @("Paracheirodon innesi", "neon tetra aquarium")
    "Cherry Shrimp" = @("Neocaridina davidi", "red cherry shrimp aquarium")
    "Corydoras"     = @("Corydoras", "cory catfish aquarium")
  }

  $fallbackQueries = @("aquarium fish", "tropical fish", "freshwater fish", "aquarium shrimp", "aquarium plant")

  $queries = $queryMap[$species]
  if (-not $queries) { $queries = $fallbackQueries }

  function GetCommonsImageCandidates([string]$q, [int]$limit = 30) {
    # Uses Wikipedia API to search Commons (via "commonswiki")
    $u = "https://en.wikipedia.org/w/api.php" +
         "?action=query" +
         "&format=json" +
         "&origin=*" +
         "&generator=search" +
         "&gsrsearch=" + [uri]::EscapeDataString($q + " filetype:bitmap") +
         "&gsrlimit=" + $limit +
         "&gsrnamespace=6" +  # File:
         "&prop=imageinfo" +
         "&iiprop=url" +
         "&iilimit=1" +
         "&iiurlwidth=1600"

    try {
      $r = Invoke-RestMethod -Uri $u -Method GET -TimeoutSec 25
      if (-not $r.query.pages) { return @() }

      $out = New-Object System.Collections.Generic.List[object]
      foreach ($p in $r.query.pages.PSObject.Properties.Value) {
        $ii = $p.imageinfo
        if (-not $ii -or $ii.Count -lt 1) { continue }
        $info = $ii[0]

        # Prefer the "thumburl" (width-limited) for reliability; use original url if thumb missing.
        $url = $info.thumburl
        if (-not $url) { $url = $info.url }
        if (-not $url) { continue }

        # Use canonical file title to dedupe globally ("File:Something.jpg")
        $title = $p.title
        if (-not $title) { continue }

        # Filter out obvious non-photo formats sometimes returned (svg) even though bitmap filter helps.
        if ($url -match "\.svg($|\?)") { continue }

        $out.Add([pscustomobject]@{ title = $title; url = $url }) | Out-Null
      }
      return $out
    } catch {
      return @()
    }
  }

  # Build a candidate pool from multiple queries
  $pool = New-Object System.Collections.Generic.List[object]
  foreach ($q in $queries) {
    $c = GetCommonsImageCandidates $q 40
    foreach ($x in $c) { $pool.Add($x) | Out-Null }
    if ($pool.Count -ge 80) { break }
  }

  # If we still have too few, add fallbacks
  if ($pool.Count -lt ($count * 4)) {
    foreach ($q in $fallbackQueries) {
      $c = GetCommonsImageCandidates $q 40
      foreach ($x in $c) { $pool.Add($x) | Out-Null }
      if ($pool.Count -ge 120) { break }
    }
  }

  # Deduplicate pool by title
  $byTitle = @{}
  foreach ($x in $pool) {
    if (-not $byTitle.ContainsKey($x.title)) { $byTitle[$x.title] = $x.url }
  }

  $titles = @($byTitle.Keys)
  if ($titles.Count -eq 0) {
    # As a last resort (offline / API fail), return picsum unique seeds
    $urls = @()
    for ($i = 0; $i -lt $count; $i++) {
      $seed = [guid]::NewGuid().ToString()
      $urls += "https://picsum.photos/seed/$seed/1600/1200"
    }
    return ,$urls
  }

  # Choose unique images within the listing, preferring never-used globally
  $chosen = New-Object System.Collections.Generic.List[string]

  # First pass: pick globally-unused
  $shuffled = $titles | Get-Random -Count ([Math]::Min($titles.Count, 999999))
  foreach ($t in $shuffled) {
    if ($chosen.Count -ge $count) { break }
    if ($script:UsedCommonsFiles.Contains($t)) { continue }
    $script:UsedCommonsFiles.Add($t) | Out-Null
    $chosen.Add($byTitle[$t]) | Out-Null
  }

  # Second pass: if not enough, allow repeats globally but still unique within listing
  if ($chosen.Count -lt $count) {
    foreach ($t in $shuffled) {
      if ($chosen.Count -ge $count) { break }
      $u = $byTitle[$t]
      if ($chosen.Contains($u)) { continue }
      $chosen.Add($u) | Out-Null
    }
  }

  # Final guard: if still short, fill with unique picsum
  while ($chosen.Count -lt $count) {
    $seed = [guid]::NewGuid().ToString()
    $chosen.Add("https://picsum.photos/seed/$seed/1600/1200") | Out-Null
  }

  return ,@($chosen.ToArray())
}

function NewListingBody([bool]$isMine) {
  $sp = RandFrom $species
  $cat = RandFrom $categories
  $price = Get-Random -Minimum 5 -Maximum 250

  $contact = if ($isMine) { "DM me here" } else { "SMS preferred" }

  $imgs = GetStockImages $sp 1 5

  return @{
    title       = "$sp - healthy stock"
    category    = $cat
    species     = $sp
    priceCents  = [int]($price * 100)
    location    = RandFrom $locations
    description = "Healthy, well-kept stock. Pickup preferred."
    contact     = $contact
    images      = $imgs     # <-- already an array
  }
}

Write-Host "Posting MY listings..."
for ($i = 1; $i -le $MY_COUNT; $i++) {
  $bodyObj = NewListingBody $true
  $json = $bodyObj | ConvertTo-Json -Depth 10

  # Optional sanity check
  # Write-Host $json

  $res = Invoke-RestMethod `
    -Uri ($API + "/api/listings") `
    -Method POST `
    -ContentType "application/json" `
    -Body $json

  $myTokens[$res.id] = $res.ownerToken
}

Write-Host "Posting OTHER listings..."
for ($i = 1; $i -le $OTHER_COUNT; $i++) {
  $bodyObj = NewListingBody $false
  $json = $bodyObj | ConvertTo-Json -Depth 10

  Invoke-RestMethod `
    -Uri ($API + "/api/listings") `
    -Method POST `
    -ContentType "application/json" `
    -Body $json | Out-Null
}

Write-Host ""
Write-Host ("Done. Seeded " + $MY_COUNT + " mine + " + $OTHER_COUNT + " others.")
Write-Host ""

$tokenJson = ($myTokens | ConvertTo-Json -Compress)

Write-Host "=== PASTE THIS INTO YOUR BROWSER CONSOLE ==="
Write-Host "localStorage.setItem('fish_owner_tokens_v1', '$tokenJson');"
Write-Host "=========================================="
