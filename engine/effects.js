// engine/effects.js — COMPLETE VERSION (PASSO 1–8)
const { moveBetweenZones } = require("./zones");

// =====================================================================
//                      HELPERS INTERNOS
// =====================================================================

function getPlayer(ctx, playerId) {
  return ctx.getPlayer(playerId);
}

function getEntity(ctx, id) {
  return ctx.findEntityById(id);
}

// =====================================================================
//                       EFEITOS BÁSICOS
// =====================================================================

function Draw(ctx, params) {
  const p = getPlayer(ctx, params.playerId);
  if (!p) return;

  const n = params.value || 1;
  for (let i = 0; i < n; i++) {
    const card = p.deck.shift();
    if (!card) break;
    p.hand.push(card);
    ctx.emit("OnDraw", { playerId: p.id, cardId: card });
  }

  ctx.log(`Draw: player=${p.id} x${n}`);
}

function DealDamage(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;

  const amount = params.value || 0;

  // Entity
  if (target.health != null) {
    target.health -= amount;
    ctx.emit("OnDamageDealt", { target, amount });

    ctx.log(`Damage: ${target.id} took ${amount}`);

    if (target.health <= 0) ctx.markForDeath(target);
    return;
  }

  // Player
  if (target.life != null) {
    target.life -= amount;
    ctx.log(`Damage: Player ${target.id} took ${amount}`);
  }
}

function Heal(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;

  const amount = params.value || 0;

  if (target.health != null) {
    target.health += amount;
    ctx.log(`Heal: ${target.id} +${amount} HP`);
    return;
  }

  if (target.life != null) {
    target.life += amount;
    ctx.log(`Heal: Player ${target.id} +${amount} HP`);
  }
}

// =====================================================================
//                    SUMMON / TOKEN / DESTROY
// =====================================================================

function Summon(ctx, params) {
  const p = getPlayer(ctx, params.playerId);
  if (!p) return;

  const cardId = params.cardId;
  const def = ctx.cards[cardId];
  if (!def) return;

  const unit = {
    id: ctx.nextEntityId(),
    cardId,
    attack: def.stats?.attack ?? 0,
    health: def.stats?.health ?? 1,
    ownerId: p.id,
  };

  p.board.push(unit);

  ctx.emit("OnEnterPlay", { entity: unit, playerId: p.id });
  ctx.log(`Summon: ${cardId} -> ${unit.id}`);
}

function CreateToken(ctx, params) {
  const p = getPlayer(ctx, params.playerId);
  if (!p) return;

  const cardId = params.cardId;
  const def = ctx.cards[cardId] || { stats: {} };

  const tok = {
    id: ctx.nextEntityId(),
    cardId,
    attack: def.stats.attack || params.attack || 0,
    health: def.stats.health || params.health || 1,
    ownerId: p.id,
  };

  p.board.push(tok);

  ctx.emit("OnEnterPlay", { entity: tok, playerId: p.id });
  ctx.log(`CreateToken: ${cardId} (${tok.id})`);
}

function Destroy(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;

  if (target.health != null) {
    ctx.markForDeath(target);
    ctx.log(`Destroy scheduled: ${target.id}`);
  }
}

// =====================================================================
//                        ZONE-BASED EFFECTS
// =====================================================================

function MoveToZone(ctx, params) {
  const playerId = params.playerId;
  const from = params.from || null;
  const to = params.to;
  const cardId = params.cardId || params.entityId;

  return moveBetweenZones(ctx, playerId, cardId, from, to, {
    asEntity: !!params.asEntity,
    event: params.event,
  });
}

// =====================================================================
//                        AVANÇADOS DO PASSO 8
// =====================================================================
//
// Recall – volta da board para a mão
// Obliterate – remove para banished permanentemente
// ReturnToHand – qualquer carta de qualquer zona volta para a mão
// Revive – revive a carta do graveyard como unidade
// Reanimate – revive com modificadores (+atk/+hp)
//

// 1) Recall — return a friendly unit from board to hand
function Recall(ctx, params) {
  const ent = ctx.resolveTarget(params.target);
  if (!ent) return;

  const owner = ctx.getPlayer(ent.ownerId);
  if (!owner) return;

  const idx = owner.board.findIndex(u => u.id === ent.id);
  if (idx === -1) return;

  owner.board.splice(idx, 1);
  owner.hand.push(ent.cardId);

  ctx.emit("OnMove", {
    item: ent,
    from: "board",
    to: "hand",
    ownerId: owner.id,
  });

  ctx.log(`Recall: ${ent.id} -> hand`);
}

// 2) Obliterate — send to banished zone
function Obliterate(ctx, params) {
  const ent = ctx.resolveTarget(params.target);
  if (!ent) return;

  const owner = ctx.getPlayer(ent.ownerId);
  if (!owner) return;

  const idx = owner.board.findIndex(u => u.id === ent.id);
  if (idx === -1) return;

  owner.board.splice(idx, 1);

  owner.banished.push(ent.cardId);

  ctx.emit("OnMove", {
    item: ent,
    from: "board",
    to: "banished",
    ownerId: owner.id,
  });

  ctx.log(`Obliterate: ${ent.id}`);
}

// 3) ReturnToHand — takes card from anywhere and moves to hand
function ReturnToHand(ctx, params) {
  const player = ctx.getPlayer(params.playerId);
  if (!player) return;

  const id = params.cardId || params.entityId;

  const zones = [
    "board",
    "graveyard",
    "exile",
    "banished",
    "limbo",
    "deck",
    "hand",
  ];

  let found = null;
  let fromZone = null;

  for (const z of zones) {
    const i = player[z].findIndex(
      x => (typeof x === "string" ? x === id : x.id === id)
    );
    if (i !== -1) {
      found = player[z].splice(i, 1)[0];
      fromZone = z;
      break;
    }
  }

  if (!found) return;

  // Store cardId if it's entity
  const cid = typeof found === "object" ? found.cardId : found;

  player.hand.push(cid);

  ctx.emit("OnMove", {
    item: found,
    from: fromZone,
    to: "hand",
    ownerId: player.id,
  });

  ctx.log(`ReturnToHand: ${cid} from ${fromZone}`);
}

// 4) Revive — revive from graveyard (full stats)
function Revive(ctx, params) {
  const player = ctx.getPlayer(params.playerId);
  const cardId = params.cardId;
  if (!player) return;

  const idx = player.graveyard.indexOf(cardId);
  if (idx === -1) return;

  player.graveyard.splice(idx, 1);

  const def = ctx.cards[cardId];
  const unit = {
    id: ctx.nextEntityId(),
    cardId,
    attack: def.stats?.attack || 0,
    health: def.stats?.health || 1,
    ownerId: player.id,
  };

  player.board.push(unit);

  ctx.emit("OnEnterPlay", { entity: unit, playerId: player.id });
  ctx.log(`Revive: ${cardId} -> ${unit.id}`);
}

// 5) Reanimate — revive with stat bonus
function Reanimate(ctx, params) {
  const player = ctx.getPlayer(params.playerId);
  const cardId = params.cardId;
  if (!player) return;

  const idx = player.graveyard.indexOf(cardId);
  if (idx === -1) return;

  player.graveyard.splice(idx, 1);

  const def = ctx.cards[cardId];
  const unit = {
    id: ctx.nextEntityId(),
    cardId,
    attack: (def.stats?.attack || 0) + (params.attackBonus || 0),
    health: (def.stats?.health || 0) + (params.healthBonus || 0),
    ownerId: player.id,
  };

  player.board.push(unit);

  ctx.emit("OnEnterPlay", { entity: unit, playerId: player.id });
  ctx.log(
    `Reanimate: ${cardId} -> ${unit.id} (+${params.attackBonus || 0}/+${params.healthBonus || 0})`
  );
}

// =====================================================================
//                      EXPORTAÇÃO FINAL
// =====================================================================

module.exports = {
  Draw,
  DealDamage,
  Heal,
  Summon,
  Destroy,
  CreateToken,

  MoveToZone,

  Recall,
  Obliterate,
  ReturnToHand,
  Revive,
  Reanimate,
};
