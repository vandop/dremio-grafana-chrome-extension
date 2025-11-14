# Security Policy

## Data Storage

This extension stores configuration data locally using Chrome's `chrome.storage.sync` API:

- **Server URLs**: Dremio server addresses
- **Project IDs**: Dremio Cloud project identifiers
- **API Tokens**: Authentication tokens (stored as-is, not encrypted)
- **Usernames/Passwords**: Basic auth credentials (stored as-is, not encrypted)
- **Query Configuration**: Table names and column mappings
- **Cache Settings**: TTL and batch size preferences

### Important Security Notes

⚠️ **Credentials are stored in plain text** in Chrome's sync storage. This is a limitation of Chrome extensions.

**Best Practices:**
1. Use API tokens instead of username/password when possible
2. Create dedicated service accounts with minimal permissions
3. Grant only SELECT permissions on the mapping table
4. Use read-only tokens if your Dremio instance supports them
5. Regularly rotate API tokens
6. Don't share your Chrome profile with untrusted users

## Network Security

The extension makes HTTPS requests to:
- Your configured Dremio server (Cloud or On-Premise)
- No other external services

**Recommendations:**
- Always use HTTPS URLs for Dremio servers
- Verify SSL certificates are valid
- Use private networks or VPNs for on-premise deployments
- Configure CORS properly on your Dremio instance

## Permissions

This extension requests the following Chrome permissions:

- `storage`: To save configuration settings
- `activeTab`: To access the current Grafana tab
- `contextMenus`: To add right-click menu options
- `notifications`: To show browser notifications
- `<all_urls>`: To inject content script on any page (but only activates on Grafana pages)

## Data Privacy

- **No telemetry**: This extension does not send any data to third parties
- **No analytics**: No usage tracking or analytics
- **Local caching**: UUID mappings are cached in memory only (cleared on browser restart)
- **No external APIs**: Only communicates with your configured Dremio instance

## Reporting Security Issues

If you discover a security vulnerability, please:

1. **Do NOT** open a public GitHub issue
2. Email the maintainers privately (see repository for contact info)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 48 hours and work on a fix.

## Security Checklist for Users

Before using this extension:

- [ ] Review the source code (it's open source!)
- [ ] Use API tokens instead of passwords
- [ ] Create a dedicated Dremio service account
- [ ] Grant minimal permissions (SELECT only on mapping table)
- [ ] Use HTTPS for all Dremio connections
- [ ] Regularly rotate API tokens
- [ ] Keep the extension updated
- [ ] Review Chrome's extension permissions

## Security Checklist for Developers

When contributing:

- [ ] Never commit credentials or tokens
- [ ] Never hardcode server URLs or project IDs
- [ ] Validate all user inputs
- [ ] Use parameterized queries (SQL injection prevention)
- [ ] Handle errors gracefully without exposing sensitive info
- [ ] Follow Chrome extension security best practices
- [ ] Test with Content Security Policy enabled
- [ ] Review all network requests

## Known Limitations

1. **Credentials stored in plain text**: Chrome's storage API doesn't provide encryption
2. **No token encryption**: API tokens are stored as-is
3. **Sync storage**: Settings sync across Chrome instances (can be a privacy concern)
4. **All URLs permission**: Required to work on any Grafana instance, but only activates on Grafana pages

## Recommended Dremio Permissions

Create a dedicated service account with minimal permissions:

```sql
-- Example: Create read-only user for UUID mapping
CREATE USER uuid_mapper_service;

-- Grant SELECT only on the mapping table
GRANT SELECT ON your_schema.uuid_mapping_table TO uuid_mapper_service;

-- Do NOT grant:
-- - CREATE, INSERT, UPDATE, DELETE
-- - Access to other tables
-- - Admin privileges
```

## Updates and Patches

- Security patches will be released as soon as possible
- Check the repository regularly for updates
- Subscribe to GitHub releases for notifications
- Review the CHANGELOG for security-related updates

