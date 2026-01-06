param(
  [string]$Root=".",
  [string]$Out="project_dump_core.txt",
  [int]$MaxBytes=12000000,

  # Core is default; pass -Mode Extended to include more
  [ValidateSet("Core","Extended")]
  [string]$Mode="Core",

  # Reduce whitespace tokens in content
  [switch]$MinifyContent,

  # If something looks like a key/token, mask it in output
  [switch]$RedactSecrets,

  # Silence console noise
  [switch]$Quiet
)

$ErrorActionPreference="Stop"

# Make console output UTF-8 too (helps if you print paths/content)
try {
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [Console]::OutputEncoding = $utf8NoBom
  $OutputEncoding = $utf8NoBom
} catch {}

# Resolve paths (PS 5.1 compatible)
$RootPath = (Resolve-Path $Root).Path
if ([System.IO.Path]::IsPathRooted($Out)) { $OutPath = $Out } else { $OutPath = Join-Path $RootPath $Out }

$ignoreDirs = @(".git","node_modules","dist","build",".venv",".idea",".vscode",".next",".turbo","coverage","__pycache__",".pytest_cache")

# Hard “never dump” patterns (filenames)
$neverDumpNameLike = @(
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "*.sqlite",
  "*.sqlite-wal",
  "*.sqlite-shm",
  "*.log",
  "*.pem",
  "*.pfx",
  "*.p12",
  "*.key",
  "*.cer",
  "*.crt",
  "*.env",
  ".env",
  ".env.*",
  "*secret*",
  "*token*",
  "*api*key*",
  "*apikey*",
  "*openai*key*",
  "*sk-*"
)

# Text-like extensions
$textExts = @(
  ".js",".ts",".tsx",".jsx",
  ".json",".yml",".yaml",".toml",".xml",
  ".html",".css",".md",".txt",
  ".ps1",".sh",".ini",".cfg"
)

function Should-IgnorePath([string]$relPath) {
  $segments = $relPath -split '[\\/]'
  if ($segments | Where-Object { $ignoreDirs -contains $_ }) { return $true }
  return $false
}

function Name-MatchesAny([string]$name, [string[]]$patterns) {
  foreach ($p in $patterns) { if ($name -like $p) { return $true } }
  return $false
}

# CORE whitelist (relative paths / globs)
$coreAllow = @(
  # root
  "package.json",

  # frontend
  "frontend/package.json",
  "frontend/index.html",
  "frontend/vite.config.*",
  "frontend/tsconfig*.json",
  "frontend/eslint.config.js",
  "frontend/postcss.config.js",
  "frontend/tailwind.config.*",
  "frontend/src/**/*"

  # backend (typical TS layout)
  "backend/package.json",
  "backend/tsconfig*.json",
  "backend/src/**/*"
)

# EXTENDED additions: everything text-like inside frontend/ and backend/
$extendedAllow = @(
  "frontend/**",
  "backend/**"
)

function RelPath-MatchesWhitelist([string]$relPath, [string[]]$whitelist) {
  # Normalize to forward slashes for consistent matching
  $p = ($relPath -replace "\\","/")

  foreach ($w in $whitelist) {
    $wp = ($w -replace "\\","/")

    # Very small glob support: **/ and * patterns via -like
    # Convert **/ to * and keep as -like (good enough for our use)
    $likePattern = $wp -replace "\*\*/","*"
    if ($p -like $likePattern) { return $true }
  }
  return $false
}

function Minify-Text([string]$s){
  if($null -eq $s){ return "" }
  $s = $s -replace "`r`n","`n"
  # trim trailing spaces per line
  $s = [regex]::Replace($s, "[ \t]+(?=`n)", "")
  # collapse 3+ newlines to 2
  $s = [regex]::Replace($s, "`n{3,}", "`n`n")
  return $s.Trim("`n")
}

function Redact-Text([string]$s){
  if($null -eq $s){ return "" }

  # Mask OpenAI-style keys like sk-... or sk-proj-...
  $s = [regex]::Replace($s, '(sk-(?:proj-)?)[A-Za-z0-9_\-]{10,}', '$1***REDACTED***')

  # Mask lines like: apiKey=..., api-key: "...", API_KEY=...
  $s = [regex]::Replace(
    $s,
    '(?im)\b(api[_-]?key)\b(\s*[:=]\s*)(["' + "'" + ']?)[^\s"'';]{8,}\3',
    '$1$2$3***REDACTED***$3'
  )

  # Mask Authorization: Bearer ...
  $s = [regex]::Replace(
    $s,
    '(?im)\b(authorization)\b(\s*[:=]\s*bearer\s+)[A-Za-z0-9\-\._~\+/]+=*',
    '$1$2***REDACTED***'
  )

  # Mask OPENAI_API_KEY style explicitly too
  $s = [regex]::Replace(
    $s,
    '(?im)\b(openai[_-]?api[_-]?key)\b(\s*[:=]\s*)(["' + "'" + ']?)[^\s"'';]{8,}\3',
    '$1$2$3***REDACTED***$3'
  )

  return $s
}

function Read-TextFileSmart([string]$path) {
  # Read raw bytes then decode in a way that avoids mojibake:
  # - If BOM exists, respect it.
  # - Else try UTF-8 strict; if it fails, fall back to Windows-1252.
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    return [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
  }
  if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
    return [System.Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2) # UTF-16 LE
  }
  if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF) {
    return [System.Text.Encoding]::BigEndianUnicode.GetString($bytes, 2, $bytes.Length - 2) # UTF-16 BE
  }

  try {
    $utf8Strict = [System.Text.UTF8Encoding]::new($false, $true) # throw on invalid bytes
    return $utf8Strict.GetString($bytes)
  } catch {
    # Fallback for legacy-encoded files (common on Windows)
    $cp1252 = [System.Text.Encoding]::GetEncoding(1252)
    return $cp1252.GetString($bytes)
  }
}

# Build whitelist
$whitelist = @()
$whitelist += $coreAllow
if ($Mode -eq "Extended") { $whitelist += $extendedAllow }

if(-not $Quiet){
  Write-Host "Root:   $RootPath"
  Write-Host "Out:    $OutPath"
  Write-Host "Mode:   $Mode"
}

# Write output file as UTF-8 (no BOM) via StreamWriter
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$dir = Split-Path -Parent $OutPath
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$sw = New-Object System.IO.StreamWriter($OutPath, $false, $utf8NoBom)
try {
  Get-ChildItem -Path $RootPath -Recurse -File | ForEach-Object {
    $file = $_
    if ($file.FullName -eq $OutPath) { return }

    $relPath = $file.FullName.Substring($RootPath.Length).TrimStart('\','/')
    if (Should-IgnorePath $relPath) { return }

    if ($file.Length -gt $MaxBytes) { return }

    $ext = $file.Extension.ToLowerInvariant()
    if (-not ($textExts -contains $ext)) { return }

    # Never dump name patterns
    if (Name-MatchesAny $file.Name $neverDumpNameLike) { return }

    # Whitelist enforcement
    if (-not (RelPath-MatchesWhitelist $relPath $whitelist)) { return }

    $content = Read-TextFileSmart -path $file.FullName
    if ($MinifyContent) { $content = Minify-Text $content }
    if ($RedactSecrets) { $content = Redact-Text $content }

    # Ultra-compact framing
    # @@@path\n<content>\n@@@\n
    $sw.Write(("@@@{0}`n{1}`n@@@`n" -f $relPath, $content))

    if(-not $Quiet){ Write-Host "Included: $relPath" }
  }
}
finally {
  $sw.Flush()
  $sw.Dispose()
}

if(-not $Quiet){ Write-Host "Wrote: $OutPath" }
