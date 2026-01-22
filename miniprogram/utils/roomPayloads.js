const { GAME_TYPES, defaultGameRules } = require("./gameConfig");

function buildCreateRoomPayload(form) {
  const gameType = form?.gameType || GAME_TYPES.TEXAS;
  if (gameType === GAME_TYPES.ZHAJINHUA) {
    const rules = defaultGameRules.zhj;
    const baseBet = Number(form?.zhjBaseBet || rules.baseBet);
    const buyIn = Number(form?.zhjBuyIn || rules.buyIn);
    const maxRounds = Number(form?.zhjMaxRounds || rules.maxRounds);
    const minSeeRound = Number(form?.zhjMinSeeRound || rules.minSeeRound);
    const maxSeats = Number(form?.seatCount || rules.maxSeats);
    return {
      gameType,
      maxSeats,
      stack: buyIn,
      gameRules: {
        baseBet,
        buyIn,
        maxRounds,
        minSeeRound,
        compareAllowedAfter: rules.compareAllowedAfter,
        rebuyLimit: buyIn,
        special235: true,
      },
    };
  }

  const rules = defaultGameRules.texas;
  return {
    gameType,
    maxSeats: Math.min(rules.maxSeats, Math.max(2, Number(form?.seatCount || 0))),
    stack: Number(form?.stack || rules.stack),
    blinds: {
      sb: Number(form?.sb || rules.blinds.sb),
      bb: Number(form?.bb || rules.blinds.bb),
    },
  };
}

module.exports = { buildCreateRoomPayload };
