import { Plugin, PluginSettingTab, App, Setting } from "obsidian";
import { BinaryManager } from "./cli/manager";
import { CommandHandlers } from "./cli/handlers";
import { LeafpressPanel, VIEW_TYPE_LEAFPRESS } from "./panel";

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
        console.log("[Leafpress] Initialize command triggered");
        await this.commandHandlers.initialize();
      },
    });

    this.addCommand({
      id: "leafpress-build",
      name: "Build Site",
      callback: async () => {
        console.log("[Leafpress] Build command triggered");
        await this.commandHandlers.build();
      },
    });

    this.addCommand({
      id: "leafpress-preview",
      name: "Preview Site",
      callback: async () => {
        console.log("[Leafpress] Preview command triggered");
        await this.commandHandlers.preview();
      },
    });

    this.addCommand({
      id: "leafpress-deploy",
      name: "Deploy",
      callback: async () => {
        console.log("[Leafpress] Deploy command triggered");
        await this.commandHandlers.deploy();
      },
    });

    this.addCommand({
      id: "leafpress-settings",
      name: "Open Settings",
      callback: () => {
        console.log("[Leafpress] Settings command triggered");
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

  constructor(app: App, plugin: LeafpressPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

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
  }
}
