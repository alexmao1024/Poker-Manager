function normalizeChipAdjustInput(input) {
  const mode = input?.mode;
  if (mode !== "add" && mode !== "sub") {
    throw new Error("INVALID_MODE");
  }
  const amount = Number(input?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    throw new Error("INVALID_AMOUNT");
  }
  const rawNote = typeof input?.note === "string" ? input.note.trim() : "";
  const note = rawNote ? rawNote.slice(0, 50) : "";
  const delta = mode === "sub" ? -amount : amount;
  return { delta, note };
}

function applyChipAdjustToPlayers(players, targetId, delta) {
  const nextPlayers = (players || []).map((player) => ({ ...player }));
  const idx = nextPlayers.findIndex((player) => player.id === targetId);
  if (idx < 0) {
    throw new Error("INVALID_TARGET");
  }
  const player = { ...nextPlayers[idx] };
  const nextStack = Number(player.stack || 0) + Number(delta || 0);
  if (!Number.isFinite(nextStack) || nextStack < 0) {
    throw new Error("STACK_NEGATIVE");
  }
  player.stack = nextStack;
  nextPlayers[idx] = player;
  return nextPlayers;
}

module.exports = {
  normalizeChipAdjustInput,
  applyChipAdjustToPlayers,
};
