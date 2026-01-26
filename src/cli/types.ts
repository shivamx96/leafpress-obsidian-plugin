export interface CLIResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

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
  provider: "github-pages" | "vercel" | "netlify";
  settings?: Record<string, any>;
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
