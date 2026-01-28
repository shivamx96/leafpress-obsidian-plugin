import {ItemView, WorkspaceLeaf, Notice, EventRef} from "obsidian";
import { ChildProcess } from "child_process";
import * as crypto from "crypto";
import { BinaryManager } from "./cli/manager";
import { readLeafpressConfig } from "./utils/config";
import { openInBrowser, isPortInUse, killPortProcess } from "./utils/platform";

interface VaultAdapter {
  basePath?: string;
  path?: string;
  vault?: { dir?: string };
  read(path: string): Promise<string>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

interface DeployState {
  lastDeploy?: {
    timestamp: string;
    url: string;
    sourceFiles?: Record<string, string>;
  };
}

interface PendingFile {
  status: string;
  file: string;
}

interface DeploymentStatus {
  pendingCount: number;
  lastDeploy: string;
  liveUrl: string;
  pendingFiles: PendingFile[];
}

export const VIEW_TYPE_LEAFPRESS = "leafpress-view";

export class LeafpressPanel extends ItemView {
  private binaryManager: BinaryManager | null = null;
  private vaultPath: string | null = null;
  private fileChangeListener: EventRef | null = null;
  private serverProcess: ChildProcess | null = null;
  private isStartingServer = false;
  private activeIntervals: NodeJS.Timeout[] = [];

  constructor(leaf: WorkspaceLeaf, binaryManager?: BinaryManager) {
    super(leaf);
    this.binaryManager = binaryManager || null;
  }

  private getVaultPath(): string {
    if (this.vaultPath) return this.vaultPath;

    try {
      const adapter = this.app.vault.adapter as VaultAdapter;

      // Try different properties
      if (adapter.basePath && typeof adapter.basePath === "string") {
        this.vaultPath = adapter.basePath;
      } else if (adapter.path && typeof adapter.path === "string") {
        this.vaultPath = adapter.path;
      } else if (adapter.vault?.dir) {
        this.vaultPath = adapter.vault.dir;
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
    // eslint-disable-next-line
    return "leafpress";
  }

  getIcon() {
    return "leaf";
  }

  async onOpen() {
    try {

      // Set up file change listener on first call
      if (!this.fileChangeListener) {
        this.fileChangeListener = this.app.vault.on("modify", (file) => {
          // Refresh when markdown files, deployment state, or _site directory changes
          if (
            file.path.endsWith(".md") ||
            file.name === ".leafpress-deploy-state.json" ||
            file.path.startsWith("_site/")
          ) {
            void this.renderPanel();
          }
        });

        this.registerEvent(this.fileChangeListener);
      }

      await this.renderPanel();
    } catch (err) {
      console.error("[leafpress] Error in panel onOpen:", err);
      const container = this.containerEl.children[1];
      container.empty();
      container.createEl("p", { text: `Error: ${err}` });
    }
  }

  private async renderPanel(): Promise<void> {
    try {
      const container = this.containerEl.children[1];
      container.empty();
      // eslint-disable-next-line
      container.createEl("h2", { text: "leafpress" });

      const content = container.createEl("div", { cls: "leafpress-panel-content" });

      // Check server status
      const serverRunning = await this.isServerRunning();
      const serverStatus = content.createEl("p");
      serverStatus.createEl("strong", { text: "Server: " });
      serverStatus.append(serverRunning ? "🟢 Running" : "⚪ Stopped");

      // Count pages built
      const pageCount = await this.countBuiltPages();
      const pageStatus = content.createEl("p");
      pageStatus.createEl("strong", { text: "Pages built: " });
      pageStatus.append(pageCount.toString());

      // Load config for deployment info
      const config = await readLeafpressConfig(this.app);
      const deploymentConfigured = !!config?.deploy?.provider;

      let statusInfo: DeploymentStatus | null = null;

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
          const lastDeployEl = content.createEl("p", { cls: "leafpress-deploy-info" });
          lastDeployEl.createEl("strong", { text: "Last deploy: " });
          lastDeployEl.append(statusInfo.lastDeploy);
        }

        if (statusInfo && statusInfo.pendingCount > 0) {
          const pendingEl = content.createEl("p", { cls: "leafpress-warning-text" });
          pendingEl.createEl("strong", {
            text: `⚠ ${statusInfo.pendingCount} file(s) pending`,
          });
        }
      }

      // Add action buttons
      const buttonContainer = content.createEl("div", { cls: "leafpress-panel-buttons" });

      // Start/Stop Server button
      const serverBtn = buttonContainer.createEl("button", {
        text: serverRunning ? "Stop server" : "Start server",
        cls: "leafpress-panel-btn",
      });
      serverBtn.addEventListener("click", () => {
        serverBtn.disabled = true;
        previewBtn.disabled = true;
        if (deployBtn) deployBtn.disabled = true;
        serverBtn.textContent = serverRunning ? "Stopping..." : "Starting...";

        void (async () => {
          try {
            if (serverRunning) {
              await this.stopServer();
              await this.waitForServerStopped(5000);
            } else {
              await this.startServer();
              await this.waitForServerReady(10000);
            }
          } finally {
            await this.renderPanel();
          }
        })();
      });

      // Open Preview button
      const previewBtn = buttonContainer.createEl("button", {
        text: "Open preview",
        cls: "leafpress-panel-btn",
      });
      previewBtn.disabled = !serverRunning;
      previewBtn.title = serverRunning ? "Open preview in browser" : "Server must be running to open preview";
      previewBtn.addEventListener("click", () => {
        openInBrowser("http://localhost:3000");
      });

      // Deploy button (if configured)
      let deployBtn: HTMLButtonElement | null = null;
      if (deploymentConfigured) {
        // Show pending files summary if available
        if (statusInfo && statusInfo.pendingFiles.length > 0) {
          const pendingSummary = content.createEl("div", {
            cls: "leafpress-pending-files",
          });

          pendingSummary.createEl("strong", {
            text: "Pending changes:",
          });
          const fileList = pendingSummary.createEl("ul", { cls: "leafpress-file-list" });

          statusInfo.pendingFiles.slice(0, 5).forEach((file: PendingFile) => {
            const li = fileList.createEl("li", { cls: "leafpress-file-item" });
            let icon = "?";
            if (file.status === "added") {
              icon = "+";
            } else if (file.status === "modified") {
              icon = "~";
            } else if (file.status === "deleted") {
              icon = "−";
            }
            li.textContent = `${icon} ${file.file}`;
          });

          if (statusInfo.pendingFiles.length > 5) {
            const more = fileList.createEl("li", { cls: "leafpress-more-files" });
            more.textContent = `... and ${statusInfo.pendingFiles.length - 5} more`;
          }
        }

        deployBtn = buttonContainer.createEl("button", {
          text: "Deploy",
          cls: "leafpress-deploy-btn",
        });
        deployBtn.addEventListener("click", () => {
          if (!deployBtn) return;
          deployBtn.disabled = true;
          deployBtn.textContent = "Deploying...";

          void (async () => {
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
                  new Notice(`Deployed: ${url}`);
                } else {
                  new Notice("Deployment failed");
                  console.error(result.stderr);
                }
              }
            } catch (err) {
              new Notice(`✗ Error: ${err}`);
              console.error(err);
            } finally {
              await this.renderPanel();
            }
          })();
        });
      }

    } catch (err) {
      console.error("[leafpress] Error rendering panel:", err);
      const container = this.containerEl.children[1];
      container.empty();
      container.createEl("p", { text: `Error: ${err}` });
    }
  }

  private isServerRunning(): Promise<boolean> {
    return isPortInUse(3000);
  }

  private async countBuiltPages(): Promise<number> {
    try {
      const vaultAdapter = (this.app.vault.adapter);
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
    if (!this.binaryManager) {
      return;
    }

    // Prevent race condition from multiple rapid clicks
    if (this.isStartingServer) {
      return;
    }

    this.isStartingServer = true;

    try {
      // Stop existing server if we have a reference
      if (this.serverProcess) {
        this.binaryManager.stopServerProcess(this.serverProcess);
        this.serverProcess = null;
        await new Promise((r) => setTimeout(r, 500));
      }

      // Start new server
      const result = await this.binaryManager.startServerProcess();

      if (result.error) {
        new Notice(`Failed to start server: ${result.error}`);
        return;
      }

      this.serverProcess = result.process;

      if (this.serverProcess) {
        // Handle unexpected server exit
        this.serverProcess.on("exit", () => {
          this.serverProcess = null;
          void this.renderPanel();
        });
      }
    } catch (err) {
      new Notice(`Error starting server: ${err}`);
    } finally {
      this.isStartingServer = false;
    }
  }

  private async stopServer(): Promise<void> {
    try {
      if (this.serverProcess && this.binaryManager) {
        this.binaryManager.stopServerProcess(this.serverProcess);
        this.serverProcess = null;
      } else {
        // Fallback: kill by port if we lost the process reference
        await killPortProcess(3000);
      }
      // Wait for process to actually terminate
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      console.error("[leafpress] Error stopping server:", err);
    }
  }

  private waitForServerReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        void (async () => {
          const isReady = await this.isServerRunning();
          const elapsed = Date.now() - startTime;
          if (isReady || elapsed > timeoutMs) {
            clearInterval(checkInterval);
            const idx = this.activeIntervals.indexOf(checkInterval);
            if (idx > -1) this.activeIntervals.splice(idx, 1);
            resolve();
          }
        })();
      }, 200);
      this.activeIntervals.push(checkInterval);
    });
  }

  private waitForServerStopped(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        void (async () => {
          const isRunning = await this.isServerRunning();
          const elapsed = Date.now() - startTime;
          if (!isRunning || elapsed > timeoutMs) {
            clearInterval(checkInterval);
            const idx = this.activeIntervals.indexOf(checkInterval);
            if (idx > -1) this.activeIntervals.splice(idx, 1);
            resolve();
          }
        })();
      }, 200);
      this.activeIntervals.push(checkInterval);
    });
  }

  private async getDeploymentStatus(): Promise<DeploymentStatus | null> {
    try {
      const stateFilePath = ".leafpress-deploy-state.json";
      const configDir = this.app.vault.configDir;

      // Read deployment state file
      let stateContent: string;
      try {
        stateContent = await this.app.vault.adapter.read(stateFilePath);
      } catch {
        return null;
      }

      let deployState: DeployState;
      try {
        deployState = JSON.parse(stateContent) as DeployState;
      } catch (parseErr) {
        console.error("[leafpress] Failed to parse deployment state JSON:", parseErr);
        return null;
      }

      const lastDeploy = deployState.lastDeploy;

      if (!lastDeploy) {
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

      // Load config to get ignore patterns
      const config = await readLeafpressConfig(this.app);
      const ignorePatterns = config?.ignore || [];
      const defaultIgnore = [".DS_Store", "Thumbs.db", configDir, "_site"];

      const shouldIgnore = (filePath: string): boolean => {
        const normalized = filePath.replace(/^\//, "");
        // Check default ignores
        for (const pattern of defaultIgnore) {
          if (normalized.startsWith(pattern)) return true;
        }
        // Check config ignores
        for (const pattern of ignorePatterns) {
          if (normalized.includes(pattern)) return true;
        }
        return false;
      };

      // Compare source files with deployed state
      const pendingFiles: PendingFile[] = [];

      try {
        // Get current source files and their hashes
        const currentSourceFiles = await this.getSourceFilesWithHashes();
        const deployedSourceFiles = lastDeploy.sourceFiles || {};

        // Find modified, added files
        for (const [file, hash] of Object.entries(currentSourceFiles)) {
          if (shouldIgnore(file)) continue;

          const deployedHash = deployedSourceFiles[file];
          if (!deployedHash) {
            pendingFiles.push({
              status: "added",
              file: file.replace(/^\//, ""),
            });
          } else if (deployedHash !== hash) {
            pendingFiles.push({
              status: "modified",
              file: file.replace(/^\//, ""),
            });
          }
        }

        // Find deleted files
        for (const file of Object.keys(deployedSourceFiles)) {
          if (shouldIgnore(file)) continue;

          if (!currentSourceFiles[file]) {
            pendingFiles.push({
              status: "deleted",
              file: file.replace(/^\//, ""),
            });
          }
        }
      } catch {
        // Could not scan source files
      }

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

  private async getSourceFilesWithHashes(): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const configDir = this.app.vault.configDir;

    // Load config to get ignore patterns and output directory
    const config = await readLeafpressConfig(this.app);
    const ignorePatterns = config?.ignore || [];
    const outputDir = config?.outputDir || "_site";

    // Reserved paths (matching backend logic from leafpress CLI)
    const reservedPaths: Record<string, boolean> = {
      "leafpress.json": true,
      "style.css": true,
      "static": true,
      "_site": true,
      ".leafpress": true,
      ".git": true,
      ".gitignore": true,
      [configDir]: true,
      "node_modules": true,
      "docs": true,
    };

    // Files to skip (matching backend)
    const skipFiles: Record<string, boolean> = {
      ".leafpress-deploy-state.json": true,
      ".DS_Store": true,
      "Thumbs.db": true,
    };

    // Add output directory to reserved paths
    reservedPaths[outputDir] = true;

    const shouldSkipDir = (dirName: string): boolean => {
      // Skip hidden directories
      if (dirName.startsWith(".")) return true;
      // Skip reserved paths
      if (reservedPaths[dirName]) return true;
      // Skip user-configured ignore patterns
      for (const pattern of ignorePatterns) {
        if (dirName === pattern) return true;
      }
      return false;
    };

    const shouldSkipFile = (fileName: string): boolean => {
      // Skip hidden files
      if (fileName.startsWith(".")) return true;
      // Skip specific files
      if (skipFiles[fileName]) return true;
      return false;
    };

    // Get all markdown files from vault
    const markdownFiles = this.app.vault.getMarkdownFiles();

    for (const file of markdownFiles) {
      const filePath = file.path;
      const pathParts = filePath.split("/");
      const fileName = pathParts[pathParts.length - 1];
      const topLevelDir = pathParts[0];

      // Skip if in reserved/ignored directory
      if (pathParts.length > 1 && shouldSkipDir(topLevelDir)) {
        continue;
      }

      // Skip ignored files
      if (shouldSkipFile(fileName)) {
        continue;
      }

      try {
        const content = await this.app.vault.cachedRead(file);
        const hash = this.sha1Hash(content);
        files[`/${filePath}`] = hash;
      } catch {
        // Error reading file
      }
    }

    // Also include leafpress.json for tracking config changes
    try {
      const configContent = await this.app.vault.adapter.read("leafpress.json");
      files["/leafpress.json"] = this.sha1Hash(configContent);
    } catch {
      // Config might not exist
    }

    return files;
  }

  private sha1Hash(content: string): string {
    // Use SHA1 to match the backend (leafpress CLI)
    return crypto.createHash("sha1").update(content).digest("hex");
  }

  private async getAllFilesInDir(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const adapter = this.app.vault.adapter;
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
        } catch {
          // Error reading directory
        }
      };

      await walkDir(dir);
    } catch {
      // Error walking directory
    }

    return files;
  }

  async onClose() {
    // Clear any active intervals
    for (const interval of this.activeIntervals) {
      clearInterval(interval);
    }
    this.activeIntervals = [];

    // Note: We don't stop the server on panel close since user may want it running
    // File change listener is automatically unregistered via registerEvent
  }
}
