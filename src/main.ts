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

    this.displaySiteConfiguration(containerEl);
    this.displayPluginSettings(containerEl);
  }

  private displayPluginSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Plugin Settings").setHeading();

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

    new Setting(containerEl)
      .setName("Check for Updates")
      .setDesc("Check for new versions of the leafpress CLI")
      .addButton((btn) =>
        btn
          .setButtonText("Check for Updates")
          .onClick(async () => {
            btn.setDisabled(true);
            btn.setButtonText("Checking...");

            try {
              const updateInfo = await this.plugin.binaryManager.checkForUpdates();
              if (!updateInfo) {
                new Notice("Could not check for updates");
                btn.setButtonText("Check for Updates");
                btn.setDisabled(false);
                return;
              }

              if (updateInfo.hasUpdate) {
                const confirmed = await new Promise<boolean>((resolve) => {
                  const modal = new Modal(this.app);
                  modal.contentEl.createEl("h3", { text: "Update Available" });
                  modal.contentEl.createEl("p", {
                    text: `${updateInfo.currentVersion} → ${updateInfo.latestVersion}`,
                  });

                  new Setting(modal.contentEl)
                    .addButton((btn) =>
                      btn.setButtonText("Cancel").onClick(() => {
                        resolve(false);
                        modal.close();
                      })
                    )
                    .addButton((btn) =>
                      btn
                        .setButtonText("Update")
                        .setCta()
                        .onClick(() => {
                          resolve(true);
                          modal.close();
                        })
                    );

                  modal.open();
                });

                if (confirmed) {
                  new Notice("Updating leafpress CLI...");
                  await this.plugin.binaryManager.updateBinary();
                }
              } else {
                new Notice(`✓ Already up to date (${updateInfo.currentVersion})`);
              }
            } catch (err) {
              new Notice(`Error checking updates: ${err}`);
              console.error(err);
            } finally {
              btn.setButtonText("Check for Updates");
              btn.setDisabled(false);
            }
          })
      );
  }

  private displaySiteConfiguration(containerEl: HTMLElement): void {
    if (!this.currentConfig) {
      this.displayInitializePrompt(containerEl);
      return;
    }

    // Theme Configuration
    new Setting(containerEl).setName("Theme").setHeading();
    this.displayFontSettings(containerEl);
    this.displayColorSettings(containerEl);
    this.displayBackgroundSettings(containerEl);
    this.displayNavStyleSettings(containerEl);

    // Navigation Items
    new Setting(containerEl).setName("Navigation").setHeading();
    this.displayNavItems(containerEl);

    // Features
    new Setting(containerEl).setName("Features").setHeading();
    this.displayFeatureToggles(containerEl);

    // Deployment
    new Setting(containerEl).setName("Deployment").setHeading();
    this.displayDeploymentSettings(containerEl);

    // Note Template
    new Setting(containerEl).setName("Note Template").setHeading();
    this.displayNoteTemplate(containerEl);
  }

  private displayInitializePrompt(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Initialize site")
      .setDesc("Create leafpress.json to configure theme and features")
      .addButton((btn) =>
        btn
          .setButtonText("Initialize")
          .setCta()
          .onClick(async () => {
            await this.plugin.commandHandlers.initialize();
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
    const parsed = parseBackgroundValue(currentValue);
    const presetId = getGradientPresetId(currentValue);

    const currentSelection =
      parsed.type === "color"
        ? "solid"
        : presetId
          ? presetId
          : "custom";

    const setting = new Setting(containerEl).setName(name);

    setting.addDropdown((dd) => {
      dd.addOption("solid", "Solid Color");
      gradients.forEach((gradient) => {
        dd.addOption(gradient.id, gradient.label);
      });
      dd.addOption("custom", "Custom CSS");
      dd.setValue(currentSelection);
      dd.onChange(async (selectedMode) => {
        if (selectedMode !== "solid" && selectedMode !== "custom") {
          const preset = gradients.find((g) => g.id === selectedMode);
          if (preset) {
            await updateThemeProperty(this.app, `background.${mode}`, preset.value);
            new Notice("Theme updated");
          }
        }
        await this.display();
      });
    });

    // Show color picker only for solid color mode
    if (currentSelection === "solid") {
      setting.addColorPicker((color) => {
        color
          .setValue(parsed.type === "color" ? currentValue : "#ffffff")
          .onChange(async (value) => {
            await updateThemeProperty(this.app, `background.${mode}`, value);
            new Notice("Theme updated");
          });
      });
    }
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

    // Display current nav items using Setting component
    if (navItems.length === 0) {
      new Setting(containerEl)
        .setName("No navigation items")
        .setDesc("Add items to create your site navigation menu");
    } else {
      navItems.forEach((item, index) => {
        new Setting(containerEl)
          .setName(item.label)
          .setDesc(item.path)
          .addButton((btn) =>
            btn.setButtonText("Edit").onClick(async () => {
              await this.editNavItem(index);
            })
          )
          .addButton((btn) =>
            btn
              .setButtonText("Delete")
              .setWarning()
              .onClick(async () => {
                await this.deleteNavItem(index);
              })
          );
      });
    }

    // Add new item button
    new Setting(containerEl)
      .setName("Add navigation item")
      .addButton((btn) =>
        btn.setButtonText("Add").onClick(async () => {
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
    new Setting(containerEl)
      .setName("View template")
      .setDesc("Frontmatter fields: title, tags, createdAt, updatedAt, growth, draft")
      .addButton((btn) =>
        btn.setButtonText("View").onClick(async () => {
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
    const isConfigured = deployConfig?.settings && Object.keys(deployConfig.settings).length > 0;

    new Setting(containerEl)
      .setName("Provider")
      .setDesc(isConfigured ? "Configured" : "Not configured")
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

    new Setting(containerEl)
      .setName("Configure")
      .setDesc("Run 'leafpress deploy' in terminal for initial setup")
      .addButton((btn) =>
        btn.setButtonText("Setup Guide").onClick(async () => {
          new DeploymentSetupModal(this.app, this.currentConfig, async () => {
            await this.display();
          }).open();
        })
      );

    new Setting(containerEl)
      .setName("Deploy now")
      .setDesc("Build and deploy your site")
      .addButton((btn) =>
        btn.setButtonText("Deploy").setCta().onClick(async () => {
          await this.plugin.commandHandlers.deploy();
        })
      );
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
    contentEl.createEl("h3", { text: this.title });

    new Setting(contentEl).addText((text) => {
      text
        .setPlaceholder(this.placeholder)
        .setValue(this.defaultValue)
        .onChange((value) => {
          this.inputValue = value;
        });
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          this.onSubmit(this.inputValue.trim() || null);
          this.close();
        }
      });
      setTimeout(() => text.inputEl.focus(), 10);
    });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => {
          this.onSubmit(null);
          this.close();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Save")
          .setCta()
          .onClick(() => {
            this.onSubmit(this.inputValue.trim() || null);
            this.close();
          })
      );
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
    contentEl.createEl("h3", { text: "Note Template" });
    const preEl = contentEl.createEl("pre");
    preEl.textContent = this.content;

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Close").onClick(() => this.close())
    );
  }
}

class DeploymentSetupModal extends Modal {
  private onComplete: () => void;

  constructor(
    app: App,
    _config: LeafpressConfig | null,
    onComplete: () => void
  ) {
    super(app);
    this.onComplete = onComplete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Deployment Setup" });
    contentEl.createEl("p", {
      text: "Initial setup requires running a command in your terminal:",
    });
    contentEl.createEl("code", { text: "leafpress deploy" });
    contentEl.createEl("p", {
      text: "This will guide you through authentication and save your configuration.",
    });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Close").onClick(() => {
        this.close();
        this.onComplete();
      })
    );
  }
}
