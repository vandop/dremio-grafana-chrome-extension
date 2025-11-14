# Contributing to Grafana UUID Mapper

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/dremio-grafana-chrome-extension.git
   cd dremio-grafana-chrome-extension
   ```
3. **Load the extension** in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the extension directory

## Development Workflow

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**:
   - Edit the relevant files
   - Test thoroughly in Chrome
   - Check browser console for errors

3. **Test your changes**:
   - Reload the extension in `chrome://extensions/`
   - Refresh any Grafana pages
   - Test all affected functionality
   - Check both Dremio Cloud and On-Premise modes

4. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request** on GitHub

## Code Style

- Use **2 spaces** for indentation
- Use **camelCase** for variables and functions
- Use **PascalCase** for classes
- Add **comments** for complex logic
- Use **template literals** for string interpolation
- Use **async/await** instead of raw promises
- Add **error handling** for all async operations

## Commit Message Format

Use conventional commits:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

Examples:
```
feat: add support for custom query templates
fix: resolve polling error for PLANNING state
docs: update README with Cloud configuration
```

## Testing Checklist

Before submitting a PR, verify:

- [ ] Extension loads without errors
- [ ] Configuration wizard works (all 3 steps)
- [ ] Connection test works for both Cloud and On-Premise
- [ ] Context menu appears and works
- [ ] UUID lookup displays results correctly
- [ ] Error handling works (network errors, invalid config, etc.)
- [ ] Browser notifications work as fallback
- [ ] No console errors or warnings
- [ ] Code follows the style guide
- [ ] No sensitive data in commits

## File Structure

```
├── manifest.json          # Extension configuration
├── background.js          # Service worker (API calls, caching)
├── content.js            # Content script (DOM interaction, modals)
├── popup.html/js         # Configuration UI
├── styles.css            # Styling for overlays and highlights
├── icons/                # Extension icons
├── README.md             # User documentation
├── CONTRIBUTING.md       # This file
├── SECURITY.md           # Security policy
└── LICENSE               # MIT License
```

## Key Components

### background.js
- `DremioClient` class: Handles all Dremio API communication
- `queryDremioCloud()`: Async polling for Cloud queries
- `queryDremioOnPrem()`: Sync queries for On-Premise
- Context menu handler
- Message passing to content script

### content.js
- `UuidMapper` class: Manages UUID detection and UI
- `createProgressModal()`: Shows loading state
- `showResultModal()`: Displays lookup results
- Message listener for background script

### popup.js
- `ConfigurationWizard` class: 3-step configuration UI
- Connection testing
- Query preview
- Settings persistence

## Adding New Features

### Example: Adding a new configuration option

1. **Update popup.html**: Add form field
2. **Update popup.js**: 
   - Add to `getAdvancedConfig()`
   - Add to `populateAdvancedForm()`
3. **Update background.js**: Use the new config value
4. **Test**: Verify it saves and loads correctly

### Example: Adding support for a new Dremio API

1. **Update background.js**: Add new query method
2. **Update popup.html**: Add UI for selecting the API type
3. **Update popup.js**: Handle the new option
4. **Test**: Verify it works end-to-end

## Debugging Tips

### Service Worker Console
- Go to `chrome://extensions/`
- Find the extension
- Click "Service worker" to open console
- Look for `[UUID Mapper - Background]` logs

### Content Script Console
- Open DevTools on the Grafana page (F12)
- Look for `[UUID Mapper - Content]` logs

### Common Issues
- **"Receiving end does not exist"**: Content script not loaded, refresh the page
- **CORS errors**: Check Dremio server CORS settings
- **401/403 errors**: Check authentication credentials
- **Modal not showing**: Check content script is loaded on the page

## Questions?

- Open an issue on GitHub
- Check existing issues for similar questions
- Review the README and SECURITY.md

Thank you for contributing! 🎉

