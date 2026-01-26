import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { spawn } from "child_process";
import * as path from "path";
import { BinaryManager } from "./cli/manager";
import { readLeafpressConfig } from "./utils/config";
import { LeafpressConfig } from "./cli/types";

export const VIEW_TYPE_LEAFPRESS = "leafpress-view";

export class LeafpressPanel extends ItemView {
  private binaryManager: BinaryManager | null = null;
  private vaultPath: string | null = null;
  private statusRefreshInterval: NodeJS.Timer | null = null;
  private isRefreshing = false;

  constructor(leaf: WorkspaceLeaf, binaryManager?: BinaryManager) {
    super(leaf);
    this.binaryManager = binaryManager || null;
  }

  private getVaultPath(): string {
    if (this.vaultPath) return this.vaultPath;

    try {
      const adapter = this.app.vault.adapter as any;

      // Try different properties
      if (adapter.basePath && typeof adapter.basePath === "string") {
        this.vaultPath = adapter.basePath;
      } else if (adapter.path && typeof adapter.path === "string") {
        this.vaultPath = adapter.path;
      } else if ((adapter as any).vault?.dir) {
        this.vaultPath = (adapter as any).vault.dir;
      }

      if (!this.vaultPath || typeof this.vaultPath !== "string") {
        throw new Error("Could not determine vault path");
      }

      return this.vaultPath;
    } catch (err) {
      console.error("[leafpress] Error getting vault path:", err);
      throw err;
    }
  }

  getViewType() {
    return VIEW_TYPE_LEAFPRESS;
  }

  getDisplayText() {
    return "leafpress";
  }

  getIcon() {
    return "leaf";
  }

  async onOpen() {
    try {
      console.log("[leafpress] Panel onOpen called");

      // Set up refresh interval only on first call (not during refreshes)
      if (!this.isRefreshing && !this.statusRefreshInterval) {
        this.statusRefreshInterval = setInterval(() => {
          this.isRefreshing = true;
          this.onOpen().finally(() => {
            this.isRefreshing = false;
          });
        }, 2000);
      }

      const container = this.containerEl.children[1];
      container.empty();
      container.createEl("h2", { text: "leafpress" });

      const content = container.createEl("div");
      content.style.padding = "10px";

      // Check server status
      const serverRunning = await this.isServerRunning();
      const serverStatus = content.createEl("p");
      serverStatus.createEl("strong", { text: "Server: " });
      serverStatus.append(serverRunning ? "🟢 Running" : "⚪ Stopped");

      // Count pages built
      const pageCount = await this.countBuiltPages();
      const pageStatus = content.createEl("p");
      pageStatus.createEl("strong", { text: "Pages Built: " });
      pageStatus.append(pageCount.toString());

      // Load config for deployment info
      const config = await readLeafpressConfig(this.app);
      const deploymentConfigured = !!config?.deploy?.provider;

      let statusInfo: any = null;

      if (deploymentConfigured && config?.deploy) {
        // Get deployment status
        statusInfo = await this.getDeploymentStatus();

        const deployStatus = content.createEl("p");
        deployStatus.createEl("strong", { text: "Deployment: " });
        const provider = config.deploy.provider;
        const providerLabel: Record<string, string> = {
          "github-pages": "GitHub Pages",
          vercel: "Vercel",
          netlify: "Netlify",
        };
        deployStatus.append(providerLabel[provider] || provider);

        if (statusInfo?.lastDeploy) {
          const lastDeployEl = content.createEl("p");
          lastDeployEl.style.fontSize = "0.9rem";
          lastDeployEl.style.color = "var(--text-muted, #999)";
          lastDeployEl.createEl("strong", { text: "Last Deploy: " });
          lastDeployEl.append(statusInfo.lastDeploy);
        }

        if (statusInfo?.pendingCount > 0) {
          const pendingEl = content.createEl("p");
          pendingEl.style.color = "var(--text-warning, #ff9800)";
          pendingEl.createEl("strong", {
            text: `⚠ ${statusInfo.pendingCount} file(s) pending`,
          });
        }
      }

      // Add action buttons
      const buttonContainer = content.createEl("div");
      buttonContainer.style.marginTop = "15px";
      buttonContainer.style.display = "flex";
      buttonContainer.style.gap = "8px";
      buttonContainer.style.flexWrap = "wrap";

      // Start/Stop Server button
      const serverBtn = buttonContainer.createEl("button", { text: serverRunning ? "Stop Server" : "Start Server" });
      serverBtn.style.flex = "1";
      serverBtn.style.minWidth = "100px";
      serverBtn.addEventListener("click", async () => {
        serverBtn.disabled = true;
        previewBtn.disabled = true;
        if (deployBtn) deployBtn.disabled = true;
        serverBtn.textContent = serverRunning ? "Stopping..." : "Starting...";

        try {
          if (serverRunning) {
            await this.stopServer();
            await new Promise(resolve => setTimeout(resolve, 500));
          } else {
            await this.startServer();
            await this.waitForServerReady(10000); // Wait up to 10 seconds
          }
        } finally {
          await this.onOpen();
        }
      });

      // Open Preview button
      const previewBtn = buttonContainer.createEl("button", { text: "Open Preview" });
      previewBtn.style.flex = "1";
      previewBtn.style.minWidth = "100px";
      previewBtn.disabled = !serverRunning;
      previewBtn.title = serverRunning ? "Open preview in browser" : "Server must be running to open preview";
      previewBtn.addEventListener("click", () => {
        spawn("open", ["http://localhost:3000"]);
      });

      // Deploy button (if configured)
      let deployBtn: HTMLButtonElement | null = null;
      if (deploymentConfigured) {
        // Show pending files summary if available
        if (statusInfo && statusInfo.pendingFiles.length > 0) {
          const pendingSummary = content.createEl("div", {
            cls: "leafpress-pending-files",
          });
          pendingSummary.style.backgroundColor = "var(--background-secondary, #f5f5f5)";
          pendingSummary.style.border = "1px solid var(--border-color, #ddd)";
          pendingSummary.style.borderRadius = "4px";
          pendingSummary.style.padding = "8px";
          pendingSummary.style.marginTop = "16px";
          pendingSummary.style.marginBottom = "12px";
          pendingSummary.style.fontSize = "0.85rem";

          pendingSummary.createEl("strong", {
            text: "Pending changes:",
          });
          const fileList = pendingSummary.createEl("ul");
          fileList.style.margin = "4px 0";
          fileList.style.paddingLeft = "20px";

          statusInfo.pendingFiles.slice(0, 5).forEach((file: any) => {
            const li = fileList.createEl("li");
            const icon =
              file.status === "added" ? "+" : file.status === "modified" ? "~" : "−";
            li.textContent = `${icon} ${file.file}`;
            li.style.fontSize = "0.85rem";
            li.style.marginBottom = "2px";
          });

          if (statusInfo.pendingFiles.length > 5) {
            const more = fileList.createEl("li");
            more.textContent = `... and ${statusInfo.pendingFiles.length - 5} more`;
            more.style.fontSize = "0.85rem";
            more.style.fontStyle = "italic";
            more.style.color = "var(--text-muted, #999)";
          }
        }

        deployBtn = buttonContainer.createEl("button", { text: "Deploy" });
        deployBtn.style.flex = "1";
        deployBtn.style.minWidth = "100px";
        deployBtn.style.backgroundColor = "var(--interactive-accent, #7c3aed)";
        deployBtn.style.color = "white";
        deployBtn.addEventListener("click", async () => {
          deployBtn!.disabled = true;
          deployBtn!.textContent = "Deploying...";

          try {
            if (this.binaryManager) {
              await this.binaryManager.ensureBinary();
              const result = await this.binaryManager.execCommand([
                "deploy",
                "--skip-build",
              ]);

              if (result.success) {
                const urlMatch = result.stdout.match(/https?:\/\/[^\s]+/);
                const url = urlMatch ? urlMatch[0] : "Deployment successful";
                new Notice(`✓ Deployed: ${url}`);
              } else {
                new Notice("✗ Deployment failed");
                console.error(result.stderr);
              }
            }
          } catch (err) {
            new Notice(`✗ Error: ${err}`);
            console.error(err);
          } finally {
            await this.onOpen();
          }
        });
      }

      console.log("[leafpress] Panel rendered successfully");
    } catch (err) {
      console.error("[leafpress] Error rendering panel:", err);
      const container = this.containerEl.children[1];
      container.empty();
      container.createEl("p", { text: `Error: ${err}` });
    }
  }

  private isServerRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("sh", ["-c", "lsof -ti:3000"]);
      let output = "";

      proc.stdout?.on("data", (data) => {
        output += data.toString();
      });

      proc.on("close", () => {
        resolve(output.trim().length > 0);
      });

      proc.on("error", () => {
        resolve(false);
      });
    });
  }

  private async countBuiltPages(): Promise<number> {
    try {
      const vaultAdapter = (this.app.vault.adapter as any);
      const sitePath = "_site";

      // Recursively count all HTML files in _site directory
      const countHtmlFiles = async (dir: string): Promise<number> => {
        try {
          const contents = await vaultAdapter.list(dir);
          let count = 0;

          if (contents.files) {
            count += contents.files.filter((f: string) => f.endsWith(".html")).length;
          }

          if (contents.folders) {
            for (const folder of contents.folders) {
              count += await countHtmlFiles(folder);
            }
          }

          return count;
        } catch {
          return 0;
        }
      };

      return await countHtmlFiles(sitePath);
    } catch {
      return 0;
    }
  }

  private async startServer(): Promise<void> {
    if (!this.binaryManager) return;

    try {
      // Kill existing process on port 3000 first
      await this.killPortProcess(3000);

      // Start server
      await this.binaryManager.ensureBinary();
      this.binaryManager.execCommand(["serve"]);
    } catch (err) {
      console.error("[leafpress] Error starting server:", err);
    }
  }

  private async stopServer(): Promise<void> {
    try {
      await this.killPortProcess(3000);
    } catch (err) {
      console.error("[leafpress] Error stopping server:", err);
    }
  }

  private killPortProcess(port: number): Promise<void> {
    return new Promise((resolve) => {
      const proc = spawn("sh", ["-c", `lsof -ti:${port} | xargs kill -9`]);
      proc.on("close", () => resolve());
      proc.on("error", () => resolve());
    });
  }

  private waitForServerReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const checkInterval = setInterval(async () => {
        const isReady = await this.isServerRunning();
        if (isReady || Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 200);
    });
  }

  private async getDeploymentStatus(): Promise<{
    pendingCount: number;
    lastDeploy: string;
    liveUrl: string;
    pendingFiles: Array<{ status: string; file: string }>;
  } | null> {
    try {
      const vaultPath = this.getVaultPath();
      const stateFilePath = ".leafpress-deploy-state.json";

      // Read deployment state file
      let stateContent: string;
      try {
        stateContent = await this.app.vault.adapter.read(stateFilePath);
      } catch (err) {
        console.log("[leafpress] Deployment state file not found:", err);
        return null;
      }

      let deployState: any;
      try {
        deployState = JSON.parse(stateContent);
      } catch (parseErr) {
        console.error("[leafpress] Failed to parse deployment state JSON:", parseErr);
        return null;
      }

      const lastDeploy = deployState.lastDeploy;

      if (!lastDeploy) {
        console.log("[leafpress] No lastDeploy found in deployment state");
        return null;
      }

      // Format last deploy time
      const deployTime = new Date(lastDeploy.timestamp);
      const now = new Date();
      const diffMs = now.getTime() - deployTime.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      let lastDeployStr = "";
      if (diffHours > 24) {
        lastDeployStr = `${Math.floor(diffHours / 24)}d ago`;
      } else if (diffHours > 0) {
        lastDeployStr = `${diffHours}h ago`;
      } else if (diffMins > 0) {
        lastDeployStr = `${diffMins}m ago`;
      } else {
        lastDeployStr = "Just now";
      }

      // Get current _site files and compare with lastDeploy.filesDeployed
      const pendingFiles: Array<{ status: string; file: string }> = [];
      const siteDir = path.join(vaultPath, "_site");

      try {
        const currentFiles = await this.getAllFilesInDir(siteDir);
        const deployedFiles = Object.keys(lastDeploy.filesDeployed || {});

        // Find added files (exist now but not in last deploy)
        for (const file of currentFiles) {
          if (!deployedFiles.includes(file)) {
            pendingFiles.push({
              status: "added",
              file: file.replace(/^\//, ""), // Remove leading slash
            });
          }
        }

        // Find deleted files (existed in last deploy but not now)
        for (const file of deployedFiles) {
          if (!currentFiles.includes(file)) {
            pendingFiles.push({
              status: "deleted",
              file: file.replace(/^\//, ""), // Remove leading slash
            });
          }
        }

        // Note: Modified detection would require comparing hashes
        // which is complex without the full build output
      } catch (err) {
        console.log("[leafpress] Could not scan _site directory:", err);
        // Fallback: assume there might be pending files
      }

      console.log("[leafpress] Parsed deployment status:", {
        pendingCount: pendingFiles.length,
        lastDeploy: lastDeployStr,
        url: lastDeploy.url,
        fileCount: pendingFiles.length,
      });

      return {
        pendingCount: pendingFiles.length,
        lastDeploy: lastDeployStr,
        liveUrl: lastDeploy.url,
        pendingFiles: pendingFiles.slice(0, 50), // Limit to 50 files
      };
    } catch (err) {
      console.error("[leafpress] Error getting deployment status:", err);
      return null;
    }
  }

  private async getAllFilesInDir(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const adapter = this.app.vault.adapter as any;
      const baseLength = dir.length + (dir.endsWith("/") ? 0 : 1);

      const walkDir = async (currentDir: string) => {
        try {
          const contents = await adapter.list(currentDir);

          if (contents.files) {
            for (const file of contents.files) {
              // Extract path relative to dir (e.g., _site/index.html -> /index.html)
              const rel = file.substring(baseLength);
              files.push(`/${rel}`);
            }
          }

          if (contents.folders) {
            for (const folder of contents.folders) {
              await walkDir(folder);
            }
          }
        } catch (err) {
          console.log(`[leafpress] Error reading directory ${currentDir}:`, err);
        }
      };

      await walkDir(dir);
    } catch (err) {
      console.log("[leafpress] Error walking directory:", err);
    }

    return files;
  }

  async onClose() {
    console.log("[leafpress] Panel closed");
    // Clear refresh interval
    if (this.statusRefreshInterval) {
      clearInterval(this.statusRefreshInterval);
      this.statusRefreshInterval = null;
    }
  }
}
