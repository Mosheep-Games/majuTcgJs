// engine/resolver.js — Engine class with turn system, phases, targeting AND mana system
const fs = require('fs');
const path = require('path');
const { Emitter } = require('./events');
const effects = require('./effects');
const { loadCards } = require('./state');
const { v4: uuidv4 } = require('uuid');

const PHASES = ['DRAW','MAIN','COMBAT','END'];
const MAX_MANA = 10;

class Engine extends Emitter {
  constructor(cardsMap) {
    super();
    this.cards = cardsMap; // id -> card metadata
    this.players = {};
    this.playerOrder = [];
    this.sockets = {};
    this.entityCounter = 1;
    this.stack = [];

    // turn state
    this.turn = { currentPlayerIndex: 0, phase: null, number: 0, currentPlayerId: null };

    // keyword registry
    this.keywords = {};
    this.loadKeywords();
  }

  nextEntityId(){ return `e${this.entityCounter++}`; }

  addPlayer(){
    const id = uuidv4();
    // Initialize mana: start at 0, maxMana will ramp on first turn
    this.players[id] = { id, deck: [], hand: [], board: [], socket: null, life: 20, currentMana: 0, maxMana: 0 };
    this.playerOrder.push(id);
    return id;
  }

  bindSocket(playerId, ws){
    this.players[playerId].socket = ws;
    this.sockets[playerId] = ws;
  }

  ready(){ return this.playerOrder.length >= 2; }

  start(){
    // setup decks (simple: duplicate all cards)
    for (const pid of this.playerOrder) {
      const player = this.players[pid];
      player.deck = Object.keys(this.cards).slice();
      // shuffle
      player.deck.sort(()=>Math.random()-0.5);
      // draw 3 cards
      for (let i=0;i<3;i++){
        const c = player.deck.shift(); if (c) player.hand.push(c);
      }
      this.sendState(player.id);
    }
    // init turn
    this.turn.number = 1;
    this.turn.currentPlayerIndex = 0;
    this.turn.currentPlayerId = this.playerOrder[0];
    this.turn.phase = 'DRAW';
    this.emit('GameStart', {});
    this.emit('TurnStart', { playerId: this.turn.currentPlayerId, phase: this.turn.phase });
    this.handlePhaseStart();
  }

  log(m){ console.log('[Engine]', m); }

  getPlayer(id){ return this.players[id]; }

  // find entity by id across boards
  findEntityById(eid) {
    for (const p of Object.values(this.players)) {
      for (const u of p.board) {
        if (u.id === eid) return u;
      }
    }
    return null;
  }

  resolveTarget(spec){
    // spec can be: {type:'player', playerId:'...'} or {type:'entity', id:'e1'} or {type:'board', playerId:'...', index:0}
    if (!spec) return null;
    if (spec.type === 'player') return this.players[spec.playerId];
    if (spec.type === 'entity') return this.findEntityById(spec.id);
    if (spec.type === 'board') {
      const p = this.players[spec.playerId];
      return p.board[spec.index || 0];
    }
    return null;
  }

  // ---- Turn / Phase management ----
  handlePhaseStart() {
    const phase = this.turn.phase;
    const playerId = this.turn.currentPlayerId;
    this.log(`Phase start: ${phase} for ${playerId}`);

    // WHEN A TURN STARTS (DRAW phase) we also handle mana ramp
    if (phase === 'DRAW') {
      // mana ramp: increase maxMana by 1 up to MAX_MANA, then refill currentMana
      const player = this.getPlayer(playerId);
      if (player) {
        player.maxMana = Math.min(MAX_MANA, (player.maxMana || 0) + 1);
        player.currentMana = player.maxMana;
        this.log(`Player ${playerId} mana set to ${player.currentMana}/${player.maxMana}`);
      }

      // draw a card
      if (player) {
        const card = player.deck.shift();
        if (card) {
          player.hand.push(card);
          this.emit('OnDraw', { playerId, cardId: card });
        }
      }
      // move to MAIN
      this.advancePhase();
    }
    // MAIN: wait for intents (plays)
    // COMBAT: waits for attack intents
    // END: conclude and pass turn
  }

  advancePhase() {
    const idx = PHASES.indexOf(this.turn.phase);
    if (idx === -1) { this.turn.phase = PHASES[0]; return; }
    if (idx + 1 < PHASES.length) {
      this.turn.phase = PHASES[idx+1];
    } else {
      // end turn -> next player
      this.endTurn();
      return;
    }
    this.emit('PhaseChange', { phase: this.turn.phase, playerId: this.turn.currentPlayerId });
    this.handlePhaseStart();
    // broadcast state
    for (const pid of Object.keys(this.players)) this.sendState(pid);
  }

  endTurn() {
    this.log(`Ending turn ${this.turn.number} for ${this.turn.currentPlayerId}`);
    // rotate player
    this.turn.currentPlayerIndex = (this.turn.currentPlayerIndex + 1) % this.playerOrder.length;
    this.turn.currentPlayerId = this.playerOrder[this.turn.currentPlayerIndex];
    this.turn.number += 1;
    this.turn.phase = 'DRAW';
    this.emit('TurnChange', { playerId: this.turn.currentPlayerId, number: this.turn.number });
    this.handlePhaseStart();
    for (const pid of Object.keys(this.players)) this.sendState(pid);
  }

  // ---- Stack / resolution ----
  pushToStack(action){ this.stack.push(action); this.resolveStack(); }

  resolveStack(){
    while(this.stack.length>0){
      const action = this.stack.shift();
      // action: {effect:'DealDamage', params:{...}}
      const fn = effects[action.effect];
      if (fn) fn(this, action.params);
    }
    // after resolution, broadcast whole state (MVP)
    for (const pid of Object.keys(this.players)) this.sendState(pid);
  }

  // ---- Intents ----
  handleIntent(playerId, intent){
    // guard: only current player can issue intents in MAIN or COMBAT depending on action
    if (playerId !== this.turn.currentPlayerId) {
      this.log(`Ignoring intent from non-active player ${playerId}`);
      return;
    }
    // intents: {type:'play_card', cardId, target?}
    if (intent.type === 'play_card'){
      if (!['MAIN'].includes(this.turn.phase)) { this.log('Cannot play cards outside MAIN phase'); return; }
      const player = this.players[playerId];
      const idx = player.hand.indexOf(intent.cardId);
      if (idx === -1) return; // not in hand
      const def = this.cards[intent.cardId];
      if (!def) return;

      // --- MANA CHECK ---
      const cost = (def.cost != null) ? Number(def.cost) : 0;
      if ((player.currentMana || 0) < cost) {
        this.log(`Player ${playerId} does not have enough mana (${player.currentMana}/${cost}) to play ${intent.cardId}`);
        return; // ignore the intent
      }

      // consume card from hand and subtract mana
      player.hand.splice(idx,1);
      player.currentMana = (player.currentMana || 0) - cost;
      this.log(`Player ${playerId} paid ${cost} mana for ${intent.cardId} -> now ${player.currentMana}/${player.maxMana}`);

      if (def.type === 'unit'){
        this.pushToStack({ effect: 'Summon', params: { playerId, cardId: intent.cardId } });
      } else if (def.type === 'spell'){
        for (const ef of def.effects||[]){ 
          // attach source info if needed
          const params = Object.assign({ playerId }, ef);
          // if intent.targetId present and ef.target.type==='entity' we map it
          if (intent.targetId && ef.target && ef.target.type==='entity') params.target = { type:'entity', id: intent.targetId };
          this.pushToStack({ effect: ef.action, params });
        }
      }
      this.sendState(playerId);
    } else if (intent.type === 'attack'){
      if (!['COMBAT'].includes(this.turn.phase)) { this.log('Cannot attack outside COMBAT phase'); return; }
      // intent: { type:'attack', attackerId, targetId }
      const attacker = this.findEntityById(intent.attackerId);
      const target = this.findEntityById(intent.targetId);
      if (!attacker || !target) return;
      // simple attack resolution: both deal damage to each other
      this.pushToStack({ effect: 'DealDamage', params: { value: attacker.attack, target: { type:'entity', id: target.id }, source: attacker } });
      this.pushToStack({ effect: 'DealDamage', params: { value: target.attack, target: { type:'entity', id: attacker.id }, source: target } });
    } else if (intent.type === 'end_phase') {
      // player requests to advance phase
      this.advancePhase();
    }
  }

  sendState(playerId){
    const p = this.players[playerId];
    if (!p || !p.socket) return;
    const dto = {
      type: 'state',
      me: { hand: p.hand, board: p.board, life: p.life, currentMana: p.currentMana, maxMana: p.maxMana },
      opponents: Object.values(this.players).filter(x=>x.id!==playerId).map(o=>({ id: o.id, board: o.board, life: o.life, currentMana: o.currentMana, maxMana: o.maxMana })),
      turn: this.turn
    };
    p.socket.send(JSON.stringify(dto));
  }

  // ---- Keywords system ----
  loadKeywords() {
    try {
      const kwDir = path.resolve(__dirname, 'keywords');
      if (!fs.existsSync(kwDir)) return;
      const files = fs.readdirSync(kwDir).filter(f=>f.endsWith('.js'));
      for (const f of files) {
        const name = f.replace('.js','');
        try {
          this.keywords[name] = require(path.join(kwDir, f));
          this.log(`Loaded keyword ${name}`);
        } catch (e) {
          console.error('Failed to load keyword', f, e);
        }
      }
    } catch (e) {
      console.error('loadKeywords error', e);
    }
  }

  applyKeywordEvent(eventName, payload) {
    // iterate all units on board and call keyword handlers
    for (const p of Object.values(this.players)) {
      for (const u of p.board) {
        const def = this.cards[u.cardId] || {};
        for (const kw of (def.keywords||[])) {
          const mod = this.keywords[kw];
          if (mod && typeof mod[eventName] === 'function') {
            try {
              mod[eventName](this, { unit: u, payload });
            } catch (e) {
              console.error('keyword handler error', kw, eventName, e);
            }
          }
        }
      }
    }
  }

}

module.exports = { Engine };
