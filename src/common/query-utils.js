const DEFAULT_QUERY_TEMPLATE = `SELECT DISTINCT
  {uuid_column} as uuid_value,
  {name_column} as display_name,
  {description_column} as description,
  {timestamp_column} as last_updated
FROM {table_name}
WHERE {uuid_column} IN ({uuid_list})`;

function sanitizeTemplate(template) {
  if (typeof template === 'string' && template.trim().length > 0) {
    return template;
  }
  return DEFAULT_QUERY_TEMPLATE;
}

function escapeUuid(uuid) {
  return `'${String(uuid).replace(/'/g, "''")}'`;
}

function buildQuery(uuids = [], queryConfig = {}) {
  const template = sanitizeTemplate(queryConfig.queryTemplate);
  const mappings = queryConfig.columnMappings || {};
  const uuidList = uuids.map(escapeUuid).join(', ');

  return template
    .replace(/{uuid_column}/g, mappings.uuid_column || 'uuid')
    .replace(/{name_column}/g, mappings.name_column || 'name')
    .replace(/{description_column}/g, mappings.description_column || 'description')
    .replace(/{timestamp_column}/g, mappings.timestamp_column || 'last_updated')
    .replace(/{table_name}/g, mappings.table_name || 'source_table')
    .replace(/{uuid_list}/g, uuidList);
}

function normalizeResponse(rawResponse = {}, queryConfig = {}) {
  const rows = Array.isArray(rawResponse.rows) ? rawResponse.rows : [];
  const mappings = queryConfig.columnMappings || {};
  const now = Date.now();

  return rows.map(row => ({
    uuid: row.uuid_value ?? row[mappings.uuid_column],
    name: row.display_name ?? row[mappings.name_column],
    description: row.description ?? row[mappings.description_column] ?? null,
    lastUpdated: row.last_updated ?? row[mappings.timestamp_column] ?? null,
    cached: false,
    timestamp: now
  }));
}

export {
  DEFAULT_QUERY_TEMPLATE,
  buildQuery,
  normalizeResponse
};
