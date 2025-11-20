// client.js — conecta com servidor, repassa estado ao renderer

// no topo, garanta que existam elementos
const phaseEl = document.createElement('div');
phaseEl.id = 'phaseIndicator';
phaseEl.style.position = 'absolute';
phaseEl.style.top = '10px';
phaseEl.style.right = '10px';
phaseEl.style.background = 'rgba(0,0,0,0.5)';
phaseEl.style.padding = '6px 10px';
phaseEl.style.borderRadius = '6px';
phaseEl.style.color = '#fff';
phaseEl.style.zIndex = 9999;
document.body.appendChild(phaseEl);

let ws = null;
let playerId = null;
let renderer = null;

function connect() {
    ws = new WebSocket(`ws://${location.host}`);
    ws.onopen = () => console.log("WebSocket open");

    ws.onmessage = (ev) => {
        const data = JSON.parse(ev.data);

        if (data.type === "joined") {
            playerId = data.playerId;
            document.getElementById("info").innerText =
                "Joined as: " + playerId;
        }

        /*if (data.type === "state") {
            if (!renderer) {
                renderer = new GameRenderer(playerId, ws);
            }*/

            if (data.turn) {
                const phase = data.turn.phase || (data.turn.currentPhase || 'MAIN');
                phaseEl.innerText = `Turn ${data.turn.number || 1} — Phase: ${phase}`;
               }
            renderer.update(data);
        
    };
}

document.getElementById("joinBtn").onclick = () => {
    ws.send(JSON.stringify({
        type: "create_match"
    }));
};

document.getElementById("passBtn").onclick = () => {
    ws.send(JSON.stringify({
        type: "intent",
        intent: { type: "pass" }
    }));
};

document.getElementById("endBtn").onclick = () => {
    ws.send(JSON.stringify({
        type: "intent",
        intent: { type: "end_phase" }
    }));
};

connect();
