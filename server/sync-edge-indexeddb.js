/*
 * Copyright (C) 2023-2025  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {existsSync} from 'fs';
import {EdgeStorageAccess} from './edge-storage-access.js';

/**
 * Parse Chrome/Edge IndexedDB LevelDB key format
 * Chrome uses a specific encoding: [database_id (varint), object_store_id (varint), index_id (varint), user_key, user_data]
 * @param {Buffer} keyBuffer
 * @returns {{databaseId: number, objectStoreId: number, indexId: number, userKey: any}|null}
 */
function parseIndexedDbKey(keyBuffer) {
    try {
        let offset = 0;
        
        // Read database ID (varint)
        let databaseId = 0;
        let shift = 0;
        while (offset < keyBuffer.length) {
            const byte = keyBuffer[offset++];
            databaseId |= (byte & 0x7F) << shift;
            if ((byte & 0x80) === 0) break;
            shift += 7;
        }
        
        // Read object store ID (varint)
        let objectStoreId = 0;
        shift = 0;
        while (offset < keyBuffer.length) {
            const byte = keyBuffer[offset++];
            objectStoreId |= (byte & 0x7F) << shift;
            if ((byte & 0x80) === 0) break;
            shift += 7;
        }
        
        // Read index ID (varint)
        let indexId = 0;
        shift = 0;
        while (offset < keyBuffer.length) {
            const byte = keyBuffer[offset++];
            indexId |= (byte & 0x7F) << shift;
            if ((byte & 0x80) === 0) break;
            shift += 7;
        }
        
        // Remaining bytes are the user key (encoded)
        const userKeyBuffer = keyBuffer.slice(offset);
        
        // Try to decode user key (could be string, number, or binary)
        let userKey = null;
        if (userKeyBuffer.length > 0) {
            try {
                // Try as string first
                const str = userKeyBuffer.toString('utf8');
                if (str.length > 0 && str.charCodeAt(0) !== 0) {
                    userKey = str;
                } else {
                    // Try as number
                    if (userKeyBuffer.length <= 8) {
                        userKey = userKeyBuffer.readDoubleBE(0);
                    } else {
                        // Keep as buffer for complex keys
                        userKey = userKeyBuffer;
                    }
                }
            } catch (e) {
                userKey = userKeyBuffer;
            }
        }
        
        return {databaseId, objectStoreId, indexId, userKey};
    } catch (error) {
        return null;
    }
}

/**
 * Decode IndexedDB value (may be encoded with V8 serialization)
 * @param {Buffer} valueBuffer
 * @returns {any}
 */
function decodeIndexedDbValue(valueBuffer) {
    try {
        // Chrome uses V8 serialization for IndexedDB values
        // For now, try to parse as JSON if it starts with '{' or '['
        const str = valueBuffer.toString('utf8');
        if (str.startsWith('{') || str.startsWith('[')) {
            try {
                return JSON.parse(str);
            } catch (e) {
                // Not JSON, return as buffer
            }
        }
        
        // Try to decode as structured clone format
        // This is complex - for now return the buffer and let the caller handle it
        return valueBuffer;
    } catch (error) {
        return valueBuffer;
    }
}

/**
 * Map object store IDs to names (based on Chrome's internal ID assignment)
 * This is a best-guess mapping - actual IDs may vary
 * @param {number} objectStoreId
 * @returns {string|null}
 */
function getObjectStoreName(objectStoreId) {
    // Chrome typically assigns IDs sequentially starting from 1
    // Based on DictionaryDatabase schema, the order is likely:
    // 1: dictionaries, 2: terms, 3: kanji, 4: termMeta, 5: kanjiMeta, 6: tagMeta, 7: media
    const mapping = {
        1: 'dictionaries',
        2: 'terms',
        3: 'kanji',
        4: 'termMeta',
        5: 'kanjiMeta',
        6: 'tagMeta',
        7: 'media',
    };
    return mapping[objectStoreId] || null;
}

/**
 * Sync Edge's IndexedDB data to fake-indexeddb
 * @param {IDBFactory} indexedDB - The IndexedDB factory (from fake-indexeddb)
 * @returns {Promise<boolean>} - True if sync was successful
 */
export async function syncEdgeIndexedDb(indexedDB) {
    console.log('=== Starting Edge IndexedDB Sync ===');
    const edgeStorage = new EdgeStorageAccess();
    const indexedDbPath = edgeStorage.getIndexedDbPath();
    
    console.log('Edge extension ID:', edgeStorage.getExtensionId());
    console.log('IndexedDB path:', indexedDbPath);
    
    if (!indexedDbPath || !existsSync(indexedDbPath)) {
        console.log('Edge IndexedDB not found, skipping sync');
        console.log('Path exists check:', indexedDbPath ? existsSync(indexedDbPath) : 'path is null');
        return false;
    }

    try {
        // Try to use level library to read Edge's IndexedDB LevelDB
        let Level;
        try {
            const levelModule = await import('level');
            // level package exports: { Level, default: { Level } }
            Level = levelModule.Level || levelModule.default?.Level;
            if (!Level || typeof Level !== 'function') {
                console.error('level import failed - Level is not a constructor:', typeof Level);
                return false;
            }
        } catch (e) {
            console.warn('level library not available, cannot sync IndexedDB:', e.message);
            return false;
        }

        console.log('Reading Edge IndexedDB LevelDB from:', indexedDbPath);
        
        // Try using classic-level directly, which might handle Chrome's format better
        let db;
        try {
            // First try with standard level
            db = new Level(indexedDbPath, {valueEncoding: null});
            await db.open();
            console.log('LevelDB opened successfully');
        } catch (error) {
            console.warn('Failed to open with level package:', error.message);
            // Try with classic-level directly
            try {
                const {ClassicLevel} = await import('classic-level');
                db = new ClassicLevel(indexedDbPath, {
                    valueEncoding: null,
                    // Chrome/Edge IndexedDB uses custom comparator, but we'll try anyway
                    createIfMissing: false,
                });
                await db.open();
                console.log('LevelDB opened successfully with classic-level');
            } catch (classicError) {
                console.error('Failed to open with classic-level:', classicError.message);
                throw new Error(`Cannot open Edge IndexedDB: ${error.message}. Note: Edge's IndexedDB uses a custom comparator (idb_cmp1) that may not be compatible with standard LevelDB readers. You may need to export dictionaries from Edge and import them using the importDictionaryCollection endpoint.`);
            }
        }
        
        // Open the 'dict' database in fake-indexeddb
        const dbName = 'dict';
        const dbVersion = 60;
        
        return new Promise((resolve) => {
            const request = indexedDB.open(dbName, dbVersion);
            
            request.onerror = async () => {
                console.error('Failed to open fake-indexeddb:', request.error);
                console.error('Error details:', request.error?.message || 'Unknown error');
                await db.close().catch(() => {});
                console.log('=== Edge IndexedDB Sync Failed ===');
                resolve(false);
            };
            
            request.onsuccess = async () => {
                const idb = request.result;
                const objectStores = ['dictionaries', 'terms', 'kanji', 'termMeta', 'kanjiMeta', 'tagMeta', 'media'];
                
                // Group entries by object store
                const entriesByStore = {};
                for (const storeName of objectStores) {
                    entriesByStore[storeName] = [];
                }
                
                let totalEntries = 0;
                let parsedEntries = 0;
                
                try {
                    // Read all entries from LevelDB
                    let sampleKeys = [];
                    const iterator = db.iterator();
                    for await (const [key, value] of iterator) {
                        totalEntries++;
                        
                        // Collect sample keys for debugging
                        if (sampleKeys.length < 5) {
                            const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key);
                            sampleKeys.push({
                                hex: keyBuffer.toString('hex').substring(0, 40),
                                length: keyBuffer.length,
                                firstBytes: Array.from(keyBuffer.slice(0, 10))
                            });
                        }
                        
                        // Parse the key
                        const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key);
                        const parsed = parseIndexedDbKey(keyBuffer);
                        
                        if (parsed) {
                            const storeName = getObjectStoreName(parsed.objectStoreId);
                            if (storeName && entriesByStore[storeName]) {
                                // Decode value
                                const valueBuffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
                                let decodedValue = decodeIndexedDbValue(valueBuffer);
                                
                                // Try to parse as structured clone if it's still a buffer
                                if (Buffer.isBuffer(decodedValue)) {
                                    try {
                                        // Chrome uses structured clone format
                                        // Try to extract JSON if present
                                        const str = decodedValue.toString('utf8');
                                        const jsonMatch = str.match(/\{.*\}|\[.*\]/);
                                        if (jsonMatch) {
                                            decodedValue = JSON.parse(jsonMatch[0]);
                                        }
                                    } catch (e) {
                                        // Keep as buffer
                                    }
                                }
                                
                                entriesByStore[storeName].push({
                                    key: parsed.userKey,
                                    value: decodedValue,
                                });
                                parsedEntries++;
                            } else if (parsed.objectStoreId) {
                                // Log unmapped object store IDs
                                if (totalEntries <= 10) {
                                    console.log(`Unmapped object store ID: ${parsed.objectStoreId}, database ID: ${parsed.databaseId}, index ID: ${parsed.indexId}`);
                                }
                            }
                        } else if (totalEntries <= 10) {
                            console.log(`Failed to parse key (first 20 bytes): ${keyBuffer.toString('hex').substring(0, 40)}`);
                        }
                    }
                    await iterator.close();
                    
                    if (sampleKeys.length > 0) {
                        console.log('Sample LevelDB keys:', JSON.stringify(sampleKeys, null, 2));
                    }
                    
                    await db.close();
                    
                    console.log(`Parsed ${parsedEntries} of ${totalEntries} entries`);
                    console.log('Entries by store:', Object.fromEntries(
                        Object.entries(entriesByStore).map(([name, entries]) => [name, entries.length])
                    ));
                    
                    // Populate fake-indexeddb with the data
                    let syncedCount = 0;
                    for (const [storeName, entries] of Object.entries(entriesByStore)) {
                        if (entries.length === 0) continue;
                        
                        console.log(`Syncing ${entries.length} entries to ${storeName}...`);
                        
                        try {
                            const transaction = idb.transaction([storeName], 'readwrite');
                            const store = transaction.objectStore(storeName);
                            
                            for (const entry of entries) {
                                try {
                                    // Try to add the entry
                                    if (entry.key !== null && entry.key !== undefined) {
                                        store.put(entry.value, entry.key);
                                    } else {
                                        store.add(entry.value);
                                    }
                                    syncedCount++;
                                } catch (e) {
                                    // Skip entries that fail to add
                                    console.warn(`Failed to add entry to ${storeName}:`, e.message);
                                }
                            }
                            
                            await new Promise((resolveTx, rejectTx) => {
                                transaction.oncomplete = () => resolveTx();
                                transaction.onerror = () => rejectTx(transaction.error);
                            });
                            
                            console.log(`Synced ${entries.length} entries to ${storeName}`);
                        } catch (error) {
                            console.warn(`Failed to sync ${storeName}:`, error.message);
                        }
                    }
                    
                    idb.close();
                    console.log(`Successfully synced ${syncedCount} entries from Edge IndexedDB`);
                    console.log('=== Edge IndexedDB Sync Complete ===');
                    resolve(syncedCount > 0);
                } catch (error) {
                    await db.close().catch(() => {});
                    idb.close();
                    console.error('Error reading Edge IndexedDB:', error);
                    console.error('Error stack:', error.stack);
                    console.log('=== Edge IndexedDB Sync Failed ===');
                    console.log('Note: Edge\'s IndexedDB uses a custom comparator (idb_cmp1) that may require special handling.');
                    console.log('Alternative: Export dictionaries from Edge and import using importDictionaryCollection endpoint.');
                    resolve(false);
                }
            };
            
            request.onupgradeneeded = (event) => {
                // Database upgrade - this should be handled by DictionaryDatabase
                // We'll let it create the stores
                const idb = event.target.result;
                // Stores will be created by DictionaryDatabase.prepare()
            };
        });
    } catch (error) {
        console.error('Failed to sync Edge IndexedDB:', error.message);
        console.error('Error stack:', error.stack);
        console.log('=== Edge IndexedDB Sync Failed ===');
        console.log('Note: Edge\'s IndexedDB LevelDB uses a custom comparator (idb_cmp1) that standard LevelDB readers cannot handle.');
        console.log('Recommendation: Export dictionaries from Edge extension and import them using the importDictionaryCollection endpoint.');
        return false;
    }
}

