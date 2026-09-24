# procwatch event pump: WMI process create/delete indications, NDJSON on stdout.
#
# Kept separate from stream.ps1 because Register-CimIndicationEvent can take
# anywhere from seconds to a minute on a WMI-degraded machine — here that only
# delays event onset, never the tick loop. Creation events carry the command
# line, which is how new processes get summarized before the next enrich pass.

param([int]$ParentPid = 0)   # procwatch's pid: exit once it is gone
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$w = [Console]::Out

Register-CimIndicationEvent -Query "SELECT * FROM __InstanceCreationEvent WITHIN 2 WHERE TargetInstance ISA 'Win32_Process'" -SourceIdentifier pwnew | Out-Null
Register-CimIndicationEvent -Query "SELECT * FROM __InstanceDeletionEvent WITHIN 2 WHERE TargetInstance ISA 'Win32_Process'" -SourceIdentifier pwdel | Out-Null
try { $w.WriteLine('{"e":"events-live"}'); $w.Flush() } catch { exit }

# Runs until procwatch goes away: its pid is gone, or stdout's reader is (a
# write into the dead pipe throws). Checked every 5 s wait, so a quiet machine
# that produces no events still notices.
while ($true) {
    if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit }
    $ev = Wait-Event -Timeout 5
    while ($ev) {
        Remove-Event -EventIdentifier $ev.EventIdentifier
        $ti = $ev.SourceEventArgs.NewEvent.TargetInstance
        if ($ti) {
            if ($ev.SourceIdentifier -eq 'pwdel') {
                $w.WriteLine((@{ e = 'del'; id = [int64]$ti.ProcessId; name = $ti.Name } | ConvertTo-Json -Compress))
            } else {
                $p = @{ pid = [int64]$ti.ProcessId; ppid = [int64]$ti.ParentProcessId; name = $ti.Name;
                        path = $ti.ExecutablePath; cmd = $ti.CommandLine; th = [int]$ti.ThreadCount;
                        start = if ($ti.CreationDate -is [DateTime]) { ([DateTimeOffset]$ti.CreationDate).ToUnixTimeMilliseconds() } else { [int64]0 };
                        mem = [int64]$ti.WorkingSetSize; cpu = [int64]0 }
                $w.WriteLine((@{ e = 'new'; p = $p } | ConvertTo-Json -Compress -Depth 4))
            }
            try { $w.Flush() } catch { exit }
        }
        $ev = Wait-Event -Timeout 0
    }
}
