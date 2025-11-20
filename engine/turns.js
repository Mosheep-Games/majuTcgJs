// Engine TCG — Kaos Edition
// Author: KAOS
// PASSO 11 - turns.js
//
// Turn manager: implementa fases (Start, Draw, Main, AttackDeclare, BlockDeclare, DamageResolve, End)
// + priority windows por fase
//
// Como usar:
// const TurnManager = require('./turns');
// this.turns = new TurnManager(this); // no resolver: passe instância do engine (this)
// this.turns.startGame(); // inicia o loop de turnos
//
// O módulo emite eventos através do engine (OnPhaseStart, OnPhaseEnd, OnTurnStart, etc)
//

class TurnManager {
  /**
   * engine: instância do Engine (resolver)
   */
  constructor(engine) {
    this.engine = engine;

    // phases in order
    this.PHASES = [
      'START',
      'DRAW',
      'MAIN',
      'ATTACK_DECLARE',
      'BLOCK_DECLARE',
      'DAMAGE_RESOLVE',
      'END'
    ];

    // turn state
    this.currentPlayerIndex = 0; // index into engine.playerOrder
    this.currentPhaseIndex = 0;
    this.turnNumber = 0;

    // priority holder: which player currently has priority (playerId)
    this.priorityHolder = null;
  }

  // -------- helpers ----------
  getCurrentPlayerId() {
    return this.engine.playerOrder[this.currentPlayerIndex];
  }

  getCurrentPhase() {
    return this.PHASES[this.currentPhaseIndex];
  }

  // move to next phase (internal), firing events and opening priority windows
  nextPhase() {
    // end current phase
    const curPhase = this.getCurrentPhase();
    const curPlayer = this.getCurrentPlayerId();
    this.engine.log(`Phase END: ${curPhase} (player ${curPlayer})`);
    this.engine.emit('OnPhaseEnd', { phase: curPhase, playerId: curPlayer });

    // increment phase
    if (this.currentPhaseIndex + 1 < this.PHASES.length) {
      this.currentPhaseIndex++;
    } else {
      // cycle to next player's start phase
      this.currentPhaseIndex = 0;
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.engine.playerOrder.length;
      this.turnNumber++;
      this.engine.log(`Turn advanced to ${this.turnNumber}, player ${this.getCurrentPlayerId()}`);
      this.engine.emit('OnTurnStart', { playerId: this.getCurrentPlayerId(), turn: this.turnNumber });
    }

    // start of the new phase
    const newPhase = this.getCurrentPhase();
    const newPlayer = this.getCurrentPlayerId();
    this.engine.log(`Phase START: ${newPhase} (player ${newPlayer})`);
    this.engine.emit('OnPhaseStart', { phase: newPhase, playerId: newPlayer });

    // open a priority window for the newPhase
    this.openPriorityWindow(newPlayer);

    // Phase-specific automatic actions
    this._autoActionsForPhase(newPhase, newPlayer);

    // broadcast state to clients
    if (this.engine.broadcastAll) this.engine.broadcastAll();
  }

  // Start game (set turn 1, assign first player, start at START phase)
  startGame(firstPlayerIndex = 0) {
    this.currentPlayerIndex = firstPlayerIndex;
    this.currentPhaseIndex = 0;
    this.turnNumber = 1;
    const pid = this.getCurrentPlayerId();
    this.engine.log(`TurnManager starting: turn ${this.turnNumber} player ${pid}`);
    this.engine.emit('OnTurnStart', { playerId: pid, turn: this.turnNumber });
    this.engine.emit('OnPhaseStart', { phase: this.getCurrentPhase(), playerId: pid });
    this.openPriorityWindow(pid);
    // run auto actions (e.g., draw if Start/Draw)
    this._autoActionsForPhase(this.getCurrentPhase(), pid);
    if (this.engine.broadcastAll) this.engine.broadcastAll();
  }

  // open priority for the player (engine already has openPriority method)
  openPriorityWindow(playerId) {
    this.priorityHolder = playerId;
    if (typeof this.engine.openPriority === 'function') {
      this.engine.openPriority(playerId);
    } else {
      // fallback: just emit event
      this.engine.emit('OnPriorityOpen', { playerId });
    }
  }

  // players can pass priority which will be forwarded to engine
  passPriority(playerId) {
    if (typeof this.engine.playerPass === 'function') {
      this.engine.playerPass(playerId);
    } else {
      this.engine.emit('OnPriorityPass', { playerId });
    }
  }

  // auto actions for phases (draw, reset mana, etc)
  _autoActionsForPhase(phase, playerId) {
    const player = this.engine.getPlayer(playerId);
    if (!player) return;

    switch (phase) {
      case 'START':
        // any start-of-turn passive effects can be handled by engine listeners
        break;

      case 'DRAW':
        // increase mana (simple ramp)
        player.maxMana = Math.min(10, (player.maxMana || 0) + 1);
        player.currentMana = player.maxMana;
        // draw 1 card
        if (player.deck && player.deck.length > 0) {
          const card = player.deck.shift();
          if (card) {
            player.hand.push(card);
            this.engine.emit('OnDraw', { playerId: player.id, cardId: card });
            this.engine.log(`Auto-draw for ${playerId}: ${card}`);
          }
        }
        break;

      case 'MAIN':
        // main phase: players can play units/spells
        break;

      case 'ATTACK_DECLARE':
        // players declare attackers; we simply open priority and wait for intents (attack)
        break;

      case 'BLOCK_DECLARE':
        // defender chooses blockers; in our MVP this could be no-op or manual intents
        break;

      case 'DAMAGE_RESOLVE':
        // after attackers/blocks are declared, resolve combat by resolving stack (engine.resolveStack)
        if (typeof this.engine.resolveStack === 'function') this.engine.resolveStack();
        break;

      case 'END':
        // end-of-turn triggers
        this.engine.emit('OnEndTurn', { playerId: player.id });
        break;
    }
    // after auto actions, broadcast
    if (this.engine.broadcastAll) this.engine.broadcastAll();
  }
}

module.exports = TurnManager;
