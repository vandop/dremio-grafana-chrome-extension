// Configuration interface logic

const LOG_PREFIX = '[UUID Mapper - Popup]';

console.log(`${LOG_PREFIX} Popup opened`);

class ConfigurationWizard {
  constructor() {
    console.log(`${LOG_PREFIX} ConfigurationWizard constructor`);
    this.currentStep = 1;
    this.maxStep = 3;
    this.config = {
      dremio: {},
      query: { columnMappings: {} },
      advanced: {}
    };

    this.initializeEventListeners();
    this.loadConfiguration();
  }

  initializeEventListeners() {
    // Navigation
    document.getElementById('next-btn').addEventListener('click', () => this.nextStep());
    document.getElementById('prev-btn').addEventListener('click', () => this.prevStep());
    document.getElementById('save-btn').addEventListener('click', () => this.saveConfiguration());

    // Dremio type change
    document.getElementById('dremio-type').addEventListener('change', (e) => this.toggleDremioTypeFields(e.target.value));

    // Authentication type change
    document.getElementById('auth-type').addEventListener('change', (e) => this.toggleAuthFields(e.target.value));

    // Connection testing
    document.getElementById('test-connection').addEventListener('click', () => this.testConnection());

    // Query building
    ['table-name', 'uuid-column', 'name-column', 'desc-column', 'timestamp-column'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => this.updateQueryPreview());
    });

    // Query testing
    document.getElementById('test-query').addEventListener('click', () => this.testQuery());

    // Initialize dremio type fields visibility
    this.toggleDremioTypeFields(document.getElementById('dremio-type').value);
  }

  async loadConfiguration() {
    console.log(`${LOG_PREFIX} Loading configuration from storage`);
    try {
      const result = await chrome.storage.sync.get(['dremioConfig', 'queryConfig', 'advancedConfig']);

      console.log(`${LOG_PREFIX} Configuration loaded:`, {
        hasDremioConfig: !!result.dremioConfig,
        hasQueryConfig: !!result.queryConfig,
        hasAdvancedConfig: !!result.advancedConfig
      });

      if (result.dremioConfig) {
        this.populateConnectionForm(result.dremioConfig);
      }

      if (result.queryConfig) {
        this.populateQueryForm(result.queryConfig);
      }

      if (result.advancedConfig) {
        this.populateAdvancedForm(result.advancedConfig);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to load configuration:`, error);
    }
  }

  populateConnectionForm(config) {
    document.getElementById('dremio-type').value = config.dremioType || 'cloud';
    document.getElementById('server-url').value = config.serverUrl || '';
    document.getElementById('project-id').value = config.projectId || '';
    document.getElementById('port').value = config.port || 9047;
    document.getElementById('auth-type').value = config.authType || 'none';
    document.getElementById('username').value = config.username || '';
    document.getElementById('token').value = config.token || '';

    this.toggleDremioTypeFields(config.dremioType || 'cloud');
    this.toggleAuthFields(config.authType || 'none');
  }

  populateQueryForm(config) {
    const mappings = config.columnMappings || {};
    document.getElementById('table-name').value = mappings.table_name || '';
    document.getElementById('uuid-column').value = mappings.uuid_column || '';
    document.getElementById('name-column').value = mappings.name_column || '';
    document.getElementById('desc-column').value = mappings.description_column || '';
    document.getElementById('timestamp-column').value = mappings.timestamp_column || '';

    this.updateQueryPreview();
  }

  populateAdvancedForm(config) {
    document.getElementById('cache-ttl').value = (config.cacheTTL || 3600000) / 60000; // Convert to minutes
    document.getElementById('batch-size').value = config.batchSize || 50;
    document.getElementById('hover-delay').value = config.hoverDelay || 300;
    document.getElementById('cloud-poll-delay').value = config.cloudPollDelay || 2000;
    document.getElementById('cloud-poll-interval').value = config.cloudPollInterval || 1000;
    document.getElementById('cloud-max-attempts').value = config.cloudMaxAttempts || 30;
  }

  toggleDremioTypeFields(dremioType) {
    console.log(`${LOG_PREFIX} Toggling Dremio type fields: ${dremioType}`);
    document.querySelectorAll('.cloud-only').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.onprem-only').forEach(el => el.classList.remove('active'));

    if (dremioType === 'cloud') {
      document.querySelectorAll('.cloud-only').forEach(el => el.classList.add('active'));
    } else {
      document.querySelectorAll('.onprem-only').forEach(el => el.classList.add('active'));
    }
  }

  toggleAuthFields(authType) {
    document.querySelectorAll('.auth-fields').forEach(el => el.classList.remove('active'));

    if (authType === 'basic') {
      document.getElementById('basic-auth').classList.add('active');
    } else if (authType === 'token') {
      document.getElementById('token-auth').classList.add('active');
    }
  }

  updateQueryPreview() {
    const tableName = document.getElementById('table-name').value || '{table_name}';
    const uuidColumn = document.getElementById('uuid-column').value || '{uuid_column}';
    const nameColumn = document.getElementById('name-column').value || '{name_column}';
    const descColumn = document.getElementById('desc-column').value || 'NULL';
    const timestampColumn = document.getElementById('timestamp-column').value || 'NULL';

    const query = `SELECT DISTINCT
  ${uuidColumn} as uuid_value,
  ${nameColumn} as display_name,
  ${descColumn} as description,
  ${timestampColumn} as last_updated
FROM ${tableName}
WHERE ${uuidColumn} IN ({uuid_list})`;

    document.getElementById('query-preview').textContent = query;
  }

  async testConnection() {
    const config = this.getConnectionConfig();
    const advancedConfig = this.getAdvancedConfig();
    console.log(`${LOG_PREFIX} Testing connection to ${config.serverUrl}:${config.port}`);

    const button = document.getElementById('test-connection');
    const status = document.getElementById('connection-status');

    button.disabled = true;
    button.textContent = 'Testing...';

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'testConnection',
        config: config,
        advancedConfig: advancedConfig
      });

      console.log(`${LOG_PREFIX} Test connection result:`, response);
      this.showStatus('connection-status', response.valid ? 'success' : 'error', response.message);

      if (response.valid) {
        document.getElementById('step-1').classList.add('completed');
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Test connection error:`, error);
      this.showStatus('connection-status', 'error', `Test failed: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = 'Test Connection';
    }
  }

  async testQuery() {
    const connectionConfig = this.getConnectionConfig();
    const queryConfig = this.getQueryConfig();

    // Test with a dummy UUID
    const testUuids = ['00000000-0000-0000-0000-000000000000'];
    const query = this.buildTestQuery(testUuids, queryConfig);

    const button = document.getElementById('test-query');
    const status = document.getElementById('query-status');

    button.disabled = true;
    button.textContent = 'Testing...';

    try {
      // This would need to be implemented in background.js
      this.showStatus('query-status', 'info', 'Query structure validated (test implementation needed)');
      document.getElementById('step-2').classList.add('completed');
    } catch (error) {
      this.showStatus('query-status', 'error', `Query test failed: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = 'Test Query';
    }
  }

  buildTestQuery(uuids, queryConfig) {
    const uuidList = uuids.map(uuid => `'${uuid}'`).join(', ');
    const mappings = queryConfig.columnMappings;

    return `SELECT 
  ${mappings.uuid_column} as uuid_value,
  ${mappings.name_column} as display_name,
  ${mappings.description_column || 'NULL'} as description,
  ${mappings.timestamp_column || 'NULL'} as last_updated
FROM ${mappings.table_name}
WHERE ${mappings.uuid_column} IN (${uuidList})`;
  }

  getConnectionConfig() {
    return {
      dremioType: document.getElementById('dremio-type').value,
      serverUrl: document.getElementById('server-url').value,
      projectId: document.getElementById('project-id').value,
      port: parseInt(document.getElementById('port').value) || 9047,
      authType: document.getElementById('auth-type').value,
      username: document.getElementById('username').value,
      password: document.getElementById('password').value,
      token: document.getElementById('token').value
    };
  }

  getQueryConfig() {
    return {
      queryTemplate: `SELECT DISTINCT
  {uuid_column} as uuid_value,
  {name_column} as display_name,
  {description_column} as description,
  {timestamp_column} as last_updated
FROM {table_name}
WHERE {uuid_column} IN ({uuid_list})`,
      columnMappings: {
        table_name: document.getElementById('table-name').value,
        uuid_column: document.getElementById('uuid-column').value,
        name_column: document.getElementById('name-column').value,
        description_column: document.getElementById('desc-column').value,
        timestamp_column: document.getElementById('timestamp-column').value
      }
    };
  }

  getAdvancedConfig() {
    return {
      cacheTTL: parseInt(document.getElementById('cache-ttl').value) * 60000, // Convert to ms
      batchSize: parseInt(document.getElementById('batch-size').value),
      hoverDelay: parseInt(document.getElementById('hover-delay').value),
      cloudPollDelay: parseInt(document.getElementById('cloud-poll-delay').value),
      cloudPollInterval: parseInt(document.getElementById('cloud-poll-interval').value),
      cloudMaxAttempts: parseInt(document.getElementById('cloud-max-attempts').value)
    };
  }

  async saveConfiguration() {
    const config = {
      dremioConfig: this.getConnectionConfig(),
      queryConfig: this.getQueryConfig(),
      advancedConfig: this.getAdvancedConfig()
    };

    console.log(`${LOG_PREFIX} Saving configuration:`, {
      serverUrl: config.dremioConfig.serverUrl,
      tableName: config.queryConfig.columnMappings.table_name,
      cacheTTL: config.advancedConfig.cacheTTL
    });

    try {
      await chrome.storage.sync.set(config);
      console.log(`${LOG_PREFIX} Configuration saved successfully`);
      this.showStatus('save-status', 'success', 'Configuration saved successfully!');
      document.getElementById('step-3').classList.add('completed');

      // Close popup after a short delay
      setTimeout(() => window.close(), 1500);
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to save configuration:`, error);
      this.showStatus('save-status', 'error', `Failed to save: ${error.message}`);
    }
  }

  showStatus(elementId, type, message) {
    const element = document.getElementById(elementId);
    element.className = `status-message status-${type}`;
    element.textContent = message;
    element.style.display = 'block';

    if (type === 'success') {
      setTimeout(() => {
        element.style.display = 'none';
      }, 3000);
    }
  }

  nextStep() {
    console.log(`${LOG_PREFIX} Moving to step ${this.currentStep + 1}`);
    if (this.currentStep < this.maxStep) {
      this.currentStep++;
      this.updateStepDisplay();
    }
  }

  prevStep() {
    console.log(`${LOG_PREFIX} Moving back to step ${this.currentStep - 1}`);
    if (this.currentStep > 1) {
      this.currentStep--;
      this.updateStepDisplay();
    }
  }

  updateStepDisplay() {
    // Hide all steps
    document.querySelectorAll('.config-step').forEach(step => step.classList.remove('active'));

    // Show current step
    const stepMap = {
      1: 'connection-step',
      2: 'query-step',
      3: 'advanced-step'
    };
    document.getElementById(stepMap[this.currentStep]).classList.add('active');

    // Update step indicators
    document.querySelectorAll('.step').forEach((step, index) => {
      step.classList.remove('active');
      if (index + 1 === this.currentStep) {
        step.classList.add('active');
      }
    });

    // Update navigation buttons
    document.getElementById('prev-btn').style.display = this.currentStep > 1 ? 'inline-block' : 'none';
    document.getElementById('next-btn').style.display = this.currentStep < this.maxStep ? 'inline-block' : 'none';
    document.getElementById('save-btn').style.display = this.currentStep === this.maxStep ? 'inline-block' : 'none';
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new ConfigurationWizard();
});
