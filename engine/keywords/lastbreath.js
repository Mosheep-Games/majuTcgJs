module.exports = {
  // LastBreath: when this unit dies, do an effect defined on the card (we expect the card to have lastbreathEffect in its data)
  OnDie: (ctx, ctxobj) => {
    const { unit, payload } = ctxobj;
    const def = ctx.cards[unit.cardId] || {};
    const lb = def.lastbreathEffect;
    if (!lb) return;
    // lb is an effect descriptor, e.g. { action: 'DealDamage', value: 1, target: { type: 'board', playerId: 'opponent', index: 0 } }
    const parsed = Object.assign({}, lb);
    // attach source info
    parsed.source = unit;
    parsed.playerId = unit.ownerId;
    ctx.pushToStack({ effect: parsed.action, params: parsed });
    ctx.log(`LastBreath triggered for ${unit.id}`);
  }
};
