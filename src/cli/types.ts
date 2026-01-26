export interface CLIResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

// GitHub Release API response types
export interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  assets: GitHubAsset[];
}

// Deploy provider type
export type DeployProvider = "github-pages" | "vercel" | "netlify";

// Feature toggle keys that can be updated
export type FeatureToggleKey = "graph" | "toc" | "search" | "wikilinks" | "backlinks";

export interface DeployResult {
  url: string;
  provider: "github-pages" | "vercel";
  timestamp: number;
}

export interface LeafpressThemeConfig {
  fontHeading?: string;
  fontBody?: string;
  fontMono?: string;
  accent?: string;
  background?: {
    light: string;
    dark: string;
  };
  navStyle?: "base" | "sticky" | "glassy";
  navActiveStyle?: "base" | "box" | "underlined";
}

export interface DeploySettings {
  provider: DeployProvider;
  settings?: Record<string, unknown>;
}

export interface LeafpressConfig {
  title: string;
  author?: string;
  baseURL?: string;
  description?: string;
  image?: string;
  outputDir?: string;
  port?: number;
  theme?: LeafpressThemeConfig;
  graph?: boolean;
  toc?: boolean;
  search?: boolean;
  wikilinks?: boolean;
  backlinks?: boolean;
  nav?: Array<{ label: string; path: string }>;
  headExtra?: string;
  ignore?: string[];
  deploy?: DeploySettings;
}
