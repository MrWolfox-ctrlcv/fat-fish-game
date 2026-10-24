// Identical deterministic streams are used by the browser and the verifier.
export function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  if (!state) state = 0x9e3779b9;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
  random.getState = () => state;
  return random;
}
