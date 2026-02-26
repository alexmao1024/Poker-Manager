const createRoomHandler = require("./handlers/createRoom");
const joinRoomHandler = require("./handlers/joinRoom");
const applyActionHandler = require("./handlers/applyAction");
const leaveRoomHandler = require("./handlers/leaveRoom");
const reorderPlayersHandler = require("./handlers/reorderPlayers");
const setAutoStageHandler = require("./handlers/setAutoStage");
const setActionTimeoutHandler = require("./handlers/setActionTimeout");
const startRoomHandler = require("./handlers/startRoom");
const updateProfileHandler = require("./handlers/updateProfile");
const endRoundHandler = require("./handlers/endRound");
const resetRoundHandler = require("./handlers/resetRound");
const finishRoomHandler = require("./handlers/finishRoom");
const rebuyHandler = require("./handlers/rebuy");
const adjustChipsHandler = require("./handlers/adjustChips");
const setNextAnteSponsorHandler = require("./handlers/setNextAnteSponsor");
const setZhjCompareRulesHandler = require("./handlers/setZhjCompareRules");

function createMapAction(deps) {
  const handlers = {
    create: createRoomHandler({ createRoom: deps?.createRoom }),
    joinRoom: joinRoomHandler({ joinRoom: deps?.joinRoom }),
    applyAction: applyActionHandler({ applyRoomAction: deps?.applyRoomAction }),
    leaveRoom: leaveRoomHandler({ leaveRoom: deps?.leaveRoom }),
    reorderPlayers: reorderPlayersHandler({ reorderPlayers: deps?.reorderPlayers }),
    setAutoStage: setAutoStageHandler({ setAutoStage: deps?.setAutoStage }),
    setActionTimeout: setActionTimeoutHandler({ setActionTimeout: deps?.setActionTimeout }),
    startRoom: startRoomHandler({ startRoom: deps?.startRoom }),
    updateProfile: updateProfileHandler({ updateProfile: deps?.updateProfile }),
    endRound: endRoundHandler({ endRoomRound: deps?.endRoomRound }),
    resetRound: resetRoundHandler({ resetRoomRound: deps?.resetRoomRound }),
    finishRoom: finishRoomHandler({ finishRoom: deps?.finishRoom }),
    rebuy: rebuyHandler({ rebuy: deps?.rebuy }),
    adjustChips: adjustChipsHandler({ adjustChips: deps?.adjustChips }),
    setNextAnteSponsor: setNextAnteSponsorHandler({ setNextAnteSponsor: deps?.setNextAnteSponsor }),
    setZhjCompareRules: setZhjCompareRulesHandler({ setZhjCompareRules: deps?.setZhjCompareRules }),
  };

  return (action) => handlers[action] || null;
}

const mapAction = createMapAction({
  createRoom: () => {
    throw new Error("NOT_CONFIGURED");
  },
  joinRoom: () => {
    throw new Error("NOT_CONFIGURED");
  },
  applyRoomAction: () => {
    throw new Error("NOT_CONFIGURED");
  },
  leaveRoom: () => {
    throw new Error("NOT_CONFIGURED");
  },
  reorderPlayers: () => {
    throw new Error("NOT_CONFIGURED");
  },
  setAutoStage: () => {
    throw new Error("NOT_CONFIGURED");
  },
  setActionTimeout: () => {
    throw new Error("NOT_CONFIGURED");
  },
  startRoom: () => {
    throw new Error("NOT_CONFIGURED");
  },
  updateProfile: () => {
    throw new Error("NOT_CONFIGURED");
  },
  endRoomRound: () => {
    throw new Error("NOT_CONFIGURED");
  },
  resetRoomRound: () => {
    throw new Error("NOT_CONFIGURED");
  },
  finishRoom: () => {
    throw new Error("NOT_CONFIGURED");
  },
  rebuy: () => {
    throw new Error("NOT_CONFIGURED");
  },
  adjustChips: () => {
    throw new Error("NOT_CONFIGURED");
  },
  setNextAnteSponsor: () => {
    throw new Error("NOT_CONFIGURED");
  },
  setZhjCompareRules: () => {
    throw new Error("NOT_CONFIGURED");
  },
});

module.exports = { createMapAction, mapAction };
