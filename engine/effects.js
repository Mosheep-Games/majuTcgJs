// engine/effects.js — expanded effects with death marking and cleanup

function DealDamage(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;

  // entity or player
  if (target.health != null) {
    target.health -= params.value;
    ctx.log(`DealDamage ${params.value} to ${target.id}`);

    if (target.health <= 0) {
      // mark entity for death
      ctx.markForDeath(target);
    }
  } else {
    // players take damage too
    target.life -= params.value;
    ctx.log(`DealDamage ${params.value} to PLAYER ${target.id}`);
  }
}

function Heal(ctx, params) {
  const target = ctx.resolveTarget(params.target);
  if (!target) return;

  if (target.health != null) {
    target.health += params.value;
    ctx.log(`Heal ${params.value} on ${target.id}`);
  }
}

function Summon(ctx, params) {
  const player = ctx.getPlayer(params.playerId);
  const cardId = params.cardId;
  const cardDef = ctx.cards[cardId];
  if (!cardDef) return;

  const unit = {
    id: ctx.nextEntityId(),
    cardId,
    attack: cardDef.stats.attack || 0,
    health: cardDef.stats.health || 0
  };

  player.board.push(unit);

  ctx.log(`Summoned ${cardId} for player ${player.id}`);

  // trigger OnEnter
  ctx.emit('OnEnter', { entity: unit, playerId: player.id });
}

module.exports = { DealDamage, Heal, Summon };
