module.exports = {
  OnDie(engine, { unit }) {
    engine.log(`LastBreath triggered by ${unit.id} (${unit.cardId})`);

    // EXEMPLO: summon 1/1 token
    engine.pushToStack({
      effect: "Summon",
      params: {
        playerId: engine.turn.currentPlayerId,
        cardId: "grunt" // qualquer token
      }
    });
  }
};
