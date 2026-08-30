$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 8769
$Url = "http://localhost:$Port/"
$IdleTimeoutSeconds = 18
$LastHeartbeat = [DateTime]::UtcNow
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class BalanceMouseBridge {
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint data,UIntPtr extra);
 const uint LD=0x0002, LU=0x0004;
 public static void MoveRelative(int dx,int dy){ POINT p; if(GetCursorPos(out p)) SetCursorPos(p.X+dx,p.Y+dy); }
 public static void LeftClick(){ mouse_event(LD,0,0,0,UIntPtr.Zero); mouse_event(LU,0,0,0,UIntPtr.Zero); }
}
"@
function Test-LocalPort { param([int]$Port) $c=New-Object System.Net.Sockets.TcpClient; try{$iar=$c.BeginConnect("127.0.0.1",$Port,$null,$null);if(-not $iar.AsyncWaitHandle.WaitOne(250)){return $false};$c.EndConnect($iar);return $true}catch{return $false}finally{$c.Close()} }
function Open-Viewer { $candidates=@("$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe","$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe","$env:LocalAppData\Microsoft\Edge\Application\msedge.exe","$env:ProgramFiles\Google\Chrome\Application\chrome.exe","$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe","$env:LocalAppData\Google\Chrome\Application\chrome.exe");foreach($browser in $candidates){if($browser -and(Test-Path -LiteralPath $browser)){Start-Process -FilePath $browser -ArgumentList $Url;return}};Start-Process $Url }
function Get-MimeType { param([string]$Path) switch([IO.Path]::GetExtension($Path).ToLowerInvariant()){'.html'{'text/html; charset=utf-8'}'.css'{'text/css; charset=utf-8'}'.js'{'application/javascript; charset=utf-8'}'.png'{'image/png'}default{'application/octet-stream'}} }
function Send-Response { param($Stream,[int]$StatusCode,[string]$StatusText,[string]$Mime,[byte[]]$Body) $header="HTTP/1.1 $StatusCode $StatusText`r`nContent-Type: $Mime`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n";$hb=[Text.Encoding]::ASCII.GetBytes($header);$Stream.Write($hb,0,$hb.Length);if($Body.Length -gt 0){$Stream.Write($Body,0,$Body.Length)};$Stream.Flush() }
function Parse-Query { param([string]$Q) $m=@{};if([string]::IsNullOrWhiteSpace($Q)){return $m};foreach($pair in $Q.TrimStart('?').Split('&')){if(!$pair){continue};$p=$pair.Split('=',2);$k=[Uri]::UnescapeDataString($p[0]);$v=if($p.Length -gt 1){[Uri]::UnescapeDataString($p[1])}else{''};$m[$k]=$v};return $m }
if(Test-LocalPort -Port $Port){Open-Viewer;exit 0}
$listener=New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback,$Port)
try{$listener.Start();Start-Sleep -Milliseconds 200;Open-Viewer;$LastHeartbeat=[DateTime]::UtcNow;while($true){if($listener.Pending()){$client=$listener.AcceptTcpClient();try{$stream=$client.GetStream();$reader=New-Object IO.StreamReader($stream,[Text.Encoding]::ASCII,$false,4096,$true);$requestLine=$reader.ReadLine();if([string]::IsNullOrWhiteSpace($requestLine)){continue};while($true){$line=$reader.ReadLine();if($null -eq $line -or $line -eq ''){break}};$parts=$requestLine.Split(' ');if($parts.Length -lt 2 -or $parts[0] -ne 'GET'){Send-Response $stream 405 'Method Not Allowed' 'text/plain' ([Text.Encoding]::UTF8.GetBytes('Method Not Allowed'));continue};$raw=$parts[1];$path=$raw.Split('?')[0];$q=if($raw.Contains('?')){$raw.Substring($raw.IndexOf('?'))}else{''};$target=[Uri]::UnescapeDataString($path);$query=Parse-Query $q;if($target -eq '/__heartbeat'){$LastHeartbeat=[DateTime]::UtcNow;Send-Response $stream 204 'No Content' 'text/plain' ([byte[]]@());continue};if($target -eq '/__mouse_move'){$dx=0;$dy=0;[int]::TryParse([string]$query['dx'],[ref]$dx)|Out-Null;[int]::TryParse([string]$query['dy'],[ref]$dy)|Out-Null;$dx=[Math]::Max(-120,[Math]::Min(120,$dx));$dy=[Math]::Max(-120,[Math]::Min(120,$dy));[BalanceMouseBridge]::MoveRelative($dx,$dy);$LastHeartbeat=[DateTime]::UtcNow;Send-Response $stream 204 'No Content' 'text/plain' ([byte[]]@());continue};if($target -eq '/__mouse_click'){[BalanceMouseBridge]::LeftClick();$LastHeartbeat=[DateTime]::UtcNow;Send-Response $stream 204 'No Content' 'text/plain' ([byte[]]@());continue};if($target -eq '/'){$target='/index.html'};$relative=$target.TrimStart('/').Replace('/',[IO.Path]::DirectorySeparatorChar);$full=[IO.Path]::GetFullPath((Join-Path $Root $relative));$base=[IO.Path]::GetFullPath($Root+[IO.Path]::DirectorySeparatorChar);if(-not $full.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){Send-Response $stream 403 'Forbidden' 'text/plain' ([Text.Encoding]::UTF8.GetBytes('Forbidden'));continue};if(-not(Test-Path -LiteralPath $full -PathType Leaf)){Send-Response $stream 404 'Not Found' 'text/plain' ([Text.Encoding]::UTF8.GetBytes('Not Found'));continue};$LastHeartbeat=[DateTime]::UtcNow;Send-Response $stream 200 'OK' (Get-MimeType -Path $full) ([IO.File]::ReadAllBytes($full))}catch{}finally{if($client){$client.Close()}}}else{if((([DateTime]::UtcNow-$LastHeartbeat).TotalSeconds)-ge $IdleTimeoutSeconds){break};Start-Sleep -Milliseconds 20}}}finally{if($listener){$listener.Stop()}}
