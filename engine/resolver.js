// engine/resolver.js — resolver com zones, deckbuilding, mulligan e persistência
const fs = require('fs');
const path = require('path');
const { Emitter } = require('./events');
const effects = require('./effects');
const { loadCards, shuffleArray, createPlayerState, drawFromDeck, saveGame, loadGame } = require('./state');
const { v4: uuidv4 } = require('uuid');

const PHASES = ['DRAW','MAIN','COMBAT','END'];
const MAX_MANA = 10;

class Engine extends Emitter {
  constructor(cardsMap) {
    super();
    this.cards = cardsMap || {};
    this.players = {};
    this.playerOrder = [];
    this.sockets = {};
    this.entityCounter = 1;

    this.stack = [];
    this.priority = { active: false, passes: {}, initiator: null };
    this.deadQueue = [];

    this.turn = { currentPlayerIndex: 0, phase: null, number: 0, currentPlayerId: null };

    // persisted metadata (optional)
    this.meta = { createdAt: Date.now() };

    this.keywords = {};
    this.loadKeywords();
  }

  nextEntityId(){ return `e${this.entityCounter++}`; }

  addPlayer(){
    const id = uuidv4();
    const p = createPlayerState(id);
    this.players[id] = p;
    this.playerOrder.push(id);
    return id;
  }

  bindSocket(playerId, ws){
    this.players[playerId].socket = ws;
    this.sockets[playerId] = ws;
  }

  ready(){ return this.playerOrder.length >= 2; }

  // ================= ZONES helpers =================
  setDeckForPlayer(playerId, deckArray) {
    const p = this.players[playerId];
    if (!p) return false;
    p.deck = deckArray.slice();
    // basic validation: ensure items exist in card DB
    p.deck = p.deck.filter(cid => this.cards[cid]);
    // shuffle
    p.deck.sort(()=>Math.random() - 0.5);
    this.log(`Deck set for ${playerId} (${p.deck.length} cards)`);
    return true;
  }

  // mulligan simple approach:
  // player sends intent: { type:'mulligan', keep: [cardId,...] }
  // We return unkept cards to deck, shuffle, draw same count, keep one fewer? For simplicity we'll implement:
  // player chooses KEEP list; non-kept are returned to deck and shuffled; then draw back to original hand size (3) (no further reductions).
  applyMulligan(playerId, keepList = []) {
    const p = this.players[playerId];
    if (!p) return;
    const initialHand = p.hand.slice();
    // compute which to return
    const toReturn = initialHand.filter(cid => !keepList.includes(cid));
    // remove returns from hand
    p.hand = initialHand.filter(cid => keepList.includes(cid));
    // return to deck and shuffle
    p.deck.push(...toReturn);
    p.deck.sort(()=>Math.random()-0.5);
    // draw up to original hand size (simple: 3)
    while (p.hand.length < 3 && p.deck.length > 0) {
      p.hand.push(p.deck.shift());
    }
    this.log(`Mulligan for ${playerId}: kept ${p.hand.length} cards`);
  }

  // ================= Death system (moves to graveyard) =================
  markForDeath(entity){
    if (!entity) return;
    if (!this.deadQueue.includes(entity)) {
      this.deadQueue.push(entity);
      this.log(`MarkForDeath: ${entity.id}`);
    }
  }

  processDeaths(){
    if (this.deadQueue.length === 0) return;
    this.log(`Processing deaths: ${this.deadQueue.length}`);
    // Fire OnDie and lastbreath (keywords may push new actions)
    for (const entity of this.deadQueue) {
      const def = this.cards[entity.cardId] || {};
      this.emit('OnDie', { entity, cardDef: def });
      if ((def.keywords || []).includes('lastbreath')) {
        const mod = this.keywords['lastbreath'];
        if (mod && typeof mod.OnDie === 'function') {
          try { mod.OnDie(this, { unit: entity }); } catch (e) { console.error('lastbreath', e); }
        }
      }
    }
    // Remove from boards and move to owner's graveyard (if owner exists)
    for (const entity of this.deadQueue) {
      for (const p of Object.values(this.players)) {
        const idx = p.board.findIndex(u => u.id === entity.id);
        if (idx !== -1) {
          const removed = p.board.splice(idx,1)[0];
          p.graveyard.push(removed.cardId || removed);
          this.log(`Moved ${removed.id} (${removed.cardId}) to graveyard of ${p.id}`);
        }
      }
    }
    this.deadQueue = [];
  }

  // ================= Stack / Priority (keeps previous behavior) =================
  openPriority(initiatorPlayerId){
    this.priority.active = true;
    this.priority.initiator = initiatorPlayerId;
    this.priority.passes = {};
    for (const pid of Object.keys(this.players)) this.priority.passes[pid] = false;
    this.log(`Priority opened by ${initiatorPlayerId}`);
    this.broadcastState();
  }

  playerPass(playerId){
    if (!this.priority.active) return;
    this.priority.passes[playerId] = true;
    this.log(`Player ${playerId} passed`);
    const allPassed = Object.values(this.priority.passes).every(v=>v === true);
    if (allPassed) {
      this.log('All players passed — resolving stack');
      this.resolveStackLIFO();
      this.priority.active = false;
      this.priority.initiator = null;
      this.broadcastState();
    } else this.broadcastState();
  }

  resetPasses(){
    for (const pid of Object.keys(this.priority.passes || {})) this.priority.passes[pid] = false;
  }

  pushToStack(action){
    const speed = action.speed || 'Slow';
    if (speed === 'Burst') {
      const fn = effects[action.effect];
      if (fn) fn(this, action.params || {});
      this.processDeaths();
      this.broadcastState();
      return;
    }
    this.stack.push(action);
    if (!this.priority.active) {
      const initiator = action.sourcePlayerId || (action.params && action.params.playerId);
      this.openPriority(initiator);
    } else {
      this.resetPasses();
    }
    this.broadcastState();
  }

  resolveStackLIFO(){
    while(this.stack.length > 0) {
      const a = this.stack.pop();
      const fn = effects[a.effect];
      if (fn) fn(this, a.params || {});
      this.processDeaths();
    }
  }

  // ================= Intents (incl. set_deck, mulligan) =================
  handleIntent(playerId, msg) {
    // differentiate top-level messages (some clients send {type:'create_match'} or {type:'intent', intent:...})
    const intent = msg.intent || msg;

    // Deck set endpoint (allow before match start or while)
    if (intent.type === 'set_deck') {
      const deckList = intent.deck || [];
      const ok = this.setDeckForPlayer(playerId, deckList);
      if (ok) this.sendState(playerId);
      return;
    }

    // Mulligan (player sends keep list)
    if (intent.type === 'mulligan') {
      const keep = intent.keep || [];
      this.applyMulligan(playerId, keep);
      this.sendState(playerId);
      return;
    }

    // priority active branch (respond/pass)
    if (this.priority.active) {
      if (intent.type === 'pass') { this.playerPass(playerId); return; }
      if (intent.type === 'play_card') {
        // allow responses from either player (cost must be paid)
        const player = this.players[playerId];
        const idx = player.hand.indexOf(intent.cardId);
        if (idx === -1) return;
        const def = this.cards[intent.cardId];
        if (!def) return;
        const cost = Number(def.cost || 0);
        if ((player.currentMana || 0) < cost) return;
        const speed = def.speed || 'Slow';
        player.hand.splice(idx,1);
        player.currentMana -= cost;
        if (def.type === 'unit') this.pushToStack({ effect:'Summon', params:{ playerId, cardId: intent.cardId }, sourcePlayerId: playerId, speed });
        else if (def.type === 'spell') {
          for (const ef of def.effects || []) {
            const params = Object.assign({ playerId }, ef);
            if (intent.targetId && ef.target && ef.target.type === 'entity') params.target = { type:'entity', id: intent.targetId };
            this.pushToStack({ effect: ef.action, params, sourcePlayerId: playerId, speed: def.speed || 'Slow' });
          }
        }
        return;
      }
      if (intent.type === 'attack') {
        if (playerId !== this.turn.currentPlayerId) return;
        if (this.turn.phase !== 'COMBAT') return;
        const attacker = this.findEntityById(intent.attackerId);
        const target = this.findEntityById(intent.targetId);
        if (!attacker || !target) return;
        // OnAttack event -> allow keywords to intercept
        const payload = { attacker, target, handled: false, sourcePlayerId: playerId };
        this.emit('OnAttack', payload);
        if (!payload.handled) {
          this.pushToStack({ effect:'DealDamage', params:{ value: attacker.attack, target: { type:'entity', id: target.id }, source: attacker }, sourcePlayerId: playerId, speed: 'Slow' });
          this.pushToStack({ effect:'DealDamage', params:{ value: target.attack, target: { type:'entity', id: attacker.id }, source: target }, sourcePlayerId: playerId, speed: 'Slow' });
        } else {
          this.processDeaths();
        }
        return;
      }
      return;
    }

    // No priority open: normal flow (play, attack, end_phase)
    if (intent.type === 'play_card') {
      if (playerId !== this.turn.currentPlayerId) return;
      if (!['MAIN'].includes(this.turn.phase)) return;
      const player = this.players[playerId];
      const idx = player.hand.indexOf(intent.cardId);
      if (idx === -1) return;
      const def = this.cards[intent.cardId];
      if (!def) return;
      const cost = Number(def.cost || 0);
      if ((player.currentMana || 0) < cost) return;
      const speed = def.speed || 'Slow';
      player.hand.splice(idx,1);
      player.currentMana -= cost;
      // For units: summon (entity on board)
      if (def.type === 'unit') {
        const action = { effect: 'Summon', params: { playerId, cardId: intent.cardId }, sourcePlayerId: playerId, speed };
        if (speed === 'Burst') this.pushToStack({ ...action, speed: 'Burst' });
        else this.pushToStack(action);
      } else if (def.type === 'spell') {
        if (def.script) {
          // scripts handled by script_runtime if present (it should push actions)
          const { parse } = require('./script_parser');
          const { executeScript } = require('./script_runtime');
          try {
            const ast = parse(def.script);
            executeScript(this, playerId, ast, intent.targetId);
          } catch (e) {
            this.log('Script parse error: ' + e);
          }
        }
        for (const ef of def.effects || []) {
          const params = Object.assign({ playerId }, ef);
          if (intent.targetId && ef.target && ef.target.type === 'entity') params.target = { type:'entity', id: intent.targetId };
          const action = { effect: ef.action, params, sourcePlayerId: playerId, speed: def.speed || 'Slow' };
          if (action.speed === 'Burst') this.pushToStack({ ...action, speed: 'Burst' });
          else this.pushToStack(action);
        }
      }
      this.broadcastState();
      return;
    }

    if (intent.type === 'attack') {
      if (playerId !== this.turn.currentPlayerId) return;
      if (this.turn.phase !== 'COMBAT') return;
      const attacker = this.findEntityById(intent.attackerId);
      const target = this.findEntityById(intent.targetId);
      if (!attacker || !target) return;
      const payload = { attacker, target, handled: false, sourcePlayerId: playerId };
      this.emit('OnAttack', payload);
      if (!payload.handled) {
        this.pushToStack({ effect:'DealDamage', params:{ value: attacker.attack, target: { type:'entity', id: target.id }, source: attacker }, sourcePlayerId: playerId, speed: 'Slow' });
        this.pushToStack({ effect:'DealDamage', params:{ value: target.attack, target: { type:'entity', id: attacker.id }, source: target }, sourcePlayerId: playerId, speed: 'Slow' });
      } else this.processDeaths();
      return;
    }

    if (intent.type === 'end_phase') {
      if (playerId !== this.turn.currentPlayerId) return;
      this.advancePhase();
      return;
    }
  }

  // helper find entity across boards
  findEntityById(eid) {
    for (const p of Object.values(this.players)) {
      for (const u of p.board) if (u.id === eid) return u;
    }
    return null;
  }

  // ================= Turn / Phase / Draw using zones =================
  start() {
    // If decks are empty for players, auto-fill with all card IDs (fallback)
    for (const pid of this.playerOrder) {
      const p = this.players[pid];
      if (!p.deck || p.deck.length === 0) {
        p.deck = Object.keys(this.cards).slice();
        p.deck.sort(()=>Math.random()-0.5);
      }
      // draw 3
      for (let i=0;i<3;i++) {
        if (p.deck.length === 0) break;
        p.hand.push(p.deck.shift());
      }
      this.sendState(pid);
    }

    this.turn.number = 1;
    this.turn.currentPlayerIndex = 0;
    this.turn.currentPlayerId = this.playerOrder[0];
    this.turn.phase = 'DRAW';
    this.handlePhaseStart();
  }

  handlePhaseStart() {
    const phase = this.turn.phase;
    const pid = this.turn.currentPlayerId;
    if (phase === 'DRAW') {
      const p = this.players[pid];
      p.maxMana = Math.min(MAX_MANA, (p.maxMana || 0) + 1);
      p.currentMana = p.maxMana;
      // draw 1
      if (p.deck.length > 0) p.hand.push(p.deck.shift());
      this.advancePhase();
      this.broadcastState();
    }
  }

  advancePhase() {
    const idx = PHASES.indexOf(this.turn.phase);
    if (idx === -1) { this.turn.phase = PHASES[0]; return; }
    if (idx + 1 < PHASES.length) this.turn.phase = PHASES[idx+1];
    else return this.endTurn();
    this.handlePhaseStart();
    this.broadcastState();
  }

  endTurn() {
    this.turn.currentPlayerIndex = (this.turn.currentPlayerIndex + 1) % this.playerOrder.length;
    this.turn.currentPlayerId = this.playerOrder[this.turn.currentPlayerIndex];
    this.turn.number++;
    this.turn.phase = 'DRAW';
    this.handlePhaseStart();
    this.broadcastState();
  }

  // ================= Send / Broadcast =================
  broadcastState() {
    for (const pid of Object.keys(this.players)) this.sendState(pid);
  }

  sendState(pid) {
    const p = this.players[pid];
    if (!p || !p.socket) return;
    const dto = {
      type: 'state',
      me: { hand: p.hand, board: p.board, graveyard: p.graveyard, exile: p.exile, deckCount: p.deck.length, life: p.life, currentMana: p.currentMana, maxMana: p.maxMana },
      opponents: Object.values(this.players).filter(x=>x.id!==pid).map(o=>({ id: o.id, board: o.board, graveyardCount: o.graveyard.length, deckCount: o.deck.length, life: o.life })),
      turn: this.turn,
      priority: { active: this.priority.active, passes: this.priority.passes },
      stackDepth: this.stack.length
    };
    p.socket.send(JSON.stringify(dto));
  }

  // ================= Persistence (debug/replay) =================
  saveGameTo(pathOut) {
    const state = {
      players: this.players,
      stack: this.stack,
      turn: this.turn,
      meta: this.meta
    };
    saveGame(pathOut, state);
  }

  loadGameFrom(pathIn) {
    const obj = loadGame(pathIn);
    if (!obj) return;
    // naive restore (for debug only)
    this.players = obj.players;
    this.stack = obj.stack || [];
    this.turn = obj.turn || this.turn;
    this.log(`Loaded saved game ${pathIn}`);
  }

  // Keywords loader
  loadKeywords() {
    try {
      const kwDir = path.join(__dirname, 'keywords');
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

}

module.exports = { Engine };
