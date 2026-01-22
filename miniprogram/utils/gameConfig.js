const GAME_TYPES = {
  TEXAS: "texas",
  ZHAJINHUA: "zhajinhua",
};

const defaultGameRules = {
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
    rebuyLimit: 2000,
    special235: true,
  },
};

module.exports = { GAME_TYPES, defaultGameRules };
