import { ItemView, WorkspaceLeaf } from "obsidian";
import { spawn } from "child_process";
import { BinaryManager } from "./cli/manager";

export const VIEW_TYPE_LEAFPRESS = "leafpress-view";

export class LeafpressPanel extends ItemView {
  private binaryManager: BinaryManager | null = null;

  constructor(leaf: WorkspaceLeaf, binaryManager?: BinaryManager) {
    super(leaf);
    this.binaryManager = binaryManager || null;
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

  async onClose() {
    console.log("[leafpress] Panel closed");
  }
}
