const clamp = (value, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;

export function makeBumperScene(game) {
  const player = game?.player;
  if (!player) return undefined;
  const edge = Math.max(0, game.arenaRadius - Math.hypot(player.x - 640, player.y - 450));
  const standings = [...(game.fighters || [])].sort((a, b) => b.kills - a.kills || a.falls - b.falls || a.id - b.id);
  const rank = standings.findIndex((fighter) => fighter.id === player.id) + 1;
  const point = (fighter) => ({ x: clamp(fighter.x, 0, 1280), y: clamp(fighter.y, 0, 900), alive: Boolean(fighter.alive) });
  return {
    player: { ...point(player), edge_distance: clamp(edge, 0, 1000), dash_ready: player.alive && player.dashCooldown <= 0, kills: clamp(player.kills, 0, 10000), falls: clamp(player.falls, 0, 10000), rank: clamp(rank, 1, 6) },
    opponents: (game.fighters || []).filter((fighter) => fighter !== player).slice(0, 5).map(point),
    arena_radius: clamp(game.arenaRadius, 0, 1000), remaining: clamp((game.duration || 90) - (game.time || 0), 0, 3600),
  };
}
