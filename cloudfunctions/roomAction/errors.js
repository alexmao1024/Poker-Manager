class RoomError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

module.exports = { RoomError };
