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
    Write-Host "Server started on http://localhost:$port/"
    [Console]::Out.Flush()
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $localPath = $request.Url.LocalPath.TrimStart('/')
        if ($localPath -eq "" -or $localPath -eq "/") { $localPath = "index.html" }

        $filePath = Join-Path (Get-Location) $localPath

        if (Test-Path $filePath -PathType Leaf) {
            $extension = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = switch ($extension) {
                ".html" { "text/html" }
                ".css" { "text/css" }
                ".js" { "application/javascript" }
                ".png" { "image/png" }
                ".jpg" { "image/jpeg" }
                ".svg" { "image/svg+xml" }
                ".ico" { "image/x-icon" }
                ".json" { "application/json" }
                default { "application/octet-stream" }
            }

            $content = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $content.Length
            $response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $response.StatusCode = 404
        }
        $response.Close()
    }
} finally {
    if ($listener -and $listener.IsListening) {
        $listener.Stop()
    }
}
