// engine/events.js — simple event emitter tailored to game state
class Emitter {
  constructor() { this.listeners = {}; }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  off(ev, fn) { this.listeners[ev] = (this.listeners[ev] || []).filter(x=>x!==fn); }

  emit(ev, ctx) {
    const L = this.listeners[ev] || [];
    // call registered listeners first
    for (const fn of [...L]) fn(ctx);
    // if this emitter is part of an Engine that supports keywords, run them too
    try {
      if (this && this.applyKeywordEvent && typeof this.applyKeywordEvent === 'function') {
        this.applyKeywordEvent(ev, ctx);
      }
    } catch (e) {
      console.error('[Emitter] error applying keywords for', ev, e);
    }
  }
}

module.exports = { Emitter };
