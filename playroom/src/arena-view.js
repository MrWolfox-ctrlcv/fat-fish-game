export function arenaViewport(width, height) {
  const aspect = Math.max(1, width) / Math.max(1, height);
  const worldWidth = Math.max(860, 860 * aspect);
  const worldHeight = worldWidth / aspect;
  return { x: 640 - worldWidth / 2, y: 450 - worldHeight / 2, width: worldWidth, height: worldHeight };
}

export function worldPoint(x, y, box, viewport) {
  return { x: viewport.x + (x - box.left) / box.width * viewport.width,
    y: viewport.y + (y - box.top) / box.height * viewport.height };
}
