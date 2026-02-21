function settlePot(players, winnersByPot) {
  const potSelections = Array.isArray(winnersByPot) ? winnersByPot : [];
  if (!potSelections.length) {
    throw new Error("NO_WINNERS");
  }

  const contributions = players.map((player) => ({
    id: player.id,
    total: (player.handBet || 0) + (player.bet || 0),
    status: player.status,
  }));
  const levels = Array.from(
    new Set(contributions.map((item) => item.total).filter((amount) => amount > 0))
  ).sort((a, b) => a - b);
  if (!levels.length) {
    throw new Error("NO_POT");
  }

  const payouts = new Map();
  let prevLevel = 0;
  for (let potIndex = 0; potIndex < levels.length; potIndex += 1) {
    const level = levels[potIndex];
    const participants = contributions.filter((item) => item.total >= level);
    const potAmount = (level - prevLevel) * participants.length;
    if (potAmount <= 0) {
      prevLevel = level;
      continue;
    }
    const eligibleIds = new Set(
      participants
        .filter((item) => item.status !== "fold" && item.status !== "out")
        .map((item) => item.id)
    );
    const selection = Array.isArray(potSelections[potIndex]) ? potSelections[potIndex] : [];
    const potWinners = players
      .filter((player) => eligibleIds.has(player.id) && selection.includes(player.id))
      .map((player) => player.id);
    const uniqueWinners = Array.from(new Set(potWinners));
    if (!uniqueWinners.length) {
      throw new Error("NO_POT_WINNER");
    }
    const share = Math.floor(potAmount / uniqueWinners.length);
    let remainder = potAmount - share * uniqueWinners.length;
    for (const winnerId of uniqueWinners) {
      const bonus = remainder > 0 ? 1 : 0;
      const current = payouts.get(winnerId) || 0;
      payouts.set(winnerId, current + share + bonus);
      remainder -= bonus;
    }
    prevLevel = level;
  }

  return players.map((player) => {
    const reward = payouts.get(player.id) || 0;
    const next = { ...player };
    next.stack += reward;
    next.bet = 0;
    next.handBet = 0;
    if (next.left) {
      next.status = "fold";
      return next;
    }
    if (next.stack <= 0) {
      next.status = "out";
    } else {
      next.status = "active";
    }
    return next;
  });
}

module.exports = { settlePot };
