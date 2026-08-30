$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 8766
$Url = "http://localhost:$Port/"
$IdleTimeoutSeconds = 18
$LastHeartbeat = [DateTime]::UtcNow

function Test-LocalPort {
    param([int]$Port)
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $c.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(250)) { return $false }
        $c.EndConnect($iar)
        return $true
    } catch {
        return $false
    } finally {
        $c.Close()
    }
}

function Open-Viewer {
    $candidates = @(
        "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:LocalAppData\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
    )

    foreach ($browser in $candidates) {
        if ($browser -and (Test-Path -LiteralPath $browser)) {
            Start-Process -FilePath $browser -ArgumentList $Url
            return
        }
    }

    Start-Process $Url
}

if (Test-LocalPort -Port $Port) {
    Open-Viewer
    exit 0
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)

function Get-MimeType {
    param([string]$Path)
    switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        ".html" { "text/html; charset=utf-8" }
        ".css"  { "text/css; charset=utf-8" }
        ".js"   { "application/javascript; charset=utf-8" }
        ".json" { "application/json; charset=utf-8" }
        ".png"  { "image/png" }
        ".jpg"  { "image/jpeg" }
        ".jpeg" { "image/jpeg" }
        ".svg"  { "image/svg+xml" }
        ".ico"  { "image/x-icon" }
        default { "application/octet-stream" }
    }
}

function Send-Response {
    param(
        [System.Net.Sockets.NetworkStream]$Stream,
        [int]$StatusCode,
        [string]$StatusText,
        [string]$Mime,
        [byte[]]$Body
    )

    $header = "HTTP/1.1 $StatusCode $StatusText`r`n" +
              "Content-Type: $Mime`r`n" +
              "Content-Length: $($Body.Length)`r`n" +
              "Cache-Control: no-store`r`n" +
              "Connection: close`r`n`r`n"

    $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Body.Length -gt 0) {
        $Stream.Write($Body, 0, $Body.Length)
    }
    $Stream.Flush()
}

try {
    $listener.Start()
    Start-Sleep -Milliseconds 200
    Open-Viewer
    $LastHeartbeat = [DateTime]::UtcNow

    while ($true) {
        if ($listener.Pending()) {
            $client = $listener.AcceptTcpClient()
            try {
                $stream = $client.GetStream()
                $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 4096, $true)

                $requestLine = $reader.ReadLine()
                if ([string]::IsNullOrWhiteSpace($requestLine)) {
                    continue
                }

                while ($true) {
                    $line = $reader.ReadLine()
                    if ($null -eq $line -or $line -eq "") { break }
                }

                $parts = $requestLine.Split(" ")
                if ($parts.Length -lt 2 -or $parts[0] -ne "GET") {
                    $body = [Text.Encoding]::UTF8.GetBytes("Method Not Allowed")
                    Send-Response $stream 405 "Method Not Allowed" "text/plain; charset=utf-8" $body
                    continue
                }

                $target = $parts[1].Split("?")[0]
                $target = [Uri]::UnescapeDataString($target)

                if ($target -eq "/__heartbeat") {
                    $LastHeartbeat = [DateTime]::UtcNow
                    Send-Response $stream 204 "No Content" "text/plain; charset=utf-8" ([byte[]]@())
                    continue
                }

                if ($target -eq "/") { $target = "/index.html" }

                $relative = $target.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
                $fullPath = [IO.Path]::GetFullPath((Join-Path $Root $relative))
                $rootPath = [IO.Path]::GetFullPath($Root + [IO.Path]::DirectorySeparatorChar)

                if (-not $fullPath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
                    $body = [Text.Encoding]::UTF8.GetBytes("Forbidden")
                    Send-Response $stream 403 "Forbidden" "text/plain; charset=utf-8" $body
                    continue
                }

                if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
                    $body = [Text.Encoding]::UTF8.GetBytes("Not Found")
                    Send-Response $stream 404 "Not Found" "text/plain; charset=utf-8" $body
                    continue
                }

                $LastHeartbeat = [DateTime]::UtcNow
                $body = [IO.File]::ReadAllBytes($fullPath)
                $mime = Get-MimeType -Path $fullPath
                Send-Response $stream 200 "OK" $mime $body
            } catch {
                # Ignore malformed or aborted local requests.
            } finally {
                if ($client) { $client.Close() }
            }
        } else {
            $idle = ([DateTime]::UtcNow - $LastHeartbeat).TotalSeconds
            if ($idle -ge $IdleTimeoutSeconds) {
                break
            }
            Start-Sleep -Milliseconds 200
        }
    }
}
finally {
    if ($listener) { $listener.Stop() }
}
