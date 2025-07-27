# Open in Claude Code

A simple Obsidian plugin that allows you to quickly open Claude Code in the current note's folder with a single click or keyboard shortcut.

## Features

- 🚀 **One-click access**: Open Claude Code directly from Obsidian's ribbon or command palette
- 📁 **Smart folder detection**: Automatically uses the current note's folder as the working directory
- ⌨️ **Keyboard shortcuts**: Configure your preferred keyboard shortcut
- 🖥️ **Terminal flexibility**: Choose from popular terminal apps or use a custom command
- 🔍 **Installation check**: Automatically detects if Claude Code is installed
- 💻 **Desktop only**: Built specifically for desktop environments

## How it works

When you trigger the plugin (via ribbon icon, command palette, or keyboard shortcut), it:

1. Detects the folder of your currently active note
2. Opens your preferred terminal application
3. Navigates to that folder
4. Launches Claude Code

For example:
- If you're viewing `References/Brown butter nectarine tart.md`, Claude Code opens in the `References/` folder
- If you're viewing a note in the vault root, Claude Code opens in the vault root directory

## Installation

### Prerequisites

1. Claude Code must be installed on your system
2. Claude Code should be accessible from your terminal (in your PATH)

### From Obsidian Community Plugins

(Coming soon)

### Manual Installation

1. Download the latest release from the releases page
2. Extract the files to your vault's `.obsidian/plugins/open-in-claude-code/` folder
3. Reload Obsidian
4. Enable the plugin in Settings → Community plugins

## Configuration

### Settings

Access the settings via Settings → Plugin Options → Open in Claude Code

- **Terminal application**: Choose from Terminal, iTerm, Warp, or Cursor
- **Use custom command**: Enable to use your own terminal launch command
- **Custom command**: Define your own command using `{{cwd}}` for the working directory and `{{claude}}` for the Claude path
- **Claude Code path**: Specify the path to Claude Code if it's not in your PATH
- **Keyboard shortcut**: Set your preferred keyboard shortcut (default: Ctrl+Shift+C)

### Custom Command Examples

- Open in VS Code's terminal: `code {{cwd}} && code --command workbench.action.terminal.new && sleep 1 && osascript -e 'tell application "System Events" to keystroke "claude" & return'`
- Open in a specific terminal profile: `open -a Terminal {{cwd}} && sleep 0.5 && osascript -e 'tell application "Terminal" to do script "claude" in front window'`

## Troubleshooting

### Claude Code not found

If the plugin reports that Claude Code is not found:

1. Make sure Claude Code is installed: https://docs.anthropic.com/en/docs/claude-code/quickstart
2. Verify it's accessible by running `claude` in your terminal
3. If installed in a non-standard location, update the Claude Code path in settings

### Terminal doesn't open

- On macOS, you may need to grant Obsidian permission to control your terminal app
- Try using a different terminal application or the custom command option

## Platform Support

This plugin is **desktop-only** and works on:
- macOS (fully supported with AppleScript integration)
- Windows (basic support)
- Linux (basic support)

Mobile devices are not supported as they don't have terminal access.

## Development

To build the plugin:

```bash
# Install dependencies
npm install

# Development build with auto-reload
npm run dev

# Production build
npm run build
```

## License

MIT