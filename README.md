# TCG Engine — MVP + Roadmap

Este repositório contém um **motor TCG data-driven** em Node.js (servidor autoritativo) e um cliente web mínimo para testes locais.

## O que já existe (MVP)
- Engine server-authoritative (Node.js + WebSocket)
- Data-driven cards (JSON)
- Event system / effects / keywords (básico)
- Stack of effects (simplified)
- Turn phases: DRAW → MAIN → COMBAT → END
- Targeting and basic attacks
- Now: **Mana system** (this commit)

## Como rodar (local)
1. `npm install`
2. `npm run dev`
3. Abra `http://localhost:3000` em 2 abas e clique **Create/Join Match** em cada uma.

## Arquitetura (resumo)
- `/engine` — core (state, events, effects, resolver)
- `/engine/keywords` — keywords modules (lifesteal, fury, lastbreath examples)
- `/data/cards` — card JSONs
- `/public` — client UI (minimal)

## Mudanças nesta fase — Mana system
- Cada jogador tem `maxMana` e `currentMana`.
- No início do turno (DRAW), `maxMana` aumenta em 1 (até 10) e `currentMana` é recarregado.
- Cartas podem ter `cost` no JSON; o servidor valida e subtrai o custo ao jogar.
- O cliente exibe mana (current / max).

## Roadmap (Qual a ideia - at´é aqui pelo menos)
1. **Sistema de Mana/Recursos** — *feito (esta versão)*  
2. **Sistema de Morte & Cleanup** — remover entidades mortas, ordem de resolução de mortes, garantir triggers `OnDie` e `LastBreath` funcionem antes da remoção.  
3. **Priority/Stack Avançado** — permitir respostas do oponente (fast/slow/burst), janela de prioridade e resolução por camadas (stack).  
4. **Renderer PIXI** — UI visual procedimental para cards (frames dinâmicos) e animações de summon/damage.  
5. **Keywords completo** — adicionar e testar keywords: Fury, Lifesteal, QuickAttack, Barrier, Poison, Regeneration.  
6. **Parser de scripts** — mini-linguagem para escrever efeitos em texto legível por designers.

## Como pedir o próximo passo
- Para evoluir para a **fase 2 (Morte / Cleanup)** rode:

  `Me leve para Fase 2` ou apenas responda **"Próximo: 2"**

## Notas de desenvolvimento
- O servidor é autoritativo: todas as validações são feitas no servidor.
- Use o `engine` como API programática para escrever testes/integrações.
- Exemplo de cartas em `/data/cards/example_set.json`.

---
## Fase 2 — Sistema de Morte & Cleanup
- Agora unidades com health ≤ 0 são marcadas para morte.
- Antes de remover:
  - dispara evento global `OnDie`
  - dispara keyword `lastbreath` se existir
- Efeitos desses triggers entram em stack normal.
- Após resolução, unidades são removidas do board.

### Fase 3 — Priority / Stack Avançado (Burst / Fast / Slow)

- Implementadas três velocidades:
  - **Burst** — resolve imediatamente (não abre janela de prioridade).
  - **Fast** — vai para a stack e pode ser respondida (abre prioridade).
  - **Slow** — vai para a stack e pode ser respondida (abre prioridade).
- Quando a primeira non-burst ação entra no stack, abre-se uma janela de prioridade.
  - Jogadores podem responder com Fast/Slow actions (ou jogar Burst which resolves immediately).
  - Jogadores podem **Pass**.
  - Quando **todos os jogadores passarem**, a pilha é resolvida **LIFO** (top primeiro).
- O servidor envia ao cliente `priority.active` e `stackDepth` no estado para permitir UI de respostas.
- `data/cards/*.json` agora pode ter `speed` (Burst/Fast/Slow) e `cost`.

### Fase 4 — PIXI Renderer (Client Visual)

- Cliente HTML substituído por renderer PIXI.js.
- Cartas visuais renderizadas com quadros, textos e stats.
- Mesa (board) e mão renderizados via containers PIXI.
- Seleção de alvo por clique em unidades.
- Suporte a "play card", "attack", "pass" e "end phase".
- Animações simples incluídas (flashRed).

### Fase 5 — Keywords completo (Fury, Lifesteal, QuickAttack, Challenger, Barrier, Poison, Regen)

- `lifesteal`: quando a unidade causa dano, cura o dono em igual quantidade.
- `fury`: quando uma unidade mata outra, ganha +1/+1.
- `quickattack`: faz o atacante aplicar seu dano antes da retaliação (é implementado via `OnAttack` e marca o ataque como `handled`).
- `challenger`: ao entrar, "provoca" (taunt) uma unidade inimiga simples (marca `provokedBy`).
- `barrier`: bloqueia o próximo dano (consome-se).
- `poison`: dano por contadores no início do turno do dono.
- `regen`: cura por contadores no início do turno do dono.

**Nota:** implementei keywords como módulos JS que são carregados automaticamente pelo `resolver`. Keywords reagem a eventos (OnEnter, OnAttack, OnDamageDealt, OnDie, OnTurnStart, ...). O motor principal emite eventos e o `events.js` chama `applyKeywordEvent` via `Engine.applyKeywordEvent` para disparar essas funções.


### Fase 7 — Zonas, Deckbuilding, Mulligan e Persistência

- Cada jogador tem zonas: `deck`, `hand`, `board`, `graveyard`, `exile`.
- Novos efeitos: `MoveToZone`, `ShuffleDeck`, `Mill`, etc.
- Deckbuilding: envie `intent` do tipo `set_deck` com uma lista de cardIds para configurar o deck antes da partida.
- Mulligan: envie `intent` do tipo `mulligan` com `keep: [cardId,...]` para escolher quais cartas manter da mão inicial; o restante volta para o deck e é embaralhado.
- Persistência: `engine.saveGameTo(path)` / `engine.loadGameFrom(path)` permitem exportar/importar estado para debugging ou replay.

### Fase 8 — Zonas avançadas, triggers de movimento e replacement effects

- Novas zonas: `banished` (removido permanentemente) e `limbo` (para efeitos em espera).
- `zones.moveBetweenZones(engine, ownerId, item, from, to, opts)` centraliza lógica de movimento de objetos entre zonas.
- Eventos lançados: `OnMove({item,from,to,ownerId})`, `OnEnterPlay`, `OnLeavePlay`, `OnEnterGraveyard`, `OnEnterExile`.
- Replacement effects declarativos: `replacement` no JSON de cartas permite substituir destino (ex.: "em vez de ir ao graveyard, vá para exile").
- Novos efeitos utilitários: `Recall`, `Obliterate`, `ReturnToHand`, `Revive`, `Reanimate`.
- A pipeline de morte processa replacements antes de mover entidades para zonas finais.

# PASSO 10 — Regiões / Fações / Campeões — KAOS Edition

Inclui:
- regions.json: definicoes de regiões (Solaris, Abyss, Natureborn, Mechanix, Chaos)
- engine/regions.js: loader + registrador de passivas regionais
- champion system: cada campeão tem campo `champion: true` e `evolveTo` com condição (ex.: playCount)
- resolver.js atualizado: integra regions, champions e eventos
- effects.js atualizado com GainAttackAllied e ChampionEvolve

Assinado: KAOS

### PASSO 11 — Turn System 2.0 (KAOS)

- Novo módulo: `/engine/turns.js` (TurnManager) — implementa fases:
  START -> DRAW -> MAIN -> ATTACK_DECLARE -> BLOCK_DECLARE -> DAMAGE_RESOLVE -> END
- Cada fase abre uma janela de prioridade. O TurnManager chama `engine.openPriority(playerId)` para abrir a janela.
- As ações automáticas do turno (draw, mana ramp) são executadas pelo TurnManager em `_autoActionsForPhase`.
- Integrar no resolver: no `start()` chame `this.turns.startGame()`; para avançar fases use `this.turns.nextPhase()`.
- O cliente agora exibe a fase atual (veja `client.js`).
- Arquivos assinados KAOS.

