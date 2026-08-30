$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 8770
$Url = "http://localhost:$Port/"
$IdleTimeoutSeconds = 30
$LastHit = [DateTime]::UtcNow

function Test-LocalPort { param([int]$Port)
  $c=New-Object System.Net.Sockets.TcpClient
  try{$iar=$c.BeginConnect("127.0.0.1",$Port,$null,$null);if(-not $iar.AsyncWaitHandle.WaitOne(220)){return $false};$c.EndConnect($iar);return $true}catch{return $false}finally{$c.Close()}
}
function Open-Viewer {
  $candidates=@("$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe","$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe","$env:LocalAppData\Microsoft\Edge\Application\msedge.exe","$env:ProgramFiles\Google\Chrome\Application\chrome.exe","$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe","$env:LocalAppData\Google\Chrome\Application\chrome.exe")
  foreach($b in $candidates){if($b -and (Test-Path -LiteralPath $b)){Start-Process -FilePath $b -ArgumentList $Url;return}}
  Start-Process $Url
}
function Mime([string]$p){switch([IO.Path]::GetExtension($p).ToLowerInvariant()){'.html'{'text/html; charset=utf-8'}'.css'{'text/css; charset=utf-8'}'.js'{'application/javascript; charset=utf-8'}default{'application/octet-stream'}}}
function Send($stream,[int]$code,[string]$text,[string]$mime,[byte[]]$body){$h="HTTP/1.1 $code $text`r`nContent-Type: $mime`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n";$hb=[Text.Encoding]::ASCII.GetBytes($h);$stream.Write($hb,0,$hb.Length);if($body.Length){$stream.Write($body,0,$body.Length)};$stream.Flush()}
if(Test-LocalPort $Port){Open-Viewer;exit 0}
$listener=New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback,$Port)
try{$listener.Start();Start-Sleep -Milliseconds 180;Open-Viewer
  while($true){
    if($listener.Pending()){$client=$listener.AcceptTcpClient();try{$stream=$client.GetStream();$reader=New-Object IO.StreamReader($stream,[Text.Encoding]::ASCII,$false,4096,$true);$line=$reader.ReadLine();if(!$line){continue};while(($x=$reader.ReadLine()) -ne $null -and $x -ne ''){};$target=($line.Split(' ')[1]).Split('?')[0];if($target -eq '/__heartbeat'){$LastHit=[DateTime]::UtcNow;Send $stream 204 'No Content' 'text/plain' ([byte[]]@());continue};if($target -eq '/'){$target='/index.html'};$rel=[Uri]::UnescapeDataString($target).TrimStart('/').Replace('/',[IO.Path]::DirectorySeparatorChar);$full=[IO.Path]::GetFullPath((Join-Path $Root $rel));$base=[IO.Path]::GetFullPath($Root+[IO.Path]::DirectorySeparatorChar);if(-not $full.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){Send $stream 403 'Forbidden' 'text/plain' ([Text.Encoding]::UTF8.GetBytes('Forbidden'))}elseif(Test-Path -LiteralPath $full -PathType Leaf){$LastHit=[DateTime]::UtcNow;Send $stream 200 'OK' (Mime $full) ([IO.File]::ReadAllBytes($full))}else{Send $stream 404 'Not Found' 'text/plain' ([Text.Encoding]::UTF8.GetBytes('Not Found'))}}finally{$client.Close()}}
    else{if((([DateTime]::UtcNow-$LastHit).TotalSeconds) -ge $IdleTimeoutSeconds){break};Start-Sleep -Milliseconds 30}
  }
}finally{$listener.Stop()}
