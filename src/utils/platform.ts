import { spawn } from "child_process";

/**
 * Open a URL in the default browser (cross-platform)
 */
export function openInBrowser(url: string): void {
  const platform = process.platform;

  if (platform === "darwin") {
    spawn("open", [url]);
  } else if (platform === "win32") {
    spawn("cmd", ["/c", "start", url]);
  } else {
    // Linux and others
    spawn("xdg-open", [url]);
  }
}

/**
 * Check if a port is in use (cross-platform)
 */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = process.platform;

    if (platform === "win32") {
      // Windows: use netstat, filter for LISTENING state only
      const proc = spawn("cmd", [
        "/c",
        `netstat -ano | findstr :${port} | findstr LISTENING`,
      ]);
      let output = "";

      proc.stdout?.on("data", (data) => {
        output += data.toString();
      });

      proc.on("close", () => {
        resolve(output.trim().length > 0);
      });

      proc.on("error", () => resolve(false));
    } else {
      // macOS/Linux: use lsof
      const proc = spawn("lsof", ["-t", "-i", `:${port}`]);
      let output = "";

      proc.stdout?.on("data", (data) => {
        output += data.toString();
      });

      proc.on("close", () => {
        resolve(output.trim().length > 0);
      });

      proc.on("error", () => resolve(false));
    }
  });
}

/**
 * Kill processes using a specific port (cross-platform)
 */
export function killPortProcess(port: number): Promise<void> {
  return new Promise((resolve) => {
    const platform = process.platform;

    if (platform === "win32") {
      // Windows: use netstat to find PID of LISTENING socket, then taskkill
      const proc = spawn("cmd", [
        "/c",
        `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port} ^| findstr LISTENING') do taskkill /F /PID %a`,
      ]);
      proc.on("close", () => resolve());
      proc.on("error", () => resolve());
    } else {
      // macOS/Linux: use lsof
      const findProc = spawn("lsof", ["-t", "-i", `:${port}`]);
      let pids = "";

      findProc.stdout?.on("data", (data) => {
        pids += data.toString();
      });

      findProc.on("close", () => {
        const pidList = pids.trim().split("\n").filter(Boolean);
        if (pidList.length === 0) {
          resolve();
          return;
        }

        for (const pidStr of pidList) {
          const pid = parseInt(pidStr, 10);
          if (!isNaN(pid)) {
            try {
              process.kill(pid, "SIGTERM");
            } catch {
              // Process may already be dead
            }
          }
        }
        resolve();
      });

      findProc.on("error", () => resolve());
    }
  });
}
