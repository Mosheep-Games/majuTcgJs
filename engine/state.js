// engine/state.js — gerenciamento de zones, carregador de cards, utilitários de deck
const fs = require('fs');
const path = require('path');

function loadCards(pathToFile) {
  const raw = fs.readFileSync(pathToFile, 'utf8');
  const obj = JSON.parse(raw);
  // support two shapes: { cards: [...] } or map of id -> card
  if (Array.isArray(obj.cards)) {
    const map = {};
    for (const c of obj.cards) map[c.id] = c;
    return map;
  }
  return obj;
}

function shuffleArray(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function createPlayerState(id) {
  return {
    id,
    deck: [],
    hand: [],
    board: [],
    graveyard: [],
    exile: [],
    socket: null,
    life: 20,
    currentMana: 0,
    maxMana: 0
  };
}

function drawFromDeck(player, n = 1) {
  const drawn = [];
  for (let i = 0; i < n; i++) {
    if (player.deck.length === 0) break;
    drawn.push(player.deck.shift());
  }
  return drawn;
}

// Persistence helpers (debug / replay)
function saveGame(pathOut, state) {
  fs.writeFileSync(pathOut, JSON.stringify(state, null, 2), 'utf8');
}

function loadGame(pathIn) {
  const raw = fs.readFileSync(pathIn, 'utf8');
  return JSON.parse(raw);
}

module.exports = { loadCards, shuffleArray, createPlayerState, drawFromDeck, saveGame, loadGame };
