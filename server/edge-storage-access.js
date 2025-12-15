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

import {readFileSync, existsSync, readdirSync, statSync} from 'fs';
import {join} from 'path';
import {homedir} from 'os';

/**
 * Access Edge browser extension storage
 */
export class EdgeStorageAccess {
    constructor() {
        this._extensionId = null;
        this._storagePath = null;
        this._indexedDbPath = null;
        this._findExtensionId();
    }

    /**
     * Find Yomitan extension ID in Edge
     */
    _findExtensionId() {
        const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
        const edgeExtensionsPath = join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Extensions');
        
        if (!existsSync(edgeExtensionsPath)) {
            console.warn('Edge extensions directory not found');
            return;
        }

        // Look for Yomitan extension by checking manifest.json files
        const extensionDirs = readdirSync(edgeExtensionsPath);
        for (const extId of extensionDirs) {
            const extPath = join(edgeExtensionsPath, extId);
            if (!existsSync(extPath) || extId.startsWith('.')) continue;

            const versions = readdirSync(extPath);
            for (const version of versions) {
                const manifestPath = join(extPath, version, 'manifest.json');
                if (existsSync(manifestPath)) {
                    try {
                        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
                        if (manifest.name && manifest.name.toLowerCase().includes('yomitan')) {
                            this._extensionId = extId;
                            this._storagePath = join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Local Extension Settings', extId);
                            this._indexedDbPath = join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'IndexedDB', `chrome-extension_${extId.replace(/-/g, '_')}_0.indexeddb.leveldb`);
                            console.log(`Found Yomitan extension ID: ${extId}`);
                            return;
                        }
                    } catch (e) {
                        // Ignore errors reading manifest
                    }
                }
            }
        }

        console.warn('Yomitan extension not found in Edge');
    }

    /**
     * Read chrome.storage.local data from Edge
     * Edge stores data in LevelDB format at: Local Extension Settings\{extension-id}
     * @param {string[]|object} keys
     * @returns {Promise<object>}
     */
    async getStorageLocal(keys) {
        if (!this._storagePath || !existsSync(this._storagePath)) {
            return {};
        }

        try {
            // Try to use level library if available to read LevelDB
            let level;
            try {
                level = await import('level');
            } catch (e) {
                // level not available, try alternative methods
            }

            if (level) {
                try {
                    // Handle level package export format: { Level, default: { Level } }
                    const Level = level.Level || level.default?.Level;
                    if (!Level) {
                        console.warn('Could not find Level class in level module');
                        return {};
                    }
                    const db = new Level(this._storagePath, {valueEncoding: 'json'});
                    await db.open();
                    const allData = {};
                    
                    // Read all entries from LevelDB
                    const iterator = db.iterator();
                    for await (const [key, value] of iterator) {
                        // Edge stores keys in a specific format, may need parsing
                        try {
                            const parsedKey = JSON.parse(key);
                            if (typeof parsedKey === 'string') {
                                allData[parsedKey] = value;
                            }
                        } catch (e) {
                            // Key might be plain string
                            allData[key] = value;
                        }
                    }
                    await iterator.close();
                    await db.close();
                    
                    // Filter by requested keys
                    if (Array.isArray(keys)) {
                        const result = {};
                        for (const key of keys) {
                            result[key] = allData[key];
                        }
                        return result;
                    }
                    return allData;
                } catch (error) {
                    console.warn('Failed to read LevelDB:', error.message);
                }
            }

            // Fallback: Try reading JSON files if they exist
            const files = readdirSync(this._storagePath);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            
            for (const jsonFile of jsonFiles) {
                try {
                    const filePath = join(this._storagePath, jsonFile);
                    const content = readFileSync(filePath, 'utf8');
                    const data = JSON.parse(content);
                    
                    if (Array.isArray(keys)) {
                        const result = {};
                        for (const key of keys) {
                            result[key] = data[key];
                        }
                        return result;
                    }
                    return data;
                } catch (e) {
                    // Continue to next file
                }
            }

            return {};
        } catch (error) {
            console.warn('Failed to read Edge storage:', error.message);
            return {};
        }
    }

    /**
     * Check if Edge storage is available
     * @returns {boolean}
     */
    isAvailable() {
        return this._extensionId !== null && this._storagePath !== null && existsSync(this._storagePath);
    }

    /**
     * Get extension ID
     * @returns {string|null}
     */
    getExtensionId() {
        return this._extensionId;
    }

    /**
     * Get IndexedDB path for the 'dict' database
     * @returns {string|null}
     */
    getIndexedDbPath() {
        if (!this._extensionId) {
            return null;
        }
        
        const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
        // Edge stores IndexedDB as: IndexedDB/chrome-extension_{id}_0.indexeddb.leveldb/
        // The database 'dict' would be inside this LevelDB
        const indexedDbBase = join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'IndexedDB', `chrome-extension_${this._extensionId.replace(/-/g, '_')}_0.indexeddb.leveldb`);
        return indexedDbBase;
    }

    /**
     * Check if IndexedDB is available
     * @returns {boolean}
     */
    isIndexedDbAvailable() {
        const path = this.getIndexedDbPath();
        return path !== null && existsSync(path);
    }
}

