# ============================================================================
# Moren Luca Local Agent — PENCERE KUCULTME GOZCUSU
# ----------------------------------------------------------------------------
# Amac: Yerel ajanin Playwright Chromium penceresi headful (gorunur) acilmak
# ZORUNDA (Luca frameset headless'ta acilmiyor). Ama kullanici bu pencereye
# KAZARA mudahale etmesin (tiklama / kapatma / gezinme). Bu gozcu, ajanin
# tarayici penceresini surekli KUCULTULMUS ve ODAKSIZ tutar; kullanici acsa
# bile ~0.5sn icinde tekrar kuculur = "kilitli".
#
# GUVENLIK: SADECE ajanin kendi profilini (`.browser-data*` user-data-dir)
# kullanan Chromium pencerelerini hedefler. Kullanicinin KENDI Chrome'una
# (varsayilan profil) ASLA dokunmaz.
#
# Tek-ornek: Global mutex ile makinede tek gozcu calisir.
# 2026-06-11 — Luca izolasyon paketi.
# ============================================================================
$ErrorActionPreference = 'SilentlyContinue'

# --- Tek-ornek guvencesi ---
$mutexCreated = $false
$mutex = New-Object System.Threading.Mutex($true, 'Global\MorenLucaWindowMinimizer', [ref]$mutexCreated)
if (-not $mutexCreated) { return }

# --- user32 P/Invoke ---
if (-not ([System.Management.Automation.PSTypeName]'MorenWin').Type) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class MorenWin {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  // Verilen PID kumesine ait, gorunur ve simdi simge-durumunda OLMAYAN pencereleri bul.
  public static List<IntPtr> WindowsToMinimize(HashSet<uint> pids) {
    List<IntPtr> result = new List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      if (IsIconic(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pids.Contains(pid)) result.Add(h);
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
"@
}

$SW_MINIMIZE = 6  # kuculturur ve odagi bir sonraki pencereye verir (kullaniciya geri)

# Ajan profil yolu imzasi: bu makinedeki luca-local-agent klasoru altindaki
# `.browser-data` (veya `.browser-data-<slot>`). CommandLine'da bu gecen
# chrome.exe = ajanin tarayicisi. Kullanicinin normal Chrome'unda bu YOK.
$agentRoot = Split-Path -Parent $PSScriptRoot   # ...\apps\luca-local-agent
$profileSig = ([regex]::Escape((Join-Path $agentRoot '.browser-data')))

while ($true) {
  try {
    # Ajanin tarayici (Chromium browser) proseslerini bul — user-data-dir profil imzasi ile.
    $pidSet = New-Object 'System.Collections.Generic.HashSet[uint32]'
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and ($_.CommandLine -match $profileSig) } |
      ForEach-Object { [void]$pidSet.Add([uint32]$_.ProcessId) }

    if ($pidSet.Count -gt 0) {
      $wins = [MorenWin]::WindowsToMinimize($pidSet)
      foreach ($h in $wins) { [void][MorenWin]::ShowWindowAsync($h, $SW_MINIMIZE) }
    }
  } catch {}
  Start-Sleep -Milliseconds 500
}
