module.exports = {
  // Challenger: when this unit enters the board, it "taunts" a target enemy unit (makes it more likely to be attacked).
  // Implementation: OnEnter sets a flag 'provokedBy' on one enemy unit (first available) pointing to this challenger.
  OnEnter: (engine, ctxobj) => {
    const { unit, payload } = ctxobj;
    const def = engine.cards[unit.cardId] || {};
    if (!(def.keywords || []).includes('challenger')) return;

    // pick a first enemy unit to 'provoked' (simple heuristic)
    const owner = engine.getPlayer(unit.ownerId);
    if (!owner) return;
    const opponents = Object.values(engine.players).filter(p => p.id !== owner.id);
    if (opponents.length === 0) return;
    const enemy = opponents[0];
    if (!enemy.board || enemy.board.length === 0) return;

    const target = enemy.board[0];
    target.provokedBy = unit.id;
    engine.log(`Challenger: ${unit.id} provoked enemy ${target.id}`);
  }
};
