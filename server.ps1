$port = if ($env:PORT) { [int]$env:PORT } else { 8095 }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try {
    $listener.Start()
    Write-Output "Server started on http://localhost:$port/"
    [Console]::Out.Flush()
    while ($listener.IsListening) {
        try {
            $context = $listener.GetContext()
            $request = $context.Request
            $response = $context.Response

            $localPath = $request.Url.LocalPath.TrimStart('/')
            if ($localPath -eq "" -or $localPath -eq "/") { $localPath = "index.html" }

            $filePath = Join-Path (Get-Location) $localPath
            Write-Output "Request: $localPath -> $filePath"

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
                    default { "application/octet-stream" }
                }
                $content = [System.IO.File]::ReadAllBytes($filePath)
                $response.ContentType = $contentType
                $response.ContentLength64 = $content.Length
                $response.OutputStream.Write($content, 0, $content.Length)
                $response.StatusCode = 200
            } else {
                Write-Output "404 Not Found: $filePath"
                $response.StatusCode = 404
            }
            $response.Close()
        } catch {
            Write-Output "Request error: $_"
            try { $response.Close() } catch {}
        }
    }
} catch {
    Write-Output "ERROR: Failed to start listener on port $port - $_"
    [Console]::Out.Flush()
    exit 1
} finally {
    try { $listener.Stop() } catch {}
}
