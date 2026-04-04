$startPort = if ($env:PORT) { [int]$env:PORT } else { 8083 }

# Find an available port starting from startPort
$port = $startPort
$listener = $null

for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $test = New-Object System.Net.HttpListener
    $test.Prefixes.Add("http://localhost:$port/")
    try {
        $test.Start()
        $test.Stop()
        $test.Close()
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add("http://localhost:$port/")
        break
    } catch {
        $port++
    }
}

if (-not $listener) {
    Write-Error "Could not find available port starting from $startPort"
    exit 1
}

try {
    $listener.Start()
    Write-Output "Listening on http://localhost:$port/"
    Write-Host "Local:   http://localhost:$port/"
    [Console]::Out.Flush()
    while ($listener.IsListening) {
        try {
            $context = $listener.GetContext()
            $request = $context.Request
            $response = $context.Response

            $localPath = $request.Url.LocalPath.TrimStart('/')
            if ($localPath -eq "" -or $localPath -eq "/") { $localPath = "index.html" }

            $filePath = Join-Path (Get-Location) $localPath

            if (Test-Path $filePath -PathType Leaf) {
                $extension = [System.IO.Path]::GetExtension($filePath).ToLower()
                $contentType = switch ($extension) {
                    ".html" { "text/html; charset=utf-8" }
                    ".css"  { "text/css" }
                    ".js"   { "application/javascript" }
                    ".png"  { "image/png" }
                    ".jpg"  { "image/jpeg" }
                    ".svg"  { "image/svg+xml" }
                    ".ico"  { "image/x-icon" }
                    ".json" { "application/json" }
                    default { "application/octet-stream" }
                }
                $content = [System.IO.File]::ReadAllBytes($filePath)
                $response.ContentType = $contentType
                $response.ContentLength64 = $content.Length
                $response.OutputStream.Write($content, 0, $content.Length)
                $response.StatusCode = 200
            } else {
                $response.StatusCode = 404
            }
            $response.Close()
        } catch {
            Write-Output "Request error: $_"
            try { $response.Close() } catch {}
        }
    }
} finally {
    if ($listener -and $listener.IsListening) {
        $listener.Stop()
    }
}
