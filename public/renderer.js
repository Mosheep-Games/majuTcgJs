// renderer.js — PIXI board renderer & interactions

class GameRenderer {
    constructor(playerId, ws) {
        this.playerId = playerId;
        this.ws = ws;

        this.app = new PIXI.Application({
            width: window.innerWidth,
            height: window.innerHeight,
            background: "#1a1a1d",
            antialias: true
        });

        document.body.appendChild(this.app.view);

        this.layers = {
            board: new PIXI.Container(),
            hand: new PIXI.Container(),
            opponent: new PIXI.Container(),
            effects: new PIXI.Container()
        };

        this.app.stage.addChild(this.layers.board);
        this.app.stage.addChild(this.layers.opponent);
        this.app.stage.addChild(this.layers.hand);
        this.app.stage.addChild(this.layers.effects);

        this.selectedCard = null;
        this.pendingAttack = null;

        this.state = null;
    }

    update(state) {
        this.state = state;
        this.renderBoard();
        this.renderHand();
        this.renderOpponent();
    }

    renderBoard() {
        const layer = this.layers.board;
        layer.removeChildren();

        const me = this.state.me;
        let x = 200;
        const y = this.app.renderer.height * 0.55;

        me.board.forEach(unit => {
            const card = renderUnitCard(unit);
            card.x = x;
            card.y = y;
            card.interactive = true;
            card.on("pointertap", () => this.onMyUnitClick(unit));
            layer.addChild(card);
            x += 160;
        });
    }

    renderHand() {
        const layer = this.layers.hand;
        layer.removeChildren();

        const me = this.state.me;

        let x = 200;
        const y = this.app.renderer.height - 200;

        me.hand.forEach(cardId => {
            const card = renderSpellMini(cardId);
            card.x = x;
            card.y = y;
            card.interactive = true;
            card.on("pointertap", () => this.onHandCardClick(cardId));
            layer.addChild(card);
            x += 140;
        });
    }

    renderOpponent() {
        const layer = this.layers.opponent;
        layer.removeChildren();

        const opp = this.state.opponents[0];
        if (!opp) return;

        let x = 200;
        const y = this.app.renderer.height * 0.18;

        opp.board.forEach(unit => {
            const card = renderUnitCard(unit);
            card.x = x;
            card.y = y;
            card.interactive = true;
            card.on("pointertap", () => this.onOpponentUnitClick(unit));
            layer.addChild(card);
            x += 160;
        });
    }

    // ======== INTERAÇÃO ========

    onHandCardClick(cardId) {
        this.selectedCard = cardId;
        alert("Selecione um alvo (oponente ou unidade)");
    }

    onOpponentUnitClick(unit) {
        if (this.pendingAttack) {
            this.ws.send(JSON.stringify({
                type: "intent",
                intent: {
                    type: "attack",
                    attackerId: this.pendingAttack,
                    targetId: unit.id
                }
            }));
            this.pendingAttack = null;
            return;
        }

        if (this.selectedCard) {
            this.ws.send(JSON.stringify({
                type: "intent",
                intent: { type: "play_card", cardId: this.selectedCard, targetId: unit.id }
            }));
            this.selectedCard = null;
        }
    }

    onMyUnitClick(unit) {
        this.pendingAttack = unit.id;
        alert("Selecione um alvo do oponente para atacar");
    }
}
