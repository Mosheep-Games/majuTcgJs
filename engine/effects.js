// engine/effects.js — effect implementations (expanded)
//
// Effects should emit events that keywords can subscribe to via applyKeywordEvent.
// Example emitted events: OnEnter, OnDie, OnDraw, OnDamageDealt

function DealDamage(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;
  const amount = params.value || 0;
  // emit before/after events for keywords: we emit OnDamageDealt after applying damage
  target.health -= amount;
  ctx.log(`DealDamage ${amount} to ${target.id}`);
  // payload for keywords: include source info if available
  const payload = { source: params.source || null, target, amount };
  ctx.emit('OnDamageDealt', payload);
  if (target.health <= 0) {
    ctx.emit('OnDie', { target, source: params.source || null });
  }
}

function Draw(ctx, params) {
  const player = ctx.getPlayer(params.playerId);
  const n = params.value || 1;
  for (let i=0;i<n;i++){
    const cardId = player.deck.shift();
    if (!cardId) break;
    player.hand.push(cardId);
    ctx.emit('OnDraw', { playerId: player.id, cardId });
  }
  ctx.log(`Player ${player.id} draws ${n}`);
}

function Summon(ctx, params) {
  const player = ctx.getPlayer(params.playerId);
  const cardId = params.cardId;
  const cardDef = ctx.cards[cardId];
  if (!cardDef) return;
  const unit = { id: ctx.nextEntityId(), cardId, attack: cardDef.stats.attack || 0, health: cardDef.stats.health || 0, ownerId: player.id };
  player.board.push(unit);
  ctx.emit('OnEnter', { entity: unit, playerId: player.id });
  ctx.log(`Summoned ${cardId} for player ${player.id}`);
}

// ===== Additional effects =====
function Heal(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;
  const amount = params.value || 0;
  target.health += amount;
  ctx.log(`Heal ${amount} on ${target.id}`);
  ctx.emit('OnHealed', { target, amount });
}

function Buff(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;
  target.attack += params.attack || 0;
  target.health += params.health || 0;
  ctx.log(`Buff ${target.id} (+${params.attack||0}/+${params.health||0})`);
  ctx.emit('OnBuff', { target, params });
}

function Debuff(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;
  target.attack -= params.attack || 0;
  target.health -= params.health || 0;
  ctx.log(`Debuff ${target.id} (-${params.attack||0}/-${params.health||0})`);
  ctx.emit('OnDebuff', { target, params });
}

function Destroy(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;
  target.health = 0;
  ctx.emit('OnDie', { target });
  ctx.log(`Destroyed ${target.id}`);
}

function Move(ctx, params) {
  const unit = ctx.resolveTarget(params.target);
  if (!unit) return;
  const player = ctx.getPlayer(params.toPlayerId);
  // remove from old owner board
  for (const p of Object.values(ctx.players)) {
    p.board = p.board.filter(x=>x.id !== unit.id);
  }
  player.board.push(unit);
  ctx.log(`Move ${unit.id} to board of ${player.id}`);
  ctx.emit('OnMove', { unit, toPlayerId: player.id });
}

function AddCounter(ctx, params) {
  const t = ctx.resolveTarget(params.target);
  if (!t) return;
  t.counters = (t.counters || 0) + (params.value || 1);
  ctx.log(`AddCounter on ${t.id} (+${params.value||1})`);
  ctx.emit('OnCounterChange', { target: t, delta: params.value || 1 });
}

function RemoveCounter(ctx, params) {
  const t = ctx.resolveTarget(params.target);
  if (!t) return;
  t.counters = Math.max(0, (t.counters || 0) - (params.value || 1));
  ctx.log(`RemoveCounter on ${t.id} (-${params.value||1})`);
  ctx.emit('OnCounterChange', { target: t, delta: -(params.value || 1) });
}

function Transform(ctx, params) {
  const t = ctx.resolveTarget(params.target);
  if (!t) return;
  const newDef = ctx.cards[params.into];
  t.cardId = params.into;
  t.attack = newDef.stats.attack;
  t.health = newDef.stats.health;
  ctx.log(`Transform ${t.id} into ${params.into}`);
  ctx.emit('OnTransform', { target: t, into: params.into });
}

function CreateToken(ctx, params) {
  const player = ctx.getPlayer(params.playerId);
  const def = ctx.cards[params.cardId];
  const tok = { id: ctx.nextEntityId(), cardId: params.cardId, attack: def.stats.attack, health: def.stats.health, ownerId: player.id };
  player.board.push(tok);
  ctx.emit('OnEnter', { entity: tok, playerId: player.id });
  ctx.log(`Token created: ${params.cardId}`);
}

module.exports = {
  DealDamage,
  Draw,
  Summon,
  Heal,
  Buff,
  Debuff,
  Destroy,
  Move,
  AddCounter,
  RemoveCounter,
  Transform,
  CreateToken
};
