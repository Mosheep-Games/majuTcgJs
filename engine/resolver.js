// engine/resolver.js — Engine with priority/response window and keyword-aware attacks
const fs = require('fs');
const path = require('path');
const { Emitter } = require('./events');
const effects = require('./effects');
const { v4: uuidv4 } = require('uuid');

const PHASES = ['DRAW','MAIN','COMBAT','END'];
const MAX_MANA = 10;

class Engine extends Emitter {
  constructor(cardsMap) {
    super();
    this.cards = cardsMap || {}; // id -> card metadata
    this.players = {};
    this.playerOrder = [];
    this.sockets = {};
    this.entityCounter = 1;

    // stack & priority
    this.stack = [];
    this.priority = { active: false, passes: {}, initiator: null };

    // death queue
    this.deadQueue = [];

    this.turn = { currentPlayerIndex: 0, phase: null, number: 0, currentPlayerId: null };

    this.keywords = {};
    this.loadKeywords();
  }

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

  // ===== Entities/targeting =====
  findEntityById(eid) {
    for (const p of Object.values(this.players)) {
      for (const u of p.board) if (u.id === eid) return u;
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

  // ===== Death system =====
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

    // 1) Fire OnDie and lastbreath (keywords can push effects to stack)
    for (const entity of this.deadQueue) {
      const def = this.cards[entity.cardId] || {};
      this.emit('OnDie', { entity, cardDef: def });

      // keyword lastbreath hook (if module exists)
      if ((def.keywords || []).includes('lastbreath')) {
        const mod = this.keywords['lastbreath'];
        if (mod && typeof mod.OnDie === 'function') {
          try { mod.OnDie(this, { unit: entity }); } catch (e) { console.error('lastbreath error', e); }
        }
      }
    }

    // 2) Remove from boards
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

  // ===== Turn / Phase / Mana =====
  start(){
    // setup decks & initial hands
    for (const pid of this.playerOrder) {
      const player = this.players[pid];
      player.deck = Object.keys(this.cards).slice();
      player.deck.sort(()=>Math.random()-0.5);
      for (let i=0;i<3;i++){ const c = player.deck.shift(); if (c) player.hand.push(c); }
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
      if (card) { p.hand.push(card); this.emit('OnDraw', { playerId: pid, cardId: card }); }
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
    } else {
      this.broadcastState();
    }
  }

  resetPasses(){
    for (const pid of Object.keys(this.priority.passes || {})) this.priority.passes[pid] = false;
  }

  // push action to stack: { effect, params, sourcePlayerId, speed }
  pushToStack(action){
    const speed = action.speed || 'Slow';
    if (speed === 'Burst') {
      this.log(`Burst executing: ${action.effect}`);
      const fn = effects[action.effect];
      if (fn) fn(this, action.params || {});
      this.processDeaths();
      this.broadcastState();
      return;
    }
    this.stack.push(action);
    this.log(`Pushed to stack [${speed}] ${action.effect}`);
    if (!this.priority.active) {
      const initiator = action.sourcePlayerId || (action.params && action.params.playerId);
      this.openPriority(initiator);
    } else {
      this.resetPasses();
    }
    this.broadcastState();
  }

  resolveStackLIFO(){
    while(this.stack.length > 0){
      const action = this.stack.pop();
      this.log(`Resolving ${action.effect} from stack`);
      const fn = effects[action.effect];
      if (fn) fn(this, action.params || {});
      this.processDeaths();
    }
  }

  // ===== Intents =====
  handleIntent(playerId, intent){
    // If priority active -> allow responses (or pass)
    if (this.priority.active) {
      if (intent.type === 'pass') { this.playerPass(playerId); return; }

      if (intent.type === 'play_card') {
        const player = this.players[playerId];
        const idx = player.hand.indexOf(intent.cardId);
        if (idx === -1) return;
        const def = this.cards[intent.cardId];
        if (!def) return;
        const cost = Number(def.cost || 0);
        if ((player.currentMana || 0) < cost) { this.log(`Player ${playerId} can't pay response cost`); return; }
        const speed = def.speed || 'Slow';
        player.hand.splice(idx,1);
        player.currentMana -= cost;
        // build action — for unit-type we Summon, for spell we push its first effect (simple)
        if (def.type === 'unit') {
          const action = { effect: 'Summon', params: { playerId, cardId: intent.cardId }, sourcePlayerId: playerId, speed };
          this.pushToStack(action);
        } else if (def.type === 'spell') {
          for (const ef of def.effects || []) {
            const params = Object.assign({ playerId }, ef);
            if (intent.targetId && ef.target && ef.target.type === 'entity') params.target = { type:'entity', id: intent.targetId };
            const action = { effect: ef.action, params, sourcePlayerId: playerId, speed: def.speed || 'Slow' };
            this.pushToStack(action);
          }
        }
        return;
      }

      // allow attack only from current player and if in COMBAT
      if (intent.type === 'attack') {
        if (playerId !== this.turn.currentPlayerId) return;
        if (this.turn.phase !== 'COMBAT') return;
        // build payload and fire OnAttack to allow keywords to handle it
        const attacker = this.findEntityById(intent.attackerId);
        const target = this.findEntityById(intent.targetId);
        if (!attacker || !target) return;
        const payload = { attacker, target, handled: false, sourcePlayerId: playerId };
        // emit to keywords/listeners
        this.emit('OnAttack', payload);
        // if payload.handled === true, keywords handled attack (no default push)
        if (payload.handled) {
          this.log('Attack handled by keyword(s)');
          // processDeaths in case keywords queued things
          this.processDeaths();
          return;
        }
        // default: push two DealDamage actions (will open priority)
        this.pushToStack({ effect: 'DealDamage', params: { value: attacker.attack, target: { type:'entity', id: target.id }, source: attacker }, sourcePlayerId: playerId, speed: 'Slow' });
        this.pushToStack({ effect: 'DealDamage', params: { value: target.attack, target: { type:'entity', id: attacker.id }, source: target }, sourcePlayerId: playerId, speed: 'Slow' });
        return;
      }

      // ignore other intents during priority
      return;
    }

    // No priority active: normal flow
    if (intent.type === 'play_card') {
      if (playerId !== this.turn.currentPlayerId) return;
      if (!['MAIN'].includes(this.turn.phase)) return;
      const player = this.players[playerId];
      const idx = player.hand.indexOf(intent.cardId);
      if (idx === -1) return;
      const def = this.cards[intent.cardId];
      if (!def) return;
      const cost = Number(def.cost || 0);
      if ((player.currentMana || 0) < cost) { this.log(`not enough mana`); return; }
      const speed = def.speed || 'Slow';
      player.hand.splice(idx,1);
      player.currentMana -= cost;
      if (def.type === 'unit') {
        const action = { effect: 'Summon', params: { playerId, cardId: intent.cardId }, sourcePlayerId: playerId, speed };
        if (speed === 'Burst') this.pushToStack({ ...action, speed: 'Burst' });
        else this.pushToStack(action);
      } else if (def.type === 'spell') {
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
      // emit OnAttack so keywords can intercept even when no priority window
      const payload = { attacker, target, handled: false, sourcePlayerId: playerId };
      this.emit('OnAttack', payload);
      if (payload.handled) {
        this.processDeaths();
        return;
      }
      this.pushToStack({ effect: 'DealDamage', params: { value: attacker.attack, target: { type:'entity', id: target.id }, source: attacker }, sourcePlayerId: playerId, speed: 'Slow' });
      this.pushToStack({ effect: 'DealDamage', params: { value: target.attack, target: { type:'entity', id: attacker.id }, source: target }, sourcePlayerId: playerId, speed: 'Slow' });
      return;
    }

    if (intent.type === 'end_phase') {
      if (playerId !== this.turn.currentPlayerId) return;
      this.advancePhase();
      return;
    }

    if (intent.type === 'pass') {
      // no-op outside priority
      return;
    }
  }

  // ===== State send / broadcast =====
  broadcastState(){ for (const pid of Object.keys(this.players)) this.sendState(pid); }

  sendState(playerId){
    const p = this.players[playerId];
    if (!p || !p.socket) return;
    const dto = {
      type: 'state',
      me: { hand: p.hand, board: p.board, life: p.life, currentMana: p.currentMana, maxMana: p.maxMana },
      opponents: Object.values(this.players).filter(x=>x.id!==playerId).map(o=>({ id: o.id, board: o.board, life: o.life, currentMana: o.currentMana, maxMana: o.maxMana })),
      turn: this.turn,
      priority: { active: this.priority.active, passes: this.priority.passes },
      stackDepth: this.stack.length
    };
    p.socket.send(JSON.stringify(dto));
  }

  // ===== Keywords loader =====
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
