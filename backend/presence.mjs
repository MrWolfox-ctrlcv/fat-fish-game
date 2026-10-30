const GAMES = ['fat-fish', 'bumper', 'survivor'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createPresence({ now = Date.now, ttl = 90000, maxEntries = 2000 } = {}) {
  const entries = new Map();

  function prune(time) {
    for (const [id, entry] of entries) {
      if (time - entry.lastSeen >= ttl) entries.delete(id);
    }
  }

  return {
    touch({ sessionId, game = 'fat-fish', playing = true } = {}) {
      if (typeof sessionId !== 'string' || !UUID.test(sessionId) || !GAMES.includes(game)) return false;
      const time = now();
      prune(time);
      const prior = entries.get(sessionId);
      if (!prior && entries.size >= maxEntries) return false;
      entries.set(sessionId, { game, playing: Boolean(playing), lastSeen: time });
      return true;
    },
    leave(sessionId) {
      return entries.delete(sessionId);
    },
    stats() {
      const time = now();
      prune(time);
      const games = Object.fromEntries(GAMES.map(game => [game, { online: 0, playing: 0 }]));
      let online = 0;
      let playing = 0;
      for (const entry of entries.values()) {
        online++;
        games[entry.game].online++;
        if (entry.playing) {
          playing++;
          games[entry.game].playing++;
        }
      }
      return { online, playing, games };
    }
  };
}
