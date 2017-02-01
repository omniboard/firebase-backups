var simpleNodeLogger = require("simple-node-logger");

module.exports = simpleNodeLogger.createSimpleLogger({
  timestampFormat: "YYYY-MM-DD HH:mm:ss.SSS",
  level: "all",
  sync: true,
});
