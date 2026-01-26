import { App, Notice, Modal } from "obsidian";
import { BinaryManager } from "./manager";
import { CLIResult } from "./types";
import { openInBrowser, isPortInUse } from "../utils/platform";

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
      // Check if server is already running
      const serverRunning = await isPortInUse(3000);

      if (serverRunning) {
        // Server is already running, just open it
        openInBrowser("http://localhost:3000");
        new Notice("✓ Preview opened at http://localhost:3000");
      } else {
        // Server not running, start it
        new Notice("Preparing...");
        await this.binaryManager.ensureBinary();
        new Notice("Starting preview server...");
        this.binaryManager.execCommand(["serve"]);

        // Give server a moment to start, then open browser
        setTimeout(() => {
          openInBrowser("http://localhost:3000");
          new Notice("✓ Preview server started at http://localhost:3000");
        }, 2000);
      }
    } catch (err) {
      new Notice(`✗ Error: ${err}`);
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

        const deployResult: any = {
          url,
          success: true,
          output: result.stdout,
        };

        new Notice(
          `✓ ${reconfigure ? "Configuration complete" : "Deployed"}: ${url}`
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

        const errorResult: any = {
          success: false,
          error: result.stderr,
          output: result.stdout,
          isNonInteractiveError,
          isMissingTokenError,
        };
        new DeploymentResultModal(this.app, errorResult).open();
      }
    } catch (err) {
      new Notice(`✗ Error: ${err}`);
      console.error(err);
    }
  }
}

class DeploymentResultModal extends Modal {
  private result: any;

  constructor(app: App, result: any) {
    super(app);
    this.result = result;
  }

  onOpen() {
    const { contentEl } = this;

    if (this.result.success) {
      contentEl.createEl("h2", { text: "✓ Deployment Complete" });

      const urlEl = contentEl.createEl("div", {
        cls: "deployment-result-section",
      });
      urlEl.createEl("strong", { text: "Site URL:" });
      const link = urlEl.createEl("a", {
        text: this.result.url,
        href: this.result.url,
      });
      link.style.color = "var(--text-link, #7c3aed)";
      link.style.display = "block";
      link.style.marginTop = "8px";
      link.addEventListener("click", (e) => {
        e.preventDefault();
        window.open(this.result.url);
      });

      if (this.result.output) {
        const outputEl = contentEl.createEl("div", {
          cls: "deployment-result-section",
        });
        outputEl.createEl("strong", { text: "Output:" });
        const preEl = outputEl.createEl("pre");
        preEl.style.backgroundColor = "var(--background-secondary, #f5f5f5)";
        preEl.style.padding = "12px";
        preEl.style.borderRadius = "4px";
        preEl.style.overflow = "auto";
        preEl.style.maxHeight = "300px";
        preEl.style.fontSize = "0.85rem";
        preEl.style.marginTop = "8px";
        preEl.textContent = this.result.output;
      }
    } else {
      contentEl.createEl("h2", { text: "✗ Deployment Failed" });

      // Special handling for non-interactive mode errors
      if (this.result.isNonInteractiveError) {
        const instructionsEl = contentEl.createEl("div", {
          cls: "deployment-setup-instructions",
        });
        instructionsEl.style.backgroundColor = "#fff3cd";
        instructionsEl.style.border = "1px solid #ffc107";
        instructionsEl.style.borderRadius = "4px";
        instructionsEl.style.padding = "12px";
        instructionsEl.style.marginBottom = "12px";

        instructionsEl.createEl("strong", { text: "Setup Required" });
        const setupSteps = instructionsEl.createEl("ol");
        setupSteps.style.margin = "8px 0";
        setupSteps.style.paddingLeft = "20px";

        const li1 = setupSteps.createEl("li");
        li1.textContent = 'Run "leafpress deploy" in a terminal within your vault';
        li1.style.marginBottom = "4px";

        const li2 = setupSteps.createEl("li");
        li2.textContent =
          "Complete the authentication/configuration in the interactive prompt";
        li2.style.marginBottom = "4px";

        const li3 = setupSteps.createEl("li");
        li3.textContent =
          "After setup, you can deploy from the plugin using Deploy Now";

        const docsEl = instructionsEl.createEl("p");
        docsEl.style.margin = "8px 0 0 0";
        docsEl.style.fontSize = "0.9rem";
        docsEl.createEl("strong", { text: "Why?" });
        docsEl.appendChild(
          document.createTextNode(
            " Initial setup requires browser authentication or token entry, which needs an interactive terminal."
          )
        );
      } else if (this.result.isMissingTokenError) {
        const tokenEl = contentEl.createEl("div", {
          cls: "deployment-setup-instructions",
        });
        tokenEl.style.backgroundColor = "#fff3cd";
        tokenEl.style.border = "1px solid #ffc107";
        tokenEl.style.borderRadius = "4px";
        tokenEl.style.padding = "12px";
        tokenEl.style.marginBottom = "12px";

        tokenEl.createEl("strong", { text: "Authentication Required" });
        const tokenSteps = tokenEl.createEl("ol");
        tokenSteps.style.margin = "8px 0";
        tokenSteps.style.paddingLeft = "20px";

        const li1 = tokenSteps.createEl("li");
        li1.textContent =
          'Run "leafpress deploy" in terminal to set up or re-authenticate';
        li1.style.marginBottom = "4px";

        const li2 = tokenSteps.createEl("li");
        li2.textContent = "Complete the provider setup (OAuth or token entry)";
        li2.style.marginBottom = "4px";

        const li3 = tokenSteps.createEl("li");
        li3.textContent = "Then deploy again from the Obsidian plugin";

        const infoEl = tokenEl.createEl("p");
        infoEl.style.margin = "8px 0 0 0";
        infoEl.style.fontSize = "0.9rem";
        infoEl.createEl("strong", { text: "Note:" });
        infoEl.appendChild(
          document.createTextNode(
            " Tokens and deployment config must be set up interactively first."
          )
        );
      } else if (this.result.error) {
        const errorEl = contentEl.createEl("div", {
          cls: "deployment-result-section",
        });
        errorEl.createEl("strong", { text: "Error:" });
        const preEl = errorEl.createEl("pre");
        preEl.style.backgroundColor = "#ffe0e0";
        preEl.style.color = "#cc3333";
        preEl.style.padding = "12px";
        preEl.style.borderRadius = "4px";
        preEl.style.overflow = "auto";
        preEl.style.maxHeight = "300px";
        preEl.style.fontSize = "0.85rem";
        preEl.style.marginTop = "8px";
        preEl.textContent = this.result.error;
      }

      const infoEl = contentEl.createEl("p");
      infoEl.style.marginTop = "12px";
      infoEl.style.fontSize = "0.9rem";
      infoEl.style.color = "var(--text-muted, #999)";
      infoEl.textContent = this.result.isNonInteractiveError
        ? "Check the console for more details on deployment output."
        : "Check the console for more details. Ensure deployment is configured correctly.";
    }

    const closeBtn = contentEl.createEl("button", { text: "Close" });
    closeBtn.style.marginTop = "16px";
    closeBtn.addEventListener("click", () => this.close());
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
      const templatesDir = "templates";

      await (this.app.vault.adapter as any).mkdir(notesDir);
      await (this.app.vault.adapter as any).mkdir(staticDir);
      await (this.app.vault.adapter as any).mkdir(templatesDir);

      // Create index.md with getting started instructions
      const indexContent = `# ${this.title}

Welcome to your digital garden. This is your homepage.

## Getting Started

### 1. Create Your First Note

- Navigate to the **notes** folder
- Use the **note template** (Obsidian Templates plugin) to create new notes
- Each note includes frontmatter fields:
  - \`title\` - Note title
  - \`tags\` - Array of tags for categorization
  - \`createdAt\` - Auto-populated creation date
  - \`updatedAt\` - Auto-populated update date
  - \`growth\` - Growth stage: seedling, budding, or evergreen
  - \`draft\` - Set to \`false\` to publish

### 2. Configure Your Site

Open the **leafpress** settings panel to:
- Customize theme (fonts, colors, backgrounds)
- Choose navigation styles
- Manage navigation menu items
- Enable/disable features (graph, search, TOC, wiki links, backlinks)

### 3. Build & Deploy

- **Build Site** - Compiles all notes to static HTML
- **Preview Site** - Start a local dev server at http://localhost:3000
- **Deploy** - Push your site to hosting (GitHub Pages, Vercel, etc.)

## File Structure

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

Happy writing! 🌱
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
