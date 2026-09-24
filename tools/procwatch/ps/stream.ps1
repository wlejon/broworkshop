# procwatch tick stream: native-API process snapshots every 1.5 s, NDJSON on stdout.
#
# WMI on some machines takes 8+ seconds for ANY Win32_Process operation —
# including event registration — so this child touches no WMI at all:
# Toolhelp32 for pid/ppid/name, GetProcesses for mem/cpu/threads,
# QueryFullProcessImageName for paths, GlobalMemoryStatusEx for RAM.
# Create/delete push events live in events.ps1, a separate child, so their
# registration latency can never stall the tick loop.

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$w = [Console]::Out

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PWNative {
    [DllImport("kernel32.dll")] public static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct PROCESSENTRY32W {
        public uint dwSize; public uint cntUsage; public uint th32ProcessID;
        public IntPtr th32DefaultHeapID; public uint th32ModuleID; public uint cntThreads;
        public uint th32ParentProcessID; public int pcPriClassBase; public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string szExeFile;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool Process32FirstW(IntPtr h, ref PROCESSENTRY32W e);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool Process32NextW(IntPtr h, ref PROCESSENTRY32W e);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    [StructLayout(LayoutKind.Sequential)]
    public struct MEMORYSTATUSEX {
        public uint dwLength; public uint dwMemoryLoad;
        public ulong ullTotalPhys; public ulong ullAvailPhys;
        public ulong ullTotalPageFile; public ulong ullAvailPageFile;
        public ulong ullTotalVirtual; public ulong ullAvailVirtual; public ulong ullAvailExtendedVirtual;
    }
    [DllImport("kernel32.dll")] public static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX m);
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool QueryFullProcessImageNameW(IntPtr h, uint flags, System.Text.StringBuilder buf, ref uint size);
    // PROCESS_QUERY_LIMITED_INFORMATION — cheap, works across users, never
    // touches the module list (Process.MainModule can block for seconds).
    public static string GetPath(uint pid) {
        IntPtr h = OpenProcess(0x1000, false, pid);
        if (h == IntPtr.Zero) return null;
        try {
            var sb = new System.Text.StringBuilder(1024); uint n = 1024;
            return QueryFullProcessImageNameW(h, 0, sb, ref n) ? sb.ToString() : null;
        } finally { CloseHandle(h); }
    }
}
"@

function Get-Tick {
    $pp = @{}
    $snap = [PWNative]::CreateToolhelp32Snapshot(2, 0)   # TH32CS_SNAPPROCESS
    if ($snap.ToInt64() -ne -1 -and $snap -ne [IntPtr]::Zero) {
        $e = New-Object PWNative+PROCESSENTRY32W
        $e.dwSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][PWNative+PROCESSENTRY32W])
        if ([PWNative]::Process32FirstW($snap, [ref]$e)) {
            do {
                $pp[[int64]$e.th32ProcessID] = @{ ppid = [int64]$e.th32ParentProcessID; name = $e.szExeFile; th = [int]$e.cntThreads }
            } while ([PWNative]::Process32NextW($snap, [ref]$e))
        }
        [void][PWNative]::CloseHandle($snap)
    }

    $procs = New-Object System.Collections.ArrayList
    foreach ($p in [System.Diagnostics.Process]::GetProcesses()) {
        $id = [int64]$p.Id
        if ($id -eq 0) { continue }
        $cpu = [int64]0; $start = [int64]0; $path = $null
        try {
            $cpu = $p.TotalProcessorTime.Ticks
            $start = ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds()
        } catch {}
        $path = [PWNative]::GetPath([uint32]$id)
        $t = $pp[$id]
        [void]$procs.Add(@{
            pid = $id
            ppid = if ($t) { $t.ppid } else { [int64]0 }
            name = if ($t -and $t.name) { $t.name } else { $p.ProcessName + '.exe' }
            th = if ($t) { $t.th } else { $p.Threads.Count }
            mem = [int64]$p.WorkingSet64
            cpu = $cpu
            start = $start
            path = $path
        })
    }

    $m = New-Object PWNative+MEMORYSTATUSEX
    $m.dwLength = [System.Runtime.InteropServices.Marshal]::SizeOf([type][PWNative+MEMORYSTATUSEX])
    [void][PWNative]::GlobalMemoryStatusEx([ref]$m)

    @{ e = 'snap'; t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); n = [int][Environment]::ProcessorCount;
       mt = [int64]$m.ullTotalPhys; mf = [int64]$m.ullAvailPhys; procs = $procs }
}

while ($true) {
    $w.WriteLine((Get-Tick | ConvertTo-Json -Compress -Depth 4)); $w.Flush()
    Start-Sleep -Milliseconds 800   # tick work itself takes ~1 s; ~2 s effective cadence
}
