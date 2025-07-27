# Debug Analysis and Fixes for Open in Claude Code Plugin

## Summary of Issues Fixed

### 1. Terminal App Detection
- **Fixed**: Proper path expansion for home directories using `process.env.HOME`
- **Fixed**: Shell command escaping to handle app names with spaces
- **Fixed**: Added bundle ID detection for more reliable app identification
- **Fixed**: Implemented caching to prevent repeated filesystem checks
- **Fixed**: Better error handling with fallback detection methods

### 2. Security Dialog Handling (VS Code/Cursor)
- **Fixed**: Improved dialog detection with retry loops
- **Fixed**: Dynamic waiting instead of fixed delays
- **Fixed**: Better error recovery with user-friendly fallback messages
- **Fixed**: Proper AppleScript error handling

### 3. Ghostty Implementation
- **Fixed**: Menu-based window creation with keyboard shortcut fallback
- **Fixed**: Proper path escaping in AppleScript
- **Fixed**: Removed incorrect useDirectLaunch configuration
- **Fixed**: More robust window activation sequence

### 4. Warp Beeping Issue
- **Fixed**: Increased default delay to 2.5 seconds for Warp
- **Fixed**: Character-by-character typing with delays to prevent beeping
- **Fixed**: Window existence checking before sending commands
- **Fixed**: Configurable delay settings per user preference

### 5. Async/Promise Handling
- **Fixed**: Created promise-based wrapper for exec commands
- **Fixed**: Proper error propagation throughout the chain
- **Fixed**: Consistent async/await usage
- **Fixed**: Timeout handling for AppleScript execution

### 6. Path Escaping
- **Fixed**: Centralized escaping functions for AppleScript and shell
- **Fixed**: Proper handling of quotes, spaces, and special characters
- **Fixed**: Correct URL encoding for VS Code/Cursor

### 7. Error Handling
- **Fixed**: Comprehensive try-catch blocks with specific error messages
- **Fixed**: Timeout handling for long-running operations
- **Fixed**: User-friendly error notifications
- **Fixed**: Debug mode for troubleshooting

### 8. Race Conditions
- **Fixed**: Window ready detection loops
- **Fixed**: State verification before operations
- **Fixed**: Configurable delays based on system performance

## New Features Added

### 1. Debug Mode
- Toggle in settings to show detailed app detection results
- Shows installed apps with bundle IDs
- Displays current configuration
- Helps users troubleshoot issues

### 2. Configurable Terminal Delay
- User can adjust delay for VS Code/Cursor/Warp (500-10000ms)
- Per-app custom delays in configuration
- Helps accommodate different system speeds

### 3. Claude Path Detection
- Automatically finds Claude installation
- Updates settings with discovered path
- Caches result for performance

### 4. Bundle ID Detection
- More reliable app detection using macOS bundle identifiers
- Faster than filesystem searches
- Works with apps installed in non-standard locations

### 5. Improved Settings UI
- Troubleshooting section with tips
- Shows Claude installation path when found
- Better organization of settings

## Usage Instructions

### For VS Code/Cursor Users
1. If you see security dialogs, approve them
2. The plugin will wait for dialog dismissal
3. If commands don't send, increase the terminal delay in settings
4. Fallback: manually open terminal (Ctrl+` for VS Code, Cmd+J for Cursor)

### For Warp Users
1. Default delay is set to 2.5 seconds to prevent beeping
2. If still beeping, increase the terminal delay in settings
3. Commands are typed character-by-character to avoid issues

### For Ghostty Users
1. Plugin tries menu-based window creation first
2. Falls back to Cmd+N if menu doesn't work
3. Ensure Ghostty is up to date

### Debug Mode
1. Enable "Show debug information" in settings
2. Check which apps are detected
3. Verify bundle IDs match your installation
4. Use this info when reporting issues

## Technical Details

### Path Escaping
- AppleScript: Escapes backslashes, then quotes, then single quotes
- Shell: Escapes quotes, spaces, dollar signs, backticks, and backslashes
- URL: Uses standard encodeURIComponent for VS Code/Cursor

### App Detection Priority
1. Bundle ID lookup (fastest, most reliable)
2. Standard application directories
3. mdfind spotlight search (fallback)

### Timing Strategy
- Base delays are configurable
- Window ready loops with timeout
- Dialog detection with retry logic
- Character-by-character typing for Warp

## Testing Recommendations

1. Test each terminal app with debug mode enabled
2. Try paths with spaces and special characters
3. Test with security dialogs enabled/disabled
4. Verify keyboard shortcuts work reliably
5. Test with different system loads

## Future Improvements

1. Consider using native messaging APIs instead of AppleScript
2. Add support for more terminal applications
3. Implement command history/favorites
4. Add project-specific terminal configurations
5. Support for multiple Claude installations