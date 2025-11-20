module.exports = {
  // Barrier: prevents the next source of damage to the unit (consumes barrier)
  OnDamageDealt: (engine, ctxobj) => {
    const { unit, payload } = ctxobj;
    if (!payload || !payload.target) return;
    // We want to protect the unit itself; apply only when unit is the target
    if (payload.target.id !== unit.id) return;
    // If the unit has barrier flag set (status), prevent damage by healing the damage and remove flag
    unit.status = unit.status || {};
    if (unit.status.barrier) {
      // restore health by amount (undo damage)
      const amount = payload.amount || 0;
      unit.health = (unit.health || 0) + amount;
      unit.status.barrier = false;
      engine.log(`Barrier blocked ${amount} damage on ${unit.id}`);
    }
  }
};
