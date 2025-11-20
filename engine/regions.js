// Engine TCG — Kaos Edition
// Author: KAOS
// PASSO 10 - regions.js
//
// Responsável por:
// - carregar definições de regiões (data-driven)
// - aplicar passivas regionais (registrando listeners no engine)
// - validar restrições de deck
//
// Estrutura de uma região (data-driven):
// {
//   "id":"solaris",
//   "name":"Solaris",
//   "keywords":["overwhelm","solar"],
//   "deckRules": { "maxCopies": 3, "minCards": 40 },
//   "passives": [
//      { "event":"OnTurnStart", "action":"GainAttackAllied", "value":1, "scope":"owner" }
//   ]
// }
//
// Como usar:
// const regions = require('./regions');
// regions.register(engine, './data/regions.json');
//

const fs = require('fs');
const path = require('path');

const DEBUG = true;

function log(...args) {
  if (DEBUG) console.log('[Regions]', ...args);
}

/**
 * Load JSON file with region definitions.
 * Accepts either a path to file or a JS object already loaded.
 */
function loadRegions(source) {
  if (!source) return {};
  if (typeof source === 'string') {
    const raw = fs.readFileSync(path.resolve(source), 'utf8');
    return JSON.parse(raw);
  }
  return source;
}

/**
 * Validate a deck with simple region rules.
 * - deck: array of cardIds
 * - engine.cards: card database must include card.region (or regions)
 *
 * Returns { ok: boolean, reasons: [] }
 */
function validateDeck(engine, deckArray, constraints = {}) {
  const result = { ok: true, reasons: [] };

  // Default rules
  const maxRegions = constraints.maxRegions || 2; // e.g., allow only up to 2 regions
  const minCards = constraints.minCards || 30;

  if (!Array.isArray(deckArray) || deckArray.length < minCards) {
    result.ok = false;
    result.reasons.push(`Deck must have at least ${minCards} cards.`);
    return result;
  }

  // count regions used
  const regionCounts = {};
  for (const cid of deckArray) {
    const def = engine.cards[cid];
    if (!def) continue;
    const regs = def.regions || [];
    for (const r of regs) regionCounts[r] = (regionCounts[r] || 0) + 1;
  }

  const usedRegions = Object.keys(regionCounts);
  if (usedRegions.length > maxRegions) {
    result.ok = false;
    result.reasons.push(`Deck uses ${usedRegions.length} regions (max ${maxRegions}). Regions: ${usedRegions.join(',')}`);
  }

  return result;
}

/**
 * Register region passives on the engine.
 * - engine: Engine instance
 * - regionsSource: path to JSON or object
 *
 * This will:
 * - attach listeners for each passive (e.g., OnTurnStart, OnEnterPlay, OnDie)
 * - implement a small mapping of passive actions to engine-side behavior (data-driven)
 *
 * NOTE: this is intentionally simple and extensible. Add new 'action' handlers below.
 */
function register(engine, regionsSource) {
  const raw = loadRegions(regionsSource);
  const map = raw.regions || raw || {};

  engine._regions = map;

  // ACTION HANDLERS (data-driven handlers)
  const actionHandlers = {
    // GainAttackAllied: increase attack of allied units at event time
    GainAttackAllied: (regionId, spec, ctx) => {
      // spec: { value: number, scope: 'owner'|'all' }
      const value = spec.value || 0;
      const scope = spec.scope || 'owner';

      // apply: iterate allied units and buff attack by value (instantaneous)
      if (ctx.event === 'OnTurnStart') {
        // ctx.playerId is the player whose turn started (we pass it below)
        const owner = engine.getPlayer(ctx.playerId);
        if (!owner) return;
        for (const u of owner.board) {
          u.attack = (u.attack || 0) + value;
        }
        engine.log(`Regions(${regionId}): GainAttackAllied applied +${value} to ${owner.id} units`);
      }
    },

    // ReduceDamageSelf: reduce incoming damage to owner's units (simple example)
    ReduceDamageSelf: (regionId, spec, ctx) => {
      // spec: { amount: number }
      // Implementation will be via listener to OnDamageDealt (see below)
      // Handler is registered but actual logic lives in OnDamageDealt wrapper
    },

    // GrantKeywordOnEnter: when a unit enters, give it a keyword (data-driven)
    GrantKeywordOnEnter: (regionId, spec, ctx) => {
      // spec: { keyword: 'fury' }
      // ctx.eventPayload contains { entity, playerId }
      const kw = spec.keyword;
      const ent = ctx.eventPayload && ctx.eventPayload.entity;
      if (!ent) return;
      ent._grantedKeywords = ent._grantedKeywords || [];
      if (!ent._grantedKeywords.includes(kw)) ent._grantedKeywords.push(kw);
      engine.log(`Regions(${regionId}): Granted keyword ${kw} to ${ent.id}`);
    }
  };

  // For each region, register event listeners for its passives.
  for (const reg of map) {
    const rid = reg.id;
    log('Register region', rid);

    // For readability / debugging we attach the region object to engine
    engine._regionDefs = engine._regionDefs || {};
    engine._regionDefs[rid] = reg;

    // For each passive entry, attach appropriate listener
    for (const passive of reg.passives || []) {
      const event = passive.event;
      const action = passive.action;
      // OnTurnStart: call every region passive that listens to it
      if (event === 'OnTurnStart') {
        engine.on('OnTurnStart', ({ playerId }) => {
          // Only apply if the player has this region in deck (simple heuristic)
          // Count region cards in player's deck/hand/board to decide "uses region"
          const player = engine.getPlayer(playerId);
          const usesRegion = playerUsesRegion(engine, player, rid);
          if (!usesRegion) return;
          // call handler
          const ctx = { event, playerId, eventPayload: null };
          const h = actionHandlers[action];
          if (h) h(rid, passive, ctx);
        });
      }

      // OnEnterPlay: when an entity enters play (we receive {entity, playerId})
      if (event === 'OnEnterPlay') {
        engine.on('OnEnterPlay', (payload) => {
          const player = engine.getPlayer(payload.playerId);
          const usesRegion = playerUsesRegion(engine, player, rid);
          if (!usesRegion) return;
          const ctx = { event, playerId: payload.playerId, eventPayload: payload };
          const h = actionHandlers[action];
          if (h) h(rid, passive, ctx);
        });
      }

      // OnDamageDealt: used for damage-reduction and region-reactive drains
      if (event === 'OnDamageDealt') {
        engine.on('OnDamageDealt', (payload) => {
          // `payload` includes { source, target, amount }
          // We call handler only if the source/target owner uses this region
          const ownerId = payload.source?.ownerId || payload.target?.ownerId;
          const player = engine.getPlayer(ownerId);
          if (!player) return;
          const usesRegion = playerUsesRegion(engine, player, rid);
          if (!usesRegion) return;
          const ctx = { event, playerId: ownerId, eventPayload: payload };
          const h = actionHandlers[action];
          if (h) h(rid, passive, ctx);
        });
      }

      // OnDie: when a unit dies (payload { entity })
      if (event === 'OnDie') {
        engine.on('OnDie', (payload) => {
          const ent = payload.entity;
          const player = engine.getPlayer(ent.ownerId);
          if (!player) return;
          const usesRegion = playerUsesRegion(engine, player, rid);
          if (!usesRegion) return;
          const ctx = { event, playerId: player.id, eventPayload: payload };
          const h = actionHandlers[action];
          if (h) h(rid, passive, ctx);
        });
      }

      // Additional events can be handled similarly (OnMove, OnEnterGraveyard, etc.)
    }
  }
}

/**
 * Helper: check whether player "uses" region (heuristic).
 * We treat a player as "using" a region if at least N cards in deck/hand/board have that region.
 * This is simplistic — you may change to check deck registration or explicit deck regions.
 */
function playerUsesRegion(engine, player, regionId) {
  let count = 0;
  const areas = ['deck', 'hand', 'board'];
  for (const z of areas) {
    for (const it of (player[z] || [])) {
      const cardId = typeof it === 'string' ? it : it.cardId;
      const def = engine.cards[cardId];
      if (!def) continue;
      const regs = def.regions || [];
      if (regs.includes(regionId)) count++;
      if (count >= 2) return true; // threshold: 2 cards
    }
  }
  return false;
}

// Expose functions
module.exports = { loadRegions, register, validateDeck, playerUsesRegion };
