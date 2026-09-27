param([int]$TokenId)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ErrorActionPreference = 'Stop'

if ($TokenId -lt 1) { throw 'usage: inspect-looper.ps1 -TokenId <tokenId>' }

$script:rpcs = @('https://mainnet.base.org', 'https://base.llamarpc.com', 'https://base-rpc.publicnode.com')
$script:contract = '0x1649CD37f4748807b4882FC48765bA0B2aFfa94a'

function Rpc {
  param([string]$Method, [object[]]$Params)
  $body = @{ jsonrpc = '2.0'; id = 1; method = $Method; params = $Params } | ConvertTo-Json -Depth 8 -Compress
  $lastErr = $null
  foreach ($u in $script:rpcs) {
    try {
      $resp = Invoke-RestMethod -Uri $u -Method Post -ContentType 'application/json' -Body $body
      if ($resp.error) { throw ($resp.error | ConvertTo-Json -Compress) }
      return $resp.result
    } catch { $lastErr = $_ }
  }
  throw $lastErr
}

function EthCall {
  param([string]$Data)
  Rpc 'eth_call' @(@{ to = $script:contract; data = $Data }, 'latest')
}

function TryCall {
  param([string]$Data)
  try { return (EthCall $Data) } catch { return '' }
}

function HexToText {
  param([string]$Hex)
  $h = $Hex -replace '^0x', ''
  if ($h.Length -eq 0) { return '' }
  if ($h.Length % 2 -ne 0) { $h = $h.Substring(0, $h.Length - 1) }
  $bytes = [byte[]]::new($h.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($h.Substring($i * 2, 2), 16) }
  [Text.Encoding]::UTF8.GetString($bytes)
}

function DecodeAbiString {
  param([string]$Hex)
  if (-not $Hex -or $Hex -eq '0x') { return '' }
  $d = $Hex -replace '^0x', ''
  if ($d.Length -ge 128) {
    $lenHex = $d.Substring(64, 64)
    if ($lenHex -match '^[0-9a-f]{64}$') {
      $len = [Convert]::ToInt32($lenHex, 16)
      if ($len -gt 0 -and $d.Length -ge (128 + $len * 2)) {
        return (HexToText ('0x' + $d.Substring(128, $len * 2)))
      }
    }
  }
  return (HexToText $Hex)
}

$code = Rpc 'eth_getCode' @($script:contract, 'latest')
if (-not $code -or $code.Length -le 2) { throw 'No contract code at this address on Base.' }

$idHex = $TokenId.ToString('x').PadLeft(64, '0')

$name = DecodeAbiString (TryCall '0x06fdde03')
$symbol = DecodeAbiString (TryCall '0x95d89b41')
$totalHex = TryCall '0x18160ddd'
$ownerHex = TryCall ('0x6352211e' + $idHex)
$uri721 = DecodeAbiString (TryCall ('0xc87b56dd' + $idHex))
$uri1155 = DecodeAbiString (TryCall ('0x0e89341c' + $idHex))
$contractUri = DecodeAbiString (TryCall '0xe8a3d485')

$total = if ($totalHex) { [Convert]::ToInt64(($totalHex -replace '^0x', ''), 16) } else { 'n/a' }
$owner = if ($ownerHex -and $ownerHex.Length -ge 42) { '0x' + $ownerHex.Substring($ownerHex.Length - 40) } else { 'n/a' }
$uri = if ($uri721) { $uri721 } else { $uri1155 }

"name        : $name"
"symbol      : $symbol"
"totalSupply : $total"
"ownerOf($TokenId): $owner"
"contractURI : $contractUri"

if (-not $uri) { throw "No tokenURI/uri returned for token $TokenId." }
"tokenURI    : $($uri.Substring(0, [Math]::Min(90, $uri.Length))) ... (total length $($uri.Length))"

$outDir = Join-Path $PSScriptRoot '..\artifacts'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if ($uri -like 'data:application/json;base64,*') {
  $b64 = $uri.Substring('data:application/json;base64,'.Length)
  $jsonText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
  $jsonPath = Join-Path $outDir "token-$TokenId.json"
  [IO.File]::WriteAllText($jsonPath, $jsonText)
  "wrote $jsonPath"
  $meta = $jsonText | ConvertFrom-Json
  foreach ($p in $meta.PSObject.Properties) {
    $sv = if ($p.Value -is [string]) { $p.Value } else { $p.Value | ConvertTo-Json -Compress -Depth 8 }
    $preview = if ($sv.Length -gt 80) { $sv.Substring(0, 80) + '...' } else { $sv }
    "  meta.$($p.Name) = $preview"
  }
  if ($meta.image -like 'data:image/svg+xml;base64,*') {
    $svg = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($meta.image.Substring('data:image/svg+xml;base64,'.Length)))
    $svgPath = Join-Path $outDir "token-$TokenId.svg"
    [IO.File]::WriteAllText($svgPath, $svg)
    "wrote $svgPath (svg length $($svg.Length))"
  } elseif ($meta.image -like 'data:image/svg+xml,*') {
    $svg = [Uri]::UnescapeDataString($meta.image.Substring('data:image/svg+xml,'.Length))
    $svgPath = Join-Path $outDir "token-$TokenId.svg"
    [IO.File]::WriteAllText($svgPath, $svg)
    "wrote $svgPath (svg length $($svg.Length))"
  }
} else {
  "tokenURI    : $uri"
}
