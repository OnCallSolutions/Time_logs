param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Arguments
)

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
try {
  & node "tools/inspect-neon.mjs" @Arguments
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
finally {
  Pop-Location
}
