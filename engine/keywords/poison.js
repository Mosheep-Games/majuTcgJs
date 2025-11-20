module.exports = {
  // Poison: units with counters take damage at start of their owner's turn
  OnTurnStart: (engine, ctxobj) => {
    // ctxobj here will be whatever is provided when turning event is emitted. Our engine emits OnDraw/PhaseChange/TurnChange etc.
    // We'll iterate all units and apply poison counters if any.
    for (const p of Object.values(engine.players)) {
      for (const u of p.board) {
        const counters = u.counters || 0;
        if (counters > 0) {
          u.health -= counters;
          engine.log(`Poison: ${u.id} takes ${counters} poison damage`);
          if (u.health <= 0) engine.markForDeath(u);
        }
      }
    }
  }
};
