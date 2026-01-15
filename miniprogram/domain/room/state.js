function normalizeRoom(room) {
  return {
    id: room?.id || room?._id || "",
    status: room?.status || "lobby",
    round: room?.round || "preflop",
    turnIndex: Number.isFinite(room?.turnIndex) ? room.turnIndex : 0,
    pot: Number(room?.pot || 0),
    players: Array.isArray(room?.players) ? room.players : [],
  };
}

function calcCurrentBet(players) {
  return (players || []).reduce((max, player) => Math.max(max, player.bet || 0), 0);
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

module.exports = { normalizeRoom, calcCurrentBet, getNextActiveIndex };
