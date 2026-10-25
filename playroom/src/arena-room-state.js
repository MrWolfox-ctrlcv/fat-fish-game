export function shouldResetRoomGame(previousRoom, nextRoom, gamePhase, snapshotPhase) {
  if (!nextRoom) return false;
  if (!previousRoom || String(previousRoom.code) !== String(nextRoom.code)) return true;
  const startsAgain = previousRoom.phase !== 'playing' && nextRoom.phase === 'playing';
  return startsAgain && (gamePhase === 'ended' || gamePhase === 'won' || gamePhase === 'lost' || gamePhase === 'draw' || snapshotPhase === 'ended');
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
    if (event.type === 'friendly-fire') {
      const attacker = Number(event.attackerId ?? event.by);
      return attacker === self ? [{ ...event, playerFriendlyFire: true, attackerId: self, victimId: Number(event.victimId ?? event.id) }] : [];
    }
    if (event.type === 'fall') {
      return Number(event.id) === self ? [{ ...event, playerFall: true, id: self }] : [];
    }
    return Number(event.by ?? event.id) === self ? [{ ...event }] : [];
  });
}

export function teamOutcome(teamScores, teamId) {
  if (!Array.isArray(teamScores) || (teamId !== 0 && teamId !== 1)) return 'lost';
  const own = Number(teamScores[teamId]);
  const other = Number(teamScores[teamId === 0 ? 1 : 0]);
  if (!Number.isFinite(own) || !Number.isFinite(other)) return 'lost';
  return own === other ? 'draw' : own > other ? 'won' : 'lost';
}

export function getTeamEventText(event, selfId) {
  const attacker = Number(event?.attackerId ?? event?.by ?? event?.id);
  const isSelfAttacker = event?.playerKill === true || event?.playerFriendlyFire === true || (selfId !== undefined && attacker === Number(selfId));
  if ((event?.type === 'friendly-fire' || event?.friendlyFire || event?.playerFriendlyFire) && isSelfAttacker) return '乌龙！误伤队友，己方−1';
  if (event?.type === 'kill' && isSelfAttacker) return '+1';
  return '';
}
