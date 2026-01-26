# Leafpress Obsidian Plugin

Build and deploy your Obsidian vault as a Leafpress digital garden without touching the CLI.

## Development

### Setup

```bash
npm install
npm run dev
```

### Build

```bash
npm run build
```

## Project Structure

- `src/main.ts` - Plugin entry point and command registration
- `src/cli/manager.ts` - Binary download and execution
- `src/cli/handlers.ts` - CLI command wrappers with UI feedback
- `src/cli/types.ts` - TypeScript types
- `src/panel.ts` - Sidebar status panel
- `manifest.json` - Obsidian plugin metadata

## Phase 1 Tasks

- [x] Project boilerplate setup
- [ ] BinaryManager: Platform detection and binary execution
- [ ] CommandHandlers: Build and deploy wrappers
- [ ] Status panel UI
- [ ] Error handling

## Notes

- Uses Obsidian 1.3.0+ API
- Requires Go CLI binary to be available
- Cross-platform support (macOS, Linux, Windows)
