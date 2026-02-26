const { GAME_TYPES } = require("./gameConfig");

function getRoomId(room) {
  return room?.id || room?._id || "";
}

function getGameTypeLabel(gameType) {
  return gameType === GAME_TYPES.ZHAJINHUA ? "炸金花" : "德州";
}

function getStatusLabel(status) {
  return status === "active" ? "进行中" : "未开始";
}

function shouldPromptExistingRoom(room) {
  if (!getRoomId(room)) return false;
  return room?.status === "lobby" || room?.status === "active";
}

function buildExistingRoomModalConfig(room, selectedGameType) {
  const roomGameType = room?.gameType || GAME_TYPES.TEXAS;
  const roomGameLabel = getGameTypeLabel(roomGameType);
  const selectedLabel = getGameTypeLabel(selectedGameType);
  const statusLabel = getStatusLabel(room?.status);
  const roomCodeText = room?.code ? `#${room.code}` : "当前房间";
  const isMismatch = !!selectedGameType && selectedGameType !== roomGameType;
  const mismatchText = isMismatch ? `\n当前选择：${selectedLabel}` : "";
  return {
    title: "已有房间",
    content:
      `你已有${statusLabel}的${roomGameLabel}房间（${roomCodeText}）。` +
      `${mismatchText}\n同一账号一次只能在一个房间。`,
    confirmText: "进入已有房间",
    cancelText: "返回修改",
  };
}

module.exports = {
  shouldPromptExistingRoom,
  buildExistingRoomModalConfig,
};
