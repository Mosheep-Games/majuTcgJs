module.exports = {
  // payload: { source, target, amount } OR in our engine it is { unit, payload } because applyKeywordEvent wraps it
  OnDamageDealt: (engine, ctxobj) => {
    const { unit, payload } = ctxobj;
    if (!payload || !payload.source) return;
    // lifesteal triggers only if this unit was the source
    if (payload.source.id !== unit.id) return;
    const owner = engine.getPlayer(unit.ownerId);
    if (!owner) return;
    const amount = payload.amount || 0;
    owner.life = (owner.life || 0) + amount;
    engine.log(`Lifesteal: healed player ${owner.id} for ${amount}`);
  }
};
