import { App, Notice, requestUrl } from "obsidian";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { CLIResult } from "./types";

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
      return this.customBinaryPath;
    }

    const { executable } = this.getPlatformInfo();
    return path.join(this.getVaultPath(), ".obsidian/plugins/leafpress/bin", executable);
  }

  private matchAssetName(pattern: string, assetName: string): boolean {
    // Convert glob pattern to regex
    // First escape dots, then replace * with .*
    const escaped = pattern.replace(/\./g, '\\.');
    const regex = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
    console.log('[leafpress] Pattern:', pattern, '-> Regex:', regex, 'Asset:', assetName, 'Match:', regex.test(assetName));
    return regex.test(assetName);
  }

  async ensureBinary(): Promise<void> {
    if (this.customBinaryPath) {
      return;
    }

    try {
      const binaryPath = this.getBinaryPath();
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
      console.log('[leafpress] Fetching latest release...');
      const releaseResponse = await requestUrl({
        url: `https://api.github.com/repos/${REPO}/releases/latest`,
        headers: {
          "User-Agent": "obsidian-leafpress-plugin"
        }
      });

      if (releaseResponse.status !== 200) {
        throw new Error(`GitHub API error: ${releaseResponse.status}`);
      }

      const release = JSON.parse(releaseResponse.text) as any;
      console.log('[leafpress] Available assets:', release.assets.map((a: any) => a.name));

      // Find asset matching pattern
      const asset = release.assets.find((a: any) => this.matchAssetName(assetName, a.name));

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
      const archivePath = path.join(binDir, asset.name);
      await fs.writeFile(archivePath, new Uint8Array(archiveResponse.arrayBuffer));

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

  async execCommand(args: string[]): Promise<CLIResult> {
    await this.ensureBinary();

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";

      const child = spawn(this.getBinaryPath(), args, {
        cwd: this.getVaultPath(),
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

      // Timeout after 5 minutes for deploy, 30s for others
      setTimeout(() => {
        child.kill();
        resolve({
          success: false,
          stdout,
          stderr: "Command timed out",
          code: -1,
        });
      }, 5 * 60 * 1000);
    });
  }
}
