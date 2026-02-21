const defaultRules = {
  texas: {
    blinds: { sb: 10, bb: 20 },
    stack: 2000,
    maxSeats: 9,
    actionTimeoutSec: 60,
  },
  zhj: {
    baseBet: 10,
    buyIn: 2000,
    maxSeats: 12,
    maxRounds: 20,
    minSeeRound: 3,
    compareAllowedAfter: 3,
  },
};

function normalizeGameRules(gameType, input) {
  if (gameType === "zhajinhua") {
    const baseBet = Number(input?.baseBet || defaultRules.zhj.baseBet);
    const buyIn = Number(input?.buyIn || defaultRules.zhj.buyIn);
    const maxSeats = Math.min(12, Math.max(2, Number(input?.maxSeats || defaultRules.zhj.maxSeats)));
    const maxRounds = Number(input?.maxRounds || defaultRules.zhj.maxRounds);
    const minSeeRound = Number(input?.minSeeRound || defaultRules.zhj.minSeeRound);
    return {
      gameType: "zhajinhua",
      rules: {
        baseBet,
        buyIn,
        maxSeats,
        maxRounds,
        minSeeRound,
        compareAllowedAfter: Number(input?.compareAllowedAfter || 3),
        rebuyLimit: buyIn,
        special235: true,
      },
    };
  }

  const blinds = input?.blinds || defaultRules.texas.blinds;
  const stack = Number(input?.stack || defaultRules.texas.stack);
  const maxSeats = Math.min(9, Math.max(2, Number(input?.maxSeats || defaultRules.texas.maxSeats)));
  return {
    gameType: "texas",
    rules: {
      blinds: { sb: Number(blinds.sb), bb: Number(blinds.bb) },
      stack,
      maxSeats,
      actionTimeoutSec: Number(input?.actionTimeoutSec || defaultRules.texas.actionTimeoutSec),
    },
  };
}

module.exports = { normalizeGameRules };
