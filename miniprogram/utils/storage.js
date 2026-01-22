const { defaultGameRules } = require("./gameConfig");

const TABLES_KEY = "chip_score_tables_v1";
const PROFILE_KEY = "chip_score_profile_v1";

const defaultConfig = defaultGameRules.texas;

function loadTables() {
  return wx.getStorageSync(TABLES_KEY) || [];
}

function saveTables(tables) {
  wx.setStorageSync(TABLES_KEY, tables);
  return tables;
}

function generateId(prefix) {
  const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${seed}`;
}

function generateCode() {
  return `${Math.floor(100000 + Math.random() * 900000)}`;
}

function buildPlayers(names, stack) {
  return names.map((name, index) => {
    const playerId = generateId("p");
    return {
      id: playerId,
      name: name || `座位${index + 1}`,
      avatar: "",
      stack,
      initialStack: stack,
      bet: 0,
      status: "active",
    };
  });
}

function applyBlind(players, index, amount) {
  if (!players.length) return;
  const target = players[index];
  if (!target || target.stack <= 0) return;
  const pay = Math.min(amount, target.stack);
  target.stack -= pay;
  target.bet += pay;
  if (target.stack === 0) {
    target.status = "allin";
  }
}

function getIndexByOffset(length, base, offset) {
  if (!length) return 0;
  const raw = (base + offset) % length;
  return raw < 0 ? raw + length : raw;
}

function getNextActiveIndex(players, startIndex) {
  if (!players.length) return 0;
  const size = players.length;
  for (let offset = 1; offset <= size; offset += 1) {
    const index = (startIndex + offset) % size;
    const player = players[index];
    if (player.status === "active") {
      return index;
    }
  }
  return startIndex;
}

function createTable(payload = {}) {
  const now = Date.now();
  const players = buildPlayers(payload.players || [], payload.stack || defaultConfig.stack);
  const dealerIndex = 0;
  const smallBlindIndex = getIndexByOffset(players.length, dealerIndex, 1);
  const bigBlindIndex = getIndexByOffset(players.length, dealerIndex, 2);

  const blinds = payload.blinds || defaultConfig.blinds;
  applyBlind(players, bigBlindIndex, blinds.bb);
  applyBlind(players, smallBlindIndex, blinds.sb);

  const table = {
    id: generateId("t"),
    code: generateCode(),
    createdAt: now,
    updatedAt: now,
    status: "active",
    blinds,
    round: "preflop",
    dealerIndex,
    turnIndex: getNextActiveIndex(players, bigBlindIndex),
    pot: 0,
    players,
    log: [],
    lastAction: null,
    hostName: payload.hostName || "",
    settled: false,
  };
  const tables = loadTables();
  tables.unshift(table);
  saveTables(tables);
  return table;
}

function updateTable(updatedTable) {
  const tables = loadTables();
  const nextTables = tables.map((table) =>
    table.id === updatedTable.id ? { ...updatedTable, updatedAt: Date.now() } : table
  );
  saveTables(nextTables);
  return updatedTable;
}

function getTableById(id) {
  return loadTables().find((table) => table.id === id);
}

function removeTable(id) {
  const tables = loadTables();
  const nextTables = tables.filter((table) => table.id !== id);
  saveTables(nextTables);
  return nextTables;
}

function getProfile() {
  return wx.getStorageSync(PROFILE_KEY) || null;
}

function saveProfile(profile) {
  wx.setStorageSync(PROFILE_KEY, profile);
  return profile;
}

module.exports = {
  defaultConfig,
  buildPlayers,
  applyBlind,
  getIndexByOffset,
  getNextActiveIndex,
  generateCode,
  loadTables,
  saveTables,
  createTable,
  updateTable,
  getTableById,
  removeTable,
  getProfile,
  saveProfile,
};
