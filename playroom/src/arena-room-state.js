export function shouldResetRoomGame(previousRoom, nextRoom, gamePhase, snapshotPhase) {
  if (!nextRoom) return false;
  if (!previousRoom || String(previousRoom.code) !== String(nextRoom.code)) return true;
  const startsAgain = previousRoom.phase !== 'playing' && nextRoom.phase === 'playing';
  return startsAgain && (gamePhase === 'ended' || gamePhase === 'won' || gamePhase === 'lost' || snapshotPhase === 'ended');
}

export function isRoomEntryIntent(hash, search) {
  if (hash === '#room-card') return true;
  const code = new URLSearchParams(search).get('room') || '';
  return /^\d{6}$/.test(code);
}

export function attributeRoomEvents(events, selfId) {
  const self = Number(selfId);
  return (Array.isArray(events) ? events : []).flatMap((event) => {
    if (!event || typeof event !== 'object') return [];
    if (event.type === 'end') return [{ ...event }];
    if (event.type === 'kill') {
      const attacker = Number(event.attackerId ?? event.by ?? event.id);
      return attacker === self ? [{ ...event, playerKill: true, attackerId: self, victimId: Number(event.victimId ?? event.targetId ?? event.id) }] : [];
    }
    if (event.type === 'fall') {
      return Number(event.id) === self ? [{ ...event, playerFall: true, id: self }] : [];
    }
    return Number(event.by ?? event.id) === self ? [{ ...event }] : [];
  });
}
