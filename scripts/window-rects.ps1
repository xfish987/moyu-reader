param([int]$TargetPid)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class WinEnum {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<string> List(uint targetPid) {
    var outp = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != targetPid) return true;
      RECT r; GetWindowRect(h, out r);
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      outp.Add(string.Format("{0}|{1}|{2}|{3}|{4}|{5}|{6}", sb, r.Left, r.Top, r.Right, r.Bottom, IsWindowVisible(h), IsIconic(h)));
      return true;
    }, IntPtr.Zero);
    return outp;
  }
}
"@
[WinEnum]::List([uint32]$TargetPid) | ForEach-Object { $_ }
