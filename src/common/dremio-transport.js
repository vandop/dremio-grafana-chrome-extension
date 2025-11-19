const LOG_PREFIX = '[UUID Mapper - Transport]';
const JOB_PROGRESS_KEYWORDS = ['PLANNING', 'RUNNING', 'ENQUEUED', 'STARTING'];

class BaseTransport {
  constructor(config, advancedConfig = {}, fetchImpl = fetch) {
    this.config = config;
    this.advanced = advancedConfig;
    this.fetch = fetchImpl;
  }

  async testConnection() {
    try {
      await this.runQuery('SELECT 1 as test_connection');
      return { valid: true, message: `${this.getLabel()} connection successful` };
    } catch (error) {
      console.error(`${LOG_PREFIX} ${this.getLabel()} connection test failed`, error);
      return { valid: false, message: `Connection failed: ${error.message}` };
    }
  }

  getLabel() {
    return 'Dremio';
  }
}

class DremioCloudTransport extends BaseTransport {
  getLabel() {
    return 'Dremio Cloud';
  }

  buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.config.authType === 'token' && this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    }
    return headers;
  }

  async runQuery(sql) {
    const jobId = await this.submitQuery(sql);
    return this.pollJobResults(jobId);
  }

  async submitQuery(sql) {
    const submitUrl = `${this.config.serverUrl}/v0/projects/${this.config.projectId}/sql`;
    const response = await this.fetch(submitUrl, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ sql })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dremio Cloud API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data.id;
  }

  async pollJobResults(jobId) {
    const delay = this.advanced.cloudPollDelay ?? 2000;
    const interval = this.advanced.cloudPollInterval ?? 1000;
    const maxAttempts = this.advanced.cloudMaxAttempts ?? 30;
    const resultsUrl = `${this.config.serverUrl}/v0/projects/${this.config.projectId}/job/${jobId}/results`;

    await sleep(delay);
    let attempts = 0;

    while (attempts < maxAttempts) {
      const response = await this.fetch(resultsUrl, {
        method: 'GET',
        headers: this.buildHeaders()
      });

      if (response.ok) {
        return await response.json();
      }

      if (response.status === 404 || response.status === 202) {
        attempts++;
        await sleep(interval);
        continue;
      }

      const errorText = await response.text();
      if (this.isJobInProgress(errorText)) {
        attempts++;
        await sleep(interval);
        continue;
      }

      throw new Error(`Dremio Cloud results error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    throw new Error(`Dremio Cloud query timeout after ${maxAttempts} attempts`);
  }

  isJobInProgress(errorText) {
    try {
      const data = JSON.parse(errorText);
      const message = data.errorMessage || '';
      return JOB_PROGRESS_KEYWORDS.some(keyword => message.includes(keyword));
    } catch (error) {
      return false;
    }
  }
}

class DremioOnPremTransport extends BaseTransport {
  getLabel() {
    return 'Dremio on-premise';
  }

  buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.config.authType === 'basic' && this.config.username) {
      headers['Authorization'] = `Basic ${btoa(`${this.config.username}:${this.config.password || ''}`)}`;
    } else if (this.config.authType === 'token' && this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    }
    return headers;
  }

  getUrl() {
    return `${this.config.serverUrl}:${this.config.port || 9047}/api/v3/sql`;
  }

  async runQuery(sql) {
    const response = await this.fetch(this.getUrl(), {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ sql })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dremio API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return await response.json();
  }
}

function createDremioTransport(config, advancedConfig = {}, fetchImpl = fetch) {
  if (config.dremioType === 'cloud') {
    return new DremioCloudTransport(config, advancedConfig, fetchImpl);
  }
  return new DremioOnPremTransport(config, advancedConfig, fetchImpl);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export {
  BaseTransport,
  DremioCloudTransport,
  DremioOnPremTransport,
  createDremioTransport
};
