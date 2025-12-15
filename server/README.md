# Yomitan Server

A Node.js server that exposes Yomitan's parsing APIs via JSON-RPC 2.0 protocol. This server reuses Yomitan's existing parsing logic, deinflection, and dictionary handling.

## Features

- **Full Yomitan Integration** - Reuses all existing parsing logic, deinflection, and dictionary APIs
- **JSON-RPC 2.0 Protocol** - Standard protocol for language-server-like communication
- **HTTP & WebSocket Support** - Both HTTP POST and WebSocket connections
- **Complete Feature Set** - All Yomitan features including:
  - Text parsing with scanning parser
  - Term lookup with deinflection
  - Kanji lookup
  - Caching
  - Furigana distribution
  - Dictionary metadata

## Installation

```bash
cd server
npm install
```

## Setup

Before running the server, you need to build the library files:

```bash
# From the yomitan root directory
npm run build:libs
```

Or the server will automatically build them on first start (may take a moment).

**Note:** You also need to have Yomitan dictionaries imported. The server uses the same IndexedDB database as the extension, so dictionaries need to be loaded through the extension first, or you can import them programmatically.

## Usage

### Start the Server

```bash
npm start
```

Or with auto-reload for development:

```bash
npm run dev
```

The server will start on port 8080 by default. Set the `PORT` environment variable to change it.

### Test the Server

```bash
npm test
```

This will run the example client that tests all endpoints.

### Environment Variables

- `PORT` - Server port (default: 8080)

## API

### Endpoints

- `POST /` - HTTP JSON-RPC endpoint
- `GET /` - Health check endpoint
- `WS /ws` - WebSocket JSON-RPC endpoint

### Methods

#### `parseText`

Parses Japanese text and returns segmented terms with readings.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "parseText",
  "params": {
    "text": "こんにちは、日本語を勉強しています",
    "scanLength": 16,
    "useInternalParser": true,
    "useMecabParser": false,
    "optionsContext": {
      "index": 0,
      "profile": "default"
    }
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": [
    {
      "id": "scan",
      "source": "scanning-parser",
      "dictionary": null,
      "index": 0,
      "content": [
        [
          {
            "text": "こんにちは",
            "reading": "こんにちは",
            "headwords": [...]
          },
          {
            "text": "、",
            "reading": ""
          },
          {
            "text": "日本語",
            "reading": "にほんご",
            "headwords": [...]
          }
        ]
      ]
    }
  ]
}
```

#### `findTerms`

Finds dictionary entries for a given term.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "findTerms",
  "params": {
    "text": "日本語",
    "details": {
      "matchType": "exact",
      "deinflect": true
    },
    "optionsContext": {
      "index": 0,
      "profile": "default"
    }
  }
}
```

#### `findKanji`

Finds kanji information for given characters.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "findKanji",
  "params": {
    "text": "日本",
    "optionsContext": {
      "index": 0,
      "profile": "default"
    }
  }
}
```

#### `initialize`

Initializes the server connection.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "initialize"
}
```

## Example Usage

### HTTP Example

```bash
curl -X POST http://localhost:8080/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "parseText",
    "params": {
      "text": "こんにちは"
    }
  }'
```

### WebSocket Example

```javascript
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080/ws");

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "parseText",
      params: {
        text: "こんにちは",
      },
    }),
  );
});

ws.on("message", (data) => {
  const response = JSON.parse(data.toString());
  console.log(response);
});
```

## Architecture

The server consists of:

1. **NodeWebExtension** - Minimal WebExtension implementation for Node.js (no browser APIs)
2. **YomitanServer** - Wraps Yomitan's Backend class and exposes JSON-RPC methods
3. **Express Server** - HTTP server with JSON-RPC endpoint
4. **WebSocket Server** - WebSocket support for real-time communication

## Requirements

- Node.js >= 22.0.0
- Yomitan dictionaries loaded in the extension
- Same dependencies as Yomitan extension

## License

Same as Yomitan (GPL-3.0-or-later)
