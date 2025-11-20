module.exports = {
  // Regen: heal units with regen counters at start of owner's turn
  OnTurnStart: (engine, ctxobj) => {
    for (const p of Object.values(engine.players)) {
      for (const u of p.board) {
        const regen = (u.status && u.status.regen) || 0;
        if (regen > 0) {
          u.health += regen;
          engine.log(`Regen: ${u.id} regains ${regen} HP`);
        }
      }
    }
  }
};
