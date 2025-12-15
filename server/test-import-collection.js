/*
 * Test script for importing dictionary collection
 */

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8080';
const COLLECTION_FILE = process.env.COLLECTION_FILE || 'C:/Users/asus/Downloads/Tray/yomitan-dictionaries-2025-12-15-19-02-44.json';

async function importDictionaryCollection() {
    console.log(`Importing dictionary collection from: ${COLLECTION_FILE}`);
    console.log('\nSending import request to server...');
    
    const response = await fetch(SERVER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'importDictionaryCollection',
            params: {
                filePath: COLLECTION_FILE,
                details: {
                    prefixWildcardsSupported: false,
                    yomitanVersion: '1.0.0',
                },
            },
        }),
    });

    const result = await response.json();
    console.log('\nImport result:');
    console.log(JSON.stringify(result, null, 2));
    
    if (result.result) {
        console.log(`\n✅ Successfully imported ${result.result.imported} dictionaries`);
        if (result.result.errors && result.result.errors.length > 0) {
            console.log(`⚠️  ${result.result.errors.length} errors occurred:`);
            result.result.errors.forEach((error, i) => {
                console.log(`  ${i + 1}. ${error.message}`);
            });
        }
    } else if (result.error) {
        console.error(`\n❌ Error: ${result.error.message}`);
        if (result.error.data) {
            console.error(`   Details: ${result.error.data}`);
        }
    }
}

importDictionaryCollection().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
});

