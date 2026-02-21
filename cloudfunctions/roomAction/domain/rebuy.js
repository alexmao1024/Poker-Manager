function validateRebuy(table, amount) {
  if (!table?.settled) {
    throw new Error("NOT_SETTLED");
  }
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("INVALID_REBUY");
  }
  const limit =
    table?.gameType === "zhajinhua"
      ? Number(table?.gameRules?.rebuyLimit || table?.gameRules?.buyIn || 0)
      : Number(table?.stack || 0);
  if (limit && value > limit) {
    throw new Error("REBUY_TOO_LARGE");
  }
  return value;
}

module.exports = { validateRebuy };
