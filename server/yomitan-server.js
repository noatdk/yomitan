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

import {Backend} from '../ext/js/background/backend.js';
import {log} from '../ext/js/core/log.js';
import {DictionaryImporter} from '../ext/js/dictionary/dictionary-importer.js';
import {DictionaryImporterMediaLoader} from '../ext/js/dictionary/dictionary-importer-media-loader.js';
import {readFileSync} from 'fs';
import {parseJson} from '../dev/json.js';

/**
 * Yomitan Server - Node.js server that exposes Yomitan's parsing APIs via JSON-RPC
 */
export class YomitanServer {
    /**
     * @param {import('./node-web-extension.js').NodeWebExtension} webExtension
     */
    constructor(webExtension) {
        /** @type {import('./node-web-extension.js').NodeWebExtension} */
        this._webExtension = webExtension;
        /** @type {?Backend} */
        this._backend = null;
    }

    /**
     * Initialize the server and backend
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            console.log('Creating Backend instance...');
            this._backend = new Backend(this._webExtension);
            console.log('Backend instance created, calling prepare()...');
            await this._backend.prepare();
            console.log('Backend prepare() completed');
            
            // Try to sync Edge's IndexedDB data after backend is prepared
            try {
                const {syncEdgeIndexedDb} = await import('./sync-edge-indexeddb.js');
                const indexedDB = globalThis.indexedDB;
                if (indexedDB) {
                    console.log('Attempting to sync Edge IndexedDB...');
                    await syncEdgeIndexedDb(indexedDB);
                }
            } catch (error) {
                console.warn('Failed to sync Edge IndexedDB:', error.message);
            }
            
            console.log('Yomitan Server initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Yomitan Server:', error);
            console.error('Error stack:', error.stack);
            log.error('Failed to initialize Yomitan Server:', error);
            throw error;
        }
    }

    /**
     * Handle JSON-RPC request
     * @param {import('api').ApiMessageAny} request
     * @returns {Promise<import('api').ApiResponseAny>}
     */
    async handleRequest(request) {
        if (!this._backend) {
            throw new Error('Server not initialized');
        }

        const {jsonrpc, id, method, params} = request;

        if (jsonrpc !== '2.0') {
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32600,
                    message: 'Invalid Request',
                },
            };
        }

        try {
            let result;
            switch (method) {
                case 'initialize':
                    result = await this.handleInitialize();
                    break;
                case 'parseText':
                    result = await this.handleParseText(params);
                    break;
                case 'findTerms':
                    result = await this.handleFindTerms(params);
                    break;
                case 'findKanji':
                    result = await this.handleFindKanji(params);
                    break;
                case 'getDictionaryInfo':
                    result = await this.handleGetDictionaryInfo();
                    break;
                case 'importDictionary':
                    result = await this.handleImportDictionary(params);
                    break;
                case 'deleteDictionary':
                    result = await this.handleDeleteDictionary(params);
                    break;
                case 'importDictionaryCollection':
                    result = await this.handleImportDictionaryCollection(params);
                    break;
                default:
                    return {
                        jsonrpc: '2.0',
                        id,
                        error: {
                            code: -32601,
                            message: 'Method not found',
                        },
                    };
            }

            return {
                jsonrpc: '2.0',
                id,
                result,
            };
        } catch (error) {
            log.error(`Error handling ${method}:`, error);
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error.message,
                },
            };
        }
    }

    /**
     * Handle initialize request
     * @returns {Promise<{serverInfo: {name: string, version: string}, capabilities: object}>}
     */
    async handleInitialize() {
        return {
            serverInfo: {
                name: 'yomitan-server',
                version: '1.0.0',
            },
            capabilities: {
                parseTextProvider: true,
                findTermsProvider: true,
                findKanjiProvider: true,
                dictionaryImportProvider: true,
                dictionaryExportProvider: false, // Not implemented yet
            },
        };
    }

    /**
     * Handle parseText request
     * @param {import('api').ApiParam<'parseText'>} params
     * @returns {Promise<import('api').ApiReturn<'parseText'>>}
     */
    async handleParseText(params) {
        const {text, optionsContext, scanLength, useInternalParser, useMecabParser} = params;

        const defaultOptionsContext = {
            index: 0,
            profile: 'default',
        };

        const mergedOptionsContext = {
            ...defaultOptionsContext,
            ...optionsContext,
        };

        // Access private method - we're in the same codebase
        // eslint-disable-next-line no-underscore-dangle
        const results = await this._backend._onApiParseText({
            text,
            optionsContext: mergedOptionsContext,
            scanLength: scanLength || 16,
            useInternalParser: useInternalParser !== false,
            useMecabParser: useMecabParser === true,
        });

        return results;
    }

    /**
     * Handle findTerms request
     * @param {import('api').ApiParam<'termsFind'>} params
     * @returns {Promise<import('api').ApiReturn<'termsFind'>>}
     */
    async handleFindTerms(params) {
        const {text, details, optionsContext} = params;

        const defaultOptionsContext = {
            index: 0,
            profile: 'default',
        };

        const mergedOptionsContext = {
            ...defaultOptionsContext,
            ...optionsContext,
        };

        // Access private method - we're in the same codebase
        // eslint-disable-next-line no-underscore-dangle
        const result = await this._backend._onApiTermsFind({
            text,
            details: details || {},
            optionsContext: mergedOptionsContext,
        });

        return result;
    }

    /**
     * Handle findKanji request
     * @param {import('api').ApiParam<'kanjiFind'>} params
     * @returns {Promise<import('api').ApiReturn<'kanjiFind'>>}
     */
    async handleFindKanji(params) {
        const {text, optionsContext} = params;

        const defaultOptionsContext = {
            index: 0,
            profile: 'default',
        };

        const mergedOptionsContext = {
            ...defaultOptionsContext,
            ...optionsContext,
        };

        // Access private method - we're in the same codebase
        // eslint-disable-next-line no-underscore-dangle
        const result = await this._backend._onApiKanjiFind({
            text,
            optionsContext: mergedOptionsContext,
        });

        return result;
    }

    /**
     * Handle getDictionaryInfo request
     * @returns {Promise<import('dictionary-importer').Summary[]>}
     */
    async handleGetDictionaryInfo() {
        if (!this._backend) {
            throw new Error('Server not initialized');
        }
        // Access private dictionary database - we're in the same codebase
        // eslint-disable-next-line no-underscore-dangle
        const dictionaryDatabase = this._backend._dictionaryDatabase;
        if (!dictionaryDatabase) {
            throw new Error('Dictionary database not available');
        }
        return await dictionaryDatabase.getDictionaryInfo();
    }

    /**
     * Handle importDictionary request
     * @param {import('dictionary-importer').ImportDictionaryParams} params
     * @returns {Promise<import('dictionary-importer').ImportResult>}
     */
    async handleImportDictionary(params) {
        if (!this._backend) {
            throw new Error('Server not initialized');
        }
        const {archiveContent, details} = params;
        
        if (!archiveContent) {
            throw new Error('archiveContent is required');
        }

        // Convert base64 string or Buffer to ArrayBuffer if needed
        let archiveBuffer;
        if (typeof archiveContent === 'string') {
            // Assume base64 encoded
            const binaryString = atob(archiveContent);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            archiveBuffer = bytes.buffer;
        } else if (archiveContent instanceof ArrayBuffer) {
            archiveBuffer = archiveContent;
        } else if (archiveContent && typeof archiveContent === 'object' && archiveContent.buffer) {
            // Handle Buffer or TypedArray
            archiveBuffer = archiveContent.buffer instanceof ArrayBuffer 
                ? archiveContent.buffer 
                : archiveContent.buffer.slice(archiveContent.byteOffset, archiveContent.byteOffset + archiveContent.byteLength);
        } else {
            throw new Error('archiveContent must be ArrayBuffer, Buffer, or base64 string');
        }

        // Access private dictionary database - we're in the same codebase
        // eslint-disable-next-line no-underscore-dangle
        const dictionaryDatabase = this._backend._dictionaryDatabase;
        if (!dictionaryDatabase) {
            throw new Error('Dictionary database not available');
        }

        if (!dictionaryDatabase.isPrepared()) {
            throw new Error('Dictionary database is not prepared');
        }

        const mediaLoader = new DictionaryImporterMediaLoader();
        const importer = new DictionaryImporter(mediaLoader);
        
        const importDetails = {
            prefixWildcardsSupported: details?.prefixWildcardsSupported ?? false,
            yomitanVersion: details?.yomitanVersion ?? '1.0.0',
        };

        const result = await importer.importDictionary(dictionaryDatabase, archiveBuffer, importDetails);
        return result;
    }

    /**
     * Handle deleteDictionary request
     * @param {{dictionaryName: string}} params
     * @returns {Promise<{success: boolean}>}
     */
    async handleDeleteDictionary(params) {
        if (!this._backend) {
            throw new Error('Server not initialized');
        }
        const {dictionaryName} = params;
        
        if (!dictionaryName || typeof dictionaryName !== 'string') {
            throw new Error('dictionaryName is required');
        }

        // Access private dictionary database - we're in the same codebase
        // eslint-disable-next-line no-underscore-dangle
        const dictionaryDatabase = this._backend._dictionaryDatabase;
        if (!dictionaryDatabase) {
            throw new Error('Dictionary database not available');
        }

        if (!dictionaryDatabase.isPrepared()) {
            throw new Error('Dictionary database is not prepared');
        }

        // Delete dictionary with progress callback
        await dictionaryDatabase.deleteDictionary(dictionaryName, 1000, () => {
            // Progress callback - can be used for reporting progress if needed
        });

        return {success: true};
    }

    /**
     * Handle importDictionaryCollection request
     * @param {{filePath: string, details?: object}} params
     * @returns {Promise<{imported: number, errors: Error[]}>}
     */
    async handleImportDictionaryCollection(params) {
        if (!this._backend) {
            throw new Error('Server not initialized');
        }
        const {filePath, details} = params;
        
        if (!filePath || typeof filePath !== 'string') {
            throw new Error('filePath is required');
        }

        // Read collection file from filesystem
        let collectionData;
        try {
            const fileContent = readFileSync(filePath, 'utf8');
            collectionData = parseJson(fileContent);
        } catch (error) {
            throw new Error(`Failed to read collection file: ${error.message}`);
        }

        if (!collectionData || typeof collectionData !== 'object') {
            throw new Error('Invalid collection file format');
        }

        // Access private dictionary database - we're in the same codebase
        // eslint-disable-next-line no-underscore-dangle
        const dictionaryDatabase = this._backend._dictionaryDatabase;
        if (!dictionaryDatabase) {
            throw new Error('Dictionary database not available');
        }

        if (!dictionaryDatabase.isPrepared()) {
            throw new Error('Dictionary database is not prepared');
        }

        // Extract dictionaries array from collection data
        const dictionaries = Array.isArray(collectionData) 
            ? collectionData 
            : (collectionData.dictionaries || []);

        if (!Array.isArray(dictionaries) || dictionaries.length === 0) {
            throw new Error('No dictionaries found in collection file');
        }

        const mediaLoader = new DictionaryImporterMediaLoader();
        const importer = new DictionaryImporter(mediaLoader);
        
        const importDetails = {
            prefixWildcardsSupported: details?.prefixWildcardsSupported ?? false,
            yomitanVersion: details?.yomitanVersion ?? '1.0.0',
        };

        const errors = [];
        let imported = 0;

        // Import each dictionary from its download URL
        for (const dictInfo of dictionaries) {
            if (!dictInfo.downloadUrl || typeof dictInfo.downloadUrl !== 'string') {
                errors.push(new Error(`Dictionary "${dictInfo.name || 'unknown'}" missing downloadUrl`));
                continue;
            }

            try {
                // Download the dictionary archive
                const response = await fetch(dictInfo.downloadUrl);
                if (!response.ok) {
                    throw new Error(`Failed to download dictionary: ${response.status} ${response.statusText}`);
                }

                const archiveBuffer = await response.arrayBuffer();

                // Import the dictionary
                const result = await importer.importDictionary(dictionaryDatabase, archiveBuffer, importDetails);
                
                if (result.errors && result.errors.length > 0) {
                    errors.push(...result.errors);
                } else if (result.result) {
                    imported++;
                }
            } catch (error) {
                errors.push(new Error(`Failed to import dictionary "${dictInfo.name || 'unknown'}": ${error.message}`));
            }
        }

        return {
            imported,
            errors: errors.map(e => ({
                message: e.message,
                name: e.name,
            })),
        };
    }
}
