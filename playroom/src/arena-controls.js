const LIMIT = 54;
const DEAD = 8;
function stick(x, y) {
  const distance = Math.hypot(x, y);
  if (distance <= DEAD) return { x: 0, y: 0, active: false };
  const strength = Math.min(1, (distance - DEAD) / (LIMIT - DEAD));
  return { x: x / distance * strength, y: y / distance * strength, active: true };
}

// Pointer positions are CSS pixels, independent of canvas resolution and arena camera.
export function createArenaControls() {
  const fingers = new Map();
  let mouse = null;
  let direction = null;
  return {
    begin(id, x, y, width) {
      if (fingers.has(id)) return null;
      const role = x < width / 2 ? 'move' : 'aim';
      if ([...fingers.values()].some((finger) => finger.role === role)) return null;
      fingers.set(id, { id, role, baseX: x, baseY: y, x, y, dx: 0, dy: 0, active: false });
      return role;
    },
    move(id, x, y) {
      const finger = fingers.get(id);
      if (!finger) return;
      finger.x = x; finger.y = y;
      const vector = stick(x - finger.baseX, y - finger.baseY);
      finger.dx = vector.x; finger.dy = vector.y; finger.active = vector.active;
      if (finger.role === 'aim' && vector.active) {
        const length = Math.hypot(vector.x, vector.y);
        direction = { x: vector.x / length, y: vector.y / length };
        mouse = null;
      }
    },
    end(id, cancelled = false) {
      const finger = fingers.get(id);
      fingers.delete(id);
      return Boolean(finger && finger.role === 'aim' && finger.active && !cancelled);
    },
    setMouseAim(point) {
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) { mouse = { ...point }; direction = null; }
    },
    input(player) {
      const move = [...fingers.values()].find((finger) => finger.role === 'move');
      const target = mouse || (direction && player ? { x: player.x + direction.x * 200, y: player.y + direction.y * 200 } : null);
      return { moveX: move?.dx || 0, moveY: move?.dy || 0, aimX: target?.x, aimY: target?.y };
    },
    sticks() { return [...fingers.values()].map((finger) => ({ ...finger })); },
    clear(resetAim = false) { fingers.clear(); if (resetAim) { mouse = null; direction = null; } },
  };
}
