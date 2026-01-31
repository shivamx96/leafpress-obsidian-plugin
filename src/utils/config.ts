import { App, Notice } from "obsidian";
import { LeafpressConfig, FeatureToggleKey } from "../cli/types";

export async function readLeafpressConfig(
  app: App
): Promise<LeafpressConfig | null> {
  try {
    const configText = await app.vault.adapter.read("leafpress.json");
    const config = JSON.parse(configText) as LeafpressConfig;
    return config;
  } catch {
    return null;
  }
}

export async function writeLeafpressConfig(
  app: App,
  config: LeafpressConfig
): Promise<void> {
  try {
    await app.vault.adapter.write(
      "leafpress.json",
      JSON.stringify(config, null, 2)
    );
  } catch (err) {
    console.error("[leafpress] Config write error:", err);
    new Notice("Failed to save config to leafpress.json");
    throw err;
  }
}

export async function updateThemeProperty(
  app: App,
  path: string,
  value: unknown
): Promise<boolean> {
  try {
    const config = await readLeafpressConfig(app);
    if (!config) {
      // eslint-disable-next-line -- Filename stylized as lowercase
      new Notice("leafpress.json not found. Initialize your site first.");
      return false;
    }

    // Initialize theme object if it doesn't exist
    if (!config.theme) {
      config.theme = {};
    }

    // Handle nested properties (e.g., 'background.light')
    const parts = path.split(".");
    if (parts.length === 1) {
      // Type assertion needed because theme properties have different types
      (config.theme as Record<string, unknown>)[parts[0]] = value;
    } else if (parts[0] === "background") {
      if (!config.theme.background) {
        config.theme.background = { light: "#ffffff", dark: "#1a1a1a" };
      }
      (config.theme.background as Record<string, unknown>)[parts[1]] = value;
    }

    await writeLeafpressConfig(app, config);
    return true;
  } catch (err) {
    console.error("[leafpress] Error updating theme property:", err);
    new Notice("Failed to update theme");
    return false;
  }
}

export async function updateFeatureToggle(
  app: App,
  feature: FeatureToggleKey,
  enabled: boolean
): Promise<boolean> {
  try {
    const config = await readLeafpressConfig(app);
    if (!config) {
      // eslint-disable-next-line -- Filename stylized as lowercase
      new Notice("leafpress.json not found. Initialize your site first.");
      return false;
    }

    config[feature] = enabled;
    await writeLeafpressConfig(app, config);
    return true;
  } catch (err) {
    console.error("[leafpress] Error updating feature toggle:", err);
    new Notice("Failed to update feature");
    return false;
  }
}

export async function updateSiteProperty(
  app: App,
  property: "title" | "author" | "description" | "baseURL" | "image",
  value: string
): Promise<boolean> {
  try {
    const config = await readLeafpressConfig(app);
    if (!config) {
      // eslint-disable-next-line -- Filename stylized as lowercase
      new Notice("leafpress.json not found. Initialize your site first.");
      return false;
    }

    if (value) {
      config[property] = value;
    } else {
      delete config[property];
    }

    await writeLeafpressConfig(app, config);
    return true;
  } catch (err) {
    console.error("[leafpress] Error updating site property:", err);
    new Notice("Failed to update config");
    return false;
  }
}
