TCG Engine MVP
==============
This is a minimal, working skeleton of the TCG engine we discussed.

How to run:
1. cd to project directory
   cd /mnt/data/tcg-engine-mvp
2. Install dependencies:
   npm install
3. Start dev server:
   npm run dev
4. Open two browser tabs and navigate to:
   http://localhost:3000
   Click 'Create/Join Match' in each tab to simulate two players.

Files included:
- server.js : static host + websocket server
- engine/    : core engine files (state, events, effects, resolver)
- data/cards/example_set.json : sample cards
- public/    : simple client (index.html + client.js) and frame template

Notes:
- This is an MVP: many improvements suggested in the conversation are not implemented here.
- If you'd like, I can now add more effects, keywords, PIXI renderer, or package as a zip you can download.

