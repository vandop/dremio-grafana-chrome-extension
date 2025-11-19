const STORAGE_KEYS = ['dremioConfig', 'queryConfig', 'advancedConfig'];

const DEFAULT_DREMIO_CONFIG = {
  dremioType: 'cloud',
  serverUrl: '',
  projectId: '',
  port: 9047,
  authType: 'none',
  username: '',
  password: '',
  token: ''
};

const DEFAULT_QUERY_COLUMN_MAPPINGS = {
  table_name: '',
  uuid_column: '',
  name_column: '',
  description_column: '',
  timestamp_column: ''
};

const DEFAULT_QUERY_CONFIG = {
  columnMappings: { ...DEFAULT_QUERY_COLUMN_MAPPINGS }
};

const DEFAULT_ADVANCED_CONFIG = {
  cacheTTL: 3600000,
  batchSize: 50,
  hoverDelay: 300,
  cloudPollDelay: 2000,
  cloudPollInterval: 1000,
  cloudMaxAttempts: 30
};

class ConfigError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDremioConfig(raw = {}) {
  const normalized = { ...DEFAULT_DREMIO_CONFIG, ...raw };
  normalized.serverUrl = normalizeString(normalized.serverUrl);
  normalized.projectId = normalizeString(normalized.projectId);
  normalized.port = normalizeNumber(normalized.port, DEFAULT_DREMIO_CONFIG.port);
  normalized.username = normalizeString(normalized.username);
  normalized.password = normalizeString(normalized.password);
  normalized.token = normalizeString(normalized.token);
  normalized.dremioType = normalized.dremioType === 'onprem' ? 'onprem' : 'cloud';
  const supportedAuthTypes = new Set(['none', 'basic', 'token']);
  normalized.authType = supportedAuthTypes.has(normalized.authType) ? normalized.authType : 'none';
  return normalized;
}

function normalizeQueryConfig(raw = {}) {
  const mappings = { ...DEFAULT_QUERY_COLUMN_MAPPINGS, ...(raw.columnMappings || {}) };
  Object.keys(mappings).forEach(key => {
    mappings[key] = normalizeString(mappings[key]);
  });
  return { columnMappings: mappings };
}

function normalizeAdvancedConfig(raw = {}) {
  const normalized = { ...DEFAULT_ADVANCED_CONFIG, ...raw };
  normalized.cacheTTL = normalizeNumber(normalized.cacheTTL, DEFAULT_ADVANCED_CONFIG.cacheTTL);
  normalized.batchSize = Math.max(1, Math.round(normalizeNumber(normalized.batchSize, DEFAULT_ADVANCED_CONFIG.batchSize)));
  normalized.hoverDelay = normalizeNumber(normalized.hoverDelay, DEFAULT_ADVANCED_CONFIG.hoverDelay);
  normalized.cloudPollDelay = normalizeNumber(normalized.cloudPollDelay, DEFAULT_ADVANCED_CONFIG.cloudPollDelay);
  normalized.cloudPollInterval = normalizeNumber(normalized.cloudPollInterval, DEFAULT_ADVANCED_CONFIG.cloudPollInterval);
  normalized.cloudMaxAttempts = Math.max(1, Math.round(normalizeNumber(normalized.cloudMaxAttempts, DEFAULT_ADVANCED_CONFIG.cloudMaxAttempts)));
  return normalized;
}

function normalizeConfiguration(raw = {}) {
  return {
    dremio: normalizeDremioConfig(raw.dremioConfig),
    query: normalizeQueryConfig(raw.queryConfig),
    advanced: normalizeAdvancedConfig(raw.advancedConfig)
  };
}

const getDremioConfig = (config) => config?.dremio ? { ...config.dremio } : normalizeDremioConfig();
const getQueryConfig = (config) => config?.query ? { ...config.query } : normalizeQueryConfig();
const getAdvancedConfig = (config) => config?.advanced ? { ...config.advanced } : normalizeAdvancedConfig();

function validateConfig(config) {
  const errors = [];
  if (!config?.dremio?.serverUrl) {
    errors.push('Dremio server URL is required');
  }

  if (config?.dremio?.dremioType === 'cloud') {
    if (!config.dremio.projectId) {
      errors.push('Dremio Cloud requires a project ID');
    }
    if (config.dremio.authType !== 'token') {
      errors.push('Dremio Cloud requires API token authentication');
    }
    if (!config.dremio.token) {
      errors.push('A Dremio API token must be provided');
    }
  }

  if (config?.dremio?.authType === 'basic') {
    if (!config.dremio.username) {
      errors.push('Username is required for basic authentication');
    }
    if (!config.dremio.password) {
      errors.push('Password is required for basic authentication');
    }
  }

  const mappings = config?.query?.columnMappings;
  if (!mappings?.table_name) {
    errors.push('A source table name is required');
  }
  if (!mappings?.uuid_column) {
    errors.push('A UUID column is required');
  }
  if (!mappings?.name_column) {
    errors.push('A display name column is required');
  }

  return { valid: errors.length === 0, errors };
}

function assertValidConfig(config) {
  const { valid, errors } = validateConfig(config);
  if (!valid) {
    throw new ConfigError(`Configuration invalid: ${errors.join('; ')}`, errors);
  }
  return config;
}

class ConfigService {
  constructor(storage = (typeof chrome !== 'undefined' ? chrome.storage?.sync : null)) {
    if (!storage || typeof storage.get !== 'function') {
      throw new Error('A chrome.storage compatible instance is required');
    }
    this.storage = storage;
  }

  async load() {
    const result = await this.storage.get(STORAGE_KEYS);
    const normalized = normalizeConfiguration({
      dremioConfig: result?.dremioConfig,
      queryConfig: result?.queryConfig,
      advancedConfig: result?.advancedConfig
    });
    return {
      dremio: getDremioConfig(normalized),
      query: getQueryConfig(normalized),
      advanced: getAdvancedConfig(normalized)
    };
  }

  async loadAndValidate() {
    const config = await this.load();
    return assertValidConfig(config);
  }
}

export {
  ConfigError,
  ConfigService,
  DEFAULT_ADVANCED_CONFIG,
  DEFAULT_DREMIO_CONFIG,
  DEFAULT_QUERY_CONFIG,
  DEFAULT_QUERY_COLUMN_MAPPINGS,
  assertValidConfig,
  getAdvancedConfig,
  getDremioConfig,
  getQueryConfig,
  normalizeAdvancedConfig,
  normalizeConfiguration,
  normalizeDremioConfig,
  normalizeQueryConfig,
  validateConfig
};
