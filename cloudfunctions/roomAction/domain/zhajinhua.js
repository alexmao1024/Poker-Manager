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

function getIndexByOffset(length, base, offset) {
  if (!length) return 0;
  const raw = (base + offset) % length;
  return raw < 0 ? raw + length : raw;
}

function getNextActiveIndex(players, startIndex) {
  if (!players?.length) return 0;
  const size = players.length;
  for (let offset = 1; offset <= size; offset += 1) {
    const index = (startIndex + offset) % size;
    if (players[index]?.status === "active") return index;
  }
  return startIndex;
}

function calcCurrentBet(players) {
  return (players || []).reduce((max, player) => Math.max(max, player.bet || 0), 0);
}

function calcTurnExpiresAt(now, timeoutSec, round, hasTurn) {
  if (!timeoutSec || timeoutSec <= 0) return null;
  if (round === "showdown") return null;
  if (!hasTurn) return null;
  return now + timeoutSec * 1000;
}

function assertExpected(table, expected) {
  if (!expected) return;
  if (typeof expected.turnIndex === "number" && table.turnIndex !== expected.turnIndex) {
    throw new Error("TURN_CHANGED");
  }
  if (typeof expected.round === "string" && table.round !== expected.round) {
    throw new Error("ROUND_CHANGED");
  }
  if (typeof expected.settled === "boolean" && table.settled !== expected.settled) {
    throw new Error("SETTLED_CHANGED");
  }
}

function assertStarted(table) {
  if (table.status !== "active") {
    throw new Error("NOT_STARTED");
  }
}

function applyZhjAction({ table, type, raiseTo, targetId, result, expected, openId, now }) {
  assertStarted(table);
  assertExpected(table, expected);
  if (table.round === "showdown" || table.zjhStage === "showdown") {
    throw new Error("ROUND_OVER");
  }

  const rules = table.gameRules || {};
  const players = (table.players || []).map((player) => ({ ...player }));
  if (!players.length) return { players };

  const turnIndex = Math.min(table.turnIndex || 0, players.length - 1);
  const player = { ...players[turnIndex] };
  if (!player || player.status !== "active") {
    throw new Error("NOT_ACTIVE");
  }
  if (!player.openId) {
    throw new Error("SEAT_UNBOUND");
  }
  if (player.openId !== openId) {
    throw new Error("NOT_OWNER");
  }

  const activePlayers = players.filter((item) => item.status === "active");
  if (type === "fold" && activePlayers.length <= 1) {
    throw new Error("LAST_PLAYER");
  }

  const baseBet = Number(rules.baseBet || 0);
  const currentBet = Math.max(baseBet, calcCurrentBet(players));
  const callNeed = Math.max(currentBet - (player.bet || 0), 0);
  const roundCount = Number.isFinite(table.zjhRoundCount) ? table.zjhRoundCount : 1;
  const seen = !!player.seen;

  const payNominal = (nominal) => {
    const base = Number(nominal || 0);
    const actualNeed = seen ? base * 2 : base;
    const paid = Math.min(actualNeed, player.stack || 0);
    player.stack -= paid;
    const nominalPaid = seen ? Math.floor(paid / 2) : paid;
    player.bet = (player.bet || 0) + nominalPaid;
    player.handBet = (player.handBet || 0) + paid;
    if (player.stack === 0) {
      player.status = "allin";
    }
  };

  let actionType = type;
  if (type === "timeout") {
    if (!table.turnExpiresAt || now < table.turnExpiresAt) {
      throw new Error("NOT_TIMEOUT");
    }
    actionType = "fold";
  }

  if (actionType === "fold") {
    player.status = "fold";
  } else if (actionType === "see") {
    if (roundCount < Number(rules.minSeeRound || 1)) {
      throw new Error("CANNOT_SEE");
    }
    player.seen = true;
  } else if (actionType === "call") {
    payNominal(callNeed);
  } else if (actionType === "raise") {
    const target = Number(raiseTo);
    if (!Number.isFinite(target)) {
      throw new Error("INVALID_RAISE");
    }
    const minRaise = currentBet + baseBet;
    if (target < minRaise || target < (player.bet || 0)) {
      throw new Error("RAISE_TOO_LOW");
    }
    const delta = target - (player.bet || 0);
    payNominal(delta);
  } else if (actionType === "allin") {
    if (player.stack <= 0) {
      throw new Error("NO_STACK");
    }
    const paid = player.stack;
    player.stack = 0;
    const nominalPaid = seen ? Math.floor(paid / 2) : paid;
    player.bet = (player.bet || 0) + nominalPaid;
    player.handBet = (player.handBet || 0) + paid;
    player.status = "allin";
  } else if (actionType === "compare") {
    if (!canCompare(rules, roundCount, seen)) {
      throw new Error("CANNOT_COMPARE");
    }
    if (!targetId) {
      throw new Error("NO_TARGET");
    }
    const targetIndex = players.findIndex((item) => item.id === targetId);
    if (targetIndex < 0) {
      throw new Error("INVALID_TARGET");
    }
    const target = { ...players[targetIndex] };
    if (target.status === "fold" || target.status === "out") {
      throw new Error("INVALID_TARGET");
    }
    payNominal(callNeed);
    const compareResult = result || "lose";
    if (compareResult === "win") {
      target.status = "fold";
    } else {
      player.status = "fold";
    }
    players[targetIndex] = target;
  } else {
    throw new Error("INVALID_ACTION");
  }

  player.actedRound = roundCount;
  players[turnIndex] = player;

  const activeAfter = players.filter((item) => item.status === "active");
  const inHandAfter = players.filter(
    (item) => item.status !== "fold" && item.status !== "out"
  );
  const currentBetAfter = calcCurrentBet(players);
  let nextRound = table.round || "betting";
  let zjhStage = table.zjhStage || "betting";
  let nextRoundCount = roundCount;
  let nextTurnIndex = getNextActiveIndex(players, turnIndex);

  if (inHandAfter.length <= 1 || (inHandAfter.length > 1 && activeAfter.length === 0)) {
    nextRound = "showdown";
    zjhStage = "showdown";
  } else {
    const allMatched = activeAfter.every((item) => (item.bet || 0) === currentBetAfter);
    const allActed = activeAfter.every((item) => (item.actedRound || 0) === roundCount);
    const advance = advanceRound({
      roundCount,
      maxRounds: Number(rules.maxRounds || 0),
      allActed,
      allMatched,
    });
    nextRoundCount = advance.roundCount;
    if (advance.forceShowdown) {
      nextRound = "showdown";
      zjhStage = "showdown";
    } else if (advance.roundCount !== roundCount) {
      players.forEach((item) => {
        item.bet = 0;
        item.actedRound = 0;
        if (item.status === "fold" || item.status === "out") return;
        item.status = item.stack > 0 ? "active" : "allin";
      });
      const dealerIndex = Math.min(table.dealerIndex || 0, Math.max(0, players.length - 1));
      nextTurnIndex = players.length
        ? getNextActiveIndex(players, getIndexByOffset(players.length, dealerIndex, -1))
        : 0;
      nextRound = "betting";
      zjhStage = "betting";
    }
  }

  const activeForTurn = players.filter((item) => item.status === "active");
  const turnExpiresAt = calcTurnExpiresAt(
    now,
    Number(table.actionTimeoutSec || 0),
    nextRound,
    activeForTurn.length > 0
  );

  const pot = players.reduce((sum, item) => sum + (item.handBet || 0), 0);
  const log = [...(table.log || [])];
  log.push({
    ts: now,
    playerId: player.id,
    action: actionType,
    bet: player.bet,
    targetId: targetId || null,
    result: result || null,
  });

  return {
    players,
    round: nextRound,
    roundId: nextRoundCount,
    zjhRoundCount: nextRoundCount,
    zjhStage,
    turnIndex: nextTurnIndex,
    pot,
    turnExpiresAt,
    settled: zjhStage === "showdown" ? false : table.settled,
    log,
  };
}

function startZhjRound({ table, now, dealerIndex }) {
  const rules = table.gameRules || {};
  const baseBet = Number(rules.baseBet || 0);
  const players = (table.players || []).map((player) => ({ ...player }));
  const safeDealerIndex = Math.min(dealerIndex || 0, Math.max(0, players.length - 1));

  players.forEach((player) => {
    player.bet = 0;
    player.handBet = 0;
    player.actedRound = 0;
    player.seen = false;
    if (player.stack > 0) {
      player.status = "active";
    } else {
      player.status = "out";
    }
  });

  players.forEach((player) => {
    if (player.status !== "active") return;
    const pay = Math.min(baseBet, player.stack);
    player.stack -= pay;
    player.handBet += pay;
    if (player.stack === 0) {
      player.status = "allin";
    }
  });

  const pot = players.reduce((sum, player) => sum + (player.handBet || 0), 0);
  const zjhRoundCount = 1;
  const round = "betting";
  const turnExpiresAt = calcTurnExpiresAt(
    now,
    Number(table.actionTimeoutSec || 0),
    round,
    players.some((player) => player.status === "active")
  );

  return {
    players,
    round,
    roundId: zjhRoundCount,
    zjhRoundCount,
    zjhStage: "betting",
    dealerIndex: safeDealerIndex,
    turnIndex: safeDealerIndex,
    pot,
    turnExpiresAt,
    settled: false,
    log: [],
  };
}

module.exports = {
  calcPayAmount,
  canCompare,
  advanceRound,
  applyZhjAction,
  startZhjRound,
};
