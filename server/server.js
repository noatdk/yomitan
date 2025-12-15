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

// Polyfill self for Node.js (used by some code to detect environment)
if (typeof globalThis.self === 'undefined') {
    globalThis.self = globalThis;
}

// Make self.constructor.name === 'Window' to prevent worker mode in dictionary database
// This avoids trying to load wasm files that may not exist
Object.defineProperty(globalThis.self, 'constructor', {
    value: class Window {},
    writable: false,
    configurable: false,
});

// Polyfill SharedWorker for Node.js (not actually used, just needs to exist)
if (typeof globalThis.SharedWorker === 'undefined') {
    globalThis.SharedWorker = class SharedWorker {
        constructor(url, options) {
            this.port = {
                postMessage: () => {},
                addEventListener: () => {},
                start: () => {},
            };
        }
    };
}

// Polyfill Worker for Node.js (not actually used, just needs to exist)
if (typeof globalThis.Worker === 'undefined') {
    globalThis.Worker = class Worker {
        constructor(url, options) {
            this.addEventListener = () => {};
        }
    };
}

// Polyfill globalThis.addEventListener for Node.js
if (typeof globalThis.addEventListener === 'undefined') {
    const listeners = new Map();
    globalThis.addEventListener = (type, handler) => {
        if (!listeners.has(type)) {
            listeners.set(type, []);
        }
        listeners.get(type).push(handler);
    };
    globalThis.removeEventListener = (type, handler) => {
        if (listeners.has(type)) {
            const handlers = listeners.get(type);
            const index = handlers.indexOf(handler);
            if (index !== -1) {
                handlers.splice(index, 1);
            }
        }
    };
    globalThis.dispatchEvent = (event) => {
        if (listeners.has(event.type)) {
            for (const handler of listeners.get(event.type)) {
                handler(event);
            }
        }
    };
}

// Polyfill chrome.permissions for Node.js
if (typeof globalThis.chrome === 'undefined' || !globalThis.chrome.permissions) {
    if (typeof globalThis.chrome === 'undefined') {
        globalThis.chrome = {};
    }
    globalThis.chrome.permissions = {
        onAdded: {addListener: () => {}, removeListener: () => {}},
        onRemoved: {addListener: () => {}, removeListener: () => {}},
    };
}

// Use persistent IndexedDB implementation for Node.js
import dbManager from 'node-indexeddb-lmdb/dbManager';
import express from 'express';
import {createServer} from 'http';
import {WebSocketServer} from 'ws';
import {fileURLToPath} from 'url';
import {dirname, join} from 'path';
import {existsSync, mkdirSync} from 'fs';
import multer from 'multer';
import {buildLibs} from '../dev/build-libs.js';
import {log} from '../ext/js/core/log.js';
import {NodeWebExtension} from './node-web-extension.js';
import {YomitanServer} from './yomitan-server.js';
import {EdgeStorageAccess} from './edge-storage-access.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 8080;

// Configure persistent IndexedDB storage directory
// node-indexeddb-lmdb defaults to ./indexeddb relative to process.cwd()
// We'll change to the server directory to ensure consistent storage location
const INDEXEDDB_STORAGE_DIR = join(__dirname, 'indexeddb');
if (!existsSync(INDEXEDDB_STORAGE_DIR)) {
    mkdirSync(INDEXEDDB_STORAGE_DIR, {recursive: true});
}

// Change working directory to server directory so indexeddb folder is created here
process.chdir(__dirname);

// Initialize Edge storage access to check availability
const edgeStorage = new EdgeStorageAccess();
if (edgeStorage.isAvailable()) {
    console.log(`Edge storage available for extension: ${edgeStorage.getExtensionId()}`);
    if (edgeStorage.isIndexedDbAvailable()) {
        console.log('Edge IndexedDB available');
    }
} else {
    console.log('Edge storage not available - using local storage');
}

console.log('Persistent IndexedDB storage will be at:', INDEXEDDB_STORAGE_DIR);

async function ensureLibsBuilt() {
    const libPath = join(__dirname, '../ext/lib/linkedom.js');
    if (!existsSync(libPath)) {
        log.info('Libs not found, building...');
        try {
            await buildLibs();
            log.info('Libs built successfully');
        } catch (error) {
            log.error('Failed to build libs:', error);
            throw error;
        }
    }
}

async function main() {
    console.log('Starting Yomitan Server...');
    
    // Initialize persistent IndexedDB first (must be done before importing IndexedDB API)
    console.log('Initializing persistent IndexedDB...');
    await dbManager.loadCache();
    
    // Import IndexedDB API after initialization
    const {indexedDB, IDBKeyRange} = await import('node-indexeddb-lmdb');
    globalThis.indexedDB = indexedDB;
    globalThis.IDBKeyRange = IDBKeyRange;
    console.log('Persistent IndexedDB initialized');
    
    // Ensure libs are built before starting
    console.log('Checking libs...');
    await ensureLibsBuilt();
    console.log('Libs check complete');
    const app = express();
    app.use(express.json());
    
    // Configure multer for file uploads (for dictionary import)
    const upload = multer({storage: multer.memoryStorage()});

    console.log('Creating webExtension...');
    const webExtension = new NodeWebExtension();
    log.configure(webExtension.extensionName);
    
    if (edgeStorage.isIndexedDbAvailable()) {
        console.log(`Edge IndexedDB found at: ${edgeStorage.getIndexedDbPath()}`);
        console.log('Will attempt to sync Edge IndexedDB data after backend initialization');
    }

    console.log('Creating YomitanServer...');
    const server = new YomitanServer(webExtension);
    console.log('Initializing server...');
    await server.initialize();
    console.log('Server initialized');

    // HTTP JSON-RPC endpoint
    app.post('/', async (req, res) => {
        try {
            const response = await server.handleRequest(req.body);
            res.json(response);
        } catch (error) {
            log.error(error);
            res.status(500).json({
                jsonrpc: '2.0',
                id: req.body?.id || null,
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error.message,
                },
            });
        }
    });

    // Dictionary import endpoint (accepts file upload)
    app.post('/import-dictionary', upload.single('dictionary'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    error: 'No file uploaded',
                });
            }

            const archiveContent = req.file.buffer;
            const details = req.body.details ? JSON.parse(req.body.details) : {};

            const response = await server.handleRequest({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'importDictionary',
                params: {
                    archiveContent,
                    details,
                },
            });

            res.json(response);
        } catch (error) {
            log.error(error);
            res.status(500).json({
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error.message,
                },
            });
        }
    });

    // Dictionary collection import endpoint (accepts file path)
    app.post('/import-dictionary-collection', express.json(), async (req, res) => {
        try {
            const {filePath, details} = req.body;

            if (!filePath || typeof filePath !== 'string') {
                return res.status(400).json({
                    error: 'filePath is required',
                });
            }

            const response = await server.handleRequest({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'importDictionaryCollection',
                params: {
                    filePath,
                    details: details || {},
                },
            });

            res.json(response);
        } catch (error) {
            log.error(error);
            res.status(500).json({
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error.message,
                },
            });
        }
    });

    // Health check endpoint
    app.get('/', (req, res) => {
        res.json({
            service: 'yomitan-server',
            version: '1.0.0',
            protocol: 'json-rpc-2.0',
            status: 'running',
        });
    });

    const httpServer = createServer(app);

    // WebSocket JSON-RPC support
    const wss = new WebSocketServer({server: httpServer, path: '/ws'});
    wss.on('connection', (ws) => {
        ws.on('message', async (message) => {
            try {
                const request = JSON.parse(message.toString());
                const response = await server.handleRequest(request);
                ws.send(JSON.stringify(response));
            } catch (error) {
                log.error(error);
                ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: null,
                    error: {
                        code: -32700,
                        message: 'Parse error',
                    },
                }));
            }
        });
    });

    httpServer.listen(PORT, () => {
        console.log(`Yomitan Server listening on port ${PORT}`);
        console.log(`HTTP endpoint: http://localhost:${PORT}/`);
        console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
    });
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});

