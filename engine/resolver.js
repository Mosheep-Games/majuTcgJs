// engine/resolver.js — COMPLETE ADVANCED VERSION (PASSO 1–8)
const fs = require("fs");
const path = require("path");
const { Emitter } = require("./events");
const effects = require("./effects");
const { loadCards } = require("./state");
const zones = require("./zones");
const { v4: uuidv4 } = require("uuid");

class Engine extends Emitter {
  constructor(cardsMap) {
    super();
    this.cards = cardsMap || {};
    this.players = {};
    this.playerOrder = [];
    this.sockets = {};

    this.entityCounter = 1;

    // game flow
    this.stack = [];
    this.priority = { active: false, initiator: null, passes: {} };
    this.deadQueue = [];

    // turn system
    this.turn = {
      number: 0,
      phase: "MAIN",
      currentPlayerId: null,
    };

    // keywords registry
    this.keywords = {};
    this.loadKeywords();
  }

  log(msg) {
    console.log("[Engine]", msg);
  }

  nextEntityId() {
    return "e" + this.entityCounter++;
  }

  // register players
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
      socket: null,
      currentMana: 0,
      maxMana: 0,
    };
    this.playerOrder.push(id);
    return id;
  }

  bindSocket(pid, ws) {
    this.players[pid].socket = ws;
    this.sockets[pid] = ws;
  }

  ready() {
    return this.playerOrder.length >= 2;
  }

  getPlayer(id) {
    return this.players[id];
  }

  // =====================================================================
  //                ENTITY & TARGET RESOLUTION
  // =====================================================================

  findEntityById(eid) {
    for (const p of Object.values(this.players)) {
      for (const u of p.board) if (u.id === eid) return u;
    }
    return null;
  }

  resolveTarget(spec) {
    if (!spec) return null;

    if (spec.type === "player")
      return this.players[spec.playerId];

    if (spec.type === "entity")
      return this.findEntityById(spec.id);

    if (spec.type === "board") {
      const p = this.players[spec.playerId];
      if (!p) return null;
      return p.board[spec.index || 0] || null;
    }

    return null;
  }

  // =====================================================================
  //                   DEATH PIPELINE (PASSO 8)
  // =====================================================================

  markForDeath(entity) {
    if (!entity) return;
    if (!this.deadQueue.includes(entity)) {
      this.deadQueue.push(entity);
      this.log(`markForDeath: ${entity.id}`);
    }
  }

  processDeaths() {
    if (this.deadQueue.length === 0) return;

    this.log("Processing deaths: " + this.deadQueue.length);

    // Call OnDie triggers
    for (const ent of this.deadQueue) {
      const def = this.cards[ent.cardId] || {};
      this.emit("OnDie", { entity: ent });

      if ((def.keywords || []).includes("lastbreath")) {
        const kw = this.keywords["lastbreath"];
        if (kw && kw.OnDie) kw.OnDie(this, { unit: ent });
      }
    }

    // Move to graveyard (using moveBetweenZones to apply replacements)
    for (const ent of this.deadQueue) {
      zones.moveBetweenZones(
        this,
        ent.ownerId,
        ent,
        "board",
        "graveyard",
        { event: "death" }
      );
    }

    this.deadQueue = [];
  }

  // =====================================================================
  //                       STACK AND PRIORITY
  // =====================================================================

  resetPasses() {
    for (const pid of Object.keys(this.priority.passes))
      this.priority.passes[pid] = false;
  }

  openPriority(initiator) {
    this.priority.active = true;
    this.priority.initiator = initiator;
    this.priority.passes = {};
    for (const pid of Object.keys(this.players)) {
      this.priority.passes[pid] = false;
    }
    this.log(`Priority opened by ${initiator}`);
  }

  playerPass(pid) {
    if (!this.priority.active) return;
    this.priority.passes[pid] = true;

    const allPassed = Object.values(this.priority.passes).every(v => v);
    if (allPassed) {
      this.resolveStack();
      this.priority.active = false;
      this.priority.initiator = null;
    }
    this.broadcastAllStates();
  }

  pushToStack(action) {
    const speed = action.speed || "Slow";

    // BURST resolves immediately
    if (speed === "Burst") {
      const fn = effects[action.effect];
      if (fn) fn(this, action.params);
      this.processDeaths();
      this.broadcastAllStates();
      return;
    }

    // FAST / SLOW go to stack
    this.stack.push(action);

    if (!this.priority.active) {
      const player = action.sourcePlayerId || action.params?.playerId;
      this.openPriority(player);
    } else {
      this.resetPasses();
    }

    this.broadcastAllStates();
  }

  resolveStack() {
    while (this.stack.length > 0) {
      const act = this.stack.pop();
      const fn = effects[act.effect];
      if (fn) fn(this, act.params);
      this.processDeaths();
    }
    this.broadcastAllStates();
  }

  // =====================================================================
  //                           INTENTS (JOGADOR)
  // =====================================================================

  handleIntent(playerId, msg) {
    const intent = msg.intent || msg;

    // --------------------
    // SET DECK
    // --------------------
    if (intent.type === "set_deck") {
      const p = this.getPlayer(playerId);
      if (!p) return;
      p.deck = [...intent.cards];
      return this.broadcastAllStates();
    }

    // --------------------
    // MULLIGAN (PASSO 7)
    // --------------------
    if (intent.type === "mulligan") {
      const p = this.getPlayer(playerId);
      if (!p) return;

      for (const cid of intent.cards) {
        const idx = p.hand.indexOf(cid);
        if (idx !== -1) {
          p.hand.splice(idx, 1);
          p.deck.push(cid);
        }
      }

      p.deck.sort(() => Math.random() - 0.5);
      while (p.hand.length < 3 && p.deck.length > 0)
        p.hand.push(p.deck.shift());

      return this.broadcastAllStates();
    }

    // --------------------
    // PASS PRIORITY
    // --------------------
    if (intent.type === "pass") {
      this.playerPass(playerId);
      return;
    }

    // --------------------
    // PLAY CARD
    // --------------------
    if (intent.type === "play_card") {
      const p = this.getPlayer(playerId);
      if (!p) return;

      const cId = intent.cardId;
      const idx = p.hand.indexOf(cId);
      if (idx === -1) return;

      const def = this.cards[cId];
      if (!def) return;

      // Unit → summon by zone system
      if (def.type === "unit") {
        // remove from hand and create entity in board
        zones.moveBetweenZones(this, playerId, cId, "hand", "board", {
          asEntity: true
        });

        // triggers OnEnterPlay already executed in zones.js

        this.broadcastAllStates();
        return;
      }

      // Spell → collect effects and push
      if (def.type === "spell") {
        // remove card from hand → graveyard (unless replacement)
        zones.moveBetweenZones(this, playerId, cId, "hand", "graveyard", {});

        for (const eff of def.effects || []) {
          this.pushToStack({
            effect: eff.action,
            params: eff,
            sourcePlayerId: playerId,
            speed: def.speed || "Slow"
          });
        }
        return;
      }
    }
  }

  // =====================================================================
  //                        TURN SYSTEM (SIMPLES)
  // =====================================================================

  startGame() {
    this.turn.number = 1;
    this.turn.currentPlayerId = this.playerOrder[0];

    // Draw 3 cards
    for (const pid of this.playerOrder) {
      const p = this.getPlayer(pid);
      for (let i = 0; i < 3; i++) {
        const card = p.deck.shift();
        if (card) p.hand.push(card);
      }
    }

    this.broadcastAllStates();
  }

  // =====================================================================
  //             STATE BROADCASTING
  // =====================================================================

  broadcastState(pid) {
    const p = this.players[pid];
    if (!p || !p.socket) return;

    const dto = {
      type: "state",
      me: {
        id: p.id,
        hand: p.hand,
        board: p.board,
        graveyard: p.graveyard,
        exile: p.exile,
        banished: p.banished,
        limbo: p.limbo,
        deckCount: p.deck.length,
        life: p.life,
        currentMana: p.currentMana,
        maxMana: p.maxMana,
      },
      opponents: Object.values(this.players)
        .filter(o => o.id !== pid)
        .map(o => ({
          id: o.id,
          board: o.board,
          graveyardCount: o.graveyard.length,
          deckCount: o.deck.length,
          banishedCount: o.banished.length
        })),
      stackDepth: this.stack.length,
      priority: this.priority,
      turn: this.turn
    };

    p.socket.send(JSON.stringify(dto));
  }

  broadcastAllStates() {
    for (const pid of Object.keys(this.players))
      this.broadcastState(pid);
  }

  // =====================================================================
  //                   KEYWORDS LOADER (PASSO 5)
  // =====================================================================

  loadKeywords() {
    const kwDir = path.join(__dirname, "keywords");
    if (!fs.existsSync(kwDir)) return;

    for (const file of fs.readdirSync(kwDir)) {
      if (!file.endsWith(".js")) continue;
      try {
        const key = file.replace(".js", "");
        const mod = require(path.join(kwDir, file));
        this.keywords[key] = mod;
        this.log("Loaded keyword: " + key);
      } catch (err) {
        console.error("[Keyword error]", file, err);
      }
    }
  }
}

module.exports = { Engine };
