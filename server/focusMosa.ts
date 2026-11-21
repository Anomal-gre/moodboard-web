import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function focusOrLaunchLocalMosaApp(
  originUrl: string,
  callback: (result: { ok: boolean; action?: 'focused' | 'launched'; error?: string }) => void
): void {
  if (process.platform !== 'win32') {
    callback({ ok: false, error: 'Unsupported OS' });
    return;
  }

  const psScript = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class MosaWinFocus {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int maxCount);
  public static bool FocusBest() {
    IntPtr best = IntPtr.Zero;
    int bestScore = 0;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256);
      GetWindowText(h, sb, sb.Capacity);
      var title = sb.ToString().Trim();
      if (title.Length == 0) return true;
      int score = 0;
      if (title.Equals("Mosa", StringComparison.OrdinalIgnoreCase)) {
        score = 100;
      } else if (
        (title.StartsWith("Mosa ", StringComparison.OrdinalIgnoreCase) ||
         title.StartsWith("Mosa-", StringComparison.OrdinalIgnoreCase) ||
         title.StartsWith("Mosa·", StringComparison.OrdinalIgnoreCase)) &&
        title.IndexOf("Vivaldi", StringComparison.OrdinalIgnoreCase) < 0 &&
        title.IndexOf("Visual Studio", StringComparison.OrdinalIgnoreCase) < 0
      ) {
        score = 50;
      }
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
      return true;
    }, IntPtr.Zero);
    if (best == IntPtr.Zero) return false;
    if (IsIconic(best)) ShowWindow(best, 9);
    SwitchToThisWindow(best, true);
    SetForegroundWindow(best);
    return true;
  }
}
"@
if ([MosaWinFocus]::FocusBest()) { Write-Output "FOCUSED" } else { Write-Output "NOT_FOUND" }
`;

  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
    { windowsHide: true }
  );

  let stdout = '';
  child.stdout?.on('data', (d: Buffer) => {
    stdout += d.toString('utf-8');
  });

  child.on('error', (err) => {
    callback({ ok: false, error: err.message });
  });

  child.on('close', () => {
    if (stdout.includes('FOCUSED')) {
      callback({ ok: true, action: 'focused' });
      return;
    }

    // No Mosa app window open yet -> launch standalone Tauri or Edge --app window
    const tauriExe = path.resolve(process.cwd(), 'src-tauri', 'target', 'release', 'mosa.exe');
    if (fs.existsSync(tauriExe)) {
      const app = spawn(tauriExe, [], { detached: true, stdio: 'ignore', windowsHide: false });
      app.unref();
      callback({ ok: true, action: 'launched' });
      return;
    }

    const edgePaths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    const edgeExe = edgePaths.find((p) => fs.existsSync(p));
    if (edgeExe) {
      const app = spawn(edgeExe, [`--app=${originUrl}`, '--window-size=1440,900'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      app.unref();
      callback({ ok: true, action: 'launched' });
      return;
    }

    callback({ ok: false, error: 'Standalone Mosa app not found' });
  });
}
