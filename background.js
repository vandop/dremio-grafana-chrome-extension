// Background script for Dremio API communication and caching

const LOG_PREFIX = '[UUID Mapper - Background]';

const configHelpersPromise = import(chrome.runtime.getURL('src/common/config.js'))
  .catch(error => {
    console.error(`${LOG_PREFIX} Failed to load configuration helpers`, error);
    throw error;
  });

const queryHelpersPromise = import(chrome.runtime.getURL('src/common/query-utils.js'))
  .catch(error => {
    console.error(`${LOG_PREFIX} Failed to load query utilities`, error);
    throw error;
  });

const transportHelpersPromise = import(chrome.runtime.getURL('src/common/dremio-transport.js'))
  .catch(error => {
    console.error(`${LOG_PREFIX} Failed to load transport helpers`, error);
    throw error;
  });

const cacheHelpersPromise = import(chrome.runtime.getURL('src/common/uuid-cache.js'))
  .catch(error => {
    console.error(`${LOG_PREFIX} Failed to load cache helpers`, error);
    throw error;
  });

console.log(`${LOG_PREFIX} Service worker started`);

class DremioClient {
  constructor({
    configService = null,
    configModulePromise = configHelpersPromise,
    queryModulePromise = queryHelpersPromise,
    transportModulePromise = transportHelpersPromise,
    cacheModulePromise = cacheHelpersPromise
  } = {}) {
    this.pendingRequests = new Map();
    this.configModulePromise = configModulePromise;
    this.queryModulePromise = queryModulePromise;
    this.transportModulePromise = transportModulePromise;
    this.cacheModulePromise = cacheModulePromise;
    this.configHelpers = null;
    this.queryHelpers = null;
    this.transportHelpers = null;
    this.cache = null;
    this.configService = configService;
    console.log(`${LOG_PREFIX} DremioClient initialized`);
  }

  async getCache() {
    if (!this.cache) {
      const { UuidCache } = await this.cacheModulePromise;
      this.cache = new UuidCache();
    }
    return this.cache;
  }

  async getConfigHelpers() {
    if (!this.configHelpers) {
      this.configHelpers = await this.configModulePromise;
    }
    return this.configHelpers;
  }

  async getQueryHelpers() {
    if (!this.queryHelpers) {
      this.queryHelpers = await this.queryModulePromise;
    }
    return this.queryHelpers;
  }

  async getTransportHelpers() {
    if (!this.transportHelpers) {
      this.transportHelpers = await this.transportModulePromise;
    }
    return this.transportHelpers;
  }

  async getConfiguration() {
    console.log(`${LOG_PREFIX} Loading configuration from storage`);
    const helpers = await this.getConfigHelpers();
    if (!this.configService) {
      this.configService = new helpers.ConfigService();
    }

    const config = await this.configService.load();
    helpers.assertValidConfig(config);

    console.log(`${LOG_PREFIX} Configuration loaded:`, {
      dremioType: config.dremio.dremioType,
      hasServerUrl: !!config.dremio.serverUrl,
      hasProjectId: !!config.dremio.projectId,
      authType: config.dremio.authType,
      hasToken: !!config.dremio.token,
      hasTableName: !!config.query.columnMappings?.table_name,
      cacheTTL: config.advanced.cacheTTL,
      batchSize: config.advanced.batchSize,
      cloudPollDelay: config.advanced.cloudPollDelay,
      cloudMaxAttempts: config.advanced.cloudMaxAttempts
    });

    return config;
  }

  async executeQuery(uuids) {
    console.log(`${LOG_PREFIX} executeQuery called with ${uuids.length} UUIDs:`, uuids);
    const config = await this.getConfiguration();
    const cache = await this.getCache();
    const { buildQuery, normalizeResponse } = await this.getQueryHelpers();
    const transport = await this.createTransportForConfig(config);

    // Check cache first
    const cachedResults = cache.getFreshEntries(uuids, config.advanced.cacheTTL);
    const uncachedUuids = uuids.filter(uuid => !cachedResults.has(uuid));

    console.log(`${LOG_PREFIX} Cache check: ${cachedResults.size} cached, ${uncachedUuids.length} need fetching`);

    if (uncachedUuids.length === 0) {
      console.log(`${LOG_PREFIX} All results from cache`);
      return this.formatResults(Array.from(cachedResults.values()));
    }

    // Batch uncached UUIDs
    const batches = this.batchUuids(uncachedUuids, config.advanced.batchSize);
    console.log(`${LOG_PREFIX} Split into ${batches.length} batches of max ${config.advanced.batchSize} UUIDs`);
    const results = new Map(cachedResults);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`${LOG_PREFIX} Processing batch ${i + 1}/${batches.length} with ${batch.length} UUIDs`);
      try {
        const sql = buildQuery(batch, config.query);
        const rawResponse = await transport.runQuery(sql);
        const batchResults = normalizeResponse(rawResponse, config.query);
        console.log(`${LOG_PREFIX} Batch ${i + 1} returned ${batchResults.length} results`);
        batchResults.forEach(result => {
          results.set(result.uuid, result);
        });
        cache.setMany(batchResults);
      } catch (error) {
        console.error(`${LOG_PREFIX} Batch ${i + 1} query failed:`, error);
        // Add error entries for failed UUIDs
        batch.forEach(uuid => {
          results.set(uuid, { uuid, name: 'Error loading name', error: true });
        });
      }
    }

    console.log(`${LOG_PREFIX} executeQuery complete: ${results.size} total results`);
    return this.formatResults(Array.from(results.values()));
  }

  batchUuids(uuids, batchSize) {
    const batches = [];
    for (let i = 0; i < uuids.length; i += batchSize) {
      batches.push(uuids.slice(i, i + batchSize));
    }
    return batches;
  }

  formatResults(results) {
    return results.reduce((acc, result) => {
      acc[result.uuid] = result;
      return acc;
    }, {});
  }

  async createTransportForConfig(config) {
    const { createDremioTransport } = await this.getTransportHelpers();
    return createDremioTransport(config.dremio, config.advanced);
  }
}

const dremioClient = new DremioClient();

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Create context menu on installation
chrome.runtime.onInstalled.addListener(() => {
  console.log(`${LOG_PREFIX} Extension installed, creating context menu`);
  chrome.contextMenus.create({
    id: 'lookup-uuid',
    title: 'Lookup UUID in Dremio',
    contexts: ['selection']
  });
});

// Helper function to safely send message to tab with retry
async function sendMessageToTab(tabId, message, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      console.log(`${LOG_PREFIX} ✅ Message sent successfully to tab ${tabId}:`, message.action);
      return true;
    } catch (error) {
      if (i < retries) {
        console.warn(`${LOG_PREFIX} ⚠️ Failed to send message to tab ${tabId}, retrying (${i + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, 200)); // Wait 200ms before retry
      } else {
        console.error(`${LOG_PREFIX} ❌ Failed to send message to tab ${tabId} after ${retries + 1} attempts:`, error.message);
        console.error(`${LOG_PREFIX} 💡 TIP: Make sure you've refreshed the Grafana page after reloading the extension!`);
        return false;
      }
    }
  }
}

// Helper function to show browser notification as fallback
function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title: title,
    message: message,
    priority: 2
  }, (notificationId) => {
    console.log(`${LOG_PREFIX} Notification shown: ${notificationId}`);
    // Auto-clear after 5 seconds
    setTimeout(() => {
      chrome.notifications.clear(notificationId);
    }, 5000);
  });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log(`${LOG_PREFIX} Context menu clicked`, { selectionText: info.selectionText, tabId: tab.id });

  if (info.menuItemId === 'lookup-uuid') {
    const selectedText = info.selectionText?.trim();

    if (!selectedText) {
      console.warn(`${LOG_PREFIX} No text selected`);
      return;
    }

    // Validate it's a UUID
    if (!UUID_REGEX.test(selectedText)) {
      console.warn(`${LOG_PREFIX} Selected text is not a valid UUID: ${selectedText}`);
      await sendMessageToTab(tab.id, {
        action: 'showUuidResult',
        error: 'Selected text is not a valid UUID',
        uuid: selectedText
      });
      return;
    }

    console.log(`${LOG_PREFIX} Valid UUID selected: ${selectedText}`);

    // Show progress modal
    const progressSent = await sendMessageToTab(tab.id, {
      action: 'showProgress',
      title: 'Looking up UUID',
      message: `Querying Dremio for UUID: ${selectedText.substring(0, 8)}...`
    });

    if (!progressSent) {
      console.warn(`${LOG_PREFIX} ⚠️ Content script not available on tab ${tab.id}`);
      console.warn(`${LOG_PREFIX} Using browser notification as fallback...`);
      showNotification('Looking up UUID', `Querying Dremio for ${selectedText.substring(0, 13)}...`);
    }

    try {
      const results = await dremioClient.executeQuery([selectedText]);
      console.log(`${LOG_PREFIX} ✅ Query completed for ${selectedText}:`, results);

      const resultSent = await sendMessageToTab(tab.id, {
        action: 'showUuidResult',
        uuid: selectedText,
        result: results[selectedText]
      });

      // If content script not available, show notification instead
      if (!resultSent) {
        const result = results[selectedText];
        if (result) {
          showNotification(
            'UUID Lookup Result',
            `${selectedText.substring(0, 13)}...\n→ ${result.name || 'No name found'}`
          );
        } else {
          showNotification('UUID Lookup Result', `No mapping found for ${selectedText.substring(0, 13)}...`);
        }
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} ❌ Failed to lookup UUID:`, error);

      const errorSent = await sendMessageToTab(tab.id, {
        action: 'showUuidResult',
        uuid: selectedText,
        error: error.message
      });

      // If content script not available, show notification instead
      if (!errorSent) {
        showNotification('UUID Lookup Failed', error.message);
      }
    }
  }
});

// Message handler for content script requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(`${LOG_PREFIX} Message received:`, request.action, sender.tab?.id);

  if (request.action === 'getUuidMappings') {
    dremioClient.executeQuery(request.uuids)
      .then(results => {
        console.log(`${LOG_PREFIX} Sending response for getUuidMappings`);
        sendResponse({ success: true, data: results });
      })
      .catch(error => {
        console.error(`${LOG_PREFIX} Error in getUuidMappings:`, error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }

  if (request.action === 'testConnection') {
    testDremioConnection(request.config, request.advancedConfig)
      .then(result => {
        console.log(`${LOG_PREFIX} Test connection result:`, result);
        sendResponse(result);
      })
      .catch(error => {
        console.error(`${LOG_PREFIX} Test connection error:`, error);
        sendResponse({ valid: false, message: error.message });
      });
    return true;
  }
});

async function testDremioConnection(config, advancedConfig = {}) {
  const helpers = await configHelpersPromise;
  const { createDremioTransport } = await transportHelpersPromise;
  const normalizedConfig = helpers.normalizeDremioConfig(config);
  const normalizedAdvanced = helpers.normalizeAdvancedConfig(advancedConfig);
  const transport = createDremioTransport(normalizedConfig, normalizedAdvanced);
  console.log(`${LOG_PREFIX} Testing ${normalizedConfig.dremioType === 'cloud' ? 'Dremio Cloud' : 'Dremio on-premise'} connection`);
  return transport.testConnection();
}
