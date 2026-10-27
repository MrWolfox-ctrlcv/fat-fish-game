/** Local-only gate. Deliberately does not consult storage or infer production mode. */
export function isLocalCheatAllowed(locationLike) {
  if (!locationLike || new URLSearchParams(locationLike.search || "").get("cheat") !== "1") return false;
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(String(locationLike.hostname || "").toLowerCase());
}

export function chooseAutoDropX(game, level) {
  const matches = game.bodies.filter((body) => body.level === level && level < 11);
  if (!matches.length) return game.width / 2;
  const target = matches.reduce((best, body) => body.y > best.y ? body : best);
  return Math.max(30, Math.min(game.width - 30, target.x));
}
