import { Plugin, PluginSettingTab, App, Setting, Notice, Modal } from "obsidian";
import { BinaryManager } from "./cli/manager";
import { CommandHandlers } from "./cli/handlers";
import { LeafpressPanel, VIEW_TYPE_LEAFPRESS } from "./panel";
import { LeafpressConfig, DeploySettings } from "./cli/types";
import {
  readLeafpressConfig,
  updateThemeProperty,
  updateFeatureToggle,
} from "./utils/config";
import {
  LIGHT_GRADIENTS,
  DARK_GRADIENTS,
  parseBackgroundValue,
  getGradientPresetId,
} from "./utils/gradient-presets";
import { FONT_DEFAULTS } from "./utils/fonts";

interface LeafpressPluginSettings {
  customBinaryPath: string;
  autoUpdateBinary: boolean;
}

const DEFAULT_SETTINGS: LeafpressPluginSettings = {
  customBinaryPath: "",
  autoUpdateBinary: true,
};

export default class LeafpressPlugin extends Plugin {
  settings: LeafpressPluginSettings;
  binaryManager: BinaryManager;
  commandHandlers: CommandHandlers;

  async onload() {
    await this.loadSettings();

    this.binaryManager = new BinaryManager(this.app, this.settings);
    this.commandHandlers = new CommandHandlers(
      this.app,
      this.binaryManager,
      this
    );

    // Register commands
    this.addCommand({
      id: "leafpress-initialize",
      name: "Initialize Site",
      callback: async () => {
        console.log("[leafpress] Initialize command triggered");
        await this.commandHandlers.initialize();
      },
    });

    this.addCommand({
      id: "leafpress-build",
      name: "Build Site",
      callback: async () => {
        console.log("[leafpress] Build command triggered");
        await this.commandHandlers.build();
      },
    });

    this.addCommand({
      id: "leafpress-preview",
      name: "Preview Site",
      callback: async () => {
        console.log("[leafpress] Preview command triggered");
        await this.commandHandlers.preview();
      },
    });

    this.addCommand({
      id: "leafpress-deploy",
      name: "Deploy",
      callback: async () => {
        console.log("[leafpress] Deploy command triggered");
        await this.commandHandlers.deploy();
      },
    });

    this.addCommand({
      id: "leafpress-settings",
      name: "Open Settings",
      callback: () => {
        console.log("[leafpress] Settings command triggered");
        this.openSettings();
      },
    });

    // Register ribbon icon
    this.addRibbonIcon("rocket", "Deploy with leafpress", () => {
      this.commandHandlers.deploy();
    });

    // Register status panel
    this.registerView(
      VIEW_TYPE_LEAFPRESS,
      (leaf) => new LeafpressPanel(leaf, this.binaryManager)
    );

    this.addRibbonIcon("leaf", "leafpress Status", () => {
      this.activateView();
    });

    // Register settings tab
    this.addSettingTab(new LeafpressSettingTab(this.app, this));

    console.log("leafpress plugin loaded");

    // Initialize panel on startup (deferred)
    if (this.app.workspace.layoutReady) {
      this.activateView();
    } else {
      this.app.workspace.onLayoutReady(() => this.activateView());
    }
  }

  onunload() {
    console.log("leafpress plugin unloaded");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_LEAFPRESS)[0];

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_LEAFPRESS,
          active: true,
        });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  openSettings() {
    // Open settings window and focus on this plugin's tab
    (this.app as any).setting?.open();
    (this.app as any).setting?.openTabById?.("obsidian-leafpress");
  }
}

class LeafpressSettingTab extends PluginSettingTab {
  plugin: LeafpressPlugin;
  currentConfig: LeafpressConfig | null = null;
  configCheckInProgress = false;

  constructor(app: App, plugin: LeafpressPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();

    // Load current config
    this.currentConfig = await readLeafpressConfig(this.app);

    this.displayPluginSettings(containerEl);
    this.displaySiteConfiguration(containerEl);
  }

  private displayPluginSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h2", { text: "Plugin Settings" });

    new Setting(containerEl)
      .setName("Custom binary path")
      .setDesc("Leave empty to auto-download. Set to custom leafpress CLI path.")
      .addText((text) =>
        text
          .setPlaceholder("/path/to/leafpress")
          .setValue(this.plugin.settings.customBinaryPath)
          .onChange(async (value) => {
            this.plugin.settings.customBinaryPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-update binary")
      .setDesc("Automatically download updates to leafpress CLI")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoUpdateBinary)
          .onChange(async (value) => {
            this.plugin.settings.autoUpdateBinary = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("hr", { cls: "leafpress-divider" });
  }

  private displaySiteConfiguration(containerEl: HTMLElement): void {
    containerEl.createEl("h2", { text: "Site Configuration" });
    containerEl.createEl("p", {
      text: "Configure your site's appearance and features. Changes are saved directly to leafpress.json.",
      cls: "leafpress-desc",
    });

    if (!this.currentConfig) {
      this.displayInitializePrompt(containerEl);
      return;
    }

    // Theme Configuration
    containerEl.createEl("h3", { text: "Theme Configuration" });
    this.displayFontSettings(containerEl);
    this.displayColorSettings(containerEl);
    this.displayBackgroundSettings(containerEl);
    this.displayNavStyleSettings(containerEl);

    containerEl.createEl("hr", { cls: "leafpress-divider" });

    // Navigation Items
    containerEl.createEl("h3", { text: "Navigation Menu" });
    containerEl.createEl("p", {
      text: "Configure navigation menu items for your site.",
      cls: "leafpress-desc",
    });
    this.displayNavItems(containerEl);

    containerEl.createEl("hr", { cls: "leafpress-divider" });

    // Note Template
    containerEl.createEl("h3", { text: "Note Template" });
    containerEl.createEl("p", {
      text: "Use the note template when creating new notes. Available in templates/note.md",
      cls: "leafpress-desc",
    });
    this.displayNoteTemplate(containerEl);

    containerEl.createEl("hr", { cls: "leafpress-divider" });

    // Features
    containerEl.createEl("h3", { text: "Features" });
    containerEl.createEl("p", {
      text: "Enable or disable site features.",
      cls: "leafpress-desc",
    });
    this.displayFeatureToggles(containerEl);

    containerEl.createEl("hr", { cls: "leafpress-divider" });

    // Deployment
    containerEl.createEl("h3", { text: "Deployment" });
    containerEl.createEl("p", {
      text: "Configure deployment settings for your site.",
      cls: "leafpress-desc",
    });
    this.displayDeploymentSettings(containerEl);
  }

  private displayInitializePrompt(containerEl: HTMLElement): void {
    const bannerEl = containerEl.createDiv("leafpress-init-banner");
    bannerEl.createEl("p", {
      text: "⚠️ Initialize your site first to configure theme and features.",
    });

    new Setting(bannerEl)
      .addButton((btn) =>
        btn
          .setButtonText("Initialize Site")
          .setClass("leafpress-init-btn")
          .onClick(async () => {
            await this.plugin.commandHandlers.initialize();
            // Reload settings after initialization
            setTimeout(() => {
              this.display();
            }, 1000);
          })
      );
  }

  private displayFontSettings(containerEl: HTMLElement): void {
    const fontHeading = this.currentConfig?.theme?.fontHeading || FONT_DEFAULTS.heading;
    const fontBody = this.currentConfig?.theme?.fontBody || FONT_DEFAULTS.body;
    const fontMono = this.currentConfig?.theme?.fontMono || FONT_DEFAULTS.mono;

    new Setting(containerEl)
      .setName("Font for Headings")
      .setDesc(
        "Google Font name for headings (e.g., Crimson Pro, Merriweather, Playfair Display)"
      )
      .addText((text) =>
        text
          .setPlaceholder(FONT_DEFAULTS.heading)
          .setValue(fontHeading)
          .onChange(async (value) => {
            await updateThemeProperty(
              this.app,
              "fontHeading",
              value || FONT_DEFAULTS.heading
            );
            new Notice("Theme updated");
          })
      );

    new Setting(containerEl)
      .setName("Font for Body")
      .setDesc("Google Font name for body text (e.g., Inter, Roboto, Open Sans)")
      .addText((text) =>
        text
          .setPlaceholder(FONT_DEFAULTS.body)
          .setValue(fontBody)
          .onChange(async (value) => {
            await updateThemeProperty(
              this.app,
              "fontBody",
              value || FONT_DEFAULTS.body
            );
            new Notice("Theme updated");
          })
      );

    new Setting(containerEl)
      .setName("Font for Code")
      .setDesc("Google Font name for code blocks (e.g., JetBrains Mono, Fira Code)")
      .addText((text) =>
        text
          .setPlaceholder(FONT_DEFAULTS.mono)
          .setValue(fontMono)
          .onChange(async (value) => {
            await updateThemeProperty(
              this.app,
              "fontMono",
              value || FONT_DEFAULTS.mono
            );
            new Notice("Theme updated");
          })
      );
  }

  private displayColorSettings(containerEl: HTMLElement): void {
    const accentColor = this.currentConfig?.theme?.accent || "#50ac00";

    new Setting(containerEl)
      .setName("Accent Color")
      .setDesc("Primary color for links, buttons, and highlights")
      .addColorPicker((color) =>
        color
          .setValue(accentColor)
          .onChange(async (value) => {
            await updateThemeProperty(this.app, "accent", value);
            new Notice("Theme updated");
          })
      );
  }

  private displayBackgroundSettings(containerEl: HTMLElement): void {
    const lightBg = this.currentConfig?.theme?.background?.light || "#ffffff";
    const darkBg = this.currentConfig?.theme?.background?.dark || "#1a1a1a";

    // Light Mode Background
    this.displayBackgroundControl(
      containerEl,
      "Light Mode Background",
      "light",
      lightBg,
      LIGHT_GRADIENTS
    );

    // Dark Mode Background
    this.displayBackgroundControl(
      containerEl,
      "Dark Mode Background",
      "dark",
      darkBg,
      DARK_GRADIENTS
    );
  }

  private displayBackgroundControl(
    containerEl: HTMLElement,
    name: string,
    mode: "light" | "dark",
    currentValue: string,
    gradients: typeof LIGHT_GRADIENTS
  ): void {
    const bgContainer = containerEl.createDiv();
    const parsed = parseBackgroundValue(currentValue);
    const presetId = getGradientPresetId(currentValue);

    let currentMode =
      parsed.type === "color"
        ? "solid"
        : presetId
          ? presetId
          : "custom";

    let colorPickerSetting: Setting | null = null;
    let customGradientSetting: Setting | null = null;

    const updateVisibility = (mode: string) => {
      if (colorPickerSetting) {
        colorPickerSetting.settingEl.style.display =
          mode === "solid" ? "" : "none";
      }
      if (customGradientSetting) {
        customGradientSetting.settingEl.style.display =
          mode === "custom" ? "" : "none";
      }
    };

    // Dropdown for mode selection
    new Setting(bgContainer)
      .setName(name)
      .setDesc("Background color or gradient for theme")
      .addDropdown((dd) => {
        dd.addOption("solid", "Solid Color");
        gradients.forEach((gradient) => {
          dd.addOption(gradient.id, gradient.label);
        });
        dd.addOption("custom", "Custom Gradient");

        dd.setValue(currentMode);

        dd.onChange(async (selectedMode) => {
          currentMode = selectedMode;
          updateVisibility(selectedMode);

          if (selectedMode === "solid") {
            // Keep current color, will be updated by color picker
          } else if (selectedMode === "custom") {
            // Keep for user to edit
          } else {
            // Preset gradient
            const preset = gradients.find((g) => g.id === selectedMode);
            if (preset) {
              await updateThemeProperty(
                this.app,
                `background.${mode}`,
                preset.value
              );
              new Notice("Theme updated");
            }
          }
        });
      });

    // Color picker (shown when solid)
    colorPickerSetting = new Setting(bgContainer).addColorPicker((color) =>
      color
        .setValue(parsed.type === "color" ? currentValue : "#ffffff")
        .onChange(async (value) => {
          await updateThemeProperty(this.app, `background.${mode}`, value);
          new Notice("Theme updated");
        })
    );

    // Custom gradient input (shown when custom)
    customGradientSetting = new Setting(bgContainer).addText((text) =>
      text
        .setPlaceholder("linear-gradient(180deg, #fff 0%, #f5f5f5 100%)")
        .setValue(parsed.type === "custom" ? currentValue : "")
        .onChange(async (value) => {
          if (value) {
            await updateThemeProperty(this.app, `background.${mode}`, value);
            new Notice("Theme updated");
          }
        })
    );

    // Initial visibility
    updateVisibility(currentMode);
  }

  private displayNavStyleSettings(containerEl: HTMLElement): void {
    const navStyle = this.currentConfig?.theme?.navStyle || "base";
    const navActiveStyle = this.currentConfig?.theme?.navActiveStyle || "base";

    new Setting(containerEl)
      .setName("Navigation Bar Style")
      .setDesc("Choose the navigation bar style")
      .addDropdown((dd) => {
        dd.addOption("base", "Base");
        dd.addOption("sticky", "Sticky");
        dd.addOption("glassy", "Glassy");
        dd.setValue(navStyle);
        dd.onChange(async (value) => {
          await updateThemeProperty(this.app, "navStyle", value);
          new Notice("Theme updated");
        });
      });

    new Setting(containerEl)
      .setName("Active Item Style")
      .setDesc("Style for active navigation items")
      .addDropdown((dd) => {
        dd.addOption("base", "Base");
        dd.addOption("box", "Box");
        dd.addOption("underlined", "Underlined");
        dd.setValue(navActiveStyle);
        dd.onChange(async (value) => {
          await updateThemeProperty(this.app, "navActiveStyle", value);
          new Notice("Theme updated");
        });
      });
  }

  private displayNavItems(containerEl: HTMLElement): void {
    const navItems = this.currentConfig?.nav || [];

    // Display current nav items
    if (navItems.length === 0) {
      containerEl.createEl("p", {
        text: "No navigation items configured.",
        cls: "leafpress-empty-state",
      });
    } else {
      navItems.forEach((item, index) => {
        const itemContainer = containerEl.createDiv("leafpress-nav-item");
        itemContainer.style.display = "flex";
        itemContainer.style.alignItems = "center";
        itemContainer.style.gap = "12px";
        itemContainer.style.marginBottom = "12px";
        itemContainer.style.padding = "8px";
        itemContainer.style.backgroundColor = "var(--background-secondary, #f5f5f5)";
        itemContainer.style.borderRadius = "4px";

        // Item display
        const labelEl = itemContainer.createEl("span", {
          text: `${item.label} → ${item.path}`,
        });
        labelEl.style.flex = "1";
        labelEl.style.fontSize = "0.9rem";

        // Edit button
        const editBtn = itemContainer.createEl("button", { text: "Edit" });
        editBtn.style.padding = "4px 8px";
        editBtn.style.fontSize = "0.85rem";
        editBtn.addEventListener("click", async () => {
          await this.editNavItem(index);
        });

        // Delete button
        const deleteBtn = itemContainer.createEl("button", { text: "Delete" });
        deleteBtn.style.padding = "4px 8px";
        deleteBtn.style.fontSize = "0.85rem";
        deleteBtn.style.color = "var(--text-error, #cc3333)";
        deleteBtn.addEventListener("click", async () => {
          await this.deleteNavItem(index);
        });
      });
    }

    // Add new item button
    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText("+ Add Navigation Item")
        .setClass("leafpress-add-nav-btn")
        .onClick(async () => {
          await this.addNavItem();
        })
    );
  }

  private async addNavItem(): Promise<void> {
    const label = await this.promptInput("Label", "e.g., Notes");
    if (!label) return;

    const path = await this.promptInput("Path", "e.g., /notes");
    if (!path) return;

    const config = this.currentConfig;
    if (!config) return;

    if (!config.nav) {
      config.nav = [];
    }

    config.nav.push({ label, path });
    await (await import("./utils/config")).writeLeafpressConfig(this.app, config);
    new Notice("Navigation item added");
    this.display();
  }

  private async editNavItem(index: number): Promise<void> {
    const config = this.currentConfig;
    if (!config || !config.nav || !config.nav[index]) return;

    const item = config.nav[index];
    const label = await this.promptInput("Label", item.label, item.label);
    if (!label) return;

    const path = await this.promptInput("Path", item.path, item.path);
    if (!path) return;

    config.nav[index] = { label, path };
    await (await import("./utils/config")).writeLeafpressConfig(this.app, config);
    new Notice("Navigation item updated");
    this.display();
  }

  private async deleteNavItem(index: number): Promise<void> {
    const config = this.currentConfig;
    if (!config || !config.nav) return;

    config.nav.splice(index, 1);
    await (await import("./utils/config")).writeLeafpressConfig(this.app, config);
    new Notice("Navigation item deleted");
    this.display();
  }

  private promptInput(
    title: string,
    placeholder: string,
    defaultValue: string = ""
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const inputModal = new PromptInputModal(
        this.app,
        title,
        placeholder,
        defaultValue,
        (value) => resolve(value)
      );
      inputModal.open();
    });
  }

  private displayNoteTemplate(containerEl: HTMLElement): void {
    const templateInfo = containerEl.createDiv("leafpress-template-info");
    templateInfo.style.backgroundColor = "var(--background-secondary, #f5f5f5)";
    templateInfo.style.border = "1px solid var(--border-color, #ddd)";
    templateInfo.style.borderRadius = "4px";
    templateInfo.style.padding = "12px";
    templateInfo.style.marginBottom = "12px";
    templateInfo.style.fontSize = "0.9rem";

    const fields = [
      { name: "title", desc: "Note title" },
      { name: "tags", desc: "Array of tags (e.g., ['markdown', 'note'])" },
      { name: "createdAt", desc: "Creation timestamp (ISO format)" },
      { name: "updatedAt", desc: "Last update timestamp (ISO format)" },
      { name: "growth", desc: 'Growth stage: seedling, budding, evergreen' },
      { name: "draft", desc: "Whether the note is in draft state" },
    ];

    const fieldsList = templateInfo.createEl("ul");
    fieldsList.style.margin = "8px 0";
    fieldsList.style.paddingLeft = "20px";

    fields.forEach((field) => {
      const li = fieldsList.createEl("li");
      li.style.marginBottom = "4px";
      const strong = li.createEl("strong", { text: field.name });
      li.appendChild(document.createTextNode(` — ${field.desc}`));
    });

    const instructions = containerEl.createEl("p", {
      text: "To use this template in Obsidian: Open the template plugin settings and point to templates/note.md. Then use 'Insert template' when creating new notes in the notes/ folder.",
      cls: "leafpress-template-instructions",
    });
    instructions.style.fontSize = "0.9rem";
    instructions.style.color = "var(--text-muted, #999)";
    instructions.style.fontStyle = "italic";

    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText("View Template File")
        .setClass("leafpress-view-template-btn")
        .onClick(async () => {
          try {
            const templateContent = await this.app.vault.adapter.read(
              "templates/note.md"
            );
            new TemplatePreviewModal(this.app, templateContent).open();
          } catch (err) {
            new Notice("Could not read template file");
            console.error(err);
          }
        })
    );
  }

  private displayDeploymentSettings(containerEl: HTMLElement): void {
    const config = this.currentConfig;
    const deployConfig = config?.deploy;
    const provider = deployConfig?.provider || "github-pages";

    // Deployment provider selection
    new Setting(containerEl)
      .setName("Deployment Provider")
      .setDesc("Choose where to deploy your site")
      .addDropdown((dd) => {
        dd.addOption("github-pages", "GitHub Pages");
        dd.addOption("vercel", "Vercel");
        dd.addOption("netlify", "Netlify");
        dd.setValue(provider);
        dd.onChange(async (value) => {
          if (!config) return;
          if (!config.deploy) {
            config.deploy = { provider: value as any, settings: {} };
          } else {
            config.deploy.provider = value as any;
          }
          const { writeLeafpressConfig } = await import("./utils/config");
          await writeLeafpressConfig(this.app, config);
          new Notice(`Deployment provider set to ${value}`);
          this.display();
        });
      });

    // Show provider info
    const infoEl = containerEl.createDiv("leafpress-deploy-info");
    infoEl.style.backgroundColor = "var(--background-secondary, #f5f5f5)";
    infoEl.style.border = "1px solid var(--border-color, #ddd)";
    infoEl.style.borderRadius = "4px";
    infoEl.style.padding = "12px";
    infoEl.style.marginBottom = "12px";
    infoEl.style.fontSize = "0.9rem";

    const providerInfo: Record<string, { title: string; desc: string }> = {
      "github-pages": {
        title: "GitHub Pages",
        desc: "Deploy to GitHub Pages using OAuth authentication. Supports both user/org sites and project repos.",
      },
      vercel: {
        title: "Vercel",
        desc: "Deploy to Vercel with automatic SSL and edge network. Requires Vercel token.",
      },
      netlify: {
        title: "Netlify",
        desc: "Deploy to Netlify with CDN and smart uploads. Requires Netlify Personal Access Token.",
      },
    };

    const info = providerInfo[provider];
    if (info) {
      infoEl.createEl("strong", { text: info.title });
      infoEl.appendChild(document.createTextNode(` — ${info.desc}`));
    }

    // Configuration status
    const statusEl = containerEl.createDiv("leafpress-deploy-status");
    statusEl.style.display = "flex";
    statusEl.style.alignItems = "center";
    statusEl.style.gap = "8px";
    statusEl.style.marginBottom = "12px";

    if (deployConfig?.settings && Object.keys(deployConfig.settings).length > 0) {
      statusEl.createEl("span", { text: "✓ Configured" });
      statusEl.style.color = "var(--text-success, #00aa00)";
    } else {
      statusEl.createEl("span", { text: "⚪ Not configured" });
      statusEl.style.color = "var(--text-muted, #999)";
    }

    // Reconfigure button
    new Setting(containerEl)
      .addButton((btn) =>
        btn
          .setButtonText("Configure Deployment")
          .setClass("leafpress-deploy-config-btn")
          .onClick(async () => {
            new DeploymentSetupModal(this.app, this.currentConfig, async () => {
              await this.display();
            }).open();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Deploy Now")
          .setClass("leafpress-deploy-btn")
          .onClick(async () => {
            await this.plugin.commandHandlers.deploy();
          })
      );

    // Provider-specific info
    const docsLink = containerEl.createDiv("leafpress-deploy-docs");
    docsLink.style.fontSize = "0.85rem";
    docsLink.style.color = "var(--text-muted, #999)";
    docsLink.style.marginTop = "12px";

    const docsByProvider: Record<string, string> = {
      "github-pages":
        "https://github.com/shivamx96/leafpress/wiki/Deploy-to-GitHub-Pages",
      vercel: "https://github.com/shivamx96/leafpress/wiki/Deploy-to-Vercel",
      netlify:
        "https://github.com/shivamx96/leafpress/wiki/Deploy-to-Netlify",
    };

    if (docsByProvider[provider]) {
      const linkEl = docsLink.createEl("a", {
        text: "View deployment guide →",
        href: "#",
      });
      linkEl.style.color = "var(--text-link, #7c3aed)";
      linkEl.addEventListener("click", (e) => {
        e.preventDefault();
        window.open(docsByProvider[provider]);
      });
    }
  }

  private displayFeatureToggles(containerEl: HTMLElement): void {
    const config = this.currentConfig;

    new Setting(containerEl)
      .setName("Graph Visualization")
      .setDesc("Show interactive graph of note connections")
      .addToggle((toggle) =>
        toggle
          .setValue(config?.graph ?? false)
          .onChange(async (value) => {
            await updateFeatureToggle(this.app, "graph", value);
            new Notice("Feature updated");
          })
      );

    new Setting(containerEl)
      .setName("Table of Contents")
      .setDesc("Show table of contents on pages")
      .addToggle((toggle) =>
        toggle
          .setValue(config?.toc ?? true)
          .onChange(async (value) => {
            await updateFeatureToggle(this.app, "toc", value);
            new Notice("Feature updated");
          })
      );

    new Setting(containerEl)
      .setName("Search")
      .setDesc("Enable full-text search on the site")
      .addToggle((toggle) =>
        toggle
          .setValue(config?.search ?? true)
          .onChange(async (value) => {
            await updateFeatureToggle(this.app, "search", value);
            new Notice("Feature updated");
          })
      );

    new Setting(containerEl)
      .setName("Wiki Links")
      .setDesc("Enable wiki-link processing")
      .addToggle((toggle) =>
        toggle
          .setValue(config?.wikilinks ?? true)
          .onChange(async (value) => {
            await updateFeatureToggle(this.app, "wikilinks", value);
            new Notice("Feature updated");
          })
      );

    new Setting(containerEl)
      .setName("Backlinks")
      .setDesc("Show backlinks section on pages")
      .addToggle((toggle) =>
        toggle
          .setValue(config?.backlinks ?? true)
          .onChange(async (value) => {
            await updateFeatureToggle(this.app, "backlinks", value);
            new Notice("Feature updated");
          })
      );
  }
}

class PromptInputModal extends Modal {
  private title: string;
  private placeholder: string;
  private defaultValue: string;
  private onSubmit: (value: string | null) => void;
  private inputValue: string = "";

  constructor(
    app: App,
    title: string,
    placeholder: string,
    defaultValue: string,
    onSubmit: (value: string | null) => void
  ) {
    super(app);
    this.title = title;
    this.placeholder = placeholder;
    this.defaultValue = defaultValue;
    this.inputValue = defaultValue;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: this.title });

    const inputEl = contentEl.createEl("input", {
      attr: {
        type: "text",
        placeholder: this.placeholder,
        value: this.defaultValue,
      },
    });
    inputEl.style.width = "100%";
    inputEl.style.padding = "8px";
    inputEl.style.marginBottom = "16px";
    inputEl.style.boxSizing = "border-box";

    inputEl.addEventListener("input", (e) => {
      this.inputValue = (e.target as HTMLInputElement).value;
    });

    inputEl.focus();

    const buttonContainer = contentEl.createEl("div");
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "10px";
    buttonContainer.style.justifyContent = "flex-end";

    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.onSubmit(null);
      this.close();
    });

    const submitBtn = buttonContainer.createEl("button", { text: "Save" });
    submitBtn.addEventListener("click", () => {
      this.onSubmit(this.inputValue.trim() || null);
      this.close();
    });

    // Allow Enter to submit
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.onSubmit(this.inputValue.trim() || null);
        this.close();
      }
    });
  }
}

class TemplatePreviewModal extends Modal {
  private content: string;

  constructor(app: App, content: string) {
    super(app);
    this.content = content;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Note Template" });

    const preEl = contentEl.createEl("pre");
    preEl.style.backgroundColor = "var(--background-secondary, #f5f5f5)";
    preEl.style.padding = "12px";
    preEl.style.borderRadius = "4px";
    preEl.style.overflow = "auto";
    preEl.style.maxHeight = "400px";
    preEl.style.fontSize = "0.85rem";
    preEl.style.fontFamily = "monospace";
    preEl.textContent = this.content;

    const closeBtn = contentEl.createEl("button", { text: "Close" });
    closeBtn.style.marginTop = "16px";
    closeBtn.addEventListener("click", () => this.close());
  }
}

class DeploymentSetupModal extends Modal {
  private config: LeafpressConfig | null;
  private onComplete: () => void;
  private provider: "github-pages" | "vercel" | "netlify";

  constructor(
    app: App,
    config: LeafpressConfig | null,
    onComplete: () => void
  ) {
    super(app);
    this.config = config;
    this.onComplete = onComplete;
    this.provider = config?.deploy?.provider || "github-pages";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Setup Deployment" });

    const infoBox = contentEl.createEl("div", {
      cls: "deployment-setup-instructions",
    });
    infoBox.style.backgroundColor = "#f0f7ff";
    infoBox.style.border = "1px solid #7c3aed";
    infoBox.style.borderRadius = "4px";
    infoBox.style.padding = "12px";
    infoBox.style.marginBottom = "16px";
    infoBox.style.lineHeight = "1.6";

    infoBox.createEl("strong", {
      text: "Initial setup requires interactive terminal",
    });
    const desc = infoBox.createEl("p");
    desc.style.margin = "8px 0 0 0";
    desc.style.fontSize = "0.9rem";
    desc.textContent =
      "Run the following command in your vault directory to set up deployment:";

    // Command
    const cmdBox = contentEl.createEl("div");
    cmdBox.style.backgroundColor = "var(--background-secondary, #f5f5f5)";
    cmdBox.style.border = "1px solid var(--border-color, #ddd)";
    cmdBox.style.borderRadius = "4px";
    cmdBox.style.padding = "12px";
    cmdBox.style.marginBottom = "16px";
    cmdBox.style.fontFamily = "monospace";
    cmdBox.style.overflowX = "auto";

    const cmd = cmdBox.createEl("code");
    cmd.textContent = "leafpress deploy";
    cmd.style.fontSize = "0.9rem";

    // Steps
    const stepsEl = contentEl.createEl("div");
    stepsEl.createEl("strong", { text: "Steps:" });
    const stepsList = stepsEl.createEl("ol");
    stepsList.style.margin = "8px 0";
    stepsList.style.paddingLeft = "20px";

    const steps = [
      "Open Terminal in your vault directory",
      "Run: leafpress deploy",
      "Follow the browser or token-based authentication",
      "Configuration will be saved to leafpress.json",
      "Return here and click Deploy Now",
    ];

    steps.forEach((step) => {
      const li = stepsList.createEl("li");
      li.textContent = step;
      li.style.marginBottom = "4px";
    });

    // Buttons
    const buttonContainer = contentEl.createEl("div");
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "10px";
    buttonContainer.style.justifyContent = "flex-end";
    buttonContainer.style.marginTop = "20px";

    const closeBtn = buttonContainer.createEl("button", { text: "Close" });
    closeBtn.addEventListener("click", () => {
      this.close();
      this.onComplete();
    });
  }
}
