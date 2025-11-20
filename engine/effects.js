// Engine TCG — Kaos Edition
// Author: KAOS
// PASSO 10 - effects.js
//
// Contém efeitos básicos + utilitários regionais e suporte a "ChampionEvolve"
//
// Observação: este arquivo assume que `zones` já existe e que `engine` emite
// eventos como OnEnterPlay, OnDamageDealt, OnTurnStart, OnDie.
//

const zones = require('./zones');

// ---------- HELPERS ----------
function getPlayer(ctx, playerId) { return ctx.getPlayer(playerId); }
function findEntity(ctx, id) { return ctx.findEntityById(id); }

// ---------- BÁSICOS (Draw/Deal/Heal/Summon/Destroy) ----------
function Draw(ctx, params) {
  const p = getPlayer(ctx, params.playerId);
  if (!p) return;
  const n = params.value || 1;
  for (let i=0;i<n;i++){
    if (p.deck.length === 0) break;
    const c = p.deck.shift();
    p.hand.push(c);
    ctx.emit('OnDraw', { playerId: p.id, cardId: c });
  }
  ctx.log(`KAOS: Draw ${p.id} x${n}`);
}

function DealDamage(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;
  const amount = params.value || 0;

  if (target.health != null) {
    target.health -= amount;
    ctx.emit('OnDamageDealt', { source: params.source || null, target, amount });
    ctx.log(`KAOS: DealDamage ${amount} -> ${target.id}`);
    if (target.health <= 0) ctx.markForDeath(target);
  } else {
    target.life -= amount;
    ctx.log(`KAOS: DealDamage ${amount} -> Player ${target.id}`);
  }
}

function Heal(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;
  const amount = params.value || 0;
  if (target.health != null) {
    target.health += amount;
    ctx.log(`KAOS: Heal ${amount} -> ${target.id}`);
  } else {
    target.life += amount;
    ctx.log(`KAOS: Heal ${amount} -> Player ${target.id}`);
  }
}

function Summon(ctx, params) {
  const p = getPlayer(ctx, params.playerId);
  if (!p) return;
  const cardId = params.cardId;
  const def = ctx.cards[cardId];
  if (!def) return;
  const unit = { id: ctx.nextEntityId(), cardId, attack: def.stats?.attack || 0, health: def.stats?.health || 0, ownerId: p.id };
  p.board.push(unit);
  ctx.emit('OnEnterPlay', { entity: unit, playerId: p.id });
  ctx.log(`KAOS: Summon ${cardId} -> ${unit.id}`);
}

function Destroy(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;
  if (target.health != null) {
    ctx.markForDeath(target);
    ctx.log(`KAOS: Destroy scheduled ${target.id}`);
  }
}

// ---------- REGION / CHAMPION-SPECIFIC EFFECTS ----------

/**
 * GainAttackAllied: simple buff to allied units
 * params: { playerId, value }
 */
function GainAttackAllied(ctx, params) {
  const p = getPlayer(ctx, params.playerId);
  if (!p) return;
  const v = params.value || 0;
  for (const u of p.board) u.attack = (u.attack || 0) + v;
  ctx.log(`KAOS: GainAttackAllied +${v} to ${p.id}`);
}

/**
 * ChampionEvolve: checks champion card instance and evolves it (replace entity)
 * params: { playerId, championEntityId, toCardId }
 *
 * The engine should call this effect when the evolve condition is satisfied.
 */
function ChampionEvolve(ctx, params) {
  const ent = findEntity(ctx, params.championEntityId);
  if (!ent) return;
  const owner = ctx.getPlayer(ent.ownerId);
  if (!owner) return;

  const toCardId = params.toCardId;
  const def = ctx.cards[toCardId];
  if (!def) return;

  // remove original entity from board, put its card id into graveyard (or use replacement)
  const idx = owner.board.findIndex(u => u.id === ent.id);
  if (idx !== -1) owner.board.splice(idx,1);

  // create evolved entity
  const newEnt = { id: ctx.nextEntityId(), cardId: toCardId, attack: def.stats?.attack || 0, health: def.stats?.health || 0, ownerId: owner.id };
  owner.board.push(newEnt);

  ctx.emit('OnEnterPlay', { entity: newEnt, playerId: owner.id });
  ctx.log(`KAOS: ChampionEvolve ${ent.id} -> ${newEnt.id} (${toCardId})`);
}

// ---------- EXPORT ----------
module.exports = {
  Draw,
  DealDamage,
  Heal,
  Summon,
  Destroy,
  GainAttackAllied,
  ChampionEvolve
};
