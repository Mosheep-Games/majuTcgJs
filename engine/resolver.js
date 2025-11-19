// engine/resolver.js — Engine class gluing everything (MVP)
const { Emitter } = require('./events');
const effects = require('./effects');
const { loadCards } = require('./state');
const { v4: uuidv4 } = require('uuid');

class Engine extends Emitter {
  constructor(cardsMap) {
    super();
    this.cards = cardsMap; // id -> card metadata
    this.players = {};
    this.playerOrder = [];
    this.sockets = {};
    this.entityCounter = 1;
    this.stack = [];
  }

  nextEntityId(){ return `e${this.entityCounter++}`; }

  addPlayer(){
    const id = uuidv4();
    this.players[id] = { id, deck: [], hand: [], board: [], socket: null, life: 20 };
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
    this.emit('GameStart', {});
  }

  log(m){ console.log('[Engine]', m); }

  getPlayer(id){ return this.players[id]; }

  resolveTarget(spec){
    // MVP: spec like {type:'player', playerId:'...'} or {type:'board', playerId:'...'}
    if (!spec) return null;
    if (spec.type === 'player') return this.players[spec.playerId];
    if (spec.type === 'board') {
      const p = this.players[spec.playerId];
      return p.board[spec.index || 0];
    }
    return null;
  }

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

  handleIntent(playerId, intent){
    // intents: {type:'play_card', cardId}
    if (intent.type === 'play_card'){
      const player = this.players[playerId];
      const idx = player.hand.indexOf(intent.cardId);
      if (idx === -1) return; // not in hand
      // consume card
      player.hand.splice(idx,1);
      // simple: if unit -> summon, if spell -> deal damage
      const def = this.cards[intent.cardId];
      if (!def) return;
      if (def.type === 'unit'){
        this.pushToStack({ effect: 'Summon', params: { playerId, cardId: intent.cardId } });
      } else if (def.type === 'spell'){
        // example: spell has effects array
        for (const ef of def.effects||[]){ 
          this.pushToStack({ effect: ef.action, params: Object.assign({ playerId }, ef) });
        }
      }
      this.sendState(playerId);
    }
  }

  sendState(playerId){
    const p = this.players[playerId];
    if (!p || !p.socket) return;
    const dto = {
      type: 'state',
      me: { hand: p.hand, board: p.board, life: p.life },
      opponents: Object.values(this.players).filter(x=>x.id!==playerId).map(o=>({ id: o.id, board: o.board, life: o.life }))
    };
    p.socket.send(JSON.stringify(dto));
  }
}

module.exports = { Engine };
