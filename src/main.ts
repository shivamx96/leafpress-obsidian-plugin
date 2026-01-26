import { Plugin, PluginSettingTab, App, Setting, Notice } from "obsidian";
import { BinaryManager } from "./cli/manager";
import { CommandHandlers } from "./cli/handlers";
import { LeafpressPanel, VIEW_TYPE_LEAFPRESS } from "./panel";
import { LeafpressConfig } from "./cli/types";
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
    this.displayNavSettings(containerEl);

    containerEl.createEl("hr", { cls: "leafpress-divider" });

    // Features
    containerEl.createEl("h3", { text: "Features" });
    containerEl.createEl("p", {
      text: "Enable or disable site features.",
      cls: "leafpress-desc",
    });
    this.displayFeatureToggles(containerEl);
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

  private displayNavSettings(containerEl: HTMLElement): void {
    const navStyle = this.currentConfig?.theme?.navStyle || "base";
    const navActiveStyle = this.currentConfig?.theme?.navActiveStyle || "base";

    new Setting(containerEl)
      .setName("Navigation Style")
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
      .setName("Active Navigation Style")
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
