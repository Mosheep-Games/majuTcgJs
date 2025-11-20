// engine/resolver.js — Engine with priority/response window and stack speeds (Burst/Fast/Slow)
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

    // The main stack: actions awaiting resolution (LIFO)
    // Each action: { effect, params, sourcePlayerId, speed }
    this.stack = [];

    // priority system
    this.priority = {
      active: false,        // is there an open priority window?
      passes: {},           // map playerId -> bool (true = player has passed)
      initiator: null       // playerId who caused window to open (the last player who played an action)
    };

    // death queue (from step 2)
    this.deadQueue = [];

    this.turn = { currentPlayerIndex: 0, phase: null, number: 0, currentPlayerId: null };

    this.keywords = {};
    this.loadKeywords();
  }

  // ===== Boilerplate helpers =====
  nextEntityId(){ return `e${this.entityCounter++}`; }

  addPlayer(){
    const id = uuidv4();
    this.players[id] = { id, deck: [], hand: [], board: [], socket: null, life: 20, currentMana: 0, maxMana: 0 };
    this.playerOrder.push(id);
    return id;
  }

  bindSocket(playerId, ws){
    this.players[playerId].socket = ws;
    this.sockets[playerId] = ws;
  }

  ready(){ return this.playerOrder.length >= 2; }

  log(m){ console.log('[Engine]', m); }

  getPlayer(id){ return this.players[id]; }

  // ===== Targeting / entities =====
  findEntityById(eid) {
    for (const p of Object.values(this.players)) {
      for (const u of p.board) {
        if (u.id === eid) return u;
      }
    }
    return null;
  }

  resolveTarget(spec){
    if (!spec) return null;
    if (spec.type === 'player') return this.players[spec.playerId];
    if (spec.type === 'entity') return this.findEntityById(spec.id);
    if (spec.type === 'board') {
      const p = this.players[spec.playerId];
      return p.board[spec.index || 0];
    }
    return null;
  }

  // ===== Death system (from step 2) =====
  markForDeath(entity){
    if (!this.deadQueue.includes(entity)) {
      this.deadQueue.push(entity);
      this.log(`MarkForDeath: ${entity.id}`);
    }
  }

  processDeaths(){
    if (this.deadQueue.length === 0) return;
    this.log(`Processing deaths: ${this.deadQueue.length} entities`);
    // Step 1: emit OnDie and lastbreath keywords BEFORE removal
    for (const entity of this.deadQueue) {
      const def = this.cards[entity.cardId] || {};
      // Global OnDie
      this.emit('OnDie', { entity, cardDef: def });
      // Keyword lastbreath (if present)
      if ((def.keywords || []).includes('lastbreath')) {
        const mod = this.keywords['lastbreath'];
        if (mod && typeof mod.OnDie === 'function') {
          try { mod.OnDie(this, { unit: entity }); } catch(e){ console.error('lastbreath err', e); }
        }
      }
    }
    // Step 2: remove from boards
    for (const entity of this.deadQueue) {
      for (const p of Object.values(this.players)) {
        const idx = p.board.indexOf(entity);
        if (idx !== -1) {
          p.board.splice(idx, 1);
          this.log(`Removed entity ${entity.id} from board`);
        }
      }
    }
    this.deadQueue = [];
  }

  // ===== Turn / Phase / Mana (from step 1) =====
  start(){
    // setup decks and initial draws
    for (const pid of this.playerOrder) {
      const player = this.players[pid];
      player.deck = Object.keys(this.cards).slice();
      player.deck.sort(()=>Math.random()-0.5);
      for (let i=0;i<3;i++){
        const c = player.deck.shift(); if (c) player.hand.push(c);
      }
      this.sendState(pid);
    }
    this.turn.number = 1;
    this.turn.currentPlayerIndex = 0;
    this.turn.currentPlayerId = this.playerOrder[0];
    this.turn.phase = 'DRAW';
    this.emit('GameStart', {});
    this.handlePhaseStart();
  }

  handlePhaseStart(){
    const phase = this.turn.phase;
    const pid = this.turn.currentPlayerId;
    this.log(`Phase start ${phase} for ${pid}`);
    if (phase === 'DRAW') {
      const p = this.players[pid];
      p.maxMana = Math.min(MAX_MANA, (p.maxMana || 0) + 1);
      p.currentMana = p.maxMana;
      const card = p.deck.shift();
      if (card) p.hand.push(card);
      this.advancePhase();
    }
  }

  advancePhase(){
    const idx = PHASES.indexOf(this.turn.phase);
    if (idx === -1) { this.turn.phase = PHASES[0]; return; }
    if (idx + 1 < PHASES.length) {
      this.turn.phase = PHASES[idx+1];
    } else {
      return this.endTurn();
    }
    this.emit('PhaseChange', { phase: this.turn.phase, playerId: this.turn.currentPlayerId });
    this.handlePhaseStart();
    this.broadcastState();
  }

  endTurn(){
    this.turn.currentPlayerIndex = (this.turn.currentPlayerIndex + 1) % this.playerOrder.length;
    this.turn.currentPlayerId = this.playerOrder[this.turn.currentPlayerIndex];
    this.turn.number += 1;
    this.turn.phase = 'DRAW';
    this.handlePhaseStart();
    this.broadcastState();
  }

  // ===== Priority system =====
  // When a non-burst action is first played, a priority window opens.
  // Players can 'respond' by playing Fast/Slow actions (these go to stack).
  // Players can 'pass'. When all players have passed since the last action, the stack resolves LIFO.

  // Open priority window (called when we push the first non-burst action)
  openPriority(initiatorPlayerId){
    this.priority.active = true;
    this.priority.initiator = initiatorPlayerId;
    // all players initially have not passed
    this.priority.passes = {};
    for (const pid of Object.keys(this.players)) this.priority.passes[pid] = false;
    this.log(`Priority opened by ${initiatorPlayerId}`);
    this.broadcastState();
  }

  // Called when a player passes during priority
  playerPass(playerId){
    if (!this.priority.active) return;
    this.priority.passes[playerId] = true;
    this.log(`Player ${playerId} passed`);
    // if all players have passed -> resolve stack
    const allPassed = Object.values(this.priority.passes).every(v=>v === true);
    if (allPassed) {
      this.log('All players passed — resolving stack');
      this.resolveStackLIFO();
      this.priority.active = false;
      this.priority.initiator = null;
      // after resolution, broadcast state
      this.broadcastState();
    } else {
      this.broadcastState();
    }
  }

  // If any player plays a response while priority.active, reset passes
  resetPasses(){
    for (const pid of Object.keys(this.priority.passes || {})) this.priority.passes[pid] = false;
  }

  // push action to stack; action expects {effect, params, sourcePlayerId, speed}
  pushToStack(action){
    // action.speed should be 'Burst' | 'Fast' | 'Slow'
    const speed = action.speed || 'Slow';
    // If Burst: resolve immediately (no priority)
    if (speed === 'Burst') {
      this.log(`Burst action executed immediately: ${action.effect}`);
      const fn = effects[action.effect];
      if (fn) fn(this, action.params || {});
      // after executing, process deaths
      this.processDeaths();
      // broadcast state
      this.broadcastState();
      return;
    }

    // Else: push to stack (Fast/Slow)
    this.stack.push(action);
    this.log(`Pushed to stack [${speed}] ${action.effect} by ${action.sourcePlayerId || action.params.playerId || 'unknown'}`);
    // If no priority window active, open it
    if (!this.priority.active) {
      const initiator = action.sourcePlayerId || action.params && action.params.playerId;
      this.openPriority(initiator);
    } else {
      // priority active: someone responded; reset passes (everyone must pass again)
      this.resetPasses();
    }
    // we DO NOT resolve yet; waiting for passes
    this.broadcastState();
  }

  // Resolves the stack LIFO until empty. After each effect, process deaths.
  resolveStackLIFO(){
    while(this.stack.length > 0) {
      const action = this.stack.pop(); // LIFO
      const fn = effects[action.effect];
      this.log(`Resolving ${action.effect} from stack (source ${action.sourcePlayerId || action.params && action.params.playerId})`);
      if (fn) fn(this, action.params || {});
      // after each effect, handle deaths
      this.processDeaths();
    }
  }

  // ===== Intents (client -> server actions) =====
  // We accept:
  // - play_card (normal play; server decides speed by card.def.speed or defaults)
  // - play_response (alias for play_card when priority.active)
  // - pass (during priority)
  // - attack
  handleIntent(playerId, intent){
    // Basic guard: for playing in MAIN phase, only current player allowed (but when priority.active we allow both to respond)
    if (this.priority.active) {
      // during priority window we allow responses from any player
      if (intent.type === 'pass') {
        this.playerPass(playerId);
        return;
      }
      // playing a response: treat like play_card but as a response
      if (intent.type === 'play_card') {
        // allow responses if card speed is Fast/Slow; Burst will execute immediately
        const player = this.players[playerId];
        const idx = player.hand.indexOf(intent.cardId);
        if (idx === -1) return;
        const def = this.cards[intent.cardId];
        if (!def) return;
        const cost = Number(def.cost || 0);
        if ((player.currentMana || 0) < cost) {
          this.log(`Player ${playerId} cannot pay cost for response ${intent.cardId}`);
          return;
        }
        // check speed
        const speed = def.speed || 'Slow';
        // consume card and pay mana
        player.hand.splice(idx,1);
        player.currentMana = (player.currentMana||0) - cost;
        // build action
        const action = {
          effect: def.type === 'unit' ? 'Summon' : (def.effects && def.effects[0] && def.effects[0].action) || 'NoOp',
          params: { playerId, ...((def.effects && def.effects[0]) || {}) },
          sourcePlayerId: playerId,
          speed
        };
        // if spell has target bound from intent.targetId, map it
        if (intent.targetId && action.params && action.params.target && action.params.target.type==='entity') {
          action.params.target = { type:'entity', id: intent.targetId };
        }
        // push to stack
        this.pushToStack(action);
        return;
      }
      // allow 'attack' only if current phase COMBAT and player is current player (not responding)
      if (intent.type === 'attack') {
        if (playerId !== this.turn.currentPlayerId) return;
        if (this.turn.phase !== 'COMBAT') return;
        // resolve as before: push two DealDamage actions (these will open a priority window)
        const attacker = this.findEntityById(intent.attackerId);
        const target = this.findEntityById(intent.targetId);
        if (!attacker || !target) return;
        this.pushToStack({ effect: 'DealDamage', params: { value: attacker.attack, target: { type:'entity', id: target.id } }, sourcePlayerId: playerId, speed: 'Slow' });
        this.pushToStack({ effect: 'DealDamage', params: { value: target.attack, target: { type:'entity', id: attacker.id } }, sourcePlayerId: playerId, speed: 'Slow' });
        return;
      }
      // any other intents during priority are ignored
      return;
    }

    // If no priority active, follow normal flow:
    // - enforce phases / turn for main actions
    if (intent.type === 'play_card') {
      // only current player can play outside priority
      if (playerId !== this.turn.currentPlayerId) { this.log('not current player'); return; }
      if (!['MAIN'].includes(this.turn.phase)) { this.log('not in MAIN'); return; }
      const player = this.players[playerId];
      const idx = player.hand.indexOf(intent.cardId);
      if (idx === -1) return;
      const def = this.cards[intent.cardId];
      if (!def) return;
      const cost = Number(def.cost || 0);
      if ((player.currentMana || 0) < cost) {
        this.log(`Player ${playerId} does not have enough mana (${player.currentMana}/${cost}) to play ${intent.cardId}`);
        return;
      }
      // determine speed
      const speed = def.speed || 'Slow';
      // consume card and pay mana
      player.hand.splice(idx,1);
      player.currentMana = (player.currentMana||0) - cost;
      this.log(`Player ${playerId} paid ${cost} mana for ${intent.cardId} -> now ${player.currentMana}/${player.maxMana}`);

      // Build action
      if (def.type === 'unit') {
        const action = { effect: 'Summon', params: { playerId, cardId: intent.cardId }, sourcePlayerId: playerId, speed };
        // If Burst -> execute immediately
        if (speed === 'Burst') {
          this.pushToStack({ ...action, speed: 'Burst' });
        } else {
          this.pushToStack(action);
        }
      } else if (def.type === 'spell') {
        // a spell may have multiple effects; we'll push them as a single "composite" action that the effects handler knows how to run
        for (const ef of def.effects || []) {
          const params = Object.assign({ playerId }, ef);
          if (intent.targetId && ef.target && ef.target.type === 'entity') params.target = { type:'entity', id: intent.targetId };
          const action = { effect: ef.action, params, sourcePlayerId: playerId, speed: def.speed || 'Slow' };
          if (action.speed === 'Burst') {
            // execute immediately
            this.pushToStack({ ...action, speed: 'Burst' });
          } else {
            this.pushToStack(action);
          }
        }
      }
      this.broadcastState();
      return;
    } else if (intent.type === 'attack') {
      // only current player can attack during COMBAT
      if (playerId !== this.turn.currentPlayerId) return;
      if (this.turn.phase !== 'COMBAT') return;
      const attacker = this.findEntityById(intent.attackerId);
      const target = this.findEntityById(intent.targetId);
      if (!attacker || !target) return;
      // attacks are slow by default (open priority)
      this.pushToStack({ effect: 'DealDamage', params: { value: attacker.attack, target: { type:'entity', id: target.id }, source: attacker }, sourcePlayerId: playerId, speed: 'Slow' });
      this.pushToStack({ effect: 'DealDamage', params: { value: target.attack, target: { type:'entity', id: attacker.id }, source: target }, sourcePlayerId: playerId, speed: 'Slow' });
      return;
    } else if (intent.type === 'end_phase') {
      if (playerId !== this.turn.currentPlayerId) return;
      this.advancePhase();
      return;
    } else if (intent.type === 'pass') {
      // passing outside a priority window is a no-op
      return;
    }
  }

  // Broadcast state to all players (includes priority info)
  broadcastState(){
    for (const pid of Object.keys(this.players)) this.sendState(pid);
  }

  sendState(playerId){
    const p = this.players[playerId];
    if (!p || !p.socket) return;
    const dto = {
      type: 'state',
      me: { hand: p.hand, board: p.board, life: p.life, currentMana: p.currentMana, maxMana: p.maxMana },
      opponents: Object.values(this.players).filter(x=>x.id!==playerId).map(o=>({ id: o.id, board: o.board, life: o.life, currentMana: o.currentMana, maxMana: o.maxMana })),
      turn: this.turn,
      priority: {
        active: this.priority.active,
        passes: this.priority.passes
      },
      stackDepth: this.stack.length
    };
    p.socket.send(JSON.stringify(dto));
  }

  // ===== Keywords loader (unchanged) =====
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
}

module.exports = { Engine };
