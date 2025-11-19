// Content script for UUID detection and overlay management

const LOG_PREFIX = '[UUID Mapper - Content]';
const configHelpersPromise = import(chrome.runtime.getURL('src/common/config.js'))
  .catch(error => {
    console.error(`${LOG_PREFIX} Failed to load configuration helpers`, error);
    throw error;
  });

class UuidMapper {
  constructor({ configService = null, configModulePromise = configHelpersPromise } = {}) {
    this.uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    this.processedUuids = new Set();
    this.mappingCache = new Map();
    this.overlay = null;
    this.hoverTimeout = null;
    this.config = null;
    this.configHelpers = null;
    this.configService = configService;
    this.configModulePromise = configModulePromise;
    this.configValid = false;
    this.configErrorMessage = null;

    console.log(`${LOG_PREFIX} UuidMapper constructor called`);
    this.init();
  }

  async getConfigHelpers() {
    if (!this.configHelpers) {
      this.configHelpers = await this.configModulePromise;
    }
    return this.configHelpers;
  }

  async init() {
    console.log(`${LOG_PREFIX} Initializing on ${window.location.href}`);

    // Check if we're on a Grafana page
    if (!this.isGrafanaPage()) {
      console.log(`${LOG_PREFIX} Not a Grafana page, skipping initialization`);
      return;
    }

    console.log(`${LOG_PREFIX} Grafana page detected`);
    await this.loadConfiguration();

    if (!this.isConfigured()) {
      console.warn(`${LOG_PREFIX} Extension not configured - please configure via extension popup`);
      return;
    }

    console.log(`${LOG_PREFIX} Configuration valid, setting up UUID detection`);
    this.createOverlay();
    this.createProgressModal();
    // Disabled automatic scanning - only use context menu (right-click)
    // this.scanForUuids();
    // this.setupMutationObserver();
    this.setupMessageListener();

    console.log(`${LOG_PREFIX} Initialization complete - context menu ready`);
  }

  isGrafanaPage() {
    return window.location.href.includes('grafana') ||
      document.querySelector('[data-testid="grafana"]') ||
      document.querySelector('.grafana-app') ||
      document.title.toLowerCase().includes('grafana');
  }

  async loadConfiguration() {
    console.log(`${LOG_PREFIX} Loading configuration from storage`);
    let helpers;
    try {
      helpers = await this.getConfigHelpers();
      if (!this.configService) {
        this.configService = new helpers.ConfigService();
      }

      const config = await this.configService.load();
      helpers.assertValidConfig(config);
      this.config = config;
      this.configValid = true;
      this.configErrorMessage = null;
      console.log(`${LOG_PREFIX} Configuration loaded:`, {
        dremioType: this.config.dremio.dremioType,
        hasServerUrl: !!this.config.dremio.serverUrl,
        hasProjectId: !!this.config.dremio.projectId,
        hasTableName: !!this.config.query.columnMappings?.table_name,
        hoverDelay: this.config.advanced.hoverDelay
      });
    } catch (error) {
      this.config = null;
      this.configValid = false;
      const isConfigError = helpers && error instanceof helpers.ConfigError;
      if (isConfigError || error?.name === 'ConfigError') {
        this.configErrorMessage = error.message;
        console.warn(`${LOG_PREFIX} Configuration invalid: ${error.message}`);
      } else {
        this.configErrorMessage = 'Failed to load configuration';
        console.error(`${LOG_PREFIX} Failed to load configuration:`, error);
      }
    }
  }

  isConfigured() {
    console.log(`${LOG_PREFIX} Configuration check: ${this.configValid ? 'VALID' : 'INVALID'}`);
    if (!this.configValid && this.configErrorMessage) {
      console.warn(`${LOG_PREFIX} ${this.configErrorMessage}`);
    }
    return this.configValid;
  }

  createOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'uuid-mapper-overlay';
    this.overlay.style.cssText = `
      position: absolute;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      z-index: 10000;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease;
      max-width: 300px;
      word-wrap: break-word;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    `;
    document.body.appendChild(this.overlay);
  }

  createProgressModal() {
    this.progressModal = document.createElement('div');
    this.progressModal.id = 'uuid-mapper-progress-modal';
    this.progressModal.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      z-index: 100000;
      min-width: 400px;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
      display: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Add backdrop
    this.progressBackdrop = document.createElement('div');
    this.progressBackdrop.id = 'uuid-mapper-progress-backdrop';
    this.progressBackdrop.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 99999;
      display: none;
    `;

    document.body.appendChild(this.progressBackdrop);
    document.body.appendChild(this.progressModal);
  }

  showProgressModal(title, message) {
    this.progressBackdrop.style.display = 'block';
    this.progressModal.style.display = 'block';
    this.progressModal.innerHTML = `
      <div style="margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px 0; font-size: 18px; color: #333;">${title}</h3>
        <p style="margin: 0; color: #666; font-size: 14px;">${message}</p>
      </div>
      <div style="display: flex; align-items: center; padding: 12px; background: #f5f5f5; border-radius: 4px;">
        <div style="width: 16px; height: 16px; border: 3px solid #1976d2; border-top: 3px solid transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 12px;"></div>
        <span style="color: #666; font-size: 14px;">Processing query...</span>
      </div>
    `;

    // Add spin animation if not already added
    if (!document.getElementById('uuid-mapper-spin-style')) {
      const style = document.createElement('style');
      style.id = 'uuid-mapper-spin-style';
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  updateProgressModal(message, progress) {
    const progressBar = progress !== undefined ? `
      <div style="margin-top: 12px;">
        <div style="background: #e0e0e0; border-radius: 4px; height: 8px; overflow: hidden;">
          <div style="background: #1976d2; height: 100%; width: ${progress}%; transition: width 0.3s ease;"></div>
        </div>
        <p style="margin: 8px 0 0 0; color: #666; font-size: 12px; text-align: center;">${Math.round(progress)}%</p>
      </div>
    ` : '';

    this.progressModal.querySelector('div[style*="background: #f5f5f5"]').innerHTML = `
      <div style="width: 16px; height: 16px; border: 3px solid #1976d2; border-top: 3px solid transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 12px;"></div>
      <span style="color: #666; font-size: 14px;">${message}</span>
      ${progressBar}
    `;
  }

  showResultModal(title, results, error = null) {
    this.progressModal.innerHTML = `
      <div style="margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px 0; font-size: 18px; color: #333;">${title}</h3>
      </div>
      ${error ? `
        <div style="padding: 12px; background: #ffebee; border-left: 4px solid #f44336; border-radius: 4px; margin-bottom: 16px;">
          <p style="margin: 0; color: #c62828; font-size: 14px;"><strong>Error:</strong> ${error}</p>
        </div>
      ` : ''}
      ${results && results.length > 0 ? `
        <div style="max-height: 400px; overflow-y: auto;">
          ${results.map(r => `
            <div style="padding: 12px; background: #f5f5f5; border-radius: 4px; margin-bottom: 8px;">
              <div style="font-family: monospace; font-size: 12px; color: #666; margin-bottom: 4px;">${r.uuid}</div>
              <div style="font-size: 14px; color: #333; font-weight: 500;">${r.name || 'No name'}</div>
              ${r.description ? `<div style="font-size: 13px; color: #666; margin-top: 4px;">${r.description}</div>` : ''}
              ${r.cached ? '<div style="font-size: 11px; color: #1976d2; margin-top: 4px;">📦 Cached</div>' : ''}
            </div>
          `).join('')}
        </div>
      ` : !error ? '<p style="color: #666; text-align: center; padding: 20px;">No results found</p>' : ''}
      <div style="margin-top: 16px; text-align: right;">
        <button id="uuid-mapper-close-modal" style="
          background: #1976d2;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
        ">Close</button>
      </div>
    `;

    document.getElementById('uuid-mapper-close-modal').addEventListener('click', () => {
      this.hideProgressModal();
    });
  }

  hideProgressModal() {
    this.progressBackdrop.style.display = 'none';
    this.progressModal.style.display = 'none';
  }

  scanForUuids() {
    console.log(`${LOG_PREFIX} Scanning page for UUIDs`);
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip script and style elements
          const parent = node.parentElement;
          if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }

    console.log(`${LOG_PREFIX} Found ${textNodes.length} text nodes to process`);
    let uuidCount = 0;
    textNodes.forEach(textNode => {
      const count = this.processTextNode(textNode);
      uuidCount += count;
    });
    console.log(`${LOG_PREFIX} Scan complete: ${uuidCount} UUIDs found and highlighted`);
  }

  processTextNode(textNode) {
    const text = textNode.textContent;
    const matches = [...text.matchAll(this.uuidRegex)];

    if (matches.length === 0) return 0;

    let lastIndex = 0;
    const fragments = [];

    matches.forEach(match => {
      const uuid = match[0];
      const startIndex = match.index;

      // Add text before UUID
      if (startIndex > lastIndex) {
        fragments.push(document.createTextNode(text.slice(lastIndex, startIndex)));
      }

      // Create UUID span
      const uuidSpan = document.createElement('span');
      uuidSpan.textContent = uuid;
      uuidSpan.className = 'uuid-mappable';
      uuidSpan.style.cssText = `
        background: rgba(0, 123, 186, 0.1);
        border-bottom: 1px dotted #007cba;
        cursor: help;
        position: relative;
      `;

      this.attachUuidEvents(uuidSpan, uuid);
      fragments.push(uuidSpan);

      lastIndex = startIndex + uuid.length;
    });

    // Add remaining text
    if (lastIndex < text.length) {
      fragments.push(document.createTextNode(text.slice(lastIndex)));
    }

    // Replace original text node with fragments
    const parent = textNode.parentNode;
    fragments.forEach(fragment => parent.insertBefore(fragment, textNode));
    parent.removeChild(textNode);

    return matches.length;
  }

  attachUuidEvents(element, uuid) {
    element.addEventListener('mouseenter', (e) => {
      this.hoverTimeout = setTimeout(() => {
        this.showUuidInfo(e, uuid);
      }, this.config.advanced.hoverDelay || 300);
    });

    element.addEventListener('mouseleave', () => {
      if (this.hoverTimeout) {
        clearTimeout(this.hoverTimeout);
        this.hoverTimeout = null;
      }
      this.hideOverlay();
    });

    element.addEventListener('mousemove', (e) => {
      if (this.overlay.style.opacity === '1') {
        this.positionOverlay(e);
      }
    });
  }

  async showUuidInfo(event, uuid) {
    console.log(`${LOG_PREFIX} Showing info for UUID: ${uuid}`);
    this.positionOverlay(event);

    // Check cache first
    if (this.mappingCache.has(uuid)) {
      console.log(`${LOG_PREFIX} Using cached mapping for ${uuid}`);
      const mapping = this.mappingCache.get(uuid);
      this.displayMapping(mapping);
      return;
    }

    // Show loading state
    console.log(`${LOG_PREFIX} Fetching mapping from Dremio for ${uuid}`);
    this.overlay.innerHTML = `
      <div style="display: flex; align-items: center;">
        <div style="width: 12px; height: 12px; border: 2px solid #fff; border-top: 2px solid transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px;"></div>
        Loading...
      </div>
    `;
    this.overlay.style.opacity = '1';

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getUuidMappings',
        uuids: [uuid]
      });

      console.log(`${LOG_PREFIX} Received response for ${uuid}:`, response);

      if (response.success && response.data[uuid]) {
        const mapping = response.data[uuid];
        this.mappingCache.set(uuid, mapping);
        this.displayMapping(mapping);
      } else {
        console.error(`${LOG_PREFIX} Failed to get mapping:`, response.error);
        this.displayError(response.error || 'Mapping not found');
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Error fetching mapping:`, error);
      this.displayError(`Failed to fetch mapping: ${error.message}`);
    }
  }

  displayMapping(mapping) {
    let content = `<strong>${mapping.name}</strong>`;

    if (mapping.description) {
      content += `<br><small style="opacity: 0.8;">${mapping.description}</small>`;
    }

    if (mapping.cached) {
      content += `<br><small style="opacity: 0.6; font-style: italic;">Cached</small>`;
    }

    if (mapping.error) {
      content = `<span style="color: #ff6b6b;">Error: ${mapping.name}</span>`;
    }

    this.overlay.innerHTML = content;
    this.overlay.style.opacity = '1';
  }

  displayError(message) {
    this.overlay.innerHTML = `<span style="color: #ff6b6b;">Error: ${message}</span>`;
    this.overlay.style.opacity = '1';
  }

  positionOverlay(event) {
    const rect = this.overlay.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = event.pageX + 10;
    let top = event.pageY - rect.height - 10;

    // Adjust if overlay would go off-screen
    if (left + rect.width > viewportWidth) {
      left = event.pageX - rect.width - 10;
    }

    if (top < window.pageYOffset) {
      top = event.pageY + 20;
    }

    this.overlay.style.left = `${left}px`;
    this.overlay.style.top = `${top}px`;
  }

  hideOverlay() {
    this.overlay.style.opacity = '0';
  }

  setupMutationObserver() {
    console.log(`${LOG_PREFIX} Setting up mutation observer for dynamic content`);
    const observer = new MutationObserver((mutations) => {
      let shouldRescan = false;

      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
              shouldRescan = true;
            }
          });
        }
      });

      if (shouldRescan) {
        // Debounce rescanning
        clearTimeout(this.rescanTimeout);
        this.rescanTimeout = setTimeout(() => {
          console.log(`${LOG_PREFIX} DOM changed, rescanning for UUIDs`);
          this.scanForUuids();
        }, 500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  setupMessageListener() {
    console.log(`${LOG_PREFIX} Setting up message listener for context menu results`);
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log(`${LOG_PREFIX} Message received:`, request.action);

      if (request.action === 'showProgress') {
        this.showProgressModal(request.title, request.message);
        sendResponse({ received: true });
      } else if (request.action === 'updateProgress') {
        this.updateProgressModal(request.message, request.progress);
        sendResponse({ received: true });
      } else if (request.action === 'showUuidResult') {
        this.showContextMenuResult(request);
        sendResponse({ received: true });
      }
    });
  }

  showContextMenuResult(request) {
    console.log(`${LOG_PREFIX} Showing context menu result for ${request.uuid}`);

    if (request.error) {
      console.error(`${LOG_PREFIX} Context menu lookup error:`, request.error);
      this.showResultModal('UUID Lookup Result', null, request.error);
    } else if (request.result) {
      console.log(`${LOG_PREFIX} Context menu lookup success:`, request.result);
      this.mappingCache.set(request.uuid, request.result);
      this.showResultModal('UUID Lookup Result', [request.result]);
    }
  }
}

// Add CSS animation for loading spinner
const style = document.createElement('style');
style.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(style);

// Initialize when DOM is ready
console.log(`${LOG_PREFIX} Content script loaded on ${window.location.href}`);
console.log(`${LOG_PREFIX} Document ready state: ${document.readyState}`);

if (document.readyState === 'loading') {
  console.log(`${LOG_PREFIX} Waiting for DOMContentLoaded...`);
  document.addEventListener('DOMContentLoaded', () => {
    console.log(`${LOG_PREFIX} DOMContentLoaded fired, initializing UuidMapper`);
    new UuidMapper();
  });
} else {
  console.log(`${LOG_PREFIX} DOM already loaded, initializing UuidMapper immediately`);
  new UuidMapper();
}
