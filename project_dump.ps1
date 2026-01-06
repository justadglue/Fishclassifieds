<#
project_dump.ps1
Creates a single text dump of your repo for pasting into ChatGPT.

Examples:
  .\project_dump.ps1 -Mode Extended
  .\project_dump.ps1 -Mode Extended -UltraMinify -Redact
  .\project_dump.ps1 -Mode Extended -UltraMinify -Redact -StripClassNames
  .\project_dump.ps1 -Mode Extended -UltraMinify -Redact -StripClassNames -OutPath .\dump.txt

Notes:
- UltraMinify is intentionally aggressive (it’s for dumping, not compiling).
- Redact removes common secrets/tokens/keys from the dump output.
- Compatible with Windows PowerShell 5.1+ (no ?? operator).

Change (safe-minify):
- UltraMinify no longer collapses internal whitespace or tightens punctuation spacing.
- This prevents breaking semantics and prevents destroying string literals like Tailwind className values.

Extreme option:
- StripClassNames removes class/className attributes from HTML/JSX/TSX.
  This WILL break styling and is for dump-size reduction only.
#>

[CmdletBinding()]
param(
  [ValidateSet("Basic","Extended")]
  [string]$Mode = "Basic",

  [string]$RootPath = (Get-Location).Path,

  [string]$OutPath = (Join-Path (Get-Location).Path "project_dump.txt"),

  [switch]$UltraMinify,

  [switch]$Redact,

  # EXTREME: removes className/class attributes from JSX/TSX/HTML to reduce dump size
  [switch]$StripClassNames,

  [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info {
  param([string]$Message)
  if (-not $Quiet) { Write-Host $Message }
}

function Write-Include {
  param([string]$RelPath)
  if (-not $Quiet) {
    Write-Host ("Included: {0}" -f $RelPath)
  }
}

function Normalize-RelPath {
  param(
    [Parameter(Mandatory=$true)][string]$FullPath,
    [Parameter(Mandatory=$true)][string]$Root
  )
  $rootNorm = [System.IO.Path]::GetFullPath($Root)
  $fullNorm = [System.IO.Path]::GetFullPath($FullPath)

  if ($fullNorm.StartsWith($rootNorm, [System.StringComparison]::OrdinalIgnoreCase)) {
    $rel = $fullNorm.Substring($rootNorm.Length).TrimStart('\','/')
    return $rel
  }

  return $FullPath
}

function Get-ExtensionLower {
  param([string]$Path)
  $ext = [System.IO.Path]::GetExtension($Path)
  if ($null -eq $ext) { $ext = "" }
  return $ext.ToLowerInvariant()
}

function Is-BinaryFileByExtension {
  param([string]$Path)
  $ext = Get-ExtensionLower -Path $Path

  $bin = @(
    ".png",".jpg",".jpeg",".gif",".webp",".bmp",".ico",
    ".zip",".7z",".rar",".tar",".gz",".bz2",
    ".exe",".dll",".pdb",".so",".dylib",
    ".pdf",".woff",".woff2",".ttf",".otf",
    ".mp4",".mov",".avi",".mkv",".mp3",".wav",
    ".db",".sqlite",".sqlite3",".db-wal",".db-shm",
    ".map"
  )
  return $bin -contains $ext
}

function Should-SkipPath {
  param(
    [Parameter(Mandatory=$true)][string]$FullPath,
    [Parameter(Mandatory=$true)][string]$RelPath
  )

  $lower = $RelPath.ToLowerInvariant()

  $dirExcludes = @(
    ".git\",
    "node_modules\",
    "dist\",
    "build\",
    "coverage\",
    ".turbo\",
    ".vite\",
    ".next\",
    ".cache\",
    "out\",
    "tmp\",
    "temp\",
    "logs\",
    "backend\data\uploads\",
    "backend\data\"
  )

  foreach ($d in $dirExcludes) {
    if ($lower.Contains($d)) { return $true }
  }

  $fileName = [System.IO.Path]::GetFileName($RelPath).ToLowerInvariant()
  $nameExcludes = @(
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    ".ds_store",
    "thumbs.db",
    "app.db",
    "app.db-wal",
    "app.db-shm"
  )
  if ($nameExcludes -contains $fileName) { return $true }

  if (Is-BinaryFileByExtension -Path $RelPath) { return $true }

  return $false
}

function Is-TextFileExtension {
  param([string]$Path)
  $ext = Get-ExtensionLower -Path $Path

  $textExts = @(
    ".txt",".md",".markdown",".json",".jsonc",".yaml",".yml",
    ".ts",".tsx",".js",".jsx",".mjs",".cjs",
    ".css",".scss",".less",".html",".htm",
    ".env",".example",
    ".sql",
    ".ps1",".psm1",".psd1",
    ".gitignore",".gitattributes",
    ".editorconfig",
    ".toml",".ini",".cfg",
    ".sh",".bash",".zsh",
    ".java",".kt",".go",".rs",".py",".cpp",".c",".h"
  )

  if ($textExts -contains $ext) { return $true }
  if ($ext -eq "") { return $true }
  return $false
}

function Read-FileTextSafe {
  param([Parameter(Mandatory=$true)][string]$Path)

  try {
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  } catch {
    try {
      return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::Default)
    } catch {
      return ""
    }
  }
}

function Try-MinifyJson {
  param([Parameter(Mandatory=$true)][AllowEmptyString()][string]$Text)

  $t = $Text
  if ($null -eq $t) { $t = "" }

  $t = $t -replace "^\uFEFF",""
  $t = $t -replace "`r`n","`n"
  $t = $t -replace "`r","`n"
  $t = $t.Trim()

  if ([string]::IsNullOrWhiteSpace($t)) { return "" }

  try {
    $node = [System.Text.Json.JsonDocument]::Parse($t)
    return $node.RootElement.GetRawText()
  } catch {
    return $null
  }
}

function Strip-ClassAttributes {
  param(
    [Parameter(Mandatory=$true)][AllowEmptyString()][string]$Text,
    [Parameter(Mandatory=$true)][string]$RelPath
  )

  $t = $Text
  if ($null -eq $t) { return "" }

  $ext = Get-ExtensionLower -Path $RelPath

  # Only touch JSX/TSX/HTML-ish files
  $isJsxLike = ($ext -in @(".tsx",".jsx"))
  $isHtmlLike = ($ext -in @(".html",".htm"))

  if (-not ($isJsxLike -or $isHtmlLike)) {
    return $t
  }

  # Normalize newlines (so Singleline patterns can remove multi-line attributes too)
  $t = $t -replace "^\uFEFF",""
  $t = $t -replace "`r`n","`n"
  $t = $t -replace "`r","`n"

  # JSX/TSX: remove className=...
  # Handles:
  #   className="..."
  #   className='...'
  #   className={`...`}
  #   className={"..."} / className={'...'}
  #   className={someExpression} (best-effort; may not handle deeply nested braces)
  if ($isJsxLike) {
    $t = [regex]::Replace(
      $t,
      '\s+className\s*=\s*(\{`[^`]*`\}|\{[^}]*\}|"[^"]*"|''[^'']*'')',
      '',
      [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
  }

  # HTML: remove class="..." / class='...'
  if ($isHtmlLike) {
    $t = [regex]::Replace(
      $t,
      '\s+class\s*=\s*(".*?"|''.*?'')',
      '',
      [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
  }

  return $t
}

function UltraMinify-Text {
  param(
    [Parameter(Mandatory=$true)][AllowEmptyString()][string]$Text,
    [Parameter(Mandatory=$true)][string]$RelPath
  )

  $ext = Get-ExtensionLower -Path $RelPath

  $t = $Text
  if ($null -eq $t) { $t = "" }

  $t = $t -replace "^\uFEFF",""
  $t = $t -replace "`r`n","`n"
  $t = $t -replace "`r","`n"

  # JSON: real minify (no newlines/spaces)
  if ($ext -eq ".json") {
    $min = Try-MinifyJson -Text $t
    if ($null -ne $min) { return $min }
  }

  # EXTREME size reduction for dump-only: remove class/className attributes
  if ($StripClassNames.IsPresent) {
    $t = Strip-ClassAttributes -Text $t -RelPath $RelPath
  }

  # Strip block comments for common languages (dump-only; still aggressive)
  if (@(".ts",".tsx",".js",".jsx",".mjs",".cjs",".css",".scss",".less",".c",".cpp",".h",".java",".kt",".go",".rs") -contains $ext) {
    $t = [regex]::Replace($t, "/\*.*?\*/", "", [System.Text.RegularExpressions.RegexOptions]::Singleline)
  }
  if (@(".ps1",".psm1",".psd1") -contains $ext) {
    $t = [regex]::Replace($t, "<#.*?#>", "", [System.Text.RegularExpressions.RegexOptions]::Singleline)
  }
  if (@(".html",".htm",".md",".markdown") -contains $ext) {
    $t = [regex]::Replace($t, "<!--.*?-->", "", [System.Text.RegularExpressions.RegexOptions]::Singleline)
  }

  $lines = $t -split "`n"
  $out = New-Object System.Collections.Generic.List[string]

  $isMarkdownLike = ($ext -in @(".md",".markdown",".txt"))

  foreach ($line in $lines) {
    $l = $line

    # Drop whole-line comments (language aware)
    if (@(".ps1",".psm1",".psd1") -contains $ext) {
      if ($l -match "^\s*#") { continue }
    } elseif ($ext -eq ".sql") {
      if ($l -match "^\s*--") { continue }
    } elseif (@(".yaml",".yml",".toml",".ini",".cfg") -contains $ext) {
      if ($l -match "^\s*#") { continue }
    } elseif (-not $isMarkdownLike) {
      if ($l -match "^\s*//") { continue }
    }

    # Trim ends + drop blanks (safe and preserves internal spaces)
    $l = $l.Trim()
    if ([string]::IsNullOrWhiteSpace($l)) { continue }

    # Inline comment stripping:
    # - JS/TS/JSX/TSX: DISABLED (unsafe without a real parser; can break URLs/regex/strings)
    # - SQL / PS / YAML-like: keep conservative stripping.
    if ($ext -eq ".sql") {
      $l = [regex]::Replace($l, "\s+--.*$", "")
      $l = $l.Trim()
      if ([string]::IsNullOrWhiteSpace($l)) { continue }
    } elseif (@(".ps1",".psm1",".psd1") -contains $ext) {
      $l = [regex]::Replace($l, "\s+#.*$", "")
      $l = $l.Trim()
      if ([string]::IsNullOrWhiteSpace($l)) { continue }
    } elseif (@(".yaml",".yml",".toml",".ini",".cfg") -contains $ext) {
      $l = [regex]::Replace($l, "\s+#.*$", "")
      $l = $l.Trim()
      if ([string]::IsNullOrWhiteSpace($l)) { continue }
    } elseif ($ext -eq ".py") {
      # Conservative: only strip " # ..." when there are no quotes before the #
      if ($l -notmatch "[`"']") {
        $l = [regex]::Replace($l, "\s+#.*$", "")
        $l = $l.Trim()
        if ([string]::IsNullOrWhiteSpace($l)) { continue }
      }
    }

    # IMPORTANT: do NOT collapse internal whitespace and do NOT tighten punctuation spacing.
    $out.Add($l)
  }

  return ($out -join "`n")
}

# --- Redaction rules (minimal / necessary-only) ---
# Goals:
#  - Always redact PEM private keys and Authorization: Bearer headers.
#  - Redact .env-style secret vars ONLY in .env* files (avoid substring false positives like MONKEY).
#  - Redact quoted apiKey/password/secret/token ONLY when the value looks credential-like (JWT / long token / key prefixes).

function Test-IsEnvFile {
  param([Parameter(Mandatory=$true)][string]$RelPath)
  $name = [System.IO.Path]::GetFileName($RelPath)
  if ($null -eq $name) { return $false }
  $lower = $name.ToLowerInvariant()
  return ($lower -eq ".env" -or $lower.StartsWith(".env."))
}

function Test-LooksLikeCredentialValue {
  param([Parameter(Mandatory=$true)][string]$Value)

  $v = $Value
  if ($null -eq $v) { return $false }
  $v = $v.Trim()
  if ($v.Length -lt 16) { return $false }

  if ($v -match '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') { return $true }
  if ($v -match '^(?i)(sk-|rk-|pk-|api_|key_)[A-Za-z0-9_\-]{10,}$') { return $true }

  if ($v.Length -ge 32 -and $v -notmatch '\s') {
    if ($v -match '^[A-Fa-f0-9]{32,}$') { return $true }
    if ($v -match '^[A-Za-z0-9+/=]{32,}$') { return $true }
    if ($v -match '^[A-Za-z0-9_-]{32,}$') { return $true }
  }

  return $false
}

$redactionRulesAlways = @(
  @{
    Name        = "Authorization Bearer"
    Pattern     = '(?i)(authorization\s*:\s*bearer\s+)([^\r\n\s]+)'
    Replacement = '$1<REDACTED>'
  },
  @{
    Name        = "PEM Private Key"
    Pattern     = '-----BEGIN (?:RSA )?PRIVATE KEY-----.*?-----END (?:RSA )?PRIVATE KEY-----'
    Replacement = '-----BEGIN PRIVATE KEY-----<REDACTED>-----END PRIVATE KEY-----'
  }
)

$redactionRuleEnvOnly = @{
  Name        = "Env var secrets (env files only)"
  Pattern     = '(?im)^(\s*(?:[A-Z0-9]+_)*(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CLIENT_SECRET)(?:_[A-Z0-9]+)*\s*=\s*)([^\r\n#]+)'
  Replacement = '$1<REDACTED>'
}

$quotedKeyPatterns = @(
  '(?i)(api[_-]?key)\s*[:=]\s*(["''])([^"''\r\n]+)\2',
  '(?i)(password)\s*[:=]\s*(["''])([^"''\r\n]+)\2',
  '(?i)(?:client[_-]?secret|secret)\s*[:=]\s*(["''])([^"''\r\n]+)\2',
  '(?i)(?:access[_-]?token|refresh[_-]?token|token)\s*[:=]\s*(["''])([^"''\r\n]+)\2'
)

function Apply-Redactions {
  param(
    [Parameter(Mandatory=$true)][AllowEmptyString()][string]$Text,
    [Parameter(Mandatory=$true)][string]$RelPath
  )

  $t = $Text
  if ($null -eq $t -or $t.Length -eq 0) { return "" }

  foreach ($rule in $redactionRulesAlways) {
    $t = [regex]::Replace(
      $t,
      $rule.Pattern,
      $rule.Replacement,
      [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
  }

  if (Test-IsEnvFile -RelPath $RelPath) {
    $t = [regex]::Replace(
      $t,
      $redactionRuleEnvOnly.Pattern,
      $redactionRuleEnvOnly.Replacement,
      [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
  }

  foreach ($pat in $quotedKeyPatterns) {
    $t = [regex]::Replace($t, $pat, {
      param($m)

      $groups = $m.Groups
      $val = $groups[$groups.Count - 1].Value
      $quote = $groups[$groups.Count - 2].Value

      if (Test-LooksLikeCredentialValue -Value $val) {
        $full = $m.Value
        return $full.Substring(0, $full.Length - $val.Length - $quote.Length) + "<REDACTED>" + $quote
      }

      return $m.Value
    })
  }

  return $t
}

function Collect-Files {
  param(
    [Parameter(Mandatory=$true)][string]$Root,
    [Parameter(Mandatory=$true)][string]$Mode
  )

  $rootFull = [System.IO.Path]::GetFullPath($Root)

  if (-not (Test-Path -LiteralPath $rootFull -PathType Container)) {
    throw "RootPath does not exist or is not a directory: $rootFull"
  }

  $basicAllowNames = @(
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "vite.config.js",
    "tailwind.config.js",
    "tailwind.config.ts",
    "postcss.config.js",
    "postcss.config.cjs",
    "eslint.config.js",
    ".eslintrc",
    ".eslintrc.json",
    ".prettierrc",
    ".prettierrc.json",
    "readme.md",
    ".env.example"
  )

  $files = Get-ChildItem -Path $rootFull -Recurse -File -Force

  $picked = New-Object System.Collections.Generic.List[System.IO.FileInfo]
  foreach ($f in $files) {
    $rel = Normalize-RelPath -FullPath $f.FullName -Root $rootFull

    if (Should-SkipPath -FullPath $f.FullName -RelPath $rel) { continue }
    if (-not (Is-TextFileExtension -Path $rel)) { continue }

    if ($Mode -eq "Basic") {
      $name = $f.Name.ToLowerInvariant()
      $relLower = $rel.ToLowerInvariant()

      $isAllowedByName = $basicAllowNames -contains $name
      $isAllowedByFolder =
        $relLower.StartsWith("backend\src\") -or
        $relLower.StartsWith("frontend\src\")

      if (-not ($isAllowedByName -or $isAllowedByFolder)) { continue }
    }

    $maxBytes = if ($Mode -eq "Extended") { 2MB } else { 512KB }
    if ($f.Length -gt $maxBytes) { continue }

    $picked.Add($f)
  }

  return $picked | Sort-Object FullName
}

function Build-MetaPrompt {
  param(
    [Parameter(Mandatory = $true)][string]$Mode,
    [Parameter(Mandatory = $true)][bool]$UltraMinifyEnabled,
    [Parameter(Mandatory = $true)][bool]$RedactEnabled,
    [Parameter(Mandatory = $true)][string]$RootFull,
    [Parameter(Mandatory = $true)][int]$FileCount
  )

  $meta = @()
  $meta += "META: Repo dump; multiple files concatenated."

  if ($UltraMinifyEnabled) {
    $meta += "META: DELIMITER: each file starts with '@@@<relative-path>' and continues until next '@@@' or EOF."
  } else {
    $meta += "META: DELIMITER: files wrapped by '===== FILE: <path> =====' and '===== END FILE ====='."
  }

  if ($RedactEnabled) {
    $meta += "META: '<REDACTED>' intentionally replaces secrets; it is NOT an error or missing code."
  } else {
    $meta += "META: Redaction=OFF. If you see any secrets/credentials/tokens/keys, point them out (file + snippet) so they can be redacted. If none, do not mention this."
  }

  $meta += "META: If any secrets appear unredacted, call them out explicitly (file + snippet) so they can be added to redaction rules. If none, do not mention this."
  $meta += "META: Do NOT claim truncation/incompleteness based on assistant-rendered excerpts (including '...' or apparent cutoff). Assume the user's dump is complete unless the dump text itself contains an unavoidable syntax break that blocks the requested task."
  $meta += "META: Only raise cutoff/truncation if it directly prevents answering the user’s question or generating correct drop-in code, and then specify exactly what needed content is missing and why it matters."
  $meta += ("META: Mode={0}; UltraMinify={1}; Redact={2}; Root={3}; FileCount={4}" -f $Mode, $UltraMinifyEnabled, $RedactEnabled, $RootFull, $FileCount)
  $meta += "META: The dump ends at '===== END FILES ====='. Any text after is a prompt about the dump above."
  $meta += "META: This dump is authoritative. Assume no prior context if not explicitly related to the prompt after the '===== END FILES ====='. Do not reference earlier discussions unless explicitly quoted here."

  return ($meta -join "`n")
}

# ---------- Main ----------
$rootFull = [System.IO.Path]::GetFullPath($RootPath)
$outFull  = [System.IO.Path]::GetFullPath($OutPath)

Write-Info ("Root:  {0}" -f $rootFull)
Write-Info ("Out:   {0}" -f $outFull)
Write-Info ("Mode:  {0}" -f $Mode)
Write-Info ("Flags: UltraMinify={0}, Redact={1}, StripClassNames={2}" -f $UltraMinify.IsPresent, $Redact.IsPresent, $StripClassNames.IsPresent)

$filesToDump = Collect-Files -Root $rootFull -Mode $Mode

$outDir = [System.IO.Path]::GetDirectoryName($outFull)
if (-not [string]::IsNullOrWhiteSpace($outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$sw = New-Object System.IO.StreamWriter($outFull, $false, $utf8NoBom)

try {
  $sw.NewLine = "`n"

  $metaPrompt = Build-MetaPrompt `
    -Mode $Mode `
    -UltraMinifyEnabled $UltraMinify.IsPresent `
    -RedactEnabled $Redact.IsPresent `
    -RootFull $rootFull `
    -FileCount $filesToDump.Count

  $sw.WriteLine($metaPrompt)
  $sw.WriteLine("")

  if (-not $UltraMinify) {
    $sw.WriteLine("===== PROJECT DUMP =====")
    $sw.WriteLine(("Root: {0}" -f $rootFull))
    $sw.WriteLine(("Mode: {0}" -f $Mode))
    $sw.WriteLine(("UltraMinify: {0}" -f $UltraMinify.IsPresent))
    $sw.WriteLine(("Redact: {0}" -f $Redact.IsPresent))
    $sw.WriteLine(("StripClassNames: {0}" -f $StripClassNames.IsPresent))
    $sw.WriteLine(("FileCount: {0}" -f $filesToDump.Count))
    $sw.WriteLine("===== BEGIN FILES =====")
    $sw.WriteLine("")
  }

  $first = $true
  foreach ($f in $filesToDump) {
    $rel = Normalize-RelPath -FullPath $f.FullName -Root $rootFull

    Write-Include -RelPath $rel

    $content = Read-FileTextSafe -Path $f.FullName
    if ($null -eq $content) { $content = "" }

    if ($UltraMinify) {
      $content = UltraMinify-Text -Text $content -RelPath $rel
      if ($null -eq $content) { $content = "" }
    }

    if ($Redact) {
      $content = Apply-Redactions -Text $content -RelPath $rel
      if ($null -eq $content) { $content = "" }
    }

    if ($UltraMinify) {
      if (-not $first) { $sw.WriteLine("") }
      $first = $false

      $sw.WriteLine(("@@@{0}" -f $rel))
      if (-not [string]::IsNullOrEmpty($content)) {
        $sw.WriteLine($content.Trim())
      }
    } else {
      $sw.WriteLine(("===== FILE: {0} =====" -f $rel))
      if (-not [string]::IsNullOrEmpty($content)) {
        $sw.WriteLine($content)
      }
      $sw.WriteLine("===== END FILE =====")
      $sw.WriteLine("")
    }
  }

  $sw.WriteLine("===== END FILES =====")
}
finally {
  $sw.Flush()
  $sw.Dispose()
}

if (-not $Quiet) {
  Write-Host ("Wrote: {0}" -f $outFull)
}
