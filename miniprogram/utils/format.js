const roundMap = {
  preflop: "翻牌前",
  flop: "三张牌",
  turn: "四张牌",
  river: "五张牌",
  showdown: "摊牌",
};

function formatRound(round) {
  return roundMap[round] || "回合";
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  return `${hh}:${mm}`;1
}

module.exports = {
  formatRound,
  formatTime,
};
