function calcPayAmount(rules, seen, targetBet) {
  const base = Number(targetBet || rules.baseBet || 0);
  return seen ? base * 2 : base;
}

function canCompare(rules, roundCount, seen) {
  return !!seen && (roundCount || 0) >= (rules.compareAllowedAfter || 3);
}

function advanceRound({ roundCount, maxRounds, allActed, allMatched }) {
  if (!allActed || !allMatched) {
    return { roundCount, forceShowdown: false };
  }
  const next = (roundCount || 0) + 1;
  return {
    roundCount: next,
    forceShowdown: next >= (maxRounds || 0),
  };
}

module.exports = { calcPayAmount, canCompare, advanceRound };
