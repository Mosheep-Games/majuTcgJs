module.exports = {
  // Fury: when this unit kills another unit, give +1/+1 to the killer
  OnDie: (ctx, ctxobj) => {
    const { unit: deadUnit, payload } = ctxobj;
    if (!payload || !payload.source) return;
    const killer = payload.source;
    if (!killer) return;
    // Only apply if killer has Fury (apply loop will already ensure we are in the context of a unit with Fury)
    killer.attack = (killer.attack || 0) + 1;
    killer.health = (killer.health || 0) + 1;
    ctx.log(`Fury: ${killer.id} gains +1/+1`);
  }
};
