const defaultConfig = {
  blinds: { sb: 10, bb: 20 },
  actionTimeoutSec: 0,
  stack: 2000,
};

function normalizeBlinds(input) {
  const sb = Number(input?.sb);
  const bb = Number(input?.bb);
  return {
    sb: Number.isFinite(sb) && sb >= 0 ? sb : defaultConfig.blinds.sb,
    bb: Number.isFinite(bb) && bb >= 0 ? bb : defaultConfig.blinds.bb,
  };
}

module.exports = { normalizeBlinds, defaultConfig };
