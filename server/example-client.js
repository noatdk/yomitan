/*
 * Example client for Yomitan Server
 */

import WebSocket from 'ws';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8080';
const WS_URL = process.env.WS_URL || 'ws://localhost:8080/ws';

async function httpRequest(method, params) {
    const response = await fetch(SERVER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params,
        }),
    });

    const data = await response.json();
    return data;
}

async function testInitialize() {
    console.log('\n=== Testing Initialize ===');
    const result = await httpRequest('initialize', {});
    console.log(JSON.stringify(result, null, 2));
}

async function testParseText() {
    console.log('\n=== Testing Parse Text ===');
    const result = await httpRequest('parseText', {
        text: 'こんにちは、日本語を勉強しています',
        scanLength: 16,
        useInternalParser: true,
        useMecabParser: false,
        optionsContext: {
            index: 0,
            profile: 'default',
        },
    });
    console.log(JSON.stringify(result, null, 2));
}

async function testFindTerms() {
    console.log('\n=== Testing Find Terms ===');
    const result = await httpRequest('findTerms', {
        text: '日本語',
        details: {
            matchType: 'exact',
            deinflect: true,
        },
        optionsContext: {
            index: 0,
            profile: 'default',
        },
    });
    console.log(JSON.stringify(result, null, 2));
}

async function testFindKanji() {
    console.log('\n=== Testing Find Kanji ===');
    const result = await httpRequest('findKanji', {
        text: '日本',
        optionsContext: {
            index: 0,
            profile: 'default',
        },
    });
    console.log(JSON.stringify(result, null, 2));
}

async function testWebSocket() {
    console.log('\n=== Testing WebSocket ===');
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);

        ws.on('open', () => {
            ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'parseText',
                params: {
                    text: 'こんにちは',
                    scanLength: 16,
                },
            }));
        });

        ws.on('message', (data) => {
            const response = JSON.parse(data.toString());
            console.log('WebSocket Response:');
            console.log(JSON.stringify(response, null, 2));
            ws.close();
            resolve();
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            reject(error);
        });
    });
}

async function testGetDictionaryInfo() {
    console.log('\n=== Testing Get Dictionary Info ===');
    const result = await httpRequest('getDictionaryInfo', {});
    console.log(JSON.stringify(result, null, 2));
}

async function main() {
    try {
        await testInitialize();
        await testParseText();
        await testFindTerms();
        await testFindKanji();
        await testGetDictionaryInfo();
        await testWebSocket();
        console.log('\n✅ All tests completed!');
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

void main();

