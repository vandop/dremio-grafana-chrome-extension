// Configuration interface logic

const LOG_PREFIX = '[UUID Mapper - Popup]';
const DEFAULT_QUERY_TEMPLATE = `SELECT DISTINCT
  {uuid_column} as uuid_value,
  {name_column} as display_name,
  {description_column} as description,
  {timestamp_column} as last_updated
FROM {table_name}
WHERE {uuid_column} IN ({uuid_list})`;

console.log(`${LOG_PREFIX} Popup opened`);

class ConfigurationWizard {
  constructor() {
    console.log(`${LOG_PREFIX} ConfigurationWizard constructor`);
    this.currentStep = 1;
    this.maxStep = 3;
    this.stepMap = {
      1: 'connection-step',
      2: 'query-step',
      3: 'advanced-step'
    };

    this.elements = this.cacheElements();
    this.stateBindings = this.createStateBindings();
    this.state = this.initializeFormState();

    this.bindStateListeners();
    this.toggleDremioTypeFields(this.state.connection.dremioType);
    this.toggleAuthFields(this.state.connection.authType);
    this.updateQueryPreview();

    this.initializeEventListeners();
    this.loadConfiguration();
    this.updateStepDisplay();
  }

  cacheElements() {
    const ids = [
      'next-btn',
      'prev-btn',
      'save-btn',
      'test-connection',
      'test-query',
      'dremio-type',
      'server-url',
      'project-id',
      'port',
      'auth-type',
      'username',
      'password',
      'token',
      'table-name',
      'uuid-column',
      'name-column',
      'desc-column',
      'timestamp-column',
      'cache-ttl',
      'batch-size',
      'hover-delay',
      'cloud-poll-delay',
      'cloud-poll-interval',
      'cloud-max-attempts',
      'query-preview',
      'connection-step',
      'query-step',
      'advanced-step',
      'step-1',
      'step-2',
      'step-3',
      'connection-status',
      'query-status',
      'save-status',
      'basic-auth',
      'token-auth'
    ];

    const elements = {};
    ids.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        elements[id] = element;
      }
    });

    elements.cloudOnly = Array.from(document.querySelectorAll('.cloud-only'));
    elements.onpremOnly = Array.from(document.querySelectorAll('.onprem-only'));
    elements.authFields = Array.from(document.querySelectorAll('.auth-fields'));

    return elements;
  }

  createStateBindings() {
    return {
      'dremio-type': { path: ['connection', 'dremioType'], event: 'change', onChange: (value) => this.toggleDremioTypeFields(value) },
      'server-url': { path: ['connection', 'serverUrl'] },
      'project-id': { path: ['connection', 'projectId'] },
      'port': { path: ['connection', 'port'] },
      'auth-type': { path: ['connection', 'authType'], event: 'change', onChange: (value) => this.toggleAuthFields(value) },
      'username': { path: ['connection', 'username'] },
      'password': { path: ['connection', 'password'] },
      'token': { path: ['connection', 'token'] },
      'table-name': { path: ['query', 'columnMappings', 'table_name'], onChange: () => this.updateQueryPreview() },
      'uuid-column': { path: ['query', 'columnMappings', 'uuid_column'], onChange: () => this.updateQueryPreview() },
      'name-column': { path: ['query', 'columnMappings', 'name_column'], onChange: () => this.updateQueryPreview() },
      'desc-column': { path: ['query', 'columnMappings', 'description_column'], onChange: () => this.updateQueryPreview() },
      'timestamp-column': { path: ['query', 'columnMappings', 'timestamp_column'], onChange: () => this.updateQueryPreview() },
      'cache-ttl': { path: ['advanced', 'cacheTTLMinutes'] },
      'batch-size': { path: ['advanced', 'batchSize'] },
      'hover-delay': { path: ['advanced', 'hoverDelay'] },
      'cloud-poll-delay': { path: ['advanced', 'cloudPollDelay'] },
      'cloud-poll-interval': { path: ['advanced', 'cloudPollInterval'] },
      'cloud-max-attempts': { path: ['advanced', 'cloudMaxAttempts'] }
    };
  }

  initializeFormState() {
    return {
      connection: {
        dremioType: this.getElementValue('dremio-type', 'cloud'),
        serverUrl: this.getElementValue('server-url', ''),
        projectId: this.getElementValue('project-id', ''),
        port: this.getElementValue('port', '9047'),
        authType: this.getElementValue('auth-type', 'none'),
        username: this.getElementValue('username', ''),
        password: this.getElementValue('password', ''),
        token: this.getElementValue('token', '')
      },
      query: {
        columnMappings: {
          table_name: this.getElementValue('table-name', ''),
          uuid_column: this.getElementValue('uuid-column', ''),
          name_column: this.getElementValue('name-column', ''),
          description_column: this.getElementValue('desc-column', ''),
          timestamp_column: this.getElementValue('timestamp-column', '')
        }
      },
      advanced: {
        cacheTTLMinutes: this.getElementValue('cache-ttl', '60'),
        batchSize: this.getElementValue('batch-size', '50'),
        hoverDelay: this.getElementValue('hover-delay', '300'),
        cloudPollDelay: this.getElementValue('cloud-poll-delay', '2000'),
        cloudPollInterval: this.getElementValue('cloud-poll-interval', '1000'),
        cloudMaxAttempts: this.getElementValue('cloud-max-attempts', '30')
      }
    };
  }

  bindStateListeners() {
    Object.entries(this.stateBindings).forEach(([id, binding]) => {
      const element = this.elements[id];
      if (!element) {
        return;
      }
      const eventName = binding.event || 'input';
      element.addEventListener(eventName, (event) => {
        this.updateStateFromValue(id, event.target.value);
      });
    });
  }

  getElementValue(id, fallback = '') {
    return this.elements[id]?.value ?? fallback;
  }

  setStateValue(path, value) {
    if (!Array.isArray(path) || path.length === 0) {
      return;
    }

    let target = this.state;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {};
      }
      target = target[key];
    }
    target[path[path.length - 1]] = value;
  }

  updateStateFromValue(id, rawValue) {
    const binding = this.stateBindings[id];
    if (!binding) {
      return;
    }

    const value = typeof binding.parse === 'function' ? binding.parse(rawValue) : rawValue;
    this.setStateValue(binding.path, value);

    if (typeof binding.onChange === 'function') {
      binding.onChange(value);
    }
  }

  setInputValue(id, value) {
    const element = this.elements[id];
    if (!element) {
      return;
    }
    element.value = value ?? '';
    this.updateStateFromValue(id, element.value);
  }

  initializeEventListeners() {
    this.elements['next-btn']?.addEventListener('click', () => this.nextStep());
    this.elements['prev-btn']?.addEventListener('click', () => this.prevStep());
    this.elements['save-btn']?.addEventListener('click', () => this.saveConfiguration());
    this.elements['test-connection']?.addEventListener('click', () => this.testConnection());
    this.elements['test-query']?.addEventListener('click', () => this.testQuery());
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
    this.setInputValue('dremio-type', config.dremioType || 'cloud');
    this.setInputValue('server-url', config.serverUrl || '');
    this.setInputValue('project-id', config.projectId || '');
    this.setInputValue('port', config.port || 9047);
    this.setInputValue('auth-type', config.authType || 'none');
    this.setInputValue('username', config.username || '');
    this.setInputValue('password', config.password || '');
    this.setInputValue('token', config.token || '');
  }

  populateQueryForm(config) {
    const mappings = config.columnMappings || {};
    this.setInputValue('table-name', mappings.table_name || '');
    this.setInputValue('uuid-column', mappings.uuid_column || '');
    this.setInputValue('name-column', mappings.name_column || '');
    this.setInputValue('desc-column', mappings.description_column || '');
    this.setInputValue('timestamp-column', mappings.timestamp_column || '');
    this.updateQueryPreview();
  }

  populateAdvancedForm(config) {
    this.setInputValue('cache-ttl', (config.cacheTTL || 3600000) / 60000);
    this.setInputValue('batch-size', config.batchSize || 50);
    this.setInputValue('hover-delay', config.hoverDelay || 300);
    this.setInputValue('cloud-poll-delay', config.cloudPollDelay || 2000);
    this.setInputValue('cloud-poll-interval', config.cloudPollInterval || 1000);
    this.setInputValue('cloud-max-attempts', config.cloudMaxAttempts || 30);
  }

  toggleDremioTypeFields(dremioType) {
    console.log(`${LOG_PREFIX} Toggling Dremio type fields: ${dremioType}`);
    this.elements.cloudOnly.forEach(el => el.classList.toggle('active', dremioType === 'cloud'));
    this.elements.onpremOnly.forEach(el => el.classList.toggle('active', dremioType === 'onprem'));
  }

  toggleAuthFields(authType) {
    this.elements.authFields.forEach(el => el.classList.remove('active'));

    if (authType === 'basic') {
      this.elements['basic-auth']?.classList.add('active');
    } else if (authType === 'token') {
      this.elements['token-auth']?.classList.add('active');
    }
  }

  updateQueryPreview() {
    const mappings = this.state.query.columnMappings;
    const tableName = mappings.table_name || '{table_name}';
    const uuidColumn = mappings.uuid_column || '{uuid_column}';
    const nameColumn = mappings.name_column || '{name_column}';
    const descColumn = mappings.description_column || 'NULL';
    const timestampColumn = mappings.timestamp_column || 'NULL';

    const query = `SELECT DISTINCT
  ${uuidColumn} as uuid_value,
  ${nameColumn} as display_name,
  ${descColumn} as description,
  ${timestampColumn} as last_updated
FROM ${tableName}
WHERE ${uuidColumn} IN ({uuid_list})`;

    if (this.elements['query-preview']) {
      this.elements['query-preview'].textContent = query;
    }
  }

  async testConnection() {
    const config = this.getConnectionConfig();
    const advancedConfig = this.getAdvancedConfig();
    console.log(`${LOG_PREFIX} Testing connection to ${config.serverUrl}:${config.port}`);

    const button = this.elements['test-connection'];
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
        this.elements['step-1']?.classList.add('completed');
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
    const advancedConfig = this.getAdvancedConfig();
    const button = this.elements['test-query'];

    button.disabled = true;
    button.textContent = 'Testing...';
    this.showStatus('query-status', 'info', 'Running a test query...');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'testQuery',
        config: connectionConfig,
        queryConfig,
        advancedConfig
      });

      if (response.valid) {
        const rows = typeof response.rows === 'number' ? response.rows : '0';
        const message = response.message || `Query validated with ${rows} row(s).`;
        this.showStatus('query-status', 'success', message);
        this.elements['step-2']?.classList.add('completed');
      } else {
        this.showStatus('query-status', 'error', response.message || 'Query validation failed.');
      }
    } catch (error) {
      this.showStatus('query-status', 'error', `Query test failed: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = 'Test Query';
    }
  }

  getConnectionConfig() {
    const connection = this.state.connection;
    return {
      dremioType: connection.dremioType,
      serverUrl: connection.serverUrl,
      projectId: connection.projectId,
      port: parseInt(connection.port, 10) || 9047,
      authType: connection.authType,
      username: connection.username,
      password: connection.password,
      token: connection.token
    };
  }

  getQueryConfig() {
    return {
      queryTemplate: DEFAULT_QUERY_TEMPLATE,
      columnMappings: { ...this.state.query.columnMappings }
    };
  }

  getAdvancedConfig() {
    const advanced = this.state.advanced;
    const ttlMinutes = parseInt(advanced.cacheTTLMinutes, 10);
    return {
      cacheTTL: (Number.isFinite(ttlMinutes) ? ttlMinutes : 60) * 60000,
      batchSize: parseInt(advanced.batchSize, 10) || 50,
      hoverDelay: parseInt(advanced.hoverDelay, 10) || 300,
      cloudPollDelay: parseInt(advanced.cloudPollDelay, 10) || 2000,
      cloudPollInterval: parseInt(advanced.cloudPollInterval, 10) || 1000,
      cloudMaxAttempts: parseInt(advanced.cloudMaxAttempts, 10) || 30
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
      this.elements['step-3']?.classList.add('completed');

      setTimeout(() => window.close(), 1500);
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to save configuration:`, error);
      this.showStatus('save-status', 'error', `Failed to save: ${error.message}`);
    }
  }

  showStatus(elementId, type, message) {
    const element = this.elements[elementId];
    if (!element) {
      return;
    }

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

  deriveStepState() {
    const steps = Object.entries(this.stepMap).map(([stepNumber, sectionId]) => {
      const numeric = Number(stepNumber);
      return {
        sectionId,
        indicatorId: `step-${stepNumber}`,
        isActive: numeric === this.currentStep,
        isCompleted: numeric < this.currentStep
      };
    });

    return {
      steps,
      navigation: {
        showPrev: this.currentStep > 1,
        showNext: this.currentStep < this.maxStep,
        showSave: this.currentStep === this.maxStep
      }
    };
  }

  updateStepDisplay() {
    const state = this.deriveStepState();

    state.steps.forEach(({ sectionId, indicatorId, isActive, isCompleted }) => {
      const section = this.elements[sectionId];
      if (section) {
        section.classList.toggle('active', isActive);
      }
      const indicator = this.elements[indicatorId];
      if (indicator) {
        indicator.classList.toggle('active', isActive);
        indicator.classList.toggle('completed', isCompleted);
      }
    });

    if (this.elements['prev-btn']) {
      this.elements['prev-btn'].style.display = state.navigation.showPrev ? 'inline-block' : 'none';
    }
    if (this.elements['next-btn']) {
      this.elements['next-btn'].style.display = state.navigation.showNext ? 'inline-block' : 'none';
    }
    if (this.elements['save-btn']) {
      this.elements['save-btn'].style.display = state.navigation.showSave ? 'inline-block' : 'none';
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new ConfigurationWizard();
});
