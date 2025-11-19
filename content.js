// Content script for UUID detection and overlay management

const LOG_PREFIX = '[UUID Mapper - Content]';
const configHelpersPromise = import(chrome.runtime.getURL('src/common/config.js'))
  .catch(error => {
    console.error(`${LOG_PREFIX} Failed to load configuration helpers`, error);
    throw error;
  });

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
  }

  emit(event, payload) {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    listeners.forEach(listener => {
      try {
        listener(payload);
      } catch (error) {
        console.error(`${LOG_PREFIX} Error in event listener for ${event}`, error);
      }
    });
  }
}

class UuidMapperOverlay {
  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'uuid-mapper-overlay';
    this.content = document.createElement('div');
    this.content.classList.add('uuid-mapper-overlay__content');
    this.element.appendChild(this.content);
    document.body.appendChild(this.element);
  }

  showLoading(message = 'Loading...') {
    const container = document.createElement('div');
    container.classList.add('uuid-mapper-overlay__status');

    const spinner = document.createElement('span');
    spinner.classList.add('uuid-mapper-loading');
    const text = document.createElement('span');
    text.textContent = message;

    container.append(spinner, text);
    this.setContent(container);
    this.show();
  }

  showMapping(mapping) {
    if (mapping?.error) {
      this.showError(`Error: ${mapping.name}`);
      return;
    }

    const wrapper = document.createElement('div');

    const name = document.createElement('strong');
    name.classList.add('uuid-mapper-overlay__name');
    name.textContent = mapping.name;
    wrapper.appendChild(name);

    if (mapping.description) {
      const description = document.createElement('p');
      description.classList.add('uuid-mapper-overlay__description');
      description.textContent = mapping.description;
      wrapper.appendChild(description);
    }

    if (mapping.cached) {
      const cached = document.createElement('span');
      cached.classList.add('uuid-mapper-cached');
      cached.textContent = '📦 Cached';
      wrapper.appendChild(cached);
    }

    this.setContent(wrapper);
    this.show();
  }

  showError(message) {
    const error = document.createElement('span');
    error.classList.add('uuid-mapper-error');
    error.textContent = message;
    this.setContent(error);
    this.show();
  }

  setContent(content) {
    this.content.replaceChildren(content);
  }

  setPositionFromEvent(event) {
    if (!event) return;
    this.setPosition(event.pageX, event.pageY);
  }

  setPosition(pageX, pageY) {
    const rect = this.element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    let left = pageX + 10;
    let top = pageY - rect.height - 10;

    if (left + rect.width > viewportWidth) {
      left = pageX - rect.width - 10;
    }

    if (top < window.pageYOffset) {
      top = pageY + 20;
    }

    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
  }

  isVisible() {
    return this.element.classList.contains('visible');
  }

  show() {
    this.element.classList.add('visible');
  }

  hide() {
    this.element.classList.remove('visible');
  }
}

class UuidMapperModal {
  constructor() {
    this.backdrop = document.createElement('div');
    this.backdrop.classList.add('uuid-mapper-backdrop');

    this.modal = document.createElement('div');
    this.modal.classList.add('uuid-mapper-modal');

    this.header = document.createElement('div');
    this.header.classList.add('uuid-mapper-modal__header');
    this.titleEl = document.createElement('h3');
    this.header.appendChild(this.titleEl);

    this.body = document.createElement('div');
    this.body.classList.add('uuid-mapper-modal__body');

    this.footer = document.createElement('div');
    this.footer.classList.add('uuid-mapper-modal__footer');

    this.modal.append(this.header, this.body, this.footer);
    document.body.append(this.backdrop, this.modal);

    this.statusMessageEl = null;
    this.progressWrapper = null;
    this.progressFillEl = null;
    this.progressValueEl = null;
  }

  show() {
    this.backdrop.classList.add('visible');
    this.modal.classList.add('visible');
  }

  hide() {
    this.backdrop.classList.remove('visible');
    this.modal.classList.remove('visible');
  }

  setTitle(title) {
    this.titleEl.textContent = title;
  }

  showProgress(title, message) {
    this.setTitle(title);
    this.body.replaceChildren(this.createStatus(message));
    this.ensureProgressElements();
    if (!this.progressWrapper.isConnected) {
      this.body.appendChild(this.progressWrapper);
    }
    if (this.progressFillEl) {
      this.progressFillEl.style.width = '0%';
    }
    if (this.progressValueEl) {
      this.progressValueEl.textContent = '0%';
    }
    this.progressWrapper.classList.remove('uuid-mapper-hidden');
    this.footer.replaceChildren();
    this.show();
  }

  updateProgress(message, progress) {
    if (this.statusMessageEl) {
      this.statusMessageEl.textContent = message;
    }

    if (typeof progress === 'number' && this.progressFillEl && this.progressValueEl) {
      this.progressFillEl.style.width = `${progress}%`;
      this.progressValueEl.textContent = `${Math.round(progress)}%`;
      this.progressWrapper?.classList.remove('uuid-mapper-hidden');
    } else if (this.progressWrapper) {
      this.progressWrapper.classList.add('uuid-mapper-hidden');
    }
  }

  showResults(title, results, error = null) {
    this.setTitle(title);
    this.statusMessageEl = null;
    if (this.progressWrapper) {
      this.progressWrapper.classList.add('uuid-mapper-hidden');
    }
    const fragments = [];

    if (error) {
      const errorEl = document.createElement('div');
      errorEl.classList.add('uuid-mapper-modal__error');
      errorEl.textContent = `Error: ${error}`;
      fragments.push(errorEl);
    }

    if (Array.isArray(results) && results.length > 0) {
      const list = document.createElement('div');
      list.classList.add('uuid-mapper-modal__results');
      results.forEach(result => {
        const item = document.createElement('div');
        item.classList.add('uuid-mapper-result');

        const uuid = document.createElement('div');
        uuid.classList.add('uuid-mapper-result__uuid');
        uuid.textContent = result.uuid;
        item.appendChild(uuid);

        const name = document.createElement('div');
        name.classList.add('uuid-mapper-result__name');
        name.textContent = result.name || 'No name';
        item.appendChild(name);

        if (result.description) {
          const description = document.createElement('div');
          description.classList.add('uuid-mapper-result__description');
          description.textContent = result.description;
          item.appendChild(description);
        }

        if (result.cached) {
          const cached = document.createElement('div');
          cached.classList.add('uuid-mapper-result__cached');
          cached.textContent = '📦 Cached';
          item.appendChild(cached);
        }

        list.appendChild(item);
      });
      fragments.push(list);
    } else if (!error) {
      const empty = document.createElement('p');
      empty.classList.add('uuid-mapper-modal__empty');
      empty.textContent = 'No results found';
      fragments.push(empty);
    }

    this.body.replaceChildren(...fragments);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.classList.add('uuid-mapper-button');
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => this.hide());

    this.footer.replaceChildren(closeButton);
    this.show();
  }

  createStatus(message) {
    const status = document.createElement('div');
    status.classList.add('uuid-mapper-modal__status');

    const spinner = document.createElement('span');
    spinner.classList.add('uuid-mapper-loading', 'uuid-mapper-modal__spinner');

    const text = document.createElement('span');
    text.classList.add('uuid-mapper-modal__message');
    text.textContent = message;

    status.append(spinner, text);
    this.statusMessageEl = text;
    return status;
  }

  ensureProgressElements() {
    if (this.progressWrapper) return;

    const wrapper = document.createElement('div');
    wrapper.classList.add('uuid-mapper-progress');

    const bar = document.createElement('div');
    bar.classList.add('uuid-mapper-progress__bar');

    const fill = document.createElement('div');
    fill.classList.add('uuid-mapper-progress__fill');
    bar.appendChild(fill);

    const value = document.createElement('p');
    value.classList.add('uuid-mapper-progress__value');
    value.textContent = '0%';

    wrapper.append(bar, value);

    this.progressWrapper = wrapper;
    this.progressFillEl = fill;
    this.progressValueEl = value;
  }
}

class UuidOverlayController {
  constructor({ eventBus }) {
    this.eventBus = eventBus;
    this.overlay = new UuidMapperOverlay();
    this.modal = new UuidMapperModal();
    this.subscribeToEvents();
  }

  subscribeToEvents() {
    this.eventBus.on('uuidHoverStart', ({ event }) => {
      this.overlay.setPositionFromEvent(event);
    });

    this.eventBus.on('uuidHoverMove', ({ event }) => {
      this.overlay.setPositionFromEvent(event);
    });

    this.eventBus.on('uuidHoverEnd', () => {
      this.overlay.hide();
    });

    this.eventBus.on('uuidLookupStarted', () => {
      this.overlay.showLoading();
    });

    this.eventBus.on('uuidLookupSuccess', ({ mapping }) => {
      this.overlay.showMapping(mapping);
    });

    this.eventBus.on('uuidLookupError', ({ error }) => {
      this.overlay.showError(error);
    });

    this.eventBus.on('contextLookupProgress', ({ title, message }) => {
      this.modal.showProgress(title, message);
    });

    this.eventBus.on('contextLookupUpdate', ({ message, progress }) => {
      this.modal.updateProgress(message, progress);
    });

    this.eventBus.on('contextLookupResult', ({ title, results, error }) => {
      this.modal.showResults(title, results, error);
    });
  }
}

class UuidDetectionService {
  constructor({ eventBus, hoverDelay = 300, root = document.body, uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi }) {
    this.eventBus = eventBus;
    this.hoverDelay = hoverDelay;
    this.root = root;
    this.uuidRegex = uuidRegex;
    this.hoverTimeouts = new WeakMap();
  }

  start() {
    this.scanForUuids();
    this.setupMutationObserver();
  }

  scanForUuids() {
    const walker = document.createTreeWalker(
      this.root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    const textNodes = [];
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }

    textNodes.forEach(textNode => {
      this.processTextNode(textNode);
    });
  }

  processTextNode(textNode) {
    const text = textNode.textContent;
    const matches = [...text.matchAll(this.uuidRegex)];

    if (matches.length === 0) return;

    let lastIndex = 0;
    const fragments = [];

    matches.forEach(match => {
      const uuid = match[0];
      const startIndex = match.index;

      if (startIndex > lastIndex) {
        fragments.push(document.createTextNode(text.slice(lastIndex, startIndex)));
      }

      const uuidSpan = document.createElement('span');
      uuidSpan.textContent = uuid;
      uuidSpan.className = 'uuid-mappable';
      this.attachUuidEvents(uuidSpan, uuid);
      fragments.push(uuidSpan);

      this.eventBus.emit('uuidDetected', { uuid, element: uuidSpan });

      lastIndex = startIndex + uuid.length;
    });

    if (lastIndex < text.length) {
      fragments.push(document.createTextNode(text.slice(lastIndex)));
    }

    const parent = textNode.parentNode;
    fragments.forEach(fragment => parent.insertBefore(fragment, textNode));
    parent.removeChild(textNode);
  }

  attachUuidEvents(element, uuid) {
    element.addEventListener('mouseenter', (event) => {
      const timeoutId = setTimeout(() => {
        this.eventBus.emit('uuidHoverStart', { uuid, event });
      }, this.hoverDelay);
      this.hoverTimeouts.set(element, timeoutId);
    });

    element.addEventListener('mousemove', (event) => {
      this.eventBus.emit('uuidHoverMove', { uuid, event });
    });

    element.addEventListener('mouseleave', () => {
      const timeoutId = this.hoverTimeouts.get(element);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.hoverTimeouts.delete(element);
      }
      this.eventBus.emit('uuidHoverEnd', { uuid });
    });
  }

  setupMutationObserver() {
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
        clearTimeout(this.rescanTimeout);
        this.rescanTimeout = setTimeout(() => {
          this.scanForUuids();
        }, 500);
      }
    });

    observer.observe(this.root, {
      childList: true,
      subtree: true
    });
  }
}

class UuidMapper {
  constructor({ configService = null, configModulePromise = configHelpersPromise } = {}) {
    this.mappingCache = new Map();
    this.config = null;
    this.configHelpers = null;
    this.configService = configService;
    this.configModulePromise = configModulePromise;
    this.configValid = false;
    this.configErrorMessage = null;
    this.eventBus = new EventBus();
    this.detectionService = null;
    this.overlayController = null;

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
    this.overlayController = new UuidOverlayController({ eventBus: this.eventBus });
    this.detectionService = new UuidDetectionService({
      eventBus: this.eventBus,
      hoverDelay: this.config.advanced.hoverDelay || 300
    });
    this.detectionService.start();
    this.subscribeToDetectionEvents();
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

  

  subscribeToDetectionEvents() {
    this.eventBus.on('uuidHoverStart', ({ uuid }) => {
      this.handleUuidHover(uuid);
    });
  }

  async handleUuidHover(uuid) {
    console.log(`${LOG_PREFIX} Handling hover for UUID: ${uuid}`);

    if (this.mappingCache.has(uuid)) {
      console.log(`${LOG_PREFIX} Using cached mapping for ${uuid}`);
      const mapping = this.mappingCache.get(uuid);
      this.eventBus.emit('uuidLookupSuccess', { uuid, mapping });
      return;
    }

    this.eventBus.emit('uuidLookupStarted', { uuid });

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getUuidMappings',
        uuids: [uuid]
      });

      if (response.success && response.data[uuid]) {
        const mapping = response.data[uuid];
        this.mappingCache.set(uuid, mapping);
        this.eventBus.emit('uuidLookupSuccess', { uuid, mapping });
      } else {
        const error = response.error || 'Mapping not found';
        console.error(`${LOG_PREFIX} Failed to get mapping:`, error);
        this.eventBus.emit('uuidLookupError', { uuid, error: `Error: ${error}` });
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Error fetching mapping:`, error);
      this.eventBus.emit('uuidLookupError', { uuid, error: `Failed to fetch mapping: ${error.message}` });
    }
  }

  setupMessageListener() {
    console.log(`${LOG_PREFIX} Setting up message listener for context menu results`);
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log(`${LOG_PREFIX} Message received:`, request.action);

      if (request.action === 'showProgress') {
        this.eventBus.emit('contextLookupProgress', {
          title: request.title,
          message: request.message
        });
        sendResponse({ received: true });
      } else if (request.action === 'updateProgress') {
        this.eventBus.emit('contextLookupUpdate', {
          message: request.message,
          progress: request.progress
        });
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
      this.eventBus.emit('contextLookupResult', {
        title: 'UUID Lookup Result',
        results: null,
        error: request.error
      });
    } else if (request.result) {
      console.log(`${LOG_PREFIX} Context menu lookup success:`, request.result);
      this.mappingCache.set(request.uuid, request.result);
      this.eventBus.emit('contextLookupResult', {
        title: 'UUID Lookup Result',
        results: [request.result],
        error: null
      });
    }
  }
}

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
