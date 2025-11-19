// server.js — minimal server with WebSocket + static host
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Engine } = require('./engine/resolver');
const { loadCards } = require('./engine/state');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

// load card data
const cards = loadCards('./data/cards/example_set.json');

// one engine per match (MVP: single match between two connected players)
let match = null;

wss.on('connection', (ws) => {
  console.log('client connected');

  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch (e) { return; }

    if (data.type === 'create_match') {
      if (!match) match = new Engine(cards);
      const playerId = match.addPlayer();
      ws.playerId = playerId;
      match.bindSocket(playerId, ws);
      ws.send(JSON.stringify({ type: 'joined', playerId }));
      if (match.ready()) match.start();
    }

    if (data.type === 'intent' && match) {
      // forward intent to engine
      match.handleIntent(ws.playerId, data.intent);
    }
  });

  ws.on('close', () => console.log('client disconnected'));
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
