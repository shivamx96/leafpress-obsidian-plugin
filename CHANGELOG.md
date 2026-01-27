### v0.1.2

**Improvements**
- Server stop reliability: Added waitForServerStopped to poll until port is freed
- Navigation item UX: Combined label and path into single modal
- Path autocomplete: Folder suggestions when adding navigation items
- Terminal commands: Full vault path in deploy commands for easy copy-paste
- Cross-platform commands: Platform-aware terminal commands (Unix vs Windows paths)

### v0.1.1

**Improvements**
- Cross-platform support: Added platform utilities for Windows, macOS, and Linux
    - Browser opening (open, xdg-open, cmd /c start)
    - Port detection (lsof on Unix, netstat on Windows)
    - Process termination (cross-platform)
    - Zip extraction (PowerShell on Windows, unzip on Unix)

**Documentation**
- Updated README with installation instructions, features, and configuration guide
- Added screenshot and sample garden images


### v0.1.0 - Initial Release

**Features**
- Core functionality: Build, deploy, and preview your Obsidian vault as a static website
- Binary management: Auto-download and manage leafpress CLI binary
- Theme configuration: Customize fonts, colors, backgrounds, and navigation styles
- Feature toggles: Enable/disable graph, TOC, search, wikilinks, and backlinks
- Deployment support: GitHub Pages, Vercel, and Netlify integration
- Site settings: Configure title, description, author, base URL, and social image
- Navigation management: Add, edit, and delete navigation menu items
- Note templates: Default template with frontmatter fields for new notes
- Status panel: Real-time server status, page count, and deployment info
- Change tracking: Track pending changes since last deployment
- CLI updates: Check for and install CLI updates from settings

**Technical**
- SHA1 file hashing for deployment state tracking
- Race condition prevention in server management
- File change listener for automatic panel refresh
- GitHub Actions release workflow