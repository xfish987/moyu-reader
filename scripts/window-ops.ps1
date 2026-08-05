param(
  [Parameter(Mandatory=$true)][int]$TargetPid,
  [Parameter(Mandatory=$true)][ValidateSet('move','minimize','restore')][string]$Op,
  [string]$TitlePart = '',
  [int]$MinWidth = 400,
  [int]$X = 0, [int]$Y = 0, [int]$W = 0, [int]$H = 0
)
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinOps3 {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT wp);
  [DllImport("user32.dll")] public static extern bool SetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT wp);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct WINDOWPLACEMENT { public int length, flags, showCmd; public POINT ptMinPosition, ptMaxPosition; public RECT rcNormalPosition; }
  public static void RestoreNormal(IntPtr h) {
    var wp = new WINDOWPLACEMENT(); wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
    GetWindowPlacement(h, ref wp);
    wp.showCmd = 1;
    SetWindowPlacement(h, ref wp);
  }
  public static IntPtr Find(uint targetPid, string titlePart, int minWidth) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != targetPid) return true;
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (!sb.ToString().Contains(titlePart)) return true;
      var wp = new WINDOWPLACEMENT(); wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
      GetWindowPlacement(h, ref wp);
      if (wp.rcNormalPosition.Right - wp.rcNormalPosition.Left < minWidth) return true;
      found = h;
      return false;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$h = [WinOps3]::Find([uint32]$TargetPid, $TitlePart, $MinWidth)
if ($h -eq [IntPtr]::Zero) { Write-Error "main window not found for pid $TargetPid"; exit 1 }
switch ($Op) {
  'move'     { [WinOps3]::MoveWindow($h, $X, $Y, $W, $H, $true) | Out-Null }
  'minimize' { [WinOps3]::ShowWindow($h, 6) | Out-Null }
  'restore'  { [WinOps3]::RestoreNormal($h) }
}
Write-Output "ok $Op"
