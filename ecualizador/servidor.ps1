# Ecualizador Libre - servidor local minimo (solo localhost) para abrir la app en Chrome o Edge.
# No necesita internet ni permisos de administrador. Cierra esta ventana para apagarlo.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootFull = [IO.Path]::GetFullPath($root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar

function Find-Browser {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { return $c }
  }
  return $null
}

function Open-App([string]$url) {
  try {
    $browser = Find-Browser
    if ($browser) { Start-Process -FilePath $browser -ArgumentList @("--app=$url") }
    else { Start-Process $url }
  } catch {
    Write-Host "  No se pudo abrir el navegador automaticamente. Abre Chrome o Edge en: $url"
  }
}

$listener = $null
$port = 0
foreach ($p in 8765..8795) {
  $l = New-Object System.Net.HttpListener
  try {
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l
    $port = $p
    break
  } catch {
    try { $l.Close() } catch { }
  }
}

if (-not $listener) {
  Write-Host 'No se pudo iniciar el servidor local. Abriendo el archivo directamente...'
  Open-App ([Uri](Join-Path $root 'index.html')).AbsoluteUri
  exit 0
}

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
}

$url = "http://localhost:$port/"
Write-Host ''
Write-Host "  Ecualizador Libre funcionando en $url"
Write-Host '  Deja esta ventana abierta (puedes minimizarla). Cierrala para apagar el ecualizador.'
Write-Host ''
Open-App $url

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if ($full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      $type = $mime[[IO.Path]::GetExtension($full).ToLowerInvariant()]
      if (-not $type) { $type = 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($full)
      $res.StatusCode = 200
      $res.ContentType = $type
    } else {
      $bytes = [Text.Encoding]::UTF8.GetBytes('No encontrado')
      $res.StatusCode = 404
      $res.ContentType = 'text/plain; charset=utf-8'
    }
    $res.Headers['Cache-Control'] = 'no-store'
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    try { $res.StatusCode = 500 } catch { }
  } finally {
    try { $res.OutputStream.Close() } catch { }
  }
}
