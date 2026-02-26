function buildMergedPots(players) {
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

  let prevLevel = 0;
  const pots = [];
  for (let potIndex = 0; potIndex < levels.length; potIndex += 1) {
    const level = levels[potIndex];
    const participants = contributions.filter((item) => item.total >= level);
    const potAmount = (level - prevLevel) * participants.length;
    prevLevel = level;
    if (potAmount <= 0) {
      continue;
    }
    const eligible = participants
      .filter((item) => item.status !== "fold" && item.status !== "out")
      .map((item) => item.id)
      .sort();
    const lastPot = pots[pots.length - 1];
    if (!eligible.length) {
      if (lastPot) {
        // Dead money layer (all contributors already folded): merge into previous contestable pot.
        lastPot.amount += potAmount;
      }
      continue;
    }
    const signature = eligible.join("|");
    if (lastPot && lastPot.signature === signature) {
      lastPot.amount += potAmount;
      continue;
    }
    pots.push({ amount: potAmount, eligibleIds: new Set(eligible), signature });
  }
  return pots;
}

function settlePot(players, winnersByPot) {
  const potSelections = Array.isArray(winnersByPot) ? winnersByPot : [];
  if (!potSelections.length) {
    throw new Error("NO_WINNERS");
  }

  const pots = buildMergedPots(players);
  const payouts = new Map();
  for (let potIndex = 0; potIndex < pots.length; potIndex += 1) {
    const pot = pots[potIndex];
    const selection = Array.isArray(potSelections[potIndex]) ? potSelections[potIndex] : [];
    const potWinners = players
      .filter((player) => pot.eligibleIds.has(player.id) && selection.includes(player.id))
      .map((player) => player.id);
    const uniqueWinners = Array.from(new Set(potWinners));
    if (!uniqueWinners.length) {
      throw new Error("NO_POT_WINNER");
    }
    const share = Math.floor(pot.amount / uniqueWinners.length);
    let remainder = pot.amount - share * uniqueWinners.length;
    for (const winnerId of uniqueWinners) {
      const bonus = remainder > 0 ? 1 : 0;
      const current = payouts.get(winnerId) || 0;
      payouts.set(winnerId, current + share + bonus);
      remainder -= bonus;
    }
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

module.exports = { settlePot, buildMergedPots };
