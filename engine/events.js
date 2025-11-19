// engine/events.js — simple event emitter tailored to game state
class Emitter {
  constructor() { this.listeners = {}; }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  off(ev, fn) { this.listeners[ev] = (this.listeners[ev] || []).filter(x=>x!==fn); }
  emit(ev, ctx) { const L = this.listeners[ev] || []; for (const fn of [...L]) fn(ctx); }
}

module.exports = { Emitter };
