// engine/resolver.js — with death system, cleanup, triggers
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
    this.cards = cardsMap;
    this.players = {};
    this.playerOrder = [];
    this.sockets = {};
    this.entityCounter = 1;
    this.stack = [];

    this.deadQueue = []; // >>> new

    this.turn = { currentPlayerIndex: 0, phase: null, number: 0, currentPlayerId: null };

    this.keywords = {};
    this.loadKeywords();
  }

  nextEntityId(){ return `e${this.entityCounter++}`; }

  addPlayer(){
    const id = uuidv4();
    this.players[id] = {
      id,
      deck: [],
      hand: [],
      board: [],
      socket: null,
      life: 20,
      currentMana: 0,
      maxMana: 0
    };
    this.playerOrder.push(id);
    return id;
  }

  bindSocket(playerId, ws){
    this.players[playerId].socket = ws;
    this.sockets[playerId] = ws;
  }

  ready(){ return this.playerOrder.length >= 2; }

  // === Death Marking =======================================================

  markForDeath(entity){
    if (!this.deadQueue.includes(entity)) {
      this.deadQueue.push(entity);
      this.log(`MarkForDeath: ${entity.id}`);
    }
  }

  processDeaths(){
    if (this.deadQueue.length === 0) return;

    this.log(`Processing deaths: ${this.deadQueue.length} entities`);

    // Step 1: run OnDie + lastbreath triggers (BEFORE removal)
    for (const entity of this.deadQueue) {
      const def = this.cards[entity.cardId];

      // Global trigger event
      this.emit('OnDie', { entity });

      // Keyword LastBreath
      if (def.keywords && def.keywords.includes("lastbreath")) {
        const mod = this.keywords["lastbreath"];
        if (mod && mod.OnDie) {
          mod.OnDie(this, { unit: entity });
        }
      }
    }

    // Step 2: remove entities from boards
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

  // === Targeting ===========================================================
  findEntityById(id){
    for (const p of Object.values(this.players)) {
      for (const u of p.board) {
        if (u.id === id) return u;
      }
    }
    return null;
  }

  resolveTarget(spec){
    if (!spec) return null;

    if (spec.type === 'player')
      return this.players[spec.playerId];

    if (spec.type === 'entity')
      return this.findEntityById(spec.id);

    return null;
  }

  // === Turn / Phase ========================================================

  handlePhaseStart(){
    const phase = this.turn.phase;
    const pid = this.turn.currentPlayerId;

    if (phase === 'DRAW') {
      const p = this.players[pid];

      p.maxMana = Math.min(MAX_MANA, p.maxMana + 1);
      p.currentMana = p.maxMana;

      const card = p.deck.shift();
      if (card) p.hand.push(card);

      this.advancePhase();
    }
  }

  advancePhase(){
    const idx = PHASES.indexOf(this.turn.phase);

    if (idx + 1 < PHASES.length)
      this.turn.phase = PHASES[idx + 1];
    else
      return this.endTurn();

    this.handlePhaseStart();
    this.broadcastState();
  }

  endTurn(){
    this.turn.currentPlayerIndex =
      (this.turn.currentPlayerIndex + 1) % this.playerOrder.length;

    this.turn.currentPlayerId =
      this.playerOrder[this.turn.currentPlayerIndex];

    this.turn.number++;
    this.turn.phase = 'DRAW';

    this.handlePhaseStart();
    this.broadcastState();
  }

  // === Stack ===============================================================

  pushToStack(action){
    this.stack.push(action);
    this.resolveStack();
  }

  resolveStack(){
    while (this.stack.length > 0) {
      const action = this.stack.shift();

      const fn = effects[action.effect];
      if (fn) fn(this, action.params);

      // NOW INCLUDE DEATH PROCESSING AFTER EACH EFFECT
      this.processDeaths();
    }

    this.broadcastState();
  }

  // === Intents =============================================================

  handleIntent(pid, intent){
    if (pid !== this.turn.currentPlayerId) return;

    const p = this.players[pid];

    if (intent.type === "play_card") {
      if (this.turn.phase !== "MAIN") return;

      const idx = p.hand.indexOf(intent.cardId);
      if (idx === -1) return;

      const def = this.cards[intent.cardId];

      // mana check
      const cost = def.cost || 0;
      if (p.currentMana < cost) return;

      p.currentMana -= cost;
      p.hand.splice(idx, 1);

      if (def.type === "unit") {
        this.pushToStack({
          effect: "Summon",
          params: { playerId: pid, cardId: def.id }
        });
      }

      if (def.type === "spell") {
        for (const ef of def.effects || []) {
          const params = {
            playerId: pid,
            ...ef
          };

          if (intent.targetId && ef.target && ef.target.type === "entity") {
            params.target = { type: "entity", id: intent.targetId };
          }

          this.pushToStack({
            effect: ef.action,
            params
          });
        }
      }

      this.broadcastState();
    }

    if (intent.type === "attack") {
      if (this.turn.phase !== "COMBAT") return;

      const attacker = this.findEntityById(intent.attackerId);
      const target = this.findEntityById(intent.targetId);

      if (!attacker || !target) return;

      // simultaneous damage
      this.pushToStack({
        effect: "DealDamage",
        params: {
          value: attacker.attack,
          target: { type: "entity", id: target.id }
        }
      });

      this.pushToStack({
        effect: "DealDamage",
        params: {
          value: target.attack,
          target: { type: "entity", id: attacker.id }
        }
      });
    }

    if (intent.type === "end_phase") {
      this.advancePhase();
    }
  }

  // === State ===============================================================

  broadcastState(){
    for (const pid of Object.keys(this.players))
      this.sendState(pid);
  }

  sendState(pid){
    const p = this.players[pid];
    if (!p.socket) return;

    p.socket.send(JSON.stringify({
      type: "state",
      me: {
        hand: p.hand,
        board: p.board,
        life: p.life,
        currentMana: p.currentMana,
        maxMana: p.maxMana
      },
      opponents: Object.values(this.players)
        .filter(x => x.id !== pid)
        .map(o => ({
          id: o.id,
          board: o.board,
          life: o.life,
          currentMana: o.currentMana,
          maxMana: o.maxMana
        })),
      turn: this.turn
    }));
  }

  // === Keywords loader ======================================================

  loadKeywords(){
    const dir = path.join(__dirname, "keywords");
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir).filter(x => x.endsWith(".js"));

    for (const f of files) {
      const name = f.replace(".js", "");
      this.keywords[name] = require(path.join(dir, f));
    }
  }
}

module.exports = { Engine };
