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

## Roadmap (o que vamos fazer a seguir, na ordem solicitada)
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
