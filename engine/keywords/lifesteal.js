module.exports = {
  // payload: { source, target, amount }
  OnDamageDealt: (ctx, ctxobj) => {
    const { unit, payload } = ctxobj;
    // lifesteal applies if the unit with this keyword is the source of the damage
    if (!payload || !payload.source) return;
    if (payload.source.id !== unit.id) return;
    // heal owner for the amount
    const owner = ctx.getPlayer(unit.ownerId);
    if (!owner) return;
    owner.life += payload.amount || 0;
    ctx.log(`Lifesteal: healed player ${owner.id} for ${payload.amount || 0}`);
  }
};
