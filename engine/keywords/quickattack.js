module.exports = {
  // QuickAttack wants the attacker to deal its damage before defender can retaliate.
  // OnAttack is emitted with payload { attacker, target, handled:false, sourcePlayerId }
  OnAttack: (engine, payload) => {
    const { attacker, target } = payload;
    if (!attacker || !target) return;
    // check that the attacker unit definition contains keyword 'quickattack'
    const def = engine.cards[attacker.cardId] || {};
    if (!(def.keywords || []).includes('quickattack')) return;
    engine.log(`QuickAttack triggered by ${attacker.id} -> dealing attacker damage as Burst before defender`);

    // Immediately (Burst) deal attacker's damage to target and mark handled so resolver won't push default mutual damage
    engine.pushToStack({
      effect: 'DealDamage',
      params: { value: attacker.attack, target: { type: 'entity', id: target.id }, source: attacker },
      sourcePlayerId: attacker.ownerId,
      speed: 'Burst'
    });

    // Optionally schedule defender retaliation afterwards (as normal slow), but keep it as separate action if needed:
    // here we schedule retaliation as Slow so it will open priority / be respondable
    engine.pushToStack({
      effect: 'DealDamage',
      params: { value: target.attack, target: { type: 'entity', id: attacker.id }, source: target },
      sourcePlayerId: target.ownerId,
      speed: 'Slow'
    });

    // mark handled so resolver doesn't push its default pair
    payload.handled = true;
  }
};
