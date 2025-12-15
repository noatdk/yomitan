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

import {EventDispatcher} from '../ext/js/core/event-dispatcher.js';
import {toError} from '../ext/js/core/to-error.js';
import {fileURLToPath} from 'url';
import {join, dirname} from 'path';
import {readFileSync, existsSync} from 'fs';
import {EdgeStorageAccess} from './edge-storage-access.js';

// Get extension directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const extDir = join(__dirname, '..', 'ext');

// Initialize Edge storage access
const edgeStorage = new EdgeStorageAccess();

// Polyfill chrome APIs for Node.js
if (typeof globalThis.chrome === 'undefined') {
    globalThis.chrome = {};
}

// Merge/initialize chrome APIs
if (!globalThis.chrome.runtime) {
    globalThis.chrome.runtime = {};
}
Object.assign(globalThis.chrome.runtime, {
    getManifest: () => ({
        name: 'Yomitan Server',
        version: '1.0.0',
        action: {
            default_title: 'Yomitan Server',
        },
    }),
    getURL: (path) => {
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        return `file://${join(extDir, normalizedPath)}`;
    },
    lastError: undefined, // Chrome API sets this when callbacks fail
    onMessage: globalThis.chrome.runtime.onMessage || {
        addListener: () => {}, // No-op for server
        removeListener: () => {},
    },
    onConnect: globalThis.chrome.runtime.onConnect || {
        addListener: () => {},
        removeListener: () => {},
    },
    onInstalled: globalThis.chrome.runtime.onInstalled || {
        addListener: () => {},
        removeListener: () => {},
    },
});

if (!globalThis.chrome.commands) {
    globalThis.chrome.commands = {
        onCommand: {
            addListener: () => {},
            removeListener: () => {},
        },
    };
}

if (!globalThis.chrome.tabs) {
    globalThis.chrome.tabs = {
        query: (queryInfo, callback) => {
            if (callback) {
                setTimeout(() => callback([]), 0);
            } else {
                return Promise.resolve([]);
            }
        },
        create: (createProperties, callback) => {
            if (callback) {
                setTimeout(() => callback({id: 0}), 0);
            } else {
                return Promise.resolve({id: 0});
            }
        },
        onZoomChange: {
            addListener: () => {},
            removeListener: () => {},
        },
    };
}

if (!globalThis.chrome.storage) {
    globalThis.chrome.storage = {
        local: {
            get: async (keys, callback) => {
                let result = {};
                
                // Try to read from Edge storage if available
                if (edgeStorage.isAvailable()) {
                    try {
                        result = await edgeStorage.getStorageLocal(keys);
                    } catch (error) {
                        console.warn('Failed to read from Edge storage, using defaults:', error.message);
                    }
                }
                
                // Fill in defaults for missing keys
                if (Array.isArray(keys)) {
                    for (const key of keys) {
                        if (!(key in result)) {
                            result[key] = undefined;
                        }
                    }
                } else if (typeof keys === 'object' && keys !== null) {
                    for (const key of Object.keys(keys)) {
                        if (!(key in result)) {
                            result[key] = keys[key];
                        }
                    }
                }
                
                if (callback) {
                    setTimeout(() => callback(result), 0);
                } else {
                    // Return a promise if no callback (for await syntax)
                    return Promise.resolve(result);
                }
            },
            set: (items, callback) => {
                // Note: We're not writing back to Edge storage, just keeping in memory
                // This could be enhanced to write back if needed
                if (callback) {
                    setTimeout(() => callback(), 0);
                } else {
                    return Promise.resolve();
                }
            },
            remove: (keys, callback) => {
                if (callback) {
                    setTimeout(() => callback(), 0);
                } else {
                    return Promise.resolve();
                }
            },
        },
        session: {
            get: (keys, callback) => {
                const result = {};
                if (Array.isArray(keys)) {
                    for (const key of keys) {
                        result[key] = undefined;
                    }
                } else if (typeof keys === 'object' && keys !== null) {
                    // If keys is an object (get all), return empty object
                    Object.assign(result, keys);
                }
                if (callback) {
                    setTimeout(() => callback(result), 0);
                } else {
                    // Return a promise if no callback (for await syntax)
                    return Promise.resolve(result);
                }
            },
            set: (items, callback) => {
                if (callback) {
                    setTimeout(() => callback(), 0);
                } else {
                    return Promise.resolve();
                }
            },
            remove: (keys, callback) => {
                if (callback) {
                    setTimeout(() => callback(), 0);
                } else {
                    return Promise.resolve();
                }
            },
        },
    };
}

if (!globalThis.chrome.permissions) {
    globalThis.chrome.permissions = {
        getAll: (callback) => {
            // Chrome API uses callback pattern, not promises
            if (callback) {
                setTimeout(() => callback({permissions: [], origins: []}), 0);
            }
        },
        onAdded: {
            addListener: () => {},
            removeListener: () => {},
        },
        onRemoved: {
            addListener: () => {},
            removeListener: () => {},
        },
    };
}

if (globalThis.chrome.offscreen === undefined) {
    globalThis.chrome.offscreen = undefined; // No offscreen support in Node.js
}

// Polyfill chrome.declarativeNetRequest for Node.js (used by RequestBuilder)
if (!globalThis.chrome.declarativeNetRequest) {
    globalThis.chrome.declarativeNetRequest = {
        getDynamicRules: (callback) => {
            if (callback) {
                setTimeout(() => callback([]), 0);
            }
        },
        updateDynamicRules: (options, callback) => {
            if (callback) {
                setTimeout(() => callback(), 0);
            }
        },
        getSessionRules: (callback) => {
            if (callback) {
                setTimeout(() => callback([]), 0);
            }
        },
        updateSessionRules: (options, callback) => {
            if (callback) {
                setTimeout(() => callback(), 0);
            }
        },
    };
}

// Polyfill fetch for file:// URLs and relative paths
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
    let urlString = typeof url === 'string' ? url : url.toString();
    
    // Convert relative paths (starting with /) to file:// URLs
    if (urlString.startsWith('/') && !urlString.startsWith('//')) {
        urlString = `file://${join(extDir, urlString)}`;
    }
    
    if (urlString.startsWith('file://')) {
        const filePath = fileURLToPath(urlString);
        if (!existsSync(filePath)) {
            const response = new Response(null, {
                status: 404,
                statusText: 'Not Found',
            });
            // Make response.ok work correctly
            Object.defineProperty(response, 'ok', {value: false, writable: false});
            return response;
        }
        const content = readFileSync(filePath);
        const response = new Response(content, {
            status: 200,
            statusText: 'OK',
            headers: {
                'Content-Type': 'application/octet-stream',
            },
        });
        // Make response.ok work correctly
        Object.defineProperty(response, 'ok', {value: true, writable: false});
        return response;
    }
    return originalFetch(url, options);
};

/**
 * Node.js-compatible WebExtension implementation
 * Provides a minimal WebExtension interface for server-side use
 * @augments EventDispatcher<import('web-extension').Events>
 */
export class NodeWebExtension extends EventDispatcher {
    constructor() {
        super();
        /** @type {boolean} */
        this._unloaded = false;
        /** @type {?string} */
        this._extensionBaseUrl = null;
        /** @type {string} */
        this._extensionName = 'Yomitan Server';
    }

    /** @type {boolean} */
    get unloaded() {
        return this._unloaded;
    }

    /** @type {string} */
    get extensionName() {
        return this._extensionName;
    }

    /**
     * @param {string} path
     * @returns {string}
     */
    getUrl(path) {
        // Return a file:// URL for Node.js
        return `file://${process.cwd()}${path}`;
    }

    /**
     * @param {unknown} message
     * @param {(response: unknown) => void} responseCallback
     * @throws {Error}
     */
    sendMessage(message, responseCallback) {
        // Not used in server context
        if (responseCallback) {
            responseCallback(null);
        }
    }

    /**
     * @param {unknown} message
     * @returns {Promise<unknown>}
     */
    sendMessagePromise(message) {
        return Promise.resolve(null);
    }

    /**
     * @param {unknown} message
     */
    sendMessageIgnoreResponse(message) {
        // NOP
    }

    /**
     * @returns {?Error}
     */
    getLastError() {
        return null;
    }

    /**
     */
    triggerUnloaded() {
        this._unloaded = true;
        this.trigger('unloaded');
    }
}

