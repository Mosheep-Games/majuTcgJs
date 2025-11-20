// engine/zones.js
// Utilities for zone movement, replacement effects and zone triggers.
// The engine (resolver) will call these helpers to centralize logic.

function ensurePlayerZones(player) {
  player.deck = player.deck || [];
  player.hand = player.hand || [];
  player.board = player.board || [];
  player.graveyard = player.graveyard || [];
  player.exile = player.exile || [];
  player.banished = player.banished || [];
  player.limbo = player.limbo || [];
}

// Looks for replacement effects registered on card definitions.
// replacementDef: { on: "death"|"move", from: "board", to: "graveyard", instead: { moveTo: "exile" } }
// It returns an alternative action or null (meaning no replacement).
function checkReplacement(engine, entityOrCardId, context) {
  // context: { event: 'death'|'move', from, to, ownerId, entity? }
  // Search replacement rules on the card definition of the entity (if entity) or card id
  const def = entityOrCardId && entityOrCardId.cardId ? engine.cards[entityOrCardId.cardId] : engine.cards[entityOrCardId];
  if (!def) return null;
  const replacements = def.replacement || [];
  for (const rep of replacements) {
    // simple matching: rep.on === context.event and rep.from === context.from and rep.to === context.to
    if (rep.on === context.event && rep.from === context.from && rep.to === context.to) {
      return rep.instead || null;
    }
  }
  return null;
}

// Move an item between zones of its owner, handling replacement effects and making events.
function moveBetweenZones(engine, ownerId, item, fromZone, toZone, opts = {}) {
  // opts: { asEntity: boolean } - if moving card id to board and asEntity true, create entity.
  const p = engine.players[ownerId];
  if (!p) return false;
  ensurePlayerZones(p);

  // find and remove from 'fromZone' (if declared). If not present, try to locate automatically.
  function removeFromZone(zone, id) {
    const z = p[zone];
    if (!Array.isArray(z)) return null;
    const idx = z.findIndex(x => (typeof x === 'string') ? x === id : x.id === id);
    if (idx >= 0) return z.splice(idx, 1)[0];
    return null;
  }

  let removed = null;
  if (fromZone) removed = removeFromZone(fromZone, (item.id || item));
  if (!removed) {
    // search across zones
    for (const zone of ['hand','deck','board','graveyard','exile','banished','limbo']) {
      removed = removeFromZone(zone, (item.id || item));
      if (removed) { fromZone = zone; break; }
    }
  }

  if (!removed) {
    engine.log(`moveBetweenZones: item not found owner=${ownerId} item=${item.id || item}`);
    return false;
  }

  // Build context for replacement lookup
  const ctx = { event: (opts.event || (fromZone === 'board' && toZone === 'graveyard' ? 'death' : 'move')), from: fromZone, to: toZone, ownerId, entity: (typeof removed === 'object' ? removed : null) };

  // check replacement
  const replacement = checkReplacement(engine, removed, ctx);
  if (replacement) {
    // example: replacement = { moveTo: 'exile' } or { returnTo: 'hand' }
    engine.log(`Replacement effect applied for ${removed.id || removed} => ${JSON.stringify(replacement)}`);
    if (replacement.moveTo) {
      // direct redirection: send to replacement.moveTo instead of original toZone
      toZone = replacement.moveTo;
    }
    if (replacement.returnTo) {
      toZone = replacement.returnTo;
    }
    if (replacement.banish) {
      toZone = 'banished';
    }
    // more complex replacement behaviors can be supported here
  }

  // If moving card id into board as entity
  if (toZone === 'board' && typeof removed === 'string' && opts.asEntity) {
    const def = engine.cards[removed];
    const unit = { id: engine.nextEntityId(), cardId: removed, attack: def.stats?.attack || 0, health: def.stats?.health || 0, ownerId };
    p.board.push(unit);
    engine.emit('OnMove', { cardId: removed, from: fromZone, to: 'board', ownerId, entity: unit });
    // OnEnterPlay synonym
    engine.emit('OnEnterPlay', { entity: unit, playerId: ownerId });
    return unit;
  }

  // push removed into destination zone
  if (!p[toZone]) p[toZone] = [];
  p[toZone].push((removed.id && removed.cardId) ? removed.cardId : removed);
  engine.emit('OnMove', { item: removed, from: fromZone, to: toZone, ownerId });
  // zone-specific triggers
  if (toZone === 'graveyard') {
    engine.emit('OnEnterGraveyard', { item: removed, ownerId });
    // if moved from board -> it's a leaveplay event too
    if (fromZone === 'board') engine.emit('OnLeavePlay', { entity: removed, playerId: ownerId });
  }
  if (toZone === 'exile') engine.emit('OnEnterExile', { item: removed, ownerId });

  return true;
}

module.exports = { ensurePlayerZones, moveBetweenZones, checkReplacement };
