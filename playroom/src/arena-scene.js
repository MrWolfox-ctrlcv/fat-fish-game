// Pure drawing; the page caches this layer and only rebuilds when the ring shrinks.
export function drawArenaFloor(ctx, radius) {
  const x = 640, y = 450, tau = Math.PI * 2;
  ctx.clearRect(0, 0, 1280, 900);
  ctx.fillStyle = '#172a45'; ctx.fillRect(0, 0, 1280, 900);
  for (let i = 0; i < 65; i++) {
    ctx.fillStyle = i % 3 ? '#b0dce00a' : '#b0dce016';
    ctx.beginPath(); ctx.arc((i * 193 + 37) % 1280, (i * 317 + 81) % 900, 2 + i % 3, 0, tau); ctx.fill();
  }
  ctx.save();
  ctx.shadowColor = '#071a34aa'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 24;
  ctx.beginPath(); ctx.arc(x, y + 8, radius + 10, 0, tau); ctx.fillStyle = '#24485c'; ctx.fill();
  ctx.restore();
  const rim = ctx.createLinearGradient(0, y - radius, 0, y + radius);
  rim.addColorStop(0, '#f4ead4'); rim.addColorStop(.45, '#c6dad3'); rim.addColorStop(1, '#83b5b6');
  ctx.beginPath(); ctx.arc(x, y, radius + 5, 0, tau); ctx.fillStyle = rim; ctx.fill();
  const surface = ctx.createRadialGradient(x - 120, y - 170, 30, x, y, radius);
  surface.addColorStop(0, '#f7f6e5'); surface.addColorStop(.7, '#e7efdc'); surface.addColorStop(1, '#c8dfcf');
  ctx.beginPath(); ctx.arc(x, y, radius - 4, 0, tau); ctx.fillStyle = surface; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, radius - 15, 0, tau); ctx.strokeStyle = '#d9aa9d'; ctx.lineWidth = 18; ctx.stroke();
  for (let i = 0; i < 72; i++) {
    const a = i / 72 * tau;
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (radius - 23), y + Math.sin(a) * (radius - 23));
    ctx.lineTo(x + Math.cos(a) * (radius - 8), y + Math.sin(a) * (radius - 8));
    ctx.strokeStyle = '#fce8d9a8'; ctx.lineWidth = 3; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(x, y, radius - 42, 0, tau); ctx.strokeStyle = '#719d8a33'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 11]); ctx.stroke(); ctx.setLineDash([]);
  for (const r of [110, 220]) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, tau); ctx.strokeStyle = '#86a38e14'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = '#739b8a33'; ctx.lineWidth = 3;
  for (let row = -1; row <= 1; row++) {
    ctx.beginPath(); ctx.moveTo(-32, row * 14); ctx.quadraticCurveTo(-16, row * 14 - 14, 0, row * 14); ctx.quadraticCurveTo(16, row * 14 + 14, 32, row * 14); ctx.stroke();
  }
  ctx.fillStyle = '#789b892b'; ctx.font = '600 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('STAY BOUNCY', 0, 53); ctx.restore();
}
