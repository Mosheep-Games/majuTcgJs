// client.js — minimal client (WebSocket) with basic targeting UI
const ws = new WebSocket(`ws://${location.host}`);
let playerId = null;
let myState = null;
ws.addEventListener('open', ()=> console.log('ws open'));
ws.addEventListener('message', ev=>{
  const data = JSON.parse(ev.data);
  if (data.type === 'joined') { playerId = data.playerId; document.getElementById('info').innerText = 'Joined as ' + playerId; }
  if (data.type === 'state') { myState = data; renderState(data); }
});

document.getElementById('join').addEventListener('click', ()=>{
  ws.send(JSON.stringify({ type:'create_match' }));
});

function renderState(state){
  const handDiv = document.getElementById('hand'); handDiv.innerHTML = '<h3>Hand</h3>';
  state.me.hand.forEach(cid => {
    const b = document.createElement('button'); b.innerText = cid; b.onclick = ()=> playCardPrompt(cid); handDiv.appendChild(b);
  });

  const boardDiv = document.getElementById('board'); boardDiv.innerHTML = '<h3>Board</h3>';
  state.me.board.forEach(u => { const d = document.createElement('div'); d.innerText = `${u.id}: ${u.cardId} (${u.attack}/${u.health})`; boardDiv.appendChild(d); });

  const oppDiv = document.getElementById('opponents'); oppDiv.innerHTML = '<h3>Opponents</h3>';
  state.opponents.forEach(o => {
    const container = document.createElement('div');
    container.innerHTML = `<div>${o.id}</div>`;
    o.board.forEach(u => {
      const btn = document.createElement('button');
      btn.innerText = `${u.id}: ${u.cardId} (${u.attack}/${u.health})`;
      btn.onclick = ()=> selectTarget(u.id);
      container.appendChild(btn);
    });
    oppDiv.appendChild(container);
  });

  const turnDiv = document.getElementById('turn'); turnDiv.innerHTML = `<strong>Turn:</strong> ${state.turn.number} <strong>Player:</strong> ${state.turn.currentPlayerId} <strong>Phase:</strong> ${state.turn.phase}`;

  // control buttons
  const controls = document.getElementById('controls'); controls.innerHTML = '';
  const endPhase = document.createElement('button'); endPhase.innerText = 'End Phase'; endPhase.onclick = ()=> ws.send(JSON.stringify({ type:'intent', intent: { type:'end_phase' } })); controls.appendChild(endPhase);

  // attack UI: list my units and allow selecting attacker then target
  const attackDiv = document.getElementById('attack'); attackDiv.innerHTML = '<h3>Attack</h3>';
  state.me.board.forEach(u => {
    const aBtn = document.createElement('button'); aBtn.innerText = `Attack with ${u.id}`; aBtn.onclick = ()=> startAttack(u.id); attackDiv.appendChild(aBtn);
  });
}

let pendingPlay = null;
function playCardPrompt(cardId){
  // ask if there's a target selection in opponents entities
  if (!myState) return;
  const possibleTargets = [];
  myState.opponents.forEach(o=> o.board.forEach(u=> possibleTargets.push(u)));
  if (possibleTargets.length === 0) {
    // play without target
    ws.send(JSON.stringify({ type:'intent', intent: { type:'play_card', cardId } }));
    return;
  }
  pendingPlay = cardId;
  alert('Select a target on opponent board by clicking its button');
}

function selectTarget(targetId){
  if (pendingPlay) {
    ws.send(JSON.stringify({ type:'intent', intent: { type:'play_card', cardId: pendingPlay, targetId } }));
    pendingPlay = null;
    return;
  }
  // otherwise selects for attack target (handled by startAttack)
  if (window._pendingAttacker) {
    ws.send(JSON.stringify({ type:'intent', intent: { type:'attack', attackerId: window._pendingAttacker, targetId } }));
    window._pendingAttacker = null;
    return;
  }
}

function startAttack(attackerId){
  window._pendingAttacker = attackerId;
  alert('Select an opponent unit to attack by clicking its button');
}

function playCard(cardId){
  ws.send(JSON.stringify({ type:'intent', intent: { type:'play_card', cardId } }));
}
