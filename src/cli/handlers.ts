import { App, Notice, Modal } from "obsidian";
import { BinaryManager } from "./manager";
import { CLIResult } from "./types";
import * as path from "path";
import { spawn } from "child_process";

export class CommandHandlers {
  private app: App;
  private binaryManager: BinaryManager;
  private plugin: any;

  constructor(app: App, binaryManager: BinaryManager, plugin: any) {
    this.app = app;
    this.binaryManager = binaryManager;
    this.plugin = plugin;
  }

  async initialize(): Promise<void> {
    try {
      const stat = await this.app.vault.adapter.stat("leafpress.json");
      if (stat) {
        new Notice("leafpress.json already exists");
        return;
      }
    } catch {
      // File doesn't exist, proceed
    }

    // Show initialize wizard modal
    new InitializeModal(this.app).open();
  }

  async build(): Promise<void> {
    try {
      console.log("[leafpress] Build handler started");
      new Notice("Preparing...");
      console.log("[leafpress] Ensuring binary exists...");
      await this.binaryManager.ensureBinary();
      new Notice("Building your site...");

      const result = await this.binaryManager.execCommand(["build"]);

      if (result.success) {
        new Notice("✓ Build successful!");
      } else {
        new Notice("✗ Build failed. Check console for details.");
        console.error(result.stderr);
      }
    } catch (err) {
      new Notice(`✗ Error: ${err}`);
      console.error(err);
    }
  }

  async preview(): Promise<void> {
    try {
      new Notice("Preparing...");
      await this.binaryManager.ensureBinary();

      // Kill existing process on port 3000
      new Notice("Stopping existing preview server...");
      await this.killPortProcess(3000);

      // Start serve without waiting (it's a long-running process)
      new Notice("Starting preview server...");
      this.binaryManager.execCommand(["serve"]);

      // Give server a moment to start, then open browser
      setTimeout(() => {
        spawn("open", ["http://localhost:3000"]);
        new Notice("✓ Preview server started at http://localhost:3000");
      }, 2000);
    } catch (err) {
      new Notice(`✗ Error: ${err}`);
      console.error(err);
    }
  }

  private killPortProcess(port: number): Promise<void> {
    return new Promise((resolve) => {
      const platform = process.platform;
      let cmd: string;

      if (platform === "win32") {
        cmd = `netstat -ano | findstr :${port} | for /f "tokens=5" %a in ('more') do taskkill /PID %a /F`;
      } else {
        cmd = `lsof -ti:${port} | xargs kill -9`;
      }

      const proc = spawn("sh", ["-c", cmd]);
      proc.on("close", () => resolve());
      proc.on("error", () => resolve()); // Ignore errors if process doesn't exist
    });
  }

  async deploy(): Promise<void> {
    try {
      new Notice("Preparing...");
      await this.binaryManager.ensureBinary();
      new Notice("Starting deployment...");

      const result = await this.binaryManager.execCommand([
        "deploy",
        "--skip-build",
      ]);

      if (result.success) {
        // Parse deployment URL from output
        const urlMatch = result.stdout.match(/https?:\/\/[^\s]+/);
        const url = urlMatch ? urlMatch[0] : "Deployment successful";

        new Notice(`✓ Deployed: ${url}`);
        // TODO: show deployment result modal with URL
      } else {
        new Notice("✗ Deployment failed");
        console.error(result.stderr);
      }
    } catch (err) {
      new Notice(`✗ Error: ${err}`);
      console.error(err);
    }
  }
}

class InitializeModal extends Modal {
  private title: string = "";
  private author: string = "";
  private baseURL: string = "";
  private description: string = "";

  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Initialize leafpress Site" });

    const form = contentEl.createEl("form");

    // Title field
    const titleLabel = form.createEl("label", { text: "Site Title (required)" });
    titleLabel.style.display = "block";
    titleLabel.style.marginBottom = "10px";
    const titleInput = form.createEl("input", {
      attr: {
        type: "text",
        placeholder: "My Digital Garden"
      }
    });
    titleInput.style.width = "100%";
    titleInput.style.marginBottom = "15px";
    titleInput.addEventListener("input", (e) => {
      this.title = (e.target as HTMLInputElement).value;
    });

    // Author field
    const authorLabel = form.createEl("label", { text: "Author (optional)" });
    authorLabel.style.display = "block";
    authorLabel.style.marginBottom = "10px";
    const authorInput = form.createEl("input", {
      attr: {
        type: "text",
        placeholder: "Your Name"
      }
    });
    authorInput.style.width = "100%";
    authorInput.style.marginBottom = "15px";
    authorInput.addEventListener("input", (e) => {
      this.author = (e.target as HTMLInputElement).value;
    });

    // Base URL field
    const baseURLLabel = form.createEl("label", { text: "Base URL (optional)" });
    baseURLLabel.style.display = "block";
    baseURLLabel.style.marginBottom = "10px";
    const baseURLInput = form.createEl("input", {
      attr: {
        type: "url",
        placeholder: "https://example.com"
      }
    });
    baseURLInput.style.width = "100%";
    baseURLInput.style.marginBottom = "15px";
    baseURLInput.addEventListener("input", (e) => {
      this.baseURL = (e.target as HTMLInputElement).value;
    });

    // Description field
    const descLabel = form.createEl("label", { text: "Description (optional)" });
    descLabel.style.display = "block";
    descLabel.style.marginBottom = "10px";
    const descInput = form.createEl("textarea", {
      attr: {
        placeholder: "A collection of my thoughts"
      }
    });
    descInput.style.width = "100%";
    descInput.style.marginBottom = "15px";
    descInput.addEventListener("input", (e) => {
      this.description = (e.target as HTMLTextAreaElement).value;
    });

    // Buttons
    const buttonContainer = contentEl.createEl("div");
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "10px";
    buttonContainer.style.justifyContent = "flex-end";

    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = buttonContainer.createEl("button", { text: "Initialize" });
    submitBtn.addEventListener("click", () => this.submit());
  }

  private async submit() {
    if (!this.title.trim()) {
      new Notice("Site title is required");
      return;
    }

    try {
      new Notice("Initializing site...");

      // Create directories (use relative paths for vault adapter)
      const notesDir = "notes";
      const staticDir = "static/images";

      await (this.app.vault.adapter as any).mkdir(notesDir);
      await (this.app.vault.adapter as any).mkdir(staticDir);

      // Create index.md
      const indexContent = `# ${this.title}\n\nWelcome to your digital garden.`;
      await this.app.vault.adapter.write("index.md", indexContent);

      // Create leafpress.json with default nav
      const config: any = {
        title: this.title,
        nav: [
          { label: "Notes", path: "/notes" },
          { label: "Tags", path: "/tags" }
        ]
      };
      if (this.author) config.author = this.author;
      if (this.baseURL) config.baseURL = this.baseURL;
      if (this.description) config.description = this.description;

      await this.app.vault.adapter.write("leafpress.json", JSON.stringify(config, null, 2));

      new Notice("✓ Site initialized successfully!");
      this.close();
    } catch (err) {
      new Notice(`✗ Failed to initialize site: ${err}`);
      console.error(err);
    }
  }
}
