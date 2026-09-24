# procwatch enrich: command lines / paths / precise start times from WMI.
# This is the slow query (8+ seconds on WMI-degraded machines), so it runs in
# its own short-lived process — at app start and periodically — never in the
# fast tick path.

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$cs = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CommandLine,ExecutablePath,CreationDate | ForEach-Object {
    @{ pid = [int64]$_.ProcessId; ppid = [int64]$_.ParentProcessId; cmd = $_.CommandLine; path = $_.ExecutablePath;
       start = if ($_.CreationDate -is [DateTime]) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { [int64]0 } }
})
[Console]::Out.WriteLine((@{ e = 'enrich'; procs = $cs } | ConvertTo-Json -Compress -Depth 4))
[Console]::Out.Flush()
