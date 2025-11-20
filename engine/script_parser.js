// script_parser.js — mini linguagem para cartas TCG

// ----------------------------------------------
// Tokenização simples
// ----------------------------------------------
function tokenize(script) {
    return script
        .replace(/\n/g, " ")
        .replace(/;/g, " ; ")
        .trim()
        .split(/\s+/)
        .filter(t => t.length > 0);
}

// ----------------------------------------------
// AST parser
// ----------------------------------------------
function parse(script) {
    const tokens = tokenize(script);
    let i = 0;

    function next() { return tokens[i++]; }
    function peek() { return tokens[i]; }

    const ast = [];

    while (i < tokens.length) {
        let tk = next();

        if (tk === ";") continue;

        // deal X to target
        if (tk === "deal") {
            const value = parseInt(next());
            if (isNaN(value)) throw "Número esperado após 'deal'";

            const to = next();
            if (to !== "to") throw "Esperado 'to' depois de deal X";

            const target = parseTarget(next());
            ast.push({ action: "DealDamage", value, target });
            continue;
        }

        // heal X to target
        if (tk === "heal") {
            const value = parseInt(next());
            if (isNaN(value)) throw "Número esperado após 'heal'";

            if (next() !== "to") throw "Esperado 'to' após heal X";

            const target = parseTarget(next());
            ast.push({ action: "Heal", value, target });
            continue;
        }

        // draw N
        if (tk === "draw") {
            const value = parseInt(next());
            if (isNaN(value)) throw "Número esperado após 'draw'";
            ast.push({ action: "Draw", value });
            continue;
        }

        // destroy target
        if (tk === "destroy") {
            const target = parseTarget(next());
            ast.push({ action: "Destroy", target });
            continue;
        }

        // buff self +A/+H
        if (tk === "buff") {
            const who = next(); // self | target | ally.random
            const buff = next(); // +X/+Y
            const [atk, hp] = buff.replace("+", "").split("/").map(x => parseInt(x));

            ast.push({
                action: "Buff",
                target: parseTarget(who),
                attack: atk,
                health: hp
            });
            continue;
        }

        // summon "card"
        if (tk === "summon") {
            const cardId = next().replace(/"/g, "");
            const forTok = next();
            if (forTok !== "for") throw "Esperado 'for' em summon";
            const who = next();
            ast.push({ action: "Summon", cardId, owner: who });
            continue;
        }

        // if ... then ... end
        if (tk === "if") {
            const condition = [];
            while (peek() !== "then") condition.push(next());
            next(); // remove "then"

            const body = [];
            while (peek() !== "end") {
                const segment = next();
                if (segment === ";") continue;
                body.push(segment);
            }

            next(); // remove "end"

            ast.push({
                action: "Conditional",
                condition: condition.join(" "),
                body: parse(body.join(" "))
            });
            continue;
        }

        throw "Token inesperado: " + tk;
    }

    return ast;
}

// ----------------------------------------------
// Target parser
// ----------------------------------------------
function parseTarget(token) {
    // exemplos:
    // enemy
    // enemy.random
    // self
    // target
    // ally.hero
    const parts = token.split(".");
    return {
        side: parts[0],      // ally | enemy | self | target
        type: parts[1] || "single"
    };
}

module.exports = { parse };
