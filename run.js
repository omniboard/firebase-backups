const logger = require("./logger");
try {
  require("dotenv").config();
  logger.info("dotenv loaded");
} catch(e) {
  logger.info("dotenv is not loaded");
}

var Backup = require("./firebaseBackup");
var b = new Backup();
