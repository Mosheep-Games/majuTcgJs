// script_runtime.js — executor do AST para a stack do engine

function executeScript(ctx, ownerId, ast, explicitTargetId = null) {
    for (const node of ast) {
        switch (node.action) {

            case "DealDamage":
                ctx.pushToStack({
                    effect: "DealDamage",
                    params: {
                        playerId: ownerId,
                        value: node.value,
                        target: resolveTarget(ctx, ownerId, node.target, explicitTargetId)
                    }
                });
                break;

            case "Heal":
                ctx.pushToStack({
                    effect: "Heal",
                    params: {
                        playerId: ownerId,
                        value: node.value,
                        target: resolveTarget(ctx, ownerId, node.target, explicitTargetId)
                    }
                });
                break;

            case "Draw":
                ctx.pushToStack({
                    effect: "Draw",
                    params: { playerId: ownerId, value: node.value }
                });
                break;

            case "Destroy":
                ctx.pushToStack({
                    effect: "Destroy",
                    params: {
                        target: resolveTarget(ctx, ownerId, node.target, explicitTargetId)
                    }
                });
                break;

            case "Buff":
                ctx.pushToStack({
                    effect: "Buff",
                    params: {
                        target: resolveTarget(ctx, ownerId, node.target, explicitTargetId),
                        attack: node.attack,
                        health: node.health
                    }
                });
                break;

            case "Summon":
                ctx.pushToStack({
                    effect: "Summon",
                    params: {
                        playerId: ownerId,
                        cardId: node.cardId
                    }
                });
                break;

            case "Conditional":
                if (evalCondition(ctx, ownerId, node.condition)) {
                    executeScript(ctx, ownerId, node.body, explicitTargetId);
                }
                break;
        }
    }
}

// Exemplo extremamente simples: você pode expandir depois
function evalCondition(ctx, ownerId, cond) {
    const self = ctx.getPlayer(ownerId);
    return eval(cond.replace("self.life", self.life));
}

// Resolve alvo usando as regras do engine
function resolveTarget(ctx, ownerId, targetDef, explicitTargetId) {
    // 1. alvo explícito do player (targetId enviado no intent)
    if (targetDef.side === "target" && explicitTargetId) {
        return { type: "entity", id: explicitTargetId };
    }

    // 2. self
    if (targetDef.side === "self") {
        return { type: "player", playerId: ownerId };
    }

    // 3. enemy
    if (targetDef.side === "enemy") {
        const opp = Object.values(ctx.players).find(p => p.id !== ownerId);
        if (!opp) return null;

        if (targetDef.type === "random") {
            const list = opp.board;
            if (list.length === 0) return null;
            const e = list[Math.floor(Math.random() * list.length)];
            return { type: "entity", id: e.id };
        }

        return { type: "player", playerId: opp.id };
    }

    // 4. ally
    if (targetDef.side === "ally") {
        const me = ctx.players[ownerId];

        if (targetDef.type === "random") {
            const list = me.board;
            if (list.length === 0) return null;
            const e = list[Math.floor(Math.random() * list.length)];
            return { type: "entity", id: e.id };
        }

        return { type: "player", playerId: ownerId };
    }

    return null;
}

module.exports = { executeScript };
