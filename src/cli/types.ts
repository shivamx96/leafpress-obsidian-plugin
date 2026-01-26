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

export interface LeafpressConfig {
  title: string;
  author?: string;
  baseURL?: string;
  description?: string;
  theme?: {
    navStyle?: string;
    navActiveStyle?: string;
  };
}
