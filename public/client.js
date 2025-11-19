// client.js — minimal client (WebSocket) to interact with server
const ws = new WebSocket(`ws://${location.host}`);
let playerId = null;
ws.addEventListener('open', ()=> console.log('ws open'));
ws.addEventListener('message', ev=>{
  const data = JSON.parse(ev.data);
  if (data.type === 'joined') { playerId = data.playerId; document.getElementById('info').innerText = 'Joined as ' + playerId; }
  if (data.type === 'state') renderState(data);
});

document.getElementById('join').addEventListener('click', ()=>{
  ws.send(JSON.stringify({ type:'create_match' }));
});

function renderState(state){
  const handDiv = document.getElementById('hand'); handDiv.innerHTML = '<h3>Hand</h3>';
  state.me.hand.forEach(cid => {
    const b = document.createElement('button'); b.innerText = cid; b.onclick = ()=> playCard(cid); handDiv.appendChild(b);
  });

  const boardDiv = document.getElementById('board'); boardDiv.innerHTML = '<h3>Board</h3>';
  state.me.board.forEach(u => { const d = document.createElement('div'); d.innerText = `${u.cardId} (${u.attack}/${u.health})`; boardDiv.appendChild(d); });

  const oppDiv = document.getElementById('info');
  oppDiv.innerHTML += `<div>Opponents: ${state.opponents.map(o=>o.id).join(',')}</div>`;
}

function playCard(cardId){
  ws.send(JSON.stringify({ type:'intent', intent: { type:'play_card', cardId } }));
}
