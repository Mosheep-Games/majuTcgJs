// engine/state.js — GameState basics and card loader
const fs = require('fs');

function loadCards(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const obj = JSON.parse(raw);
  // return map id -> card
  const map = {};
  for (const c of obj.cards) map[c.id] = c;
  return map;
}

module.exports = { loadCards };
