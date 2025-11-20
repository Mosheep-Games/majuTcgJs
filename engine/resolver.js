// Engine TCG — Kaos Edition
// Author: KAOS
// PASSO 10 - resolver.js (COMPLETO)
//
// Integração completa:
// - zonas (via zones.moveBetweenZones) -> zones.js must exist
// - effects (effects.js) -> vários efeitos, inclusive regionais e champion evolve
// - regions (regions.js) -> load regions definitions & passives
// - champions: evolution system (simple counter-based)
// - priority stack with Burst/Fast/Slow
//
// Observação: Este arquivo é intencionalmente auto-contido e comentado
// para que você consiga entender e evoluir. Leia os comentários :)

const fs = require('fs');
const path = require('path');
const { Emitter } = require('./events');
const effects = require('./effects');
const regionsModule = require('./regions');
const { v4: uuidv4 } = require('uuid');

class Engine extends Emitter {
  constructor(cardsMap) {
    super();
    this.cards = cardsMap || {};
    this.players = {};
    this.sockets = {};
    this.playerOrder = [];

    this.stack = []; // LIFO list of actions
    this.priority = { active: false, passes: {}, initiator: null };

    this.deadQueue = [];

    this.entityCounter = 1;

    // champion tracking: map entityId -> { playCount, ownerId, cardId }
    // This is a simple example: we increment playCount when the owner plays other cards,
    // and when condition matches we call ChampionEvolve via effects.ChampionEvolve
    this.championTracker = {};

    // register region definitions later via registerRegions()
    this.regions = null;

    // load keywords if any
    this.keywords = {};
    this.loadKeywords();
  }

  log(...args) { console.log('[Engine KAOS]', ...args); }

  nextEntityId() { return 'e' + (this.entityCounter++); }

  addPlayer() {
    const id = uuidv4();
    this.players[id] = {
      id,
      deck: [],
      hand: [],
      board: [],
      graveyard: [],
      exile: [],
      banished: [],
      limbo: [],
      life: 20,
      currentMana: 0,
      maxMana: 0,
      // champion counter for this player (global per-player/per-champion design)
      championCounts: {}
    };
    this.playerOrder.push(id);
    return id;
  }

  bindSocket(playerId, ws) {
    this.players[playerId].socket = ws;
    this.sockets[playerId] = ws;
  }

  ready() { return this.playerOrder.length >= 2; }

  getPlayer(id) { return this.players[id]; }

  // -----------------------------------------------------------------------
  //  Stack / Priority
  // -----------------------------------------------------------------------
  openPriority(initiator) {
    this.priority.active = true;
    this.priority.initiator = initiator;
    this.priority.passes = {};
    for (const pid of Object.keys(this.players)) this.priority.passes[pid] = false;
    this.log('Priority opened by', initiator);
    this.broadcastAll();
  }

  playerPass(pid) {
    if (!this.priority.active) return;
    this.priority.passes[pid] = true;
    const all = Object.values(this.priority.passes).every(x => x === true);
    if (all) {
      this.log('All passed -> resolve stack');
      this.resolveStack();
      this.priority.active = false;
      this.priority.initiator = null;
    }
    this.broadcastAll();
  }

  pushToStack(action) {
    // action: { effect, params, sourcePlayerId, speed }
    const speed = action.speed || 'Slow';
    if (speed === 'Burst') {
      // execute immediately (no priority window)
      const fn = effects[action.effect];
      if (fn) fn(this, action.params || {});
      this.processDeaths();
      this.broadcastAll();
      return;
    }
    // else push to stack
    this.stack.push(action);
    if (!this.priority.active) {
      this.openPriority(action.sourcePlayerId || (action.params && action.params.playerId));
    } else {
      // someone responded — reset passes
      for (const pid of Object.keys(this.priority.passes)) this.priority.passes[pid] = false;
    }
    this.broadcastAll();
  }

  resolveStack() {
    while (this.stack.length > 0) {
      const act = this.stack.pop();
      const fn = effects[act.effect];
      if (fn) fn(this, act.params || {});
      // after each effect, process deaths
      this.processDeaths();
    }
    this.broadcastAll();
  }

  // -----------------------------------------------------------------------
  //  Death pipeline (uses zones.moveBetweenZones internally via events)
  // -----------------------------------------------------------------------
  markForDeath(entity) {
    if (!entity) return;
    if (!this.deadQueue.includes(entity)) this.deadQueue.push(entity);
  }

  processDeaths() {
    if (this.deadQueue.length === 0) return;
    this.log('Processing deaths', this.deadQueue.map(e=>e.id));
    // fire OnDie
    for (const e of this.deadQueue) {
      this.emit('OnDie', { entity: e });
      // if card declares lastbreath keyword, keyword handler will run
      const def = this.cards[e.cardId] || {};
      if ((def.keywords || []).includes('lastbreath')) {
        const kw = this.keywords['lastbreath'];
        if (kw && kw.OnDie) kw.OnDie(this, { unit: e });
      }
    }
    // move to graveyard using regions/zones handling
    for (const e of this.deadQueue) {
      // we expect zones.moveBetweenZones available and registered; to keep resolver standalone,
      // raise an OnMove event and let zones.js (if integrated) move the card.
      // But for safety, we simply emit OnMove here and assume zones.moveBetweenZones will be used elsewhere
      // In our architecture, zones.moveBetweenZones will be called by earlier code (see PASSO 8).
      this.emit('OnMove', { item: e, from: 'board', to: 'graveyard', ownerId: e.ownerId });
      // As fallback: if there is no zones module wiring, remove from board
      const owner = this.getPlayer(e.ownerId);
      if (owner) {
        const idx = owner.board.findIndex(u => u.id === e.id);
        if (idx !== -1) {
          owner.board.splice(idx,1);
          owner.graveyard.push(e.cardId);
          this.log(`(fallback) moved ${e.id} to graveyard`);
        }
      }
    }
    this.deadQueue = [];
  }

  // -----------------------------------------------------------------------
  //  Regions support (loads region file & registers passives)
  // -----------------------------------------------------------------------
  registerRegions(regionsSource) {
    try {
      regionsModule.register(this, regionsSource);
      this.regions = regionsSource;
      this.log('Regions registered');
    } catch (e) {
      console.error('Failed to register regions:', e);
    }
  }

  // -----------------------------------------------------------------------
  //  Champion system (simple)
  //  - When a player plays a card, if they control a champion entity we may count plays
  //  - When playCount reaches threshold, call ChampionEvolve
  // -----------------------------------------------------------------------
  trackChampionPlay(playerId) {
    const p = this.getPlayer(playerId);
    if (!p) return;
    // increment counters for champions owned by player
    for (const unit of p.board) {
      const def = this.cards[unit.cardId] || {};
      if (def.champion && def.evolveTo && def.evolveTo.condition && def.evolveTo.condition.playCount) {
        const need = def.evolveTo.condition.playCount;
        const key = unit.id;
        this.championTracker[key] = this.championTracker[key] || { count: 0, ownerId: playerId, cardId: unit.cardId, unitId: unit.id, targetCardId: def.evolveTo.cardId };
        this.championTracker[key].count++;
        this.log(`Champion tracker ${unit.id} count=${this.championTracker[key].count}/${need}`);
        if (this.championTracker[key].count >= need) {
          // call ChampionEvolve effect
          this.pushToStack({ effect: 'ChampionEvolve', params: { championEntityId: unit.id, toCardId: def.evolveTo.cardId, playerId }, sourcePlayerId: playerId, speed: 'Burst' });
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  //  Intents (player actions) - simple and server-authoritative
  // -----------------------------------------------------------------------
  handleIntent(playerId, msg) {
    const intent = msg.intent || msg;

    // PASS
    if (intent.type === 'pass') { this.playerPass(playerId); return; }

    // PLAY CARD
    if (intent.type === 'play_card') {
      const player = this.getPlayer(playerId);
      if (!player) return;
      const idx = player.hand.indexOf(intent.cardId);
      if (idx === -1) return; // not in hand

      const def = this.cards[intent.cardId];
      if (!def) return;

      // cost checks omitted for brevity — add mana check if needed
      // remove from hand
      player.hand.splice(idx,1);

      // If unit: summon (we create entity and fire OnEnterPlay)
      if (def.type === 'unit') {
        const unit = { id: this.nextEntityId(), cardId: def.id || intent.cardId, attack: def.stats?.attack || 0, health: def.stats?.health || 0, ownerId: playerId };
        player.board.push(unit);
        this.emit('OnEnterPlay', { entity: unit, playerId });
        // track champion if unit is champion
        if (def.champion) this.championTracker[unit.id] = { count: 0, ownerId: playerId, cardId: unit.cardId, unitId: unit.id, targetCardId: def.evolveTo?.cardId };
        // per playing a card, update champion play counters for existing champions
        this.trackChampionPlay(playerId);
        this.broadcastAll();
        return;
      }

      // If spell: push effects to stack
      if (def.type === 'spell') {
        // move card to graveyard (subject to replacement effects)
        this.emit('OnMove', { item: intent.cardId, from: 'hand', to: 'graveyard', ownerId: playerId });
        for (const ef of def.effects || []) {
          this.pushToStack({ effect: ef.action, params: Object.assign({ playerId }, ef), sourcePlayerId: playerId, speed: def.speed || 'Slow' });
        }
        // playing a spell counts as a "play" for champion tracking
        this.trackChampionPlay(playerId);
        return;
      }
    }

    // ATTACK intent
    if (intent.type === 'attack') {
      // simple mutual-damage model (pushes two DealDamage)
      const attacker = this.findEntityById(intent.attackerId);
      const target = this.findEntityById(intent.targetId);
      if (!attacker || !target) return;
      // allow keywords to intercept by emitting OnAttack
      const payload = { attacker, target, handled: false, sourcePlayerId: playerId };
      this.emit('OnAttack', payload);
      if (!payload.handled) {
        this.pushToStack({ effect: 'DealDamage', params: { value: attacker.attack, target: { type: 'entity', id: target.id }, source: attacker }, sourcePlayerId: playerId, speed: 'Slow' });
        this.pushToStack({ effect: 'DealDamage', params: { value: target.attack, target: { type: 'entity', id: attacker.id }, source: target }, sourcePlayerId: playerId, speed: 'Slow' });
      }
      return;
    }

    // END PHASE / NEXT PHASE (simplified)
    if (intent.type === 'end_phase') {
      // for demo: rotate current player
      const idx = this.playerOrder.indexOf(this.turn.currentPlayerId);
      const nextIdx = (idx+1) % this.playerOrder.length;
      this.turn.currentPlayerId = this.playerOrder[nextIdx];
      this.turn.number++;
      this.emit('OnTurnStart', { playerId: this.turn.currentPlayerId });
      this.broadcastAll();
      return;
    }
  }

  // -----------------------------------------------------------------------
  //  Broadcasting state to players
  // -----------------------------------------------------------------------
  sendState(pid) {
    const p = this.getPlayer(pid);
    if (!p || !p.socket) return;
    const dto = {
      type: 'state',
      me: { hand: p.hand, board: p.board, graveyard: p.graveyard, exile: p.exile, banished: p.banished, deckCount: p.deck.length, life: p.life, currentMana: p.currentMana, maxMana: p.maxMana },
      opponents: Object.values(this.players).filter(x=>x.id!==pid).map(o=>({ id: o.id, board: o.board, graveyardCount: o.graveyard.length, deckCount: o.deck.length })),
      stackDepth: this.stack.length,
      priority: this.priority,
      turn: this.turn
    };
    p.socket.send(JSON.stringify(dto));
  }

  broadcastAll() {
    for (const pid of Object.keys(this.players)) this.sendState(pid);
  }

  // -----------------------------------------------------------------------
  //  Keywords loader (keeps existing behavior)
  // -----------------------------------------------------------------------
  loadKeywords() {
    const kwDir = path.join(__dirname, 'keywords');
    if (!fs.existsSync(kwDir)) return;
    for (const f of fs.readdirSync(kwDir)) {
      if (!f.endsWith('.js')) continue;
      try {
        const name = f.replace('.js','');
        this.keywords[name] = require(path.join(__dirname,'keywords',f));
      } catch (e) { console.error('kw load err', e); }
    }
  }
}

module.exports = { Engine };
