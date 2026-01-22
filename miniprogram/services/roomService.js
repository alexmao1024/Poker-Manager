function createRoomService(callFn) {
  async function call(action, payload) {
    const res = await callFn({ name: "roomAction", data: { action, payload } });
    return res?.result ?? res;
  }

  return {
    createRoom(payload, profile) {
      return call("create", { payload, profile });
    },
    joinRoomByCode(code) {
      return call("joinRoom", { code });
    },
    getMyRoom(openId) {
      return call("getMyRoom", { openId });
    },
    applyAction(roomId, payload) {
      return call("applyAction", { roomId, ...payload });
    },
  };
}

module.exports = { createRoomService };
