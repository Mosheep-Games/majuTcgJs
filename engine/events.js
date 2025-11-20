// engine/effects.js — efeitos base que operam sobre zones (deck/hand/board/graveyard/exile)
function getPlayerById(ctx, playerId) {
  return ctx.getPlayer(playerId);
}

function ShuffleDeck(ctx, params) {
  const player = getPlayerById(ctx, params.playerId);
  if (!player) return;
  // shuffle deck array
  if (player.deck && Array.isArray(player.deck)) {
    player.deck.sort(() => Math.random() - 0.5);
  }
  ctx.log(`ShuffleDeck for ${player.id}`);
}

function MoveToZone(ctx, params) {
  // params: { playerId, cardId or entityId, from: 'deck'|'hand'|'board'|'graveyard'|'exile', to: same, asEntity: bool }
  const player = getPlayerById(ctx, params.playerId);
  if (!player) return;

  const removeFrom = (zone, id) => {
    const z = player[zone];
    if (!Array.isArray(z)) return null;
    const idx = z.findIndex(x => (typeof x === 'string' ? x === id : x.id === id));
    if (idx !== -1) return z.splice(idx, 1)[0];
    return null;
  };

  // identify source
  let item = null;
  if (params.from) item = removeFrom(params.from, params.cardId || params.entityId);
  // fallback: if not found, try search across zones
  if (!item) {
    for (const z of ['hand','deck','board','graveyard','exile']) {
      item = removeFrom(z, params.cardId || params.entityId);
      if (item) break;
    }
  }

  // Put into destination zone
  if (!item) {
    ctx.log(`MoveToZone: item not found ${params.cardId || params.entityId}`);
    return;
  }

  const dest = params.to;
  if (!player[dest]) player[dest] = [];
  // If moving a card id into board, convert to entity (create unit instance)
  if (dest === 'board' && typeof item === 'string' && params.asEntity) {
    const def = ctx.cards[item];
    const unit = { id: ctx.nextEntityId(), cardId: item, attack: def.stats?.attack || 0, health: def.stats?.health || 0, ownerId: player.id };
    player.board.push(unit);
    ctx.log(`MoveToZone: Summoned ${item} as entity ${unit.id} for ${player.id}`);
    ctx.emit('OnEnter', { entity: unit, playerId: player.id });
    return;
  }

  // else push raw object or id
  player[dest].push(item);
  ctx.log(`MoveToZone: moved ${params.cardId || params.entityId} to ${dest} for ${player.id}`);
}

function Draw(ctx, params) {
  const player = getPlayerById(ctx, params.playerId);
  const n = params.value || 1;
  for (let i = 0; i < n; i++) {
    const cardId = player.deck.shift();
    if (!cardId) break;
    player.hand.push(cardId);
    ctx.emit('OnDraw', { playerId: player.id, cardId });
  }
  ctx.log(`Player ${player.id} draws ${n} (deck now ${player.deck.length})`);
}

function DealDamage(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;
  const amount = params.value || 0;
  if (target.health != null) {
    target.health -= amount;
    ctx.log(`DealDamage ${amount} to ${target.id}`);
    const payload = { source: params.source || null, target, amount };
    ctx.emit('OnDamageDealt', payload);
    if (target.health <= 0) ctx.markForDeath(target);
  } else {
    // player target
    target.life -= amount;
    ctx.log(`DealDamage ${amount} to player ${target.id}`);
  }
}

function Heal(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;
  if (target.health != null) {
    target.health += params.value || 0;
    ctx.log(`Heal ${params.value} on ${target.id}`);
  } else {
    target.life += params.value || 0;
    ctx.log(`Heal ${params.value} on player ${target.id}`);
  }
}

function Summon(ctx, params) {
  const player = getPlayerById(ctx, params.playerId);
  const cardId = params.cardId;
  const cardDef = ctx.cards[cardId];
  if (!cardDef) return;
  const unit = { id: ctx.nextEntityId(), cardId, attack: cardDef.stats?.attack || 0, health: cardDef.stats?.health || 0, ownerId: player.id };
  player.board.push(unit);
  ctx.emit('OnEnter', { entity: unit, playerId: player.id });
  ctx.log(`Summoned ${cardId} as ${unit.id} for ${player.id}`);
}

function Destroy(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;
  if (target.health != null) {
    // mark for death (resolver will move to graveyard)
    ctx.markForDeath(target);
    ctx.log(`Destroy scheduled for ${target.id}`);
  }
}

function Mill(ctx, params) {
  const player = getPlayerById(ctx, params.playerId);
  const n = params.value || 1;
  for (let i = 0; i < n; i++) {
    if (player.deck.length === 0) break;
    const top = player.deck.shift();
    player.graveyard.push(top);
    ctx.emit('OnMill', { playerId: player.id, cardId: top });
    ctx.log(`Mill: ${player.id} milled ${top}`);
  }
}

function CreateToken(ctx, params) {
  const player = getPlayerById(ctx, params.playerId);
  const def = ctx.cards[params.cardId];
  const tok = { id: ctx.nextEntityId
