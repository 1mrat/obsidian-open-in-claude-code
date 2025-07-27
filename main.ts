import { 
  App, 
  Plugin, 
  PluginSettingTab, 
  Setting, 
  Notice, 
  FileSystemAdapter,
  TFile,
  Platform
} from 'obsidian';

// Plugin settings interface
interface OpenInClaudeCodeSettings {
  terminalApp: string;
  customCommand: string;
  claudeCodePath: string;
  useCustomClaudePath: boolean; // Use custom Claude Code path
  keyboardShortcut: string;
  showDebugInfo?: boolean;
  terminalDelay?: number; // Configurable delay for terminal operations
  alwaysOpenVaultRoot?: boolean; // Always open vault root instead of current note's parent
  // Claude CLI options
  permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'plan' | 'default' | 'custom';
  dangerouslySkipPermissions?: boolean;
  allowedTools?: string[];
  deniedTools?: string[];
  claudeModel?: string;
  continueLastSession?: boolean;
  additionalDirectories?: string[];
  maxTurns?: number;
  verboseMode?: boolean;
}

// Default settings
const DEFAULT_SETTINGS: OpenInClaudeCodeSettings = {
  terminalApp: 'terminal',
  customCommand: '',
  claudeCodePath: '/opt/homebrew/bin/claude',
  useCustomClaudePath: false,
  keyboardShortcut: 'Ctrl+Shift+C',
  showDebugInfo: false,
  terminalDelay: 1500, // Default 1.5 seconds, configurable
  alwaysOpenVaultRoot: false, // Default to opening current note's parent
  // Claude CLI defaults
  permissionMode: 'default',
  dangerouslySkipPermissions: false,
  allowedTools: [],
  deniedTools: [],
  claudeModel: 'default',
  continueLastSession: false,
  additionalDirectories: [],
  maxTurns: 10,
  verboseMode: false
};

// Terminal app configurations
const TERMINAL_APPS: Record<string, {
  name: string;
  appName: string;
  bundleId?: string;
  urlScheme: string | null;
  openCommand: ((cwd: string, claudePath: string) => string) | null;
  useDirectLaunch?: boolean;
  requiresDelay?: boolean;
  customDelay?: number;
}> = {
  terminal: {
    name: 'Terminal',
    appName: 'Terminal',
    bundleId: 'com.apple.Terminal',
    urlScheme: null,
    openCommand: (cwd: string, claudePath: string) => {
      const escapedPath = escapeAppleScriptString(cwd);
      return `tell application "Terminal"
        activate
        set newWindow to do script "cd ${escapedPath} && clear && ${claudePath}"
        set current settings of newWindow to settings set "Pro"
      end tell`;
    }
  },
  iterm: {
    name: 'iTerm2',
    appName: 'iTerm',
    bundleId: 'com.googlecode.iterm2',
    urlScheme: null,
    openCommand: (cwd: string, claudePath: string) => {
      const escapedPath = escapeAppleScriptString(cwd);
      return `tell application "iTerm"
        activate
        create window with default profile
        tell current session of current window
          write text "cd ${escapedPath} && clear && ${claudePath}"
        end tell
      end tell`;
    }
  },
  warp: {
    name: 'Warp',
    appName: 'Warp',
    bundleId: 'dev.warp.Warp-Stable',
    urlScheme: 'warp://action/new_window',
    openCommand: null,
    requiresDelay: true,
    customDelay: 2500 // Longer delay for Warp
  },
  cursor: {
    name: 'Cursor',
    appName: 'Cursor', 
    bundleId: 'com.todesktop.230313mzl4w4u92',
    urlScheme: 'cursor://file/',
    openCommand: null,
    requiresDelay: true
  },
  vscode: {
    name: 'VS Code',
    appName: 'Visual Studio Code',
    bundleId: 'com.microsoft.VSCode',
    urlScheme: 'vscode://file/',
    openCommand: null,
    requiresDelay: true
  },
  ghostty: {
    name: 'Ghostty',
    appName: 'Ghostty',
    urlScheme: null,
    openCommand: (cwd: string, claudePath: string) => {
      const escapedPath = escapeAppleScriptString(cwd);
      // More robust Ghostty handling
      return `tell application "Ghostty"
        activate
      end tell
      delay 0.5
      tell application "System Events"
        tell process "Ghostty"
          -- Try to create new window with menu
          try
            click menu item "New Window" of menu "Shell" of menu bar 1
          on error
            -- Fallback to keyboard shortcut
            keystroke "n" using command down
          end try
          delay 0.8
          -- Type the command
          keystroke "cd ${escapedPath} && clear && ${claudePath}"
          keystroke return
        end tell
      end tell`;
    }
  }
};

// Cache for terminal app detection
const terminalAppCache = new Map<string, { installed: boolean; timestamp: number }>();
const CACHE_DURATION = 60000; // 1 minute cache

// Utility function to escape strings for AppleScript
function escapeAppleScriptString(str: string): string {
  // Escape backslashes first, then quotes
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "'\"'\"'");
}

// Utility function to escape shell commands
function escapeShellString(str: string): string {
  return str.replace(/(["\s'$`\\])/g, '\\$1');
}

// Promise-based exec wrapper
function execAsync(command: string, options?: any): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    exec(command, options, (error: any, stdout: string, stderr: string) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// Enhanced AppleScript execution with timeout
async function runAppleScript(script: string, timeout: number = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    const osascript = exec('osascript', { timeout }, (error: any, stdout: string, stderr: string) => {
      if (error) {
        if (error.killed) {
          reject(new Error('AppleScript execution timed out'));
        } else {
          reject(new Error(`AppleScript error: ${stderr || error.message}`));
        }
      } else {
        resolve();
      }
    });
    
    osascript.stdin?.write(script);
    osascript.stdin?.end();
  });
}

// Build Claude command with CLI options
function buildClaudeCommand(settings: OpenInClaudeCodeSettings): string {
  let command = settings.useCustomClaudePath ? settings.claudeCodePath : 'claude';
  
  // Add permission mode if not default
  if (settings.permissionMode && settings.permissionMode !== 'default') {
    command += ` --permission-mode ${settings.permissionMode}`;
  }
  
  // Add dangerous skip permissions flag
  if (settings.dangerouslySkipPermissions) {
    command += ' --dangerously-skip-permissions';
  }
  
  // Add allowed tools
  if (settings.allowedTools && settings.allowedTools.length > 0) {
    command += ` --allowedTools ${settings.allowedTools.join(',')}`;
  }
  
  // Add denied tools
  if (settings.deniedTools && settings.deniedTools.length > 0) {
    command += ` --disallowedTools ${settings.deniedTools.join(',')}`;
  }
  
  // Add model selection
  if (settings.claudeModel && settings.claudeModel !== 'default') {
    command += ` --model ${settings.claudeModel}`;
  }
  
  // Add continue last session
  if (settings.continueLastSession) {
    command += ' --continue';
  }
  
  // Add max turns if not default
  if (settings.maxTurns && settings.maxTurns !== 10) {
    command += ` --max-turns ${settings.maxTurns}`;
  }
  
  // Add verbose mode
  if (settings.verboseMode) {
    command += ' --verbose';
  }
  
  // Add additional directories
  if (settings.additionalDirectories && settings.additionalDirectories.length > 0) {
    for (const dir of settings.additionalDirectories) {
      if (dir.trim()) {
        command += ` --add-dir "${escapeShellString(dir.trim())}"`;
      }
    }
  }
  
  return command;
}

export default class OpenInClaudeCodePlugin extends Plugin {
  settings: OpenInClaudeCodeSettings;
  private claudeInstalled: boolean | null = null;

  /**
   * Detect Claude Code installation path
   */
  async detectClaudePath(): Promise<string | null> {
    try {
      // Try to find claude in PATH first
      try {
        const { stdout } = await execAsync('which claude');
        const path = stdout.trim();
        if (path) return path;
      } catch {
        // Continue to check specific paths
      }

      // Check common installation paths
      const paths = [
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        `${process.env.HOME}/.local/bin/claude`,
        '/usr/bin/claude'
      ];
      
      for (const path of paths) {
        try {
          const { stdout } = await execAsync(`test -f "${path}" && echo "exists"`);
          if (stdout.trim() === 'exists') {
            return path;
          }
        } catch {
          // Continue checking other paths
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error detecting Claude Code path:', error);
      return null;
    }
  }

  /**
   * Verify if a given path contains Claude Code executable
   */
  async verifyClaudePath(path: string): Promise<boolean> {
    if (!path) return false;
    
    try {
      // Check if file exists and is executable
      const { stdout } = await execAsync(`test -x "${path}" && echo "executable"`);
      return stdout.trim() === 'executable';
    } catch {
      return false;
    }
  }

  async onload() {
    // Load settings
    await this.loadSettings();

    // Check platform support
    if (!Platform.isDesktopApp || !Platform.isMacOS) {
      new Notice('Open in Claude Code: This plugin only supports macOS desktop. The plugin will not function on this platform.', 10000);
      console.warn('Open in Claude Code: Plugin requires macOS desktop');
    }

    // Add ribbon icon
    this.addRibbonIcon('terminal', 'Open in Claude Code', () => {
      this.openClaudeCode();
    });

    // Add command
    this.addCommand({
      id: 'open-in-claude-code',
      name: 'Open in Claude Code',
      callback: () => {
        this.openClaudeCode();
      },
      hotkeys: this.parseHotkey(this.settings.keyboardShortcut)
    });

    // Add settings tab
    this.addSettingTab(new OpenInClaudeCodeSettingTab(this.app, this));

    // Check if Claude Code is installed on startup (with caching)
    if (Platform.isDesktopApp && Platform.isMacOS) {
      this.checkClaudeCodeInstallation();
    }
  }

  /**
   * Parse hotkey string into Obsidian hotkey format
   */
  parseHotkey(hotkeyString: string): any[] {
    if (!hotkeyString) return [];
    
    const parts = hotkeyString.split('+').map(s => s.trim());
    const modifiers: string[] = [];
    let key = '';

    parts.forEach(part => {
      const lowerPart = part.toLowerCase();
      if (lowerPart === 'ctrl' || lowerPart === 'cmd') {
        modifiers.push('Mod');
      } else if (lowerPart === 'alt' || lowerPart === 'option') {
        modifiers.push('Alt');
      } else if (lowerPart === 'shift') {
        modifiers.push('Shift');
      } else {
        key = part;
      }
    });

    return [{
      modifiers: modifiers,
      key: key
    }];
  }

  /**
   * Get the vault path from Obsidian
   */
  getVaultPath(): string {
    if (this.app.vault.adapter instanceof FileSystemAdapter) {
      return this.app.vault.adapter.getBasePath();
    }
    return '';
  }

  /**
   * Get the working directory based on the active note
   */
  getWorkingDirectory(): string {
    const vaultPath = this.getVaultPath();
    
    // If alwaysOpenVaultRoot is enabled, always return vault root
    if (this.settings.alwaysOpenVaultRoot) {
      return vaultPath;
    }
    
    const activeFile = this.app.workspace.getActiveFile();
    
    if (!activeFile) {
      // No active file, use vault root
      return vaultPath;
    }

    // Get the folder containing the active file
    const folderPath = activeFile.parent?.path || '';
    
    // Return absolute path to the folder
    if (folderPath) {
      return `${vaultPath}/${folderPath}`;
    }
    
    return vaultPath;
  }

  /**
   * Check if Claude Code is installed (with caching)
   */
  async checkClaudeCodeInstallation(): Promise<boolean> {
    // Use cached result if available
    if (this.claudeInstalled !== null) {
      return this.claudeInstalled;
    }

    try {
      // If using custom path, verify it
      if (this.settings.useCustomClaudePath) {
        this.claudeInstalled = await this.verifyClaudePath(this.settings.claudeCodePath);
        return this.claudeInstalled;
      }

      // Otherwise, try to auto-detect
      const detectedPath = await this.detectClaudePath();
      if (detectedPath) {
        this.settings.claudeCodePath = detectedPath;
        await this.saveSettings();
        this.claudeInstalled = true;
        return true;
      }
      
      this.claudeInstalled = false;
      return false;
    } catch (error) {
      console.error('Error checking Claude Code installation:', error);
      this.claudeInstalled = false;
      return false;
    }
  }

  /**
   * Check if a terminal app is installed (with caching)
   */
  async checkTerminalAppInstalled(appName: string): Promise<boolean> {
    if (!Platform.isMacOS) return true; // Only check on macOS
    
    // Check cache first
    const cached = terminalAppCache.get(appName);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.installed;
    }

    try {
      // Try bundle ID first if available
      const terminalConfig = Object.values(TERMINAL_APPS).find(config => config.appName === appName);
      if (terminalConfig?.bundleId) {
        try {
          const { stdout } = await execAsync(
            `osascript -e 'tell application "Finder" to get application file id "${terminalConfig.bundleId}" as text'`
          );
          if (stdout.trim()) {
            terminalAppCache.set(appName, { installed: true, timestamp: Date.now() });
            return true;
          }
        } catch {
          // Continue with other methods
        }
      }
      
      // Check standard locations
      const appPaths = [
        `/Applications/${appName}.app`,
        `${process.env.HOME}/Applications/${appName}.app`,
        `/System/Applications/${appName}.app`
      ];
      
      for (const path of appPaths) {
        try {
          const { stdout } = await execAsync(`test -d "${path}" && echo "exists"`);
          if (stdout.trim() === 'exists') {
            terminalAppCache.set(appName, { installed: true, timestamp: Date.now() });
            return true;
          }
        } catch {
          // Continue checking other paths
        }
      }
      
      // Use mdfind as last resort
      try {
        const escapedAppName = escapeShellString(appName);
        const { stdout } = await execAsync(
          `mdfind "kMDItemKind == 'Application' && kMDItemFSName == '${escapedAppName}.app'" | head -1`
        );
        const installed = stdout.trim().length > 0;
        terminalAppCache.set(appName, { installed, timestamp: Date.now() });
        return installed;
      } catch {
        terminalAppCache.set(appName, { installed: false, timestamp: Date.now() });
        return false;
      }
    } catch (error) {
      console.error(`Error checking for ${appName}:`, error);
      terminalAppCache.set(appName, { installed: false, timestamp: Date.now() });
      return false;
    }
  }

  /**
   * Open Claude Code in the appropriate directory
   */
  async openClaudeCode() {
    // Check if we're on desktop and macOS
    if (!Platform.isDesktopApp || !Platform.isMacOS) {
      new Notice('This feature is only available on macOS desktop');
      return;
    }

    // Check if Claude is installed
    const claudeInstalled = await this.checkClaudeCodeInstallation();
    if (!claudeInstalled) {
      new Notice('Claude Code not found. Please install it first.');
      return;
    }

    const workingDir = this.getWorkingDirectory();
    const activeFile = this.app.workspace.getActiveFile();
    const displayPath = activeFile ? activeFile.parent?.path || 'vault root' : 'vault root';

    try {
      if (this.settings.terminalApp === 'custom') {
        // Use custom command
        await this.executeCustomCommand(workingDir);
      } else {
        // Use predefined terminal app
        await this.openInTerminal(workingDir);
      }
      
      // Don't show success notice for VS Code/Cursor as they have their own notice
      if (!['vscode', 'cursor'].includes(this.settings.terminalApp)) {
        new Notice(`Opening Claude Code in: ${displayPath}`);
      }
    } catch (error) {
      console.error('Failed to open Claude Code:', error);
      new Notice(`Failed to open Claude Code: ${error.message}`);
    }
  }

  /**
   * Execute custom command with working directory
   */
  async executeCustomCommand(cwd: string): Promise<void> {
    const claudeCommand = buildClaudeCommand(this.settings);
    const command = this.settings.customCommand
      .replace('{{cwd}}', cwd)
      .replace('{{claude}}', claudeCommand);
    
    try {
      await execAsync(command, { cwd });
    } catch (error) {
      throw new Error(`Custom command failed: ${error.message}`);
    }
  }

  /**
   * Open in the selected terminal application
   */
  async openInTerminal(cwd: string): Promise<void> {
    const terminalConfig = TERMINAL_APPS[this.settings.terminalApp];
    
    if (!terminalConfig) {
      throw new Error('Invalid terminal application selected');
    }

    // Build the Claude command with all options
    const claudeCommand = buildClaudeCommand(this.settings);

    // Handle URL schemes for specific apps
    if (terminalConfig.urlScheme) {
      await this.handleUrlSchemeApp(terminalConfig, cwd);
      return;
    }

    // Use AppleScript for Terminal, iTerm, and Ghostty
    if (Platform.isMacOS && terminalConfig.openCommand) {
      const script = terminalConfig.openCommand(cwd, claudeCommand);
      await runAppleScript(script);
    } else {
      // Fallback for other platforms
      await execAsync(claudeCommand, { cwd });
    }
  }

  /**
   * Handle apps that use URL schemes (VS Code, Cursor, Warp)
   */
  private async handleUrlSchemeApp(terminalConfig: any, cwd: string): Promise<void> {
    const delay = terminalConfig.customDelay || this.settings.terminalDelay || DEFAULT_SETTINGS.terminalDelay!;
    
    if (this.settings.terminalApp === 'cursor') {
      const url = `cursor://file/${encodeURIComponent(cwd)}`;
      window.open(url);
      new Notice('Opening Cursor... Please approve the security dialog if prompted.', 8000);
      
      // Enhanced Cursor handling
      setTimeout(async () => {
        const escapedPath = escapeAppleScriptString(cwd);
        const script = `
          tell application "Cursor"
            activate
          end tell
          delay 1
          tell application "System Events"
            tell process "Cursor"
              -- Wait for any dialogs to be dismissed
              repeat 10 times
                if not (exists window "Open External Folder") then
                  exit repeat
                end if
                delay 0.5
              end repeat
              
              -- Open terminal
              delay 0.5
              keystroke "j" using command down
              delay 1
              
              -- Send command
              keystroke "cd ${escapedPath} && ${buildClaudeCommand(this.settings)}"
              keystroke return
            end tell
          end tell
        `;
        
        try {
          await runAppleScript(script);
        } catch (error) {
          console.error('Failed to send command to Cursor:', error);
          new Notice('Failed to open terminal in Cursor. Please open it manually with Cmd+J');
        }
      }, delay);
      
    } else if (this.settings.terminalApp === 'vscode') {
      const url = `vscode://file/${encodeURIComponent(cwd)}`;
      window.open(url);
      new Notice('Opening VS Code... Please approve the security dialog if prompted.', 8000);
      
      // Enhanced VS Code handling
      setTimeout(async () => {
        const escapedPath = escapeAppleScriptString(cwd);
        const script = `
          tell application "Visual Studio Code"
            activate
          end tell
          delay 1
          tell application "System Events"
            tell process "Code"
              -- Wait for any dialogs
              repeat 10 times
                try
                  if not (exists sheet 1 of window 1) then
                    exit repeat
                  end if
                on error
                  exit repeat
                end try
                delay 0.5
              end repeat
              
              -- Open integrated terminal
              delay 0.5
              keystroke "\`" using control down
              delay 1
              
              -- Send command
              keystroke "cd ${escapedPath} && ${buildClaudeCommand(this.settings)}"
              keystroke return
            end tell
          end tell
        `;
        
        try {
          await runAppleScript(script);
        } catch (error) {
          console.error('Failed to send command to VS Code:', error);
          new Notice('Failed to open terminal in VS Code. Please open it manually with Ctrl+`');
        }
      }, delay);
      
    } else if (this.settings.terminalApp === 'warp') {
      window.open(terminalConfig.urlScheme);
      
      // Enhanced Warp handling with proper timing
      setTimeout(async () => {
        const escapedPath = escapeAppleScriptString(cwd);
        const script = `
          tell application "Warp"
            activate
          end tell
          delay 2
          tell application "System Events"
            tell process "Warp"
              -- Wait for window to be ready
              repeat 10 times
                if (exists window 1) then
                  exit repeat
                end if
                delay 0.5
              end repeat
              
              delay 1
              -- Send command slowly to avoid beeping
              keystroke "c"
              delay 0.1
              keystroke "d"
              delay 0.1
              keystroke " "
              delay 0.1
              keystroke "${escapedPath}"
              delay 0.3
              keystroke return
              delay 0.5
              keystroke "${buildClaudeCommand(this.settings)}"
              keystroke return
            end tell
          end tell
        `;
        
        try {
          await runAppleScript(script);
        } catch (error) {
          console.error('Failed to send command to Warp:', error);
          new Notice('Failed to send command to Warp. Please type it manually.');
        }
      }, delay);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/**
 * Settings tab for the plugin
 */
class OpenInClaudeCodeSettingTab extends PluginSettingTab {
  plugin: OpenInClaudeCodePlugin;

  constructor(app: App, plugin: OpenInClaudeCodePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Open in Claude Code Settings' });

    // Check Claude Code installation
    this.checkAndDisplayClaudeStatus(containerEl);

    // Claude Code custom path section
    const pathSection = new Setting(containerEl)
      .setName('Claude Code custom path')
      .setDesc('Override the auto-detected Claude Code path')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useCustomClaudePath || false)
        .onChange(async (value) => {
          this.plugin.settings.useCustomClaudePath = value;
          
          if (!value) {
            // Reset to auto-detected path
            const detectedPath = await this.plugin.detectClaudePath();
            if (detectedPath) {
              this.plugin.settings.claudeCodePath = detectedPath;
            }
          }
          
          await this.plugin.saveSettings();
          this.display(); // Refresh to show/hide path input
        }));
    
    // Only show path input and test button when custom path is enabled
    if (this.plugin.settings.useCustomClaudePath) {
      pathSection.addText(text => {
        text.setPlaceholder('/opt/homebrew/bin/claude')
          .setValue(this.plugin.settings.claudeCodePath || '')
          .onChange(async (value) => {
            this.plugin.settings.claudeCodePath = value;
            await this.plugin.saveSettings();
          });
        
        text.inputEl.style.width = '300px';
        text.inputEl.style.fontFamily = 'var(--font-monospace)';
        text.inputEl.style.fontSize = '13px';
        
        return text;
      });
      
      // Add test button
      pathSection.addButton(button => button
        .setButtonText('Test')
        .onClick(async () => {
          const isValid = await this.plugin.verifyClaudePath(this.plugin.settings.claudeCodePath);
          if (isValid) {
            new Notice('✓ Claude Code found at this path!');
          } else {
            new Notice('✗ Claude Code not found at this path');
          }
        }));
    }

    // Terminal application selection
    const terminalSetting = new Setting(containerEl)
      .setName('Terminal application')
      .setDesc('Select your preferred terminal application');
      
    // Create dropdown with loading message
    let dropdownComponent: any;
    terminalSetting.addDropdown(dropdown => {
      dropdownComponent = dropdown;
      dropdown.addOption('loading', 'Checking installed apps...');
      dropdown.setValue('loading');
    });
    
    // Check installed apps asynchronously and update dropdown
    this.checkInstalledTerminalApps().then(availableApps => {
      // Clear the dropdown
      const selectEl = dropdownComponent.selectEl;
      selectEl.empty();
      
      // Add available options
      Object.entries(availableApps).forEach(([key, name]) => {
        dropdownComponent.addOption(key, name);
      });
      
      // Always add custom option
      dropdownComponent.addOption('custom', 'Custom Command');
      
      // If current selection is not available, reset to first available option
      if (this.plugin.settings.terminalApp !== 'custom' && !availableApps[this.plugin.settings.terminalApp]) {
        this.plugin.settings.terminalApp = Object.keys(availableApps)[0] || 'terminal';
        this.plugin.saveSettings();
      }
      
      dropdownComponent
        .setValue(this.plugin.settings.terminalApp)
        .onChange(async (value: string) => {
          this.plugin.settings.terminalApp = value;
          await this.plugin.saveSettings();
          this.display(); // Refresh to show/hide custom command field
        });
    });

    // Custom command input (only show if custom is selected)
    if (this.plugin.settings.terminalApp === 'custom') {
      new Setting(containerEl)
        .setName('Custom command')
        .setDesc('Use {{cwd}} for working directory and {{claude}} for Claude path')
        .addTextArea(text => text
          .setPlaceholder('Example: open -a "My Terminal" {{cwd}} && {{claude}}')
          .setValue(this.plugin.settings.customCommand)
          .onChange(async (value) => {
            this.plugin.settings.customCommand = value;
            await this.plugin.saveSettings();
          }));
    }

    // Terminal delay setting
    new Setting(containerEl)
      .setName('Terminal activation delay')
      .setDesc('Delay in milliseconds before sending commands (for VS Code, Cursor, Warp)')
      .addText(text => text
        .setPlaceholder('1500')
        .setValue(String(this.plugin.settings.terminalDelay || DEFAULT_SETTINGS.terminalDelay))
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 500 && numValue <= 10000) {
            this.plugin.settings.terminalDelay = numValue;
            await this.plugin.saveSettings();
          }
        }));

    // Keyboard shortcut
    new Setting(containerEl)
      .setName('Keyboard shortcut')
      .setDesc('Set a keyboard shortcut (e.g., Ctrl+Shift+C)')
      .addText(text => text
        .setPlaceholder('Ctrl+Shift+C')
        .setValue(this.plugin.settings.keyboardShortcut)
        .onChange(async (value) => {
          this.plugin.settings.keyboardShortcut = value;
          await this.plugin.saveSettings();
          new Notice('Restart Obsidian to apply the new keyboard shortcut');
        }));

    // Folder preference
    new Setting(containerEl)
      .setName('Always open vault root')
      .setDesc('When enabled, always opens Claude Code in the vault root. When disabled, opens in the current note\'s parent folder.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.alwaysOpenVaultRoot || false)
        .onChange(async (value) => {
          this.plugin.settings.alwaysOpenVaultRoot = value;
          await this.plugin.saveSettings();
        }));

    // Model selection
    new Setting(containerEl)
      .setName('Claude model')
      .setDesc('Select which Claude model to use')
      .addDropdown(dropdown => dropdown
        .addOption('default', 'Default (Auto-select)')
        .addOption('claude-opus-4-20250514', 'Claude Opus 4')
        .addOption('claude-sonnet-4-20250514', 'Claude Sonnet 4')
        .addOption('opus', 'Opus (alias)')
        .addOption('sonnet', 'Sonnet (alias)')
        .setValue(this.plugin.settings.claudeModel || 'default')
        .onChange(async (value) => {
          this.plugin.settings.claudeModel = value;
          await this.plugin.saveSettings();
        }));

    // Continue last session
    new Setting(containerEl)
      .setName('Continue last session')
      .setDesc('Automatically resume your most recent Claude conversation')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.continueLastSession || false)
        .onChange(async (value) => {
          this.plugin.settings.continueLastSession = value;
          await this.plugin.saveSettings();
        }));

    // Permission mode
    const permissionSetting = new Setting(containerEl)
      .setName('Permission mode')
      .setDesc('Base permission behavior')
      .addDropdown(dropdown => dropdown
        .addOption('default', 'Default - Ask for each operation')
        .addOption('acceptEdits', 'Accept Edits - Auto-approve file edits')
        .addOption('bypassPermissions', 'Bypass Permissions - Skip all checks')
        .addOption('plan', 'Plan Mode - Planning only')
        .addOption('custom', 'Custom - Select specific tools')
        .setValue(this.plugin.settings.permissionMode || 'default')
        .onChange(async (value: 'acceptEdits' | 'bypassPermissions' | 'plan' | 'default' | 'custom') => {
          this.plugin.settings.permissionMode = value;
          
          // Update tool permissions based on permission mode
          if (!this.plugin.settings.allowedTools) {
            this.plugin.settings.allowedTools = [];
          }
          
          switch (value) {
            case 'acceptEdits':
              // Accept Edits mode should enable edit-related tools
              const editTools = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];
              this.plugin.settings.allowedTools = editTools;
              break;
              
            case 'bypassPermissions':
              // Bypass mode enables all tools
              this.plugin.settings.allowedTools = ['Bash', 'Edit', 'Write', 'MultiEdit', 'WebFetch', 'WebSearch', 'NotebookEdit'];
              this.plugin.settings.dangerouslySkipPermissions = false; // Use mode instead of flag
              break;
              
            case 'plan':
              // Plan mode disables all tools
              this.plugin.settings.allowedTools = [];
              break;
              
            case 'default':
              // Default mode - reset to empty (user must explicitly choose)
              this.plugin.settings.allowedTools = [];
              this.plugin.settings.dangerouslySkipPermissions = false;
              break;
              
            case 'custom':
              // Custom mode - keep existing selections
              break;
          }
          
          await this.plugin.saveSettings();
          this.display(); // Refresh UI to show/hide tool permissions
        }));
    
    // Tool permissions - show inline when custom mode is selected
    if (this.plugin.settings.permissionMode === 'custom') {
      const toolsContainer = permissionSetting.settingEl.createDiv('claude-tools-permissions');
      toolsContainer.style.marginTop = '20px';
      toolsContainer.style.marginLeft = '0';
      toolsContainer.style.paddingLeft = '0';
      
      toolsContainer.createEl('h5', { text: 'Tool Permissions', cls: 'setting-item-name' });
      const toolsDesc = toolsContainer.createEl('p', { 
        cls: 'setting-item-description' 
      });
      toolsDesc.innerHTML = 'Select which tools Claude can use without asking:';
      
      const tools = [
        { id: 'Bash', name: 'Bash', desc: 'Run shell commands' },
        { id: 'Edit', name: 'Edit', desc: 'Edit existing files' },
        { id: 'Write', name: 'Write', desc: 'Create new files' },
        { id: 'MultiEdit', name: 'Multi Edit', desc: 'Make multiple edits' },
        { id: 'WebFetch', name: 'Web Fetch', desc: 'Fetch web content' },
        { id: 'WebSearch', name: 'Web Search', desc: 'Search the web' },
        { id: 'NotebookEdit', name: 'Notebook Edit', desc: 'Edit Jupyter notebooks' }
      ];
      
      // Create two columns for tools
      const toolsGrid = toolsContainer.createDiv('claude-tools-grid');
      toolsGrid.style.display = 'grid';
      toolsGrid.style.gridTemplateColumns = '1fr 1fr';
      toolsGrid.style.gap = '10px';
      toolsGrid.style.marginTop = '10px';
      
      tools.forEach(tool => {
        const toolSetting = new Setting(toolsGrid)
          .setName(tool.name)
          .setDesc(tool.desc)
          .addToggle(toggle => {
            const isAllowed = this.plugin.settings.allowedTools?.includes(tool.id) || false;
            toggle.setValue(isAllowed)
              .onChange(async (value) => {
                if (!this.plugin.settings.allowedTools) {
                  this.plugin.settings.allowedTools = [];
                }
                
                if (value) {
                  // Add to allowed tools if not already there
                  if (!this.plugin.settings.allowedTools.includes(tool.id)) {
                    this.plugin.settings.allowedTools.push(tool.id);
                  }
                  // Remove from denied tools if present
                  if (this.plugin.settings.deniedTools?.includes(tool.id)) {
                    this.plugin.settings.deniedTools = this.plugin.settings.deniedTools.filter(t => t !== tool.id);
                  }
                } else {
                  // Remove from allowed tools
                  this.plugin.settings.allowedTools = this.plugin.settings.allowedTools.filter(t => t !== tool.id);
                }
                
                await this.plugin.saveSettings();
              });
          });
        toolSetting.settingEl.style.marginBottom = '10px';
      });
    }
    
    // Dangerous skip permissions toggle
    new Setting(containerEl)
      .setName('Skip all permissions (dangerous)')
      .setDesc('⚠️ Bypasses all permission prompts - use with extreme caution')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.dangerouslySkipPermissions || false)
        .onChange(async (value) => {
          this.plugin.settings.dangerouslySkipPermissions = value;
          await this.plugin.saveSettings();
        }));
    


    // Debug mode toggle
    new Setting(containerEl)
      .setName('Show debug information')
      .setDesc('Display detailed terminal app detection results')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showDebugInfo || false)
        .onChange(async (value) => {
          this.plugin.settings.showDebugInfo = value;
          await this.plugin.saveSettings();
          this.display(); // Refresh to show/hide debug info
        }));

    // Instructions
    containerEl.createEl('h3', { text: 'How it works' });
    const instructionsEl = containerEl.createEl('div', { cls: 'setting-item-description' });
    instructionsEl.createEl('p', { 
      text: 'This plugin opens Claude Code in the folder of your currently active note.' 
    });
    instructionsEl.createEl('p', { 
      text: 'For example, if you\'re viewing a note in the "References" folder, Claude Code will open with that folder as the working directory.' 
    });

    // Troubleshooting section
    containerEl.createEl('h3', { text: 'Troubleshooting' });
    const troubleEl = containerEl.createEl('div', { cls: 'setting-item-description' });
    troubleEl.createEl('p', { text: 'If you experience issues:' });
    const ul = troubleEl.createEl('ul');
    ul.createEl('li', { text: 'For VS Code/Cursor: Increase the terminal delay if commands aren\'t being sent' });
    ul.createEl('li', { text: 'For Warp: Try increasing the delay to avoid beeping' });
    ul.createEl('li', { text: 'For Ghostty: Ensure you have the latest version installed' });
    ul.createEl('li', { text: 'Enable debug mode to see which apps are detected' });
  }

  async checkInstalledTerminalApps(): Promise<Record<string, string>> {
    const availableApps: Record<string, string> = {};
    
    for (const [key, config] of Object.entries(TERMINAL_APPS)) {
      // Always include Terminal.app as it's built-in on macOS
      if (key === 'terminal' && Platform.isMacOS) {
        availableApps[key] = config.name;
      } else {
        // Check if the app is installed
        const isInstalled = await this.plugin.checkTerminalAppInstalled(config.appName);
        if (isInstalled) {
          availableApps[key] = config.name;
        }
      }
    }
    
    return availableApps;
  }

  async checkAndDisplayClaudeStatus(containerEl: HTMLElement) {
    const statusEl = containerEl.createDiv('claude-code-status');
    statusEl.createEl('h3', { text: 'Claude Code Status' });
    
    // Get current path
    const currentPath = this.plugin.settings.useCustomClaudePath 
      ? this.plugin.settings.claudeCodePath 
      : await this.plugin.detectClaudePath() || '/opt/homebrew/bin/claude';
    
    // Check if the current path is valid
    const isInstalled = await this.plugin.verifyClaudePath(currentPath);
    
    // Simple status display
    const statusText = statusEl.createEl('p', { 
      cls: isInstalled ? 'claude-status-success' : 'claude-status-error'
    });
    
    if (isInstalled) {
      statusText.createEl('span', { text: '✅ Claude Code is installed and available' });
    } else {
      statusText.createEl('span', { text: '❌ Claude Code not found' });
      const helpEl = statusEl.createEl('p', { cls: 'claude-help-text' });
      helpEl.createEl('a', {
        text: 'Install Claude Code',
        href: 'https://docs.anthropic.com/en/docs/claude-code/quickstart'
      });
    }
    
    // Add debug information if enabled
    if (this.plugin.settings.showDebugInfo) {
      const debugEl = containerEl.createDiv('claude-debug-info');
      debugEl.createEl('h4', { text: 'Debug Information' });
      
      // Clear terminal app cache to get fresh results
      terminalAppCache.clear();
      
      // Check each terminal app
      for (const [key, config] of Object.entries(TERMINAL_APPS)) {
        const isInstalled = await this.plugin.checkTerminalAppInstalled(config.appName);
        const status = isInstalled ? '✓' : '✗';
        const bundleInfo = config.bundleId ? ` (${config.bundleId})` : '';
        debugEl.createEl('p', { 
          text: `${status} ${config.name} (${config.appName})${bundleInfo}`,
          cls: isInstalled ? 'debug-success' : 'debug-fail'
        });
      }
      
      // Show current settings
      debugEl.createEl('h4', { text: 'Current Settings' });
      debugEl.createEl('p', { 
        text: `Selected Terminal: ${this.plugin.settings.terminalApp}`,
        cls: 'debug-info'
      });
      debugEl.createEl('p', { 
        text: `Terminal Delay: ${this.plugin.settings.terminalDelay || DEFAULT_SETTINGS.terminalDelay}ms`,
        cls: 'debug-info'
      });
    }
  }
}