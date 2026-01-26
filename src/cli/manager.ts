import { App, Notice, requestUrl } from "obsidian";
import { spawn, ChildProcess } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { CLIResult, GitHubRelease, GitHubAsset } from "./types";

export class BinaryManager {
  private app: App;
  private customBinaryPath: string;
  private vaultPath: string | null = null;

  constructor(app: App, settings: any) {
    this.app = app;
    this.customBinaryPath = settings.customBinaryPath;
  }

  private getVaultPath(): string {
    if (this.vaultPath) return this.vaultPath;

    try {
      const adapter = this.app.vault.adapter as any;

      // Try different properties
      if (adapter.basePath && typeof adapter.basePath === 'string') {
        this.vaultPath = adapter.basePath;
      } else if (adapter.path && typeof adapter.path === 'string') {
        this.vaultPath = adapter.path;
      } else if ((adapter as any).vault?.dir) {
        this.vaultPath = (adapter as any).vault.dir;
      } else {
        // Fallback: construct from home + vault name
        const vaultName = this.app.vault.getName();
        this.vaultPath = path.join(os.homedir(), '.obsidian/vaults', vaultName);
      }

      if (!this.vaultPath || typeof this.vaultPath !== 'string') {
        throw new Error('Could not determine vault path');
      }

      console.log('[leafpress] Vault path:', this.vaultPath);
      return this.vaultPath;
    } catch (err) {
      console.error('[leafpress] Error getting vault path:', err);
      throw new Error('Failed to determine vault path');
    }
  }

  private getPlatformInfo(): {
    platform: string;
    arch: string;
    assetName: string;
    executable: string;
  } {
    const platform = process.platform;
    const arch = process.arch;
    let assetName: string;
    let executable: string;

    if (platform === "darwin") {
      const archName = arch === "arm64" ? "arm64" : "amd64";
      assetName = `leafpress-v*-darwin-${archName}.tar.gz`;
      executable = "leafpress";
    } else if (platform === "linux") {
      const archName = arch === "arm64" ? "arm64" : "amd64";
      assetName = `leafpress-v*-linux-${archName}.tar.gz`;
      executable = "leafpress";
    } else if (platform === "win32") {
      assetName = `leafpress-v*-windows-amd64.zip`;
      executable = "leafpress.exe";
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    return { platform, arch, assetName, executable };
  }

  private getBinaryPath(): string {
    if (this.customBinaryPath) {
      // Expand ~ to home directory
      let expandedPath = this.customBinaryPath;
      if (expandedPath.startsWith("~")) {
        expandedPath = expandedPath.replace(/^~/, os.homedir());
      }
      return expandedPath;
    }

    const { executable } = this.getPlatformInfo();
    return path.join(this.getVaultPath(), ".obsidian/plugins/leafpress/bin", executable);
  }

  private matchAssetName(pattern: string, assetName: string): boolean {
    // Convert glob pattern to regex
    // First escape dots, then replace * with .*
    const escaped = pattern.replace(/\./g, '\\.');
    const regex = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
    return regex.test(assetName);
  }

  async ensureBinary(): Promise<void> {
    const binaryPath = this.getBinaryPath();

    if (this.customBinaryPath) {
      // Validate custom binary path exists
      try {
        await fs.access(binaryPath);
        console.log('[leafpress] Custom binary found at:', binaryPath);
      } catch {
        throw new Error(`Custom binary not found at: ${binaryPath}`);
      }
      return;
    }

    try {
      await fs.access(binaryPath);
      console.log('[leafpress] Binary found at:', binaryPath);
    } catch {
      console.log('[leafpress] Binary not found, downloading...');
      await this.downloadBinary();
    }
  }

  private async downloadBinary(): Promise<void> {
    const { assetName, executable } = this.getPlatformInfo();
    const REPO = "shivamx96/leafpress";

    try {
      // Fetch latest release info using Obsidian's requestUrl (handles CORS)
      const releaseResponse = await requestUrl({
        url: `https://api.github.com/repos/${REPO}/releases/latest`,
        headers: {
          "User-Agent": "obsidian-leafpress-plugin"
        }
      });

      if (releaseResponse.status !== 200) {
        throw new Error(`GitHub API error: ${releaseResponse.status}`);
      }

      const release: GitHubRelease = JSON.parse(releaseResponse.text);

      // Find asset matching pattern
      const asset = release.assets.find((a) => this.matchAssetName(assetName, a.name));

      if (!asset) {
        throw new Error(`Binary not found. Expected pattern: ${assetName}`);
      }

      // Create bin directory
      const vaultPath = this.getVaultPath();
      const binDir = path.join(vaultPath, ".obsidian/plugins/leafpress/bin");
      await fs.mkdir(binDir, { recursive: true });

      // Download archive using Obsidian's requestUrl
      console.log('[leafpress] Downloading', asset.name, 'from', asset.browser_download_url);
      const archiveResponse = await requestUrl({
        url: asset.browser_download_url,
        headers: {
          "User-Agent": "obsidian-leafpress-plugin"
        }
      });

      if (archiveResponse.status !== 200) {
        throw new Error(`Download failed: ${archiveResponse.status}`);
      }

      // Save archive temporarily
      const archiveData = new Uint8Array(archiveResponse.arrayBuffer);
      const archivePath = path.join(binDir, asset.name);
      await fs.writeFile(archivePath, archiveData);

      // Verify checksum if available
      const checksumValid = await this.verifyChecksum(release.assets, asset.name, archiveData);
      if (checksumValid === false) {
        await fs.unlink(archivePath);
        throw new Error("Checksum verification failed - download may be corrupted");
      }

      // Extract based on file type
      if (asset.name.endsWith('.tar.gz')) {
        await this.extractTarGz(archivePath, binDir, executable);
      } else if (asset.name.endsWith('.zip')) {
        await this.extractZip(archivePath, binDir, executable);
      }

      // Clean up archive
      try {
        await fs.unlink(archivePath);
      } catch {
        // Ignore cleanup errors
      }

      console.log('[leafpress] Binary downloaded and extracted successfully');
      new Notice(`✓ leafpress CLI downloaded successfully`);
    } catch (err) {
      const message = `Failed to download leafpress binary: ${err}`;
      console.error('[leafpress]', message);
      new Notice(`✗ ${message}`);
      throw err;
    }
  }

  private extractTarGz(archivePath: string, binDir: string, executable: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const tar = spawn('tar', ['-xzf', archivePath, '-C', binDir]);

      tar.on('close', (code: number) => {
        if (code === 0) {
          // Make executable
          if (process.platform !== "win32") {
            const binaryPath = path.join(binDir, executable);
            fs.chmod(binaryPath, 0o755).then(() => resolve()).catch(reject);
          } else {
            resolve();
          }
        } else {
          reject(new Error(`tar extraction failed with code ${code}`));
        }
      });

      tar.on('error', reject);
    });
  }

  private extractZip(archivePath: string, binDir: string, executable: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const unzip = spawn('unzip', ['-o', archivePath, '-d', binDir]);

      unzip.on('close', (code: number) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`unzip extraction failed with code ${code}`));
        }
      });

      unzip.on('error', reject);
    });
  }

  /**
   * Verify downloaded file checksum against checksums file from release.
   * Returns true if valid, false if invalid, null if no checksums available.
   */
  private async verifyChecksum(
    assets: GitHubAsset[],
    assetName: string,
    data: Uint8Array
  ): Promise<boolean | null> {
    // Look for checksums file in release assets
    const checksumAsset = assets.find(
      (a) =>
        a.name === "checksums.txt" ||
        a.name === "SHA256SUMS" ||
        a.name.toLowerCase().includes("checksum")
    );

    if (!checksumAsset) {
      console.log("[leafpress] No checksums file found in release, skipping verification");
      return null;
    }

    try {
      // Download checksums file
      const checksumResponse = await requestUrl({
        url: checksumAsset.browser_download_url,
        headers: { "User-Agent": "obsidian-leafpress-plugin" },
      });

      if (checksumResponse.status !== 200) {
        console.warn("[leafpress] Failed to download checksums file");
        return null;
      }

      // Parse checksums file (format: "hash  filename" or "hash filename")
      const checksumText = checksumResponse.text;
      const lines = checksumText.split("\n");
      let expectedHash: string | null = null;

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2 && parts[1] === assetName) {
          expectedHash = parts[0].toLowerCase();
          break;
        }
      }

      if (!expectedHash) {
        console.warn(`[leafpress] No checksum found for ${assetName}`);
        return null;
      }

      // Calculate SHA256 of downloaded data
      const actualHash = crypto
        .createHash("sha256")
        .update(data)
        .digest("hex")
        .toLowerCase();

      console.log(`[leafpress] Checksum verification: expected=${expectedHash}, actual=${actualHash}`);

      if (actualHash !== expectedHash) {
        console.error("[leafpress] Checksum mismatch!");
        return false;
      }

      console.log("[leafpress] Checksum verified successfully");
      return true;
    } catch (err) {
      console.warn("[leafpress] Error verifying checksum:", err);
      return null;
    }
  }

  async checkForUpdates(): Promise<{ currentVersion: string; latestVersion: string; hasUpdate: boolean } | null> {
    try {
      const REPO = "shivamx96/leafpress";
      const releaseResponse = await requestUrl({
        url: `https://api.github.com/repos/${REPO}/releases/latest`,
        headers: {
          "User-Agent": "obsidian-leafpress-plugin"
        }
      });

      if (releaseResponse.status !== 200) {
        throw new Error(`GitHub API error: ${releaseResponse.status}`);
      }

      const release: GitHubRelease = JSON.parse(releaseResponse.text);
      let latestVersion = release.tag_name || "unknown";
      // Clean up version (remove leading 'v')
      latestVersion = latestVersion.replace(/^v/, "");

      // Try to get current version from binary or default to 0.0.0
      let currentVersion = "0.0.0";
      try {
        const result = await this.execCommand(["--version"]);
        if (result.success) {
          // Match versions like: 1.0.0, v1.0.0, 1.0.0-alpha, 1.0.0-alpha.1, 1.0.0-beta.2
          const match = result.stdout.match(/v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/);
          currentVersion = match ? match[1] : "0.0.0";
        }
      } catch (err) {
        console.log("[leafpress] Could not determine current version");
      }

      const hasUpdate = this.compareVersions(currentVersion, latestVersion) < 0;

      return {
        currentVersion,
        latestVersion,
        hasUpdate
      };
    } catch (err) {
      console.error("[leafpress] Error checking for updates:", err);
      return null;
    }
  }

  async updateBinary(): Promise<void> {
    if (this.customBinaryPath) {
      throw new Error("Cannot update custom binary path. Remove custom path from settings first.");
    }

    const { executable } = this.getPlatformInfo();
    const binaryPath = this.getBinaryPath();
    const binDir = path.dirname(binaryPath);

    try {
      // Backup current binary
      const backupPath = binaryPath + ".backup";
      try {
        await fs.copyFile(binaryPath, backupPath);
        console.log("[leafpress] Backed up current binary to:", backupPath);
      } catch (err) {
        console.log("[leafpress] Could not backup binary:", err);
      }

      // Download and install new version
      await this.downloadBinary();

      // Clean up backup
      try {
        await fs.unlink(backupPath);
      } catch (err) {
        console.log("[leafpress] Could not remove backup:", err);
      }

      new Notice("✓ leafpress CLI updated successfully");
    } catch (err) {
      console.error("[leafpress] Error updating binary:", err);
      // Try to restore from backup
      const backupPath = binaryPath + ".backup";
      try {
        await fs.copyFile(backupPath, binaryPath);
        new Notice("✗ Update failed, restored previous version");
      } catch (restoreErr) {
        new Notice("✗ Update failed and could not restore backup");
      }
      throw err;
    }
  }

  private compareVersions(v1: string, v2: string): number {
    // Parse semantic versions with pre-release identifiers
    // e.g., "1.0.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-beta.2"

    const parseVersion = (v: string): { major: number; minor: number; patch: number; prerelease: string } => {
      const cleanVersion = v.replace(/^v/, ""); // Remove leading 'v'
      const [baseVersion, prerelease] = cleanVersion.split("-");
      const [major, minor, patch] = baseVersion.split(".").map(p => parseInt(p, 10) || 0);
      return { major, minor, patch, prerelease: prerelease || "" };
    };

    const parsed1 = parseVersion(v1);
    const parsed2 = parseVersion(v2);

    // Compare major.minor.patch
    if (parsed1.major !== parsed2.major) return parsed1.major > parsed2.major ? 1 : -1;
    if (parsed1.minor !== parsed2.minor) return parsed1.minor > parsed2.minor ? 1 : -1;
    if (parsed1.patch !== parsed2.patch) return parsed1.patch > parsed2.patch ? 1 : -1;

    // Both have same base version, compare pre-release
    // No pre-release > has pre-release (1.0.0 > 1.0.0-alpha)
    if (!parsed1.prerelease && parsed2.prerelease) return 1;
    if (parsed1.prerelease && !parsed2.prerelease) return -1;
    if (!parsed1.prerelease && !parsed2.prerelease) return 0;

    // Both have pre-release, compare them
    const pre1Parts = parsed1.prerelease.split(".");
    const pre2Parts = parsed2.prerelease.split(".");

    for (let i = 0; i < Math.max(pre1Parts.length, pre2Parts.length); i++) {
      const part1 = pre1Parts[i];
      const part2 = pre2Parts[i];

      // Missing parts: shorter version is less than longer
      if (part1 === undefined && part2 !== undefined) return -1;
      if (part1 !== undefined && part2 === undefined) return 1;
      if (part1 === undefined && part2 === undefined) return 0;

      // Try to parse as numbers
      const num1 = parseInt(part1!, 10);
      const num2 = parseInt(part2!, 10);
      const isNum1 = !isNaN(num1);
      const isNum2 = !isNaN(num2);

      if (isNum1 && isNum2) {
        if (num1 !== num2) return num1 > num2 ? 1 : -1;
      } else if (isNum1) {
        return -1; // numbers come before strings
      } else if (isNum2) {
        return 1;
      } else {
        // String comparison
        if (part1 !== part2) return part1! > part2! ? 1 : -1;
      }
    }

    return 0;
  }

  async execCommand(args: string[]): Promise<CLIResult> {
    await this.ensureBinary();

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";

      const child = spawn(this.getBinaryPath(), args, {
        cwd: this.getVaultPath(),
        env: process.env,
      });

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        resolve({
          success: code === 0,
          stdout,
          stderr,
          code: code || 1,
        });
      });

      child.on("error", (err) => {
        resolve({
          success: false,
          stdout,
          stderr: err.message,
          code: 1,
        });
      });

      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        // Give process time to cleanup, then force kill
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 3000);
        resolve({
          success: false,
          stdout,
          stderr: "Command timed out",
          code: -1,
        });
      }, 5 * 60 * 1000);

      // Clear timeout if process exits normally
      child.on("exit", () => clearTimeout(timeout));
    });
  }

  /**
   * Start a long-running server process. Returns the child process
   * so caller can manage its lifecycle. Does not timeout.
   */
  async startServerProcess(): Promise<{ process: ChildProcess | null; error?: string }> {
    try {
      await this.ensureBinary();
    } catch (err) {
      return { process: null, error: `Failed to ensure binary: ${err}` };
    }

    const child = spawn(this.getBinaryPath(), ["serve"], {
      cwd: this.getVaultPath(),
      env: process.env,
      detached: false,
    });

    // Return early error if spawn fails
    return new Promise((resolve) => {
      let resolved = false;

      child.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          resolve({ process: child, error: err.message });
        }
      });

      // Give it a moment to fail, then assume it started
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ process: child });
        }
      }, 500);
    });
  }

  /**
   * Stop a server process gracefully
   */
  stopServerProcess(child: ChildProcess): void {
    if (!child || child.killed) return;

    child.kill("SIGTERM");

    // Force kill after 3 seconds if still running
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 3000);
  }
}
