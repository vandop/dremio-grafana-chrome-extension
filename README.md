# Grafana UUID Mapper Chrome Extension

A Chrome extension that maps UUIDs in Grafana dashboards to human-readable names by querying a Dremio database. Perfect for making dashboards more user-friendly when dealing with UUID-based identifiers.

## Features

- 🔍 **Context Menu Lookup**: Right-click any UUID to look up its mapping
- 🏷️ **Modal Results Display**: Shows UUID mappings in a clean, formatted modal
- 🗄️ **Dremio Integration**: Supports both Dremio Cloud and on-premise deployments
- ⚡ **Smart Caching**: Reduces API calls with configurable cache TTL
- 🎛️ **Flexible Configuration**: Customizable queries and column mappings
- 🔔 **Browser Notifications**: Fallback notifications when content script isn't available
- ⚙️ **Configurable Polling**: Adjustable delays and retry settings for Dremio Cloud

## Installation

### Method 1: Load Unpacked Extension (Development)

1. **Download/Clone** this repository to your local machine
2. **Open Chrome** and navigate to `chrome://extensions/`
3. **Enable Developer Mode** (toggle in top-right corner)
4. **Click "Load unpacked"** and select the extension directory
5. **Pin the extension** to your toolbar for easy access

### Method 2: Build and Install

```bash
# Clone the repository
git clone <repository-url>
cd dremio-grafana-chrome-extension

# The extension is ready to use - no build step required
```

## Configuration

### Step 1: Dremio Connection

1. Click the extension icon in your Chrome toolbar
2. Select your **Dremio Type**:
   - **Dremio Cloud**: For cloud-hosted instances
   - **On-Premise**: For self-hosted Dremio servers
3. Enter your Dremio server details:
   - **Cloud**:
     - Server URL: `https://api.dremio.cloud` or `https://api.eu.dremio.cloud`
     - Project ID: Found in your Dremio Cloud project settings
     - Authentication: API Token (Bearer)
   - **On-Premise**:
     - Server URL: `https://your-dremio-instance.com`
     - Port: `9047` (default)
     - Authentication: None, Username/Password, or API Token
4. Click **"Test Connection"** to verify

### Step 2: Query Configuration

Configure how the extension maps UUIDs to names:

1. **Table/View Name**: The Dremio table containing UUID mappings
2. **Column Mappings**:
   - **UUID Column**: Column containing the UUIDs
   - **Name Column**: Column containing human-readable names
   - **Description Column**: (Optional) Additional context
   - **Timestamp Column**: (Optional) For cache validation

**Required Table Format:**
```sql
-- Your Dremio table should return this structure:
SELECT 
  uuid_column as uuid_value,      -- The UUID (string)
  name_column as display_name,    -- Human-readable name (string)
  desc_column as description,     -- Optional description (string)
  timestamp_column as last_updated -- Optional timestamp
FROM your_mapping_table
WHERE uuid_column IN ('uuid1', 'uuid2', ...)
```

3. **Preview** the generated query and click **"Test Query"**

### Step 3: Advanced Settings

- **Cache Duration**: How long to cache results (default: 60 minutes)
- **Batch Size**: Max UUIDs per API call (default: 50)
- **Hover Delay**: Delay before showing overlay (default: 300ms)
- **Dremio Cloud Polling** (Cloud only):
  - **Initial Poll Delay**: Wait time before first results check (default: 2000ms)
  - **Poll Interval**: Wait time between retry attempts (default: 1000ms)
  - **Max Poll Attempts**: Maximum retry attempts before timeout (default: 30)

## Usage

### Looking Up UUIDs

1. **Configure** the extension following the steps above
2. **Navigate** to a Grafana dashboard containing UUIDs
3. **Select a UUID** with your mouse
4. **Right-click** and select "Lookup UUID in Dremio"
5. **View the result** in the modal that appears

The extension will:
- Show a progress modal while querying Dremio
- Display the UUID mapping (name, description) in a formatted modal
- Cache results to speed up subsequent lookups
- Fall back to browser notifications if the page hasn't been refreshed after extension installation

### Test with Sample Data

Create a test table in Dremio:

```sql
-- Create sample mapping table
CREATE TABLE uuid_mappings AS
SELECT * FROM VALUES
  ('550e8400-e29b-41d4-a716-446655440000', 'Production Server', 'Main production environment'),
  ('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'Development Server', 'Dev environment'),
  ('6ba7b811-9dad-11d1-80b4-00c04fd430c8', 'Staging Server', 'Staging environment')
AS t(uuid_value, display_name, description);
```

Configure the extension:
- **Table Name**: `uuid_mappings`
- **UUID Column**: `uuid_value`
- **Name Column**: `display_name`
- **Description Column**: `description`

### Troubleshooting

**Extension not working?**
- Check that you're on a Grafana page (URL contains 'grafana')
- Verify the extension is enabled in `chrome://extensions/`
- Check browser console for error messages

**Connection issues?**
- Verify Dremio server URL and credentials
- Check network connectivity and CORS settings
- Ensure Dremio REST API is accessible

**No UUIDs detected?**
- UUIDs must follow standard format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- Check that UUIDs are in text content (not images)

**Query errors?**
- Verify table/column names exist in Dremio
- Check that your user has SELECT permissions
- Test the query directly in Dremio's SQL editor

## Development

### File Structure
```
├── manifest.json          # Extension configuration
├── background.js          # Service worker for API calls
├── content.js            # UUID detection and overlay logic
├── popup.html/js         # Configuration interface
├── styles.css            # Overlay and highlight styling
├── icons/                # Extension icons
└── README.md             # This file
```

### Key Components

- **UUID Detection**: Regex-based scanning with mutation observer
- **Dremio Client**: REST API integration with authentication
- **Caching System**: In-memory cache with configurable TTL
- **Configuration**: Multi-step wizard with validation

## License

MIT License - see LICENSE file for details

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request
