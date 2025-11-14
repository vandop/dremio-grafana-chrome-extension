// Background script for Dremio API communication and caching

const LOG_PREFIX = '[UUID Mapper - Background]';

console.log(`${LOG_PREFIX} Service worker started`);

class DremioClient {
  constructor() {
    this.cache = new Map();
    this.pendingRequests = new Map();
    console.log(`${LOG_PREFIX} DremioClient initialized`);
  }

  async getConfiguration() {
    console.log(`${LOG_PREFIX} Loading configuration from storage`);
    const result = await chrome.storage.sync.get(['dremioConfig', 'queryConfig', 'advancedConfig']);
    const config = {
      dremio: result.dremioConfig || {},
      query: result.queryConfig || {},
      advanced: result.advancedConfig || {
        cacheTTL: 3600000,
        batchSize: 50,
        cloudPollDelay: 2000,
        cloudPollInterval: 1000,
        cloudMaxAttempts: 30
      }
    };
    console.log(`${LOG_PREFIX} Configuration loaded:`, {
      hasServerUrl: !!config.dremio.serverUrl,
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

    if (!config.dremio.serverUrl || !config.query.columnMappings) {
      const error = 'Extension not configured. Please configure Dremio connection.';
      console.error(`${LOG_PREFIX} ${error}`);
      throw new Error(error);
    }

    // Check cache first
    const cachedResults = this.getCachedResults(uuids, config.advanced.cacheTTL);
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
        const batchResults = await this.queryDremio(batch, config);
        console.log(`${LOG_PREFIX} Batch ${i + 1} returned ${batchResults.length} results`);
        batchResults.forEach(result => {
          results.set(result.uuid, result);
          this.cacheResult(result);
        });
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

  async queryDremio(uuids, config) {
    const query = this.buildQuery(uuids, config.query);

    // Determine if using Dremio Cloud or on-premise
    const isCloud = config.dremio.dremioType === 'cloud';

    if (isCloud) {
      return await this.queryDremioCloud(query, config);
    } else {
      return await this.queryDremioOnPrem(query, config);
    }
  }

  async queryDremioCloud(query, config) {
    // Dremio Cloud uses async API: submit job, then poll for results
    const baseUrl = config.dremio.serverUrl;
    const projectId = config.dremio.projectId;
    const submitUrl = `${baseUrl}/v0/projects/${projectId}/sql`;

    console.log(`${LOG_PREFIX} Executing Dremio Cloud query:`);
    console.log(`${LOG_PREFIX} URL: ${submitUrl}`);
    console.log(`${LOG_PREFIX} SQL:\n${query}`);

    const headers = {
      'Content-Type': 'application/json',
    };

    // Dremio Cloud uses Bearer token auth
    if (config.dremio.authType === 'token' && config.dremio.token) {
      headers['Authorization'] = `Bearer ${config.dremio.token}`;
      console.log(`${LOG_PREFIX} Using Bearer token auth`);
    } else {
      console.warn(`${LOG_PREFIX} Dremio Cloud requires Bearer token authentication`);
    }

    // Step 1: Submit the query
    const startTime = Date.now();
    const submitResponse = await fetch(submitUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sql: query })
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      console.error(`${LOG_PREFIX} Dremio Cloud submit error:`, errorText);
      throw new Error(`Dremio Cloud API error: ${submitResponse.status} ${submitResponse.statusText}`);
    }

    const submitData = await submitResponse.json();
    const jobId = submitData.id;
    console.log(`${LOG_PREFIX} Query submitted, job ID: ${jobId}`);

    // Step 2: Poll for results
    const resultsUrl = `${baseUrl}/v0/projects/${projectId}/job/${jobId}/results`;
    console.log(`${LOG_PREFIX} Polling for results at: ${resultsUrl}`);

    // Get polling configuration (with defaults)
    const pollDelay = config.advanced.cloudPollDelay || 2000;
    const pollInterval = config.advanced.cloudPollInterval || 1000;
    const maxAttempts = config.advanced.cloudMaxAttempts || 30;

    console.log(`${LOG_PREFIX} Poll config: initial delay=${pollDelay}ms, interval=${pollInterval}ms, max attempts=${maxAttempts}`);

    // Wait before first poll (Dremio Cloud jobs take time)
    await this.sleep(pollDelay);

    let attempts = 0;

    while (attempts < maxAttempts) {
      const resultsResponse = await fetch(resultsUrl, {
        method: 'GET',
        headers
      });

      if (resultsResponse.ok) {
        const duration = Date.now() - startTime;
        console.log(`${LOG_PREFIX} Results ready (${duration}ms, ${attempts + 1} attempts)`);

        const data = await resultsResponse.json();
        console.log(`${LOG_PREFIX} Raw Dremio Cloud response:`, data);

        const normalized = this.normalizeResponse(data, config.query);
        console.log(`${LOG_PREFIX} Normalized to ${normalized.length} results`);
        return normalized;
      } else if (resultsResponse.status === 404 || resultsResponse.status === 202) {
        // Job still running, wait and retry
        attempts++;
        console.log(`${LOG_PREFIX} Job still running (${resultsResponse.status}), attempt ${attempts}/${maxAttempts}`);
        await this.sleep(pollInterval);
      } else {
        // Check if it's a "job still in progress" error
        const errorText = await resultsResponse.text();
        let shouldRetry = false;

        try {
          const errorData = JSON.parse(errorText);
          // Check if error message indicates job is still running (PLANNING, RUNNING, ENQUEUED, etc.)
          if (errorData.errorMessage &&
            (errorData.errorMessage.includes('PLANNING') ||
              errorData.errorMessage.includes('RUNNING') ||
              errorData.errorMessage.includes('ENQUEUED') ||
              errorData.errorMessage.includes('STARTING'))) {
            shouldRetry = true;
            console.log(`${LOG_PREFIX} Job still in progress (${errorData.errorMessage}), attempt ${attempts + 1}/${maxAttempts}`);
          }
        } catch (parseError) {
          // Not JSON, treat as real error
        }

        if (shouldRetry) {
          attempts++;
          await this.sleep(pollInterval);
        } else {
          console.error(`${LOG_PREFIX} Dremio Cloud results error:`, errorText);
          throw new Error(`Dremio Cloud results error: ${resultsResponse.status} ${resultsResponse.statusText}`);
        }
      }
    }

    throw new Error(`Dremio Cloud query timeout after ${maxAttempts} attempts (${(pollDelay + maxAttempts * pollInterval) / 1000}s total)`);
  }

  async queryDremioOnPrem(query, config) {
    // On-premise Dremio uses synchronous API
    const url = `${config.dremio.serverUrl}:${config.dremio.port || 9047}/api/v3/sql`;

    console.log(`${LOG_PREFIX} Executing Dremio on-premise query:`);
    console.log(`${LOG_PREFIX} URL: ${url}`);
    console.log(`${LOG_PREFIX} SQL:\n${query}`);

    const headers = {
      'Content-Type': 'application/json',
    };

    // Add authentication
    if (config.dremio.authType === 'basic' && config.dremio.username) {
      const credentials = btoa(`${config.dremio.username}:${config.dremio.password || ''}`);
      headers['Authorization'] = `Basic ${credentials}`;
      console.log(`${LOG_PREFIX} Using Basic auth with username: ${config.dremio.username}`);
    } else if (config.dremio.authType === 'token' && config.dremio.token) {
      headers['Authorization'] = `Bearer ${config.dremio.token}`;
      console.log(`${LOG_PREFIX} Using Bearer token auth`);
    } else {
      console.log(`${LOG_PREFIX} No authentication configured`);
    }

    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sql: query })
    });
    const duration = Date.now() - startTime;

    console.log(`${LOG_PREFIX} Dremio response: ${response.status} ${response.statusText} (${duration}ms)`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`${LOG_PREFIX} Dremio API error response:`, errorText);
      throw new Error(`Dremio API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`${LOG_PREFIX} Raw Dremio response:`, data);

    const normalized = this.normalizeResponse(data, config.query);
    console.log(`${LOG_PREFIX} Normalized to ${normalized.length} results`);
    return normalized;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  buildQuery(uuids, queryConfig) {
    const { queryTemplate, columnMappings } = queryConfig;

    const uuidList = uuids
      .map(uuid => `'${uuid.replace(/'/g, "''")}'`)
      .join(', ');

    return queryTemplate
      .replace(/{uuid_column}/g, columnMappings.uuid_column)
      .replace(/{name_column}/g, columnMappings.name_column)
      .replace(/{description_column}/g, columnMappings.description_column || 'NULL')
      .replace(/{timestamp_column}/g, columnMappings.timestamp_column || 'NULL')
      .replace(/{table_name}/g, columnMappings.table_name)
      .replace(/{uuid_list}/g, uuidList);
  }

  normalizeResponse(rawResponse, queryConfig) {
    const rows = rawResponse.rows || [];

    return rows.map(row => ({
      uuid: row.uuid_value || row[queryConfig.columnMappings.uuid_column],
      name: row.display_name || row[queryConfig.columnMappings.name_column],
      description: row.description || null,
      lastUpdated: row.last_updated || null,
      cached: false,
      timestamp: Date.now()
    }));
  }

  getCachedResults(uuids, ttl) {
    const results = new Map();
    const now = Date.now();

    uuids.forEach(uuid => {
      const cached = this.cache.get(uuid);
      if (cached && (now - cached.timestamp) < ttl) {
        const age = Math.round((now - cached.timestamp) / 1000);
        console.log(`${LOG_PREFIX} Cache HIT for ${uuid} (age: ${age}s)`);
        results.set(uuid, { ...cached, cached: true });
      } else if (cached) {
        console.log(`${LOG_PREFIX} Cache EXPIRED for ${uuid}`);
      } else {
        console.log(`${LOG_PREFIX} Cache MISS for ${uuid}`);
      }
    });

    return results;
  }

  cacheResult(result) {
    console.log(`${LOG_PREFIX} Caching result for ${result.uuid}: ${result.name}`);
    this.cache.set(result.uuid, { ...result, timestamp: Date.now() });
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
  const isCloud = config.dremioType === 'cloud';
  console.log(`${LOG_PREFIX} Testing ${isCloud ? 'Dremio Cloud' : 'Dremio on-premise'} connection`);

  if (isCloud) {
    return await testDremioCloudConnection(config, advancedConfig);
  } else {
    return await testDremioOnPremConnection(config);
  }
}

async function testDremioCloudConnection(config, advancedConfig = {}) {
  console.log(`${LOG_PREFIX} Testing Dremio Cloud connection to ${config.serverUrl}`);
  console.log(`${LOG_PREFIX} Project ID: ${config.projectId}`);

  try {
    const testQuery = "SELECT 1 as test_connection";
    const submitUrl = `${config.serverUrl}/v0/projects/${config.projectId}/sql`;

    console.log(`${LOG_PREFIX} Submit URL: ${submitUrl}`);

    const headers = { 'Content-Type': 'application/json' };
    if (config.authType === 'token' && config.token) {
      headers['Authorization'] = `Bearer ${config.token}`;
      console.log(`${LOG_PREFIX} Test using Bearer token (length: ${config.token.length})`);
    } else {
      console.log(`${LOG_PREFIX} WARNING: Dremio Cloud requires Bearer token`);
      return { valid: false, message: 'Dremio Cloud requires Bearer token authentication' };
    }

    // Submit test query
    console.log(`${LOG_PREFIX} Submitting test query...`);
    const submitResponse = await fetch(submitUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sql: testQuery })
    });

    console.log(`${LOG_PREFIX} Submit response status: ${submitResponse.status} ${submitResponse.statusText}`);
    console.log(`${LOG_PREFIX} Submit response headers:`, Object.fromEntries(submitResponse.headers.entries()));

    // Get response text first to see what we're dealing with
    const responseText = await submitResponse.text();
    console.log(`${LOG_PREFIX} Submit response body (first 500 chars):`, responseText.substring(0, 500));

    if (!submitResponse.ok) {
      console.error(`${LOG_PREFIX} Cloud connection test FAILED: ${submitResponse.status}`);
      return {
        valid: false,
        message: `Connection failed: ${submitResponse.status} ${submitResponse.statusText}. Check server URL, project ID, and token.`
      };
    }

    // Try to parse as JSON
    let submitData;
    try {
      submitData = JSON.parse(responseText);
    } catch (parseError) {
      console.error(`${LOG_PREFIX} Failed to parse response as JSON:`, parseError);
      console.error(`${LOG_PREFIX} Response was:`, responseText);
      return {
        valid: false,
        message: `Invalid response from server. Expected JSON, got: ${responseText.substring(0, 100)}...`
      };
    }

    const jobId = submitData.id;
    console.log(`${LOG_PREFIX} Test query submitted, job ID: ${jobId}`);

    // Try to fetch results (just to verify the connection works end-to-end)
    const resultsUrl = `${config.serverUrl}/v0/projects/${config.projectId}/job/${jobId}/results`;
    console.log(`${LOG_PREFIX} Results URL: ${resultsUrl}`);

    // Use configured poll delay or default to 2 seconds
    const pollDelay = advancedConfig.cloudPollDelay || 2000;
    console.log(`${LOG_PREFIX} Waiting ${pollDelay}ms before checking results...`);
    await new Promise(resolve => setTimeout(resolve, pollDelay));

    const resultsResponse = await fetch(resultsUrl, {
      method: 'GET',
      headers
    });

    console.log(`${LOG_PREFIX} Results response status: ${resultsResponse.status}`);

    if (resultsResponse.ok || resultsResponse.status === 404 || resultsResponse.status === 202) {
      // 404/202 is OK - means job is still running but connection works
      console.log(`${LOG_PREFIX} Cloud connection test PASSED`);
      return { valid: true, message: "Dremio Cloud connection successful" };
    } else {
      // Check if it's a "job still in progress" error (which is also OK for connection test)
      const errorText = await resultsResponse.text();
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.errorMessage &&
          (errorData.errorMessage.includes('PLANNING') ||
            errorData.errorMessage.includes('RUNNING') ||
            errorData.errorMessage.includes('ENQUEUED') ||
            errorData.errorMessage.includes('STARTING'))) {
          console.log(`${LOG_PREFIX} Cloud connection test PASSED (job in progress: ${errorData.errorMessage})`);
          return { valid: true, message: "Dremio Cloud connection successful (job still running)" };
        }
      } catch (parseError) {
        // Not JSON or doesn't match pattern, treat as error
      }

      console.error(`${LOG_PREFIX} Cloud results test FAILED: ${resultsResponse.status}`, errorText);
      return { valid: false, message: `Results fetch failed: ${resultsResponse.status}` };
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Cloud connection test ERROR:`, error);
    console.error(`${LOG_PREFIX} Error stack:`, error.stack);
    return { valid: false, message: `Connection failed: ${error.message}` };
  }
}

async function testDremioOnPremConnection(config) {
  console.log(`${LOG_PREFIX} Testing Dremio on-premise connection to ${config.serverUrl}:${config.port || 9047}`);

  try {
    const testQuery = "SELECT 1 as test_connection";
    const url = `${config.serverUrl}:${config.port || 9047}/api/v3/sql`;

    const headers = { 'Content-Type': 'application/json' };
    if (config.authType === 'basic' && config.username) {
      headers['Authorization'] = `Basic ${btoa(`${config.username}:${config.password || ''}`)}`;
      console.log(`${LOG_PREFIX} Test using Basic auth`);
    } else if (config.authType === 'token' && config.token) {
      headers['Authorization'] = `Bearer ${config.token}`;
      console.log(`${LOG_PREFIX} Test using Bearer token`);
    } else {
      console.log(`${LOG_PREFIX} Test with no auth`);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sql: testQuery })
    });

    if (response.ok) {
      console.log(`${LOG_PREFIX} On-premise connection test PASSED`);
      return { valid: true, message: "Dremio on-premise connection successful" };
    } else {
      const errorText = await response.text();
      console.error(`${LOG_PREFIX} On-premise connection test FAILED: ${response.status}`, errorText);
      return { valid: false, message: `Connection failed: ${response.status} ${response.statusText}` };
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} On-premise connection test ERROR:`, error);
    return { valid: false, message: `Connection failed: ${error.message}` };
  }
}
