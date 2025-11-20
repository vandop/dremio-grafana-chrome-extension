import assert from 'assert';
import path from 'path';

// Mock browser environment for config.js
global.chrome = {
    storage: {
        sync: {
            get: async () => ({})
        }
    },
    runtime: {
        getURL: (path) => path
    }
};

// Import modules to test
// Note: We need to use dynamic imports or require if they are CommonJS. 
// The source files use 'export', so they are ES modules. 
// We will use a simple runner that handles ES modules or just mock the require if we were in a real node env that supports it.
// Since we are running in a potentially limited environment, let's try to read the files and eval them or use a trick.
// Actually, the simplest way given the constraints and file content (they use 'export { ... }') is to 
// just read them and wrap them or use a node script that uses 'import'.
// Node.js handles ESM if the file ends in .mjs or package.json says type: module.
// Let's try to write this as .mjs file.

async function runTests() {
    console.log('Starting Unit Tests...');
    let passed = 0;
    let failed = 0;

    try {
        // --- Test Query Utils ---
        console.log('\nTesting query-utils.js...');
        const { buildQuery, normalizeResponse } = await import('../src/common/query-utils.js');

        // Test 1: buildQuery default
        try {
            const sql = buildQuery(['uuid-1', 'uuid-2']);
            assert(sql.includes("'uuid-1', 'uuid-2'"), 'SQL should contain UUIDs');
            assert(sql.includes('SELECT DISTINCT'), 'SQL should start with SELECT DISTINCT');
            console.log('✅ buildQuery default');
            passed++;
        } catch (e) {
            console.error('❌ buildQuery default', e);
            failed++;
        }

        // Test 2: normalizeResponse
        try {
            const raw = {
                rows: [
                    { uuid_value: 'u1', display_name: 'n1', description: 'd1', last_updated: 123 }
                ]
            };
            const normalized = normalizeResponse(raw);
            assert.strictEqual(normalized[0].uuid, 'u1');
            assert.strictEqual(normalized[0].name, 'n1');
            assert.strictEqual(normalized[0].cached, false);
            console.log('✅ normalizeResponse');
            passed++;
        } catch (e) {
            console.error('❌ normalizeResponse', e);
            failed++;
        }

        // --- Test UUID Cache ---
        console.log('\nTesting uuid-cache.js...');
        const { UuidCache } = await import('../src/common/uuid-cache.js');

        // Test 3: Cache set and get
        try {
            const cache = new UuidCache(() => 1000);
            cache.set('u1', { name: 'test' });

            // Immediate retrieval
            const fresh = cache.getFreshEntries(['u1'], 100);
            assert(fresh.has('u1'), 'Should have entry');
            assert.strictEqual(fresh.get('u1').name, 'test');
            assert.strictEqual(fresh.get('u1').cached, true);
            console.log('✅ Cache set/get');
            passed++;
        } catch (e) {
            console.error('❌ Cache set/get', e);
            failed++;
        }

        // Test 4: Cache expiration
        try {
            let time = 1000;
            const cache = new UuidCache(() => time);
            cache.set('u1', { name: 'test' });

            time = 2000; // Advance time
            const fresh = cache.getFreshEntries(['u1'], 500); // TTL 500
            assert(!fresh.has('u1'), 'Should be expired');
            console.log('✅ Cache expiration');
            passed++;
        } catch (e) {
            console.error('❌ Cache expiration', e);
            failed++;
        }

        // --- Test Config ---
        console.log('\nTesting config.js...');
        const { validateConfig, normalizeConfiguration } = await import('../src/common/config.js');

        // Test 5: Validate invalid config
        try {
            const result = validateConfig({});
            assert.strictEqual(result.valid, false);
            assert(result.errors.length > 0);
            console.log('✅ Validate invalid config');
            passed++;
        } catch (e) {
            console.error('❌ Validate invalid config', e);
            failed++;
        }

        // Test 6: Normalize defaults
        try {
            const config = normalizeConfiguration({});
            assert.strictEqual(config.dremio.dremioType, 'cloud');
            assert.strictEqual(config.advanced.batchSize, 50);
            console.log('✅ Normalize defaults');
            passed++;
        } catch (e) {
            console.error('❌ Normalize defaults', e);
            failed++;
        }

    } catch (e) {
        console.error('Critical Error running tests:', e);
        failed++;
    }

    console.log(`\nSummary: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

runTests();
