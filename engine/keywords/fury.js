module.exports = {
  // when something dies, if the killer has Fury, buff it
  OnDie: (engine, ctxobj) => {
    const { unit: deadUnit, payload } = ctxobj;
    if (!payload || !payload.source) return;
    const killer = payload.source;
    // apply only if killer exists and is on board
    if (!killer) return;
    killer.attack = (killer.attack || 0) + 1;
    killer.health = (killer.health || 0) + 1;
    engine.log(`Fury: ${killer.id} gains +1/+1`);
  }
};
