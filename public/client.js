// client.js — conecta com servidor, repassa estado ao renderer

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

        if (data.type === "state") {
            if (!renderer) {
                renderer = new GameRenderer(playerId, ws);
            }
            renderer.update(data);
        }
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
