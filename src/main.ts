import { Plugin, PluginSettingTab, App, Setting, Notice, Modal, TFolder } from "obsidian";
import { BinaryManager } from "./cli/manager";
import { CommandHandlers } from "./cli/handlers";
import { LeafpressPanel, VIEW_TYPE_LEAFPRESS } from "./panel";
import { LeafpressConfig, DeployProvider } from "./cli/types";
import {
  readLeafpressConfig,
  updateThemeProperty,
  updateFeatureToggle,
  updateSiteProperty,
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
      id: "initialize",
      name: "Initialize site",
      callback: async () => {
        await this.commandHandlers.initialize();
      },
    });

    this.addCommand({
      id: "build",
      name: "Build site",
      callback: async () => {
        await this.commandHandlers.build();
      },
    });

    this.addCommand({
      id: "preview",
      name: "Preview site",
      callback: async () => {
        await this.commandHandlers.preview();
      },
    });

    this.addCommand({
      id: "deploy",
      name: "Deploy",
      callback: async () => {
        await this.commandHandlers.deploy();
      },
    });

    this.addCommand({
      id: "settings",
      name: "Open settings",
      callback: () => {
        this.openSettings();
      },
    });

    // Register ribbon icon
    this.addRibbonIcon("rocket", "Deploy site", () => {
      void this.commandHandlers.deploy();
    });

    // Register status panel
    this.registerView(
      VIEW_TYPE_LEAFPRESS,
      (leaf) => new LeafpressPanel(leaf, this.binaryManager)
    );

    this.addRibbonIcon("leaf", "Open status panel", () => {
      void this.activateView();
    });

    // Register settings tab
    this.addSettingTab(new LeafpressSettingTab(this.app, this));

    // Initialize panel on startup (deferred)
    if (this.app.workspace.layoutReady) {
      void this.activateView();
    } else {
      this.app.workspace.onLayoutReady(() => void this.activateView());
    }
  }

  onunload() {
    // Cleanup
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData() as Partial<LeafpressPluginSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
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
      void workspace.revealLeaf(leaf);
    }
  }

  openSettings(): void {
    // Open settings window and focus on this plugin's tab
    const appWithSettings = this.app as App & { setting?: { open(): void; openTabById?(id: string): void } };
    appWithSettings.setting?.open();
    appWithSettings.setting?.openTabById?.("obsidian-leafpress");
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Load current config
    void readLeafpressConfig(this.app).then((config) => {
      this.currentConfig = config;
      this.displaySiteConfiguration(containerEl);
      this.displayPluginSettings(containerEl);
    });
  }

  private displayPluginSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Plugin").setHeading();

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
      .setName("Check for updates")
      .setDesc("Check for new versions of the leafpress CLI")
      .addButton((btn) =>
        btn
          .setButtonText("Check for updates")
          .onClick(async () => {
            btn.setDisabled(true);
            btn.setButtonText("Checking...");

            try {
              const updateInfo = await this.plugin.binaryManager.checkForUpdates();
              if (!updateInfo) {
                new Notice("Could not check for updates");
                btn.setButtonText("Check for updates");
                btn.setDisabled(false);
                return;
              }

              if (updateInfo.hasUpdate) {
                const confirmed = await new Promise<boolean>((resolve) => {
                  const modal = new Modal(this.app);
                  new Setting(modal.contentEl).setName("Update available").setHeading();
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
              btn.setButtonText("Check for updates");
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

    // Site Info
    new Setting(containerEl).setName("Site").setHeading();
    this.displaySiteInfo(containerEl);

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

    // Ignored directories
    new Setting(containerEl).setName("Ignored directories").setHeading();
    this.displayIgnoredDirectories(containerEl);

    // Deployment
    new Setting(containerEl).setName("Deployment").setHeading();
    this.displayDeploymentSettings(containerEl);

    // Note template
    new Setting(containerEl).setName("Note template").setHeading();
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

  private displaySiteInfo(containerEl: HTMLElement): void {
    const config = this.currentConfig;

    new Setting(containerEl)
      .setName("Title")
      .setDesc("Your site's title")
      .addText((text) =>
        text
          .setPlaceholder("My digital garden")
          .setValue(config?.title || "")
          .onChange(async (value) => {
            await updateSiteProperty(this.app, "title", value);
          })
      );

    new Setting(containerEl)
      .setName("Description")
      .setDesc("Short description for search engines and social sharing")
      .addText((text) => {
        text
          .setPlaceholder("A collection of my notes and thoughts")
          .setValue(config?.description || "")
          .onChange(async (value) => {
            await updateSiteProperty(this.app, "description", value);
          });
        text.inputEl.addClass("leafpress-wide-input");
      });

    new Setting(containerEl)
      .setName("Author")
      .setDesc("Your name")
      .addText((text) =>
        text
          .setPlaceholder("Your name")
          .setValue(config?.author || "")
          .onChange(async (value) => {
            await updateSiteProperty(this.app, "author", value);
          })
      );

    new Setting(containerEl)
      .setName("Site address")
      .setDesc("Your site's URL (for sitemap and canonical links)")
      .addText((text) => {
        text
          .setPlaceholder("https://example.com")
          .setValue(config?.baseURL || "")
          .onChange(async (value) => {
            await updateSiteProperty(this.app, "baseURL", value);
          });
        text.inputEl.addClass("leafpress-wide-input");
      });

    new Setting(containerEl)
      .setName("Social image")
      .setDesc("Default image for social sharing (og:image)")
      .addText((text) =>
        text
          .setPlaceholder("/static/og-image.png")
          .setValue(config?.image || "")
          .onChange(async (value) => {
            await updateSiteProperty(this.app, "image", value);
          })
      );
  }

  private displayFontSettings(containerEl: HTMLElement): void {
    const fontHeading = this.currentConfig?.theme?.fontHeading || FONT_DEFAULTS.heading;
    const fontBody = this.currentConfig?.theme?.fontBody || FONT_DEFAULTS.body;
    const fontMono = this.currentConfig?.theme?.fontMono || FONT_DEFAULTS.mono;

    new Setting(containerEl)
      .setName("Font for headings")
      .setDesc(
        // eslint-disable-next-line
        "Google font name for headings, like Crimson Pro or Merriweather"
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
            // Config saved
          })
      );

    new Setting(containerEl)
      .setName("Font for body")
      // eslint-disable-next-line
      .setDesc("Google font name for body text, like Inter or Roboto")
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
            // Config saved
          })
      );

    new Setting(containerEl)
      .setName("Font for code")
      // eslint-disable-next-line
      .setDesc("Google font name for code blocks, like JetBrains Mono or Fira Code")
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
            // Config saved
          })
      );
  }

  private displayColorSettings(containerEl: HTMLElement): void {
    const accentColor = this.currentConfig?.theme?.accent || "#50ac00";

    new Setting(containerEl)
      .setName("Accent color")
      .setDesc("Primary color for links, buttons, and highlights")
      .addColorPicker((color) =>
        color
          .setValue(accentColor)
          .onChange(async (value) => {
            await updateThemeProperty(this.app, "accent", value);
            // Config saved
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
      dd.addOption("solid", "Solid color");
      gradients.forEach((gradient) => {
        dd.addOption(gradient.id, gradient.label);
      });
      dd.addOption("custom", "Custom CSS");
      dd.setValue(currentSelection);
      dd.onChange((selectedMode) => {
        void (async () => {
          if (selectedMode !== "solid" && selectedMode !== "custom") {
            const preset = gradients.find((g) => g.id === selectedMode);
            if (preset) {
              await updateThemeProperty(this.app, `background.${mode}`, preset.value);
            }
          }
          this.display();
        })();
      });
    });

    // Show color picker only for solid color mode
    if (currentSelection === "solid") {
      setting.addColorPicker((color) => {
        color
          .setValue(parsed.type === "color" ? currentValue : "#ffffff")
          .onChange(async (value) => {
            await updateThemeProperty(this.app, `background.${mode}`, value);
            // Config saved
          });
      });
    }
  }

  private displayNavStyleSettings(containerEl: HTMLElement): void {
    const navStyle = this.currentConfig?.theme?.navStyle || "base";
    const navActiveStyle = this.currentConfig?.theme?.navActiveStyle || "base";

    new Setting(containerEl)
      .setName("Navigation bar style")
      .setDesc("Choose the navigation bar style")
      .addDropdown((dd) => {
        dd.addOption("base", "Base");
        dd.addOption("sticky", "Sticky");
        dd.addOption("glassy", "Glassy");
        dd.setValue(navStyle);
        dd.onChange(async (value) => {
          await updateThemeProperty(this.app, "navStyle", value);
          // Config saved
        });
      });

    new Setting(containerEl)
      .setName("Active item style")
      .setDesc("Style for active navigation items")
      .addDropdown((dd) => {
        dd.addOption("base", "Base");
        dd.addOption("box", "Box");
        dd.addOption("underlined", "Underlined");
        dd.setValue(navActiveStyle);
        dd.onChange(async (value) => {
          await updateThemeProperty(this.app, "navActiveStyle", value);
          // Config saved
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
    const result = await this.promptNavItem("Add Navigation Item", "", "");
    if (!result) return;

    const config = this.currentConfig;
    if (!config) return;

    if (!config.nav) {
      config.nav = [];
    }

    config.nav.push(result);
    await (await import("./utils/config")).writeLeafpressConfig(this.app, config);
    new Notice("Navigation item added");
    this.display();
  }

  private async editNavItem(index: number): Promise<void> {
    const config = this.currentConfig;
    if (!config || !config.nav || !config.nav[index]) return;

    const item = config.nav[index];
    const result = await this.promptNavItem("Edit Navigation Item", item.label, item.path);
    if (!result) return;

    config.nav[index] = result;
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

  private promptNavItem(
    title: string,
    defaultLabel: string,
    defaultPath: string
  ): Promise<{ label: string; path: string } | null> {
    return new Promise((resolve) => {
      const modal = new NavItemModal(
        this.app,
        title,
        defaultLabel,
        defaultPath,
        (result) => resolve(result)
      );
      modal.open();
    });
  }

  private displayNoteTemplate(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("View template")
      // eslint-disable-next-line
      .setDesc("Includes fields: title, tags, createdAt, updatedAt, growth, draft")
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
        // eslint-disable-next-line
        dd.addOption("github-pages", "GitHub Pages");
        dd.addOption("vercel", "Vercel");
        dd.addOption("netlify", "Netlify");
        dd.setValue(provider);
        dd.onChange(async (value) => {
          if (!config) return;
          const provider = value as DeployProvider;
          if (!config.deploy) {
            config.deploy = { provider, settings: {} };
          } else {
            config.deploy.provider = provider;
          }
          const { writeLeafpressConfig } = await import("./utils/config");
          await writeLeafpressConfig(this.app, config);
          new Notice(`Deployment provider set to ${value}`);
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Configure")
      // eslint-disable-next-line
      .setDesc("Click Setup guide for terminal command")
      .addButton((btn) =>
        btn.setButtonText("Setup guide").onClick(() => {
          new DeploymentSetupModal(this.app, this.currentConfig, () => {
            this.display();
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
      .setName("Graph visualization")
      .setDesc("Show interactive graph of note connections")
      .addToggle((toggle) =>
        toggle
          .setValue(config?.graph ?? false)
          .onChange(async (value) => {
            await updateFeatureToggle(this.app, "graph", value);
            // Config saved
          })
      );

    new Setting(containerEl)
      .setName("Table of contents")
      .setDesc("Show table of contents on pages")
      .addToggle((toggle) =>
        toggle
          .setValue(config?.toc ?? true)
          .onChange(async (value) => {
            await updateFeatureToggle(this.app, "toc", value);
            // Config saved
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
            // Config saved
          })
      );

    new Setting(containerEl)
      .setName("Wiki links")
      .setDesc("Enable wiki-link processing")
      .addToggle((toggle) =>
        toggle
          .setValue(config?.wikilinks ?? true)
          .onChange(async (value) => {
            await updateFeatureToggle(this.app, "wikilinks", value);
            // Config saved
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
            // Config saved
          })
      );
  }

  private displayIgnoredDirectories(containerEl: HTMLElement): void {
    const ignoredDirs = this.currentConfig?.ignore || [];

    new Setting(containerEl)
      .setDesc("Directories and files to exclude from the build (glob patterns supported)");

    // Display current ignored directories
    if (ignoredDirs.length === 0) {
      new Setting(containerEl)
        .setName("No ignored directories")
        .setDesc("Add patterns to exclude files from your site");
    } else {
      ignoredDirs.forEach((pattern, index) => {
        new Setting(containerEl)
          .setName(pattern)
          .addButton((btn) =>
            btn
              .setButtonText("Delete")
              .setWarning()
              .onClick(async () => {
                await this.deleteIgnoredDirectory(index);
              })
          );
      });
    }

    // Add new ignore pattern
    new Setting(containerEl)
      .setName("Add ignore pattern")
      .setDesc("e.g., drafts/**, private/*, *.tmp")
      .addText((text) => {
        text.setPlaceholder("e.g., drafts/**");
        text.inputEl.id = "leafpress-ignore-input";
      })
      .addButton((btn) =>
        btn.setButtonText("Add").onClick(async () => {
          const input = containerEl.querySelector<HTMLInputElement>("#leafpress-ignore-input");
          const pattern = input?.value?.trim();
          if (!pattern) {
            new Notice("Please enter a pattern");
            return;
          }
          await this.addIgnoredDirectory(pattern);
          if (input) input.value = "";
        })
      );
  }

  private async addIgnoredDirectory(pattern: string): Promise<void> {
    const config = this.currentConfig;
    if (!config) return;

    if (!config.ignore) {
      config.ignore = [];
    }

    if (config.ignore.includes(pattern)) {
      new Notice("Pattern already exists");
      return;
    }

    config.ignore.push(pattern);
    await (await import("./utils/config")).writeLeafpressConfig(this.app, config);
    new Notice("Ignore pattern added");
    this.display();
  }

  private async deleteIgnoredDirectory(index: number): Promise<void> {
    const config = this.currentConfig;
    if (!config || !config.ignore) return;

    config.ignore.splice(index, 1);
    await (await import("./utils/config")).writeLeafpressConfig(this.app, config);
    new Notice("Ignore pattern removed");
    this.display();
  }
}

class NavItemModal extends Modal {
  private title: string;
  private defaultLabel: string;
  private defaultPath: string;
  private onSubmit: (result: { label: string; path: string } | null) => void;
  private labelValue: string;
  private pathValue: string;

  constructor(
    app: App,
    title: string,
    defaultLabel: string,
    defaultPath: string,
    onSubmit: (result: { label: string; path: string } | null) => void
  ) {
    super(app);
    this.title = title;
    this.defaultLabel = defaultLabel;
    this.defaultPath = defaultPath;
    this.labelValue = defaultLabel;
    this.pathValue = defaultPath;
    this.onSubmit = onSubmit;
  }

  private getFolderPaths(): string[] {
    const folders: string[] = ["/"];
    const configDir = this.app.vault.configDir;
    const skipFolders = new Set([configDir, "_site", ".git", "node_modules", ".leafpress"]);

    // Get all folders from vault
    const allFiles = this.app.vault.getAllLoadedFiles();
    for (const file of allFiles) {
      if (file instanceof TFolder) {
        const folderPath = file.path;
        const topLevel = folderPath.split("/")[0];
        if (!skipFolders.has(topLevel) && !folderPath.startsWith(".")) {
          folders.push("/" + folderPath);
        }
      }
    }

    return folders.sort();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });

    new Setting(contentEl)
      .setName("Label")
      .setDesc("Display text in navigation menu")
      .addText((text) => {
        text
          // eslint-disable-next-line
          .setPlaceholder("e.g., Notes")
          .setValue(this.defaultLabel)
          .onChange((value) => {
            this.labelValue = value;
          });
        setTimeout(() => text.inputEl.focus(), 10);
      });

    // Create datalist for path autocomplete
    const datalistId = "leafpress-path-suggestions";
    const datalist = contentEl.createEl("datalist", { attr: { id: datalistId } });
    for (const folderPath of this.getFolderPaths()) {
      datalist.createEl("option", { attr: { value: folderPath } });
    }

    new Setting(contentEl)
      .setName("Path")
      .setDesc("URL path (e.g., /notes or /tags)")
      .addText((text) => {
        text
          .setPlaceholder("e.g., /notes")
          .setValue(this.defaultPath)
          .onChange((value) => {
            this.pathValue = value;
          });
        text.inputEl.setAttribute("list", datalistId);
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
            const label = this.labelValue.trim();
            const path = this.pathValue.trim();
            if (!label || !path) {
              new Notice("Both label and path are required");
              return;
            }
            this.onSubmit({ label, path });
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
    contentEl.createEl("h3", { text: "Note template" });
    const preEl = contentEl.createEl("pre");
    preEl.textContent = this.content;

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Close").onClick(() => this.close())
    );
  }
}

class DeploymentSetupModal extends Modal {
  private onComplete: () => void;
  private vaultPath: string;

  constructor(
    app: App,
    _config: LeafpressConfig | null,
    onComplete: () => void
  ) {
    super(app);
    this.onComplete = onComplete;
    // Get vault path
    const adapter = this.app.vault.adapter as { basePath?: string; path?: string };
    this.vaultPath = adapter.basePath || adapter.path || "";
  }

  private getDeployCommand(): string {
    const configDir = this.app.vault.configDir;
    const isWindows = process.platform === "win32";
    if (isWindows) {
      return `cd "${this.vaultPath}" && .\\${configDir}\\plugins\\leafpress\\bin\\leafpress.exe deploy`;
    }
    return `cd "${this.vaultPath}" && ./${configDir}/plugins/leafpress/bin/leafpress deploy`;
  }

  onOpen() {
    const { contentEl } = this;
    const fullCommand = this.getDeployCommand();

    contentEl.createEl("h3", { text: "Deployment setup" });
    contentEl.createEl("p", {
      text: "Initial setup requires running a command in your terminal. Copy and paste:",
    });

    const commandEl = contentEl.createEl("div", { cls: "leafpress-panel-section" });

    commandEl.createEl("code", {
      text: fullCommand,
      cls: "leafpress-code-block",
    });

    const copyBtn = commandEl.createEl("button", { text: "Copy command" });
    copyBtn.addEventListener("click", () => {
      void navigator.clipboard.writeText(fullCommand);
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy command";
      }, 2000);
    });

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
