// engine/effects.js — basic effect implementations
if (!target) return;
target.health += params.value;
ctx.log(`Heal ${params.value} on ${target.id}`);
}


function Buff(ctx, params) {
const target = ctx.resolveTarget(params.target);
if (!target) return;
target.attack += params.attack || 0;
target.health += params.health || 0;
ctx.log(`Buff ${target.id} (+${params.attack||0}/+${params.health||0})`);
}


function Debuff(ctx, params) {
const target = ctx.resolveTarget(params.target);
if (!target) return;
target.attack -= params.attack || 0;
target.health -= params.health || 0;
ctx.log(`Debuff ${target.id} (-${params.attack||0}/-${params.health||0})`);
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
player.board.push(unit);
ctx.log(`Move ${unit.id} to board of ${player.id}`);
}


function AddCounter(ctx, params) {
const t = ctx.resolveTarget(params.target);
if (!t) return;
t.counters = (t.counters || 0) + (params.value || 1);
ctx.log(`AddCounter on ${t.id} (+${params.value||1})`);
}


function RemoveCounter(ctx, params) {
const t = ctx.resolveTarget(params.target);
if (!t) return;
t.counters = Math.max(0, (t.counters || 0) - (params.value || 1));
ctx.log(`RemoveCounter on ${t.id} (-${params.value||1})`);
}


function Transform(ctx, params) {
const t = ctx.resolveTarget(params.target);
if (!t) return;
const newDef = ctx.cards[params.into];
t.cardId = params.into;
t.attack = newDef.stats.attack;
t.health = newDef.stats.health;
ctx.log(`Transform ${t.id} into ${params.into}`);
}


function CreateToken(ctx, params) {
const player = ctx.getPlayer(params.playerId);
const def = ctx.cards[params.cardId];
const tok = { id: ctx.nextEntityId(), cardId: params.cardId, attack: def.stats.attack, health: def.stats.health };
player.board.push(tok);
ctx.emit('OnEnter', { entity: tok, playerId: player.id });
ctx.log(`Token created: ${params.cardId}`);
}


module.exports = { DealDamage, Draw, Summon };