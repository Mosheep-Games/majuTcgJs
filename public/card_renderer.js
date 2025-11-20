// card_renderer.js — procedural card visuals

function renderUnitCard(unit) {
    const container = new PIXI.Container();

    const bg = new PIXI.Graphics();
    bg.beginFill(0x222222);
    bg.drawRoundedRect(0, 0, 130, 180, 10);
    bg.endFill();
    container.addChild(bg);

    const name = new PIXI.Text(unit.cardId, {
        fontSize: 16,
        fill: "#ffffff",
        fontWeight: "bold"
    });
    name.x = 10;
    name.y = 8;
    container.addChild(name);

    const atk = new PIXI.Text("ATK: " + unit.attack, {
        fontSize: 18,
        fill: "#ff6961"
    });
    atk.x = 10;
    atk.y = 150;
    container.addChild(atk);

    const hp = new PIXI.Text("HP: " + unit.health, {
        fontSize: 18,
        fill: "#77dd77"
    });
    hp.x = 70;
    hp.y = 150;
    container.addChild(hp);

    return container;
}

function renderSpellMini(cardId) {
    const container = new PIXI.Container();

    const bg = new PIXI.Graphics();
    bg.beginFill(0x444444);
    bg.drawRoundedRect(0, 0, 120, 160, 10);
    bg.endFill();
    container.addChild(bg);

    const txt = new PIXI.Text(cardId, {
        fill: "#ffffff",
        fontSize: 16,
        wordWrap: true,
        wordWrapWidth: 100
    });
    txt.x = 10;
    txt.y = 10;
    container.addChild(txt);

    return container;
}
