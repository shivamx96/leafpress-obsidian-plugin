import { App, Notice, Modal } from "obsidian";
import { BinaryManager } from "./manager";
import { openInBrowser, isPortInUse } from "../utils/platform";

interface DeploymentSuccess {
  success: true;
  url: string;
  output: string;
}

interface DeploymentError {
  success: false;
  error: string;
  output: string;
  isNonInteractiveError: boolean;
  isMissingTokenError: boolean;
}

type DeploymentResult = DeploymentSuccess | DeploymentError;

interface FileSystemAdapter {
  basePath?: string;
  path?: string;
  mkdir(path: string): Promise<void>;
}

export class CommandHandlers {
  private app: App;
  private binaryManager: BinaryManager;

  constructor(app: App, binaryManager: BinaryManager, _plugin: unknown) {
    this.app = app;
    this.binaryManager = binaryManager;
  }

  async initialize(): Promise<void> {
    try {
      const stat = await this.app.vault.adapter.stat("leafpress.json");
      if (stat) {
        new Notice("Configuration file already exists");
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
      new Notice("Preparing...");
      await this.binaryManager.ensureBinary();
      new Notice("Building your site...");

      const result = await this.binaryManager.execCommand(["build"]);

      if (result.success) {
        new Notice("Build successful");
      } else {
        new Notice("Build failed. Check console for details.");
        console.error(result.stderr);
      }
    } catch (err) {
      new Notice(`Error: ${String(err)}`);
      console.error(err);
    }
  }

  async preview(): Promise<void> {
    try {
      // Check if server is already running
      const serverRunning = await isPortInUse(3000);

      if (serverRunning) {
        // Server is already running, just open it
        openInBrowser("http://localhost:3000");
        new Notice("Preview opened in browser");
      } else {
        // Server not running, start it
        new Notice("Preparing...");
        await this.binaryManager.ensureBinary();
        new Notice("Starting preview server...");
        void this.binaryManager.execCommand(["serve"]);

        // Give server a moment to start, then open browser
        setTimeout(() => {
          openInBrowser("http://localhost:3000");
          new Notice("Preview server started");
        }, 2000);
      }
    } catch (err) {
      new Notice(`Error: ${String(err)}`);
      console.error(err);
    }
  }

  async deploy(reconfigure: boolean = false): Promise<void> {
    try {
      new Notice("Preparing...");
      await this.binaryManager.ensureBinary();

      const args = ["deploy", "--skip-build"];
      if (reconfigure) {
        args.push("--reconfigure");
        new Notice("Reconfiguring deployment...");
      } else {
        new Notice("Starting deployment...");
      }

      const result = await this.binaryManager.execCommand(args);

      if (result.success) {
        // Parse deployment URL from output
        const urlMatch = result.stdout.match(/https?:\/\/[^\s]+/);
        const url = urlMatch ? urlMatch[0] : "Deployment successful";

        const deployResult: DeploymentSuccess = {
          url,
          success: true,
          output: result.stdout,
        };

        new Notice(
          `${reconfigure ? "Configuration complete" : "Deployed"}: ${url}`
        );
        new DeploymentResultModal(this.app, deployResult).open();
      } else {
        // Check for specific error types
        const isNonInteractiveError = result.stderr.includes(
          "non-interactive mode"
        );
        const isMissingTokenError =
          result.stderr.includes("no deploy configuration") ||
          result.stderr.includes("token") ||
          result.stderr.includes("authentication");

        const errorResult: DeploymentError = {
          success: false,
          error: result.stderr,
          output: result.stdout,
          isNonInteractiveError,
          isMissingTokenError,
        };
        new DeploymentResultModal(this.app, errorResult).open();
      }
    } catch (err) {
      new Notice(`Error: ${String(err)}`);
      console.error(err);
    }
  }
}

class DeploymentResultModal extends Modal {
  private result: DeploymentResult;
  private vaultPath: string;

  constructor(app: App, result: DeploymentResult) {
    super(app);
    this.result = result;
    const adapter = this.app.vault.adapter as FileSystemAdapter;
    this.vaultPath = adapter.basePath ?? adapter.path ?? "";
  }

  private getDeployCommand(): string {
    const configDir = this.app.vault.configDir;
    const isWindows = process.platform === "win32";
    if (isWindows) {
      return `cd "${this.vaultPath}" && .\\${configDir}\\plugins\\leafpress\\bin\\leafpress.exe deploy`;
    }
    return `cd "${this.vaultPath}" && ./${configDir}/plugins/leafpress/bin/leafpress deploy`;
  }

  onOpen(): void {
    const { contentEl } = this;
    const result = this.result;

    if (result.success) {
      contentEl.createEl("h2", { text: "Deployment complete" });

      const urlEl = contentEl.createEl("div", {
        cls: "deployment-result-section",
      });
      urlEl.createEl("strong", { text: "Site URL:" });
      const link = urlEl.createEl("a", {
        text: result.url,
        href: result.url,
        cls: "leafpress-link",
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        window.open(result.url);
      });

      if (result.output) {
        const outputEl = contentEl.createEl("div", {
          cls: "deployment-result-section",
        });
        outputEl.createEl("strong", { text: "Output:" });
        const preEl = outputEl.createEl("pre", { cls: "leafpress-pre" });
        preEl.textContent = result.output;
      }
      return;
    }

    // Error case - result is DeploymentError (narrowed by the return above)
    const errorResult = result as DeploymentError;
    contentEl.createEl("h2", { text: "Deployment failed" });

    // Special handling for non-interactive mode errors
    if (errorResult.isNonInteractiveError) {
        const instructionsEl = contentEl.createEl("div", {
          cls: "leafpress-warning-box",
        });

        instructionsEl.createEl("strong", { text: "Setup required" });
        const setupSteps = instructionsEl.createEl("ol", { cls: "leafpress-steps" });

        const li1 = setupSteps.createEl("li");
        li1.appendText("Run in terminal: ");
        const code1 = li1.createEl("code");
        code1.textContent = this.getDeployCommand();

        const li2 = setupSteps.createEl("li");
        li2.textContent =
          "Complete the authentication/configuration in the interactive prompt";

        const li3 = setupSteps.createEl("li");
        li3.textContent =
          "After setup, you can deploy from the plugin";

        const docsEl = instructionsEl.createEl("p", { cls: "leafpress-info-text" });
        docsEl.createEl("strong", { text: "Why?" });
        docsEl.appendChild(
          document.createTextNode(
            " Initial setup requires browser authentication or token entry, which needs an interactive terminal."
          )
        );
    } else if (errorResult.isMissingTokenError) {
      const tokenEl = contentEl.createEl("div", {
        cls: "leafpress-warning-box",
      });

      tokenEl.createEl("strong", { text: "Authentication required" });
      const tokenSteps = tokenEl.createEl("ol", { cls: "leafpress-steps" });

      const li1 = tokenSteps.createEl("li");
      li1.appendText("Run in terminal: ");
      const code2 = li1.createEl("code");
      code2.textContent = this.getDeployCommand();

      const li2 = tokenSteps.createEl("li");
      li2.textContent = "Complete the provider authentication setup";

      const li3 = tokenSteps.createEl("li");
      li3.textContent = "Then deploy again from the Obsidian plugin";

      const infoEl = tokenEl.createEl("p", { cls: "leafpress-info-text" });
      infoEl.createEl("strong", { text: "Note:" });
      infoEl.appendChild(
        document.createTextNode(
          " Tokens and deployment config must be set up interactively first."
        )
      );
    } else if (errorResult.error) {
      const errorEl = contentEl.createEl("div", {
        cls: "deployment-result-section",
      });
      errorEl.createEl("strong", { text: "Error:" });
      const preEl = errorEl.createEl("pre", { cls: "leafpress-pre-error" });
      preEl.textContent = String(errorResult.error);
    }

    const infoEl = contentEl.createEl("p", { cls: "leafpress-muted-text" });
    infoEl.textContent = errorResult.isNonInteractiveError
      ? "Check the console for more details on deployment output."
      : "Check the console for more details. Ensure deployment is configured correctly.";

    const closeBtn = contentEl.createEl("button", {
      text: "Close",
      cls: "leafpress-btn-mt",
    });
    closeBtn.addEventListener("click", () => this.close());
  }
}

interface LeafpressInitConfig {
  title: string;
  nav: Array<{ label: string; path: string }>;
  ignore: string[];
  author?: string;
  baseURL?: string;
  description?: string;
}

class InitializeModal extends Modal {
  private title: string = "";
  private author: string = "";
  private baseURL: string = "";
  private description: string = "";

  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Initialize site" });

    const form = contentEl.createEl("form");

    // Title field
    const titleLabel = form.createEl("label", {
      text: "Site title (required)",
      cls: "leafpress-form-label",
    });
    const titleInput = titleLabel.createEl("input", {
      attr: {
        type: "text",
        placeholder: "My digital garden",
      },
      cls: "leafpress-form-input",
    });
    titleInput.addEventListener("input", (e) => {
      this.title = (e.target as HTMLInputElement).value;
    });

    // Author field
    const authorLabel = form.createEl("label", {
      text: "Author (optional)",
      cls: "leafpress-form-label",
    });
    const authorInput = authorLabel.createEl("input", {
      attr: {
        type: "text",
        placeholder: "Your name",
      },
      cls: "leafpress-form-input",
    });
    authorInput.addEventListener("input", (e) => {
      this.author = (e.target as HTMLInputElement).value;
    });

    // Base URL field
    const baseURLLabel = form.createEl("label", {
      text: "Base URL (optional)",
      cls: "leafpress-form-label",
    });
    const baseURLInput = baseURLLabel.createEl("input", {
      attr: {
        type: "url",
        placeholder: "https://example.com",
      },
      cls: "leafpress-form-input",
    });
    baseURLInput.addEventListener("input", (e) => {
      this.baseURL = (e.target as HTMLInputElement).value;
    });

    // Description field
    const descLabel = form.createEl("label", {
      text: "Description (optional)",
      cls: "leafpress-form-label",
    });
    const descInput = descLabel.createEl("textarea", {
      attr: {
        placeholder: "A collection of my thoughts",
      },
      cls: "leafpress-form-input",
    });
    descInput.addEventListener("input", (e) => {
      this.description = (e.target as HTMLTextAreaElement).value;
    });

    // Buttons
    const buttonContainer = contentEl.createEl("div", {
      cls: "leafpress-btn-container",
    });

    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = buttonContainer.createEl("button", { text: "Initialize" });
    submitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      void this.submit();
    });
  }

  private async submit(): Promise<void> {
    if (!this.title.trim()) {
      new Notice("Site title is required");
      return;
    }

    try {
      new Notice("Initializing site...");

      // Create directories (use relative paths for vault adapter)
      const adapter = this.app.vault.adapter as FileSystemAdapter;
      await adapter.mkdir("notes");
      await adapter.mkdir("static/images");
      await adapter.mkdir("templates");

      // Create index.md with getting started instructions
      const indexContent = `# ${this.title}

Welcome to your digital garden. This is your homepage.

## Getting started

### 1. Create your first note

- Navigate to the **notes** folder
- Use the **note template** (Obsidian Templates plugin) to create new notes
- Each note includes frontmatter fields:
  - \`title\` - Note title
  - \`tags\` - Array of tags for categorization
  - \`createdAt\` - Auto-populated creation date
  - \`updatedAt\` - Auto-populated update date
  - \`growth\` - Growth stage: seedling, budding, or evergreen
  - \`draft\` - Set to \`false\` to publish

### 2. Configure your site

Open the **leafpress** settings panel to:
- Customize theme (fonts, colors, backgrounds)
- Choose navigation styles
- Manage navigation menu items
- Enable/disable features (graph, search, TOC, wiki links, backlinks)

### 3. Build & deploy

- **Build site** - Compiles all notes to static HTML
- **Preview site** - Start a local dev server at http://localhost:3000
- **Deploy** - Push your site to hosting (GitHub Pages, Vercel, etc.)

## File structure

\`\`\`
.
├── index.md (this file)
├── notes/ (your markdown notes)
├── tags.md (auto-generated tag index)
├── static/images/ (images and static assets)
├── templates/note.md (note template)
└── leafpress.json (site configuration)
\`\`\`

## Tips

- Use **wiki links** (\`[[note-name]]\`) to connect your notes
- The **graph visualization** shows connections between notes
- **Backlinks** appear automatically on referenced notes
- Use **tags** to organize and discover related content
- Mark notes as **draft: true** to work in progress without publishing

Happy writing!
`;
      await this.app.vault.adapter.write("index.md", indexContent);

      // Create note template
      const now = new Date().toISOString();
      const noteTemplate = `---
title: "{{title}}"
tags: []
createdAt: ${now}
updatedAt: ${now}
growth: "seedling"
draft: false
---

Your note content goes here.
`;
      await this.app.vault.adapter.write("templates/note.md", noteTemplate);

      // Create leafpress.json with default nav and ignore patterns
      const config: LeafpressInitConfig = {
        title: this.title,
        nav: [
          { label: "Notes", path: "/notes" },
          { label: "Tags", path: "/tags" },
        ],
        ignore: ["templates"],
      };
      if (this.author) config.author = this.author;
      if (this.baseURL) config.baseURL = this.baseURL;
      if (this.description) config.description = this.description;

      await this.app.vault.adapter.write(
        "leafpress.json",
        JSON.stringify(config, null, 2)
      );

      new Notice("Site initialized successfully");
      this.close();
    } catch (err) {
      new Notice(`Failed to initialize site: ${String(err)}`);
      console.error(err);
    }
  }
}
