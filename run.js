try {
  require('dotenv').config();
  console.log('dotenv loaded');
} catch(e) {
  console.debug("dotenv is not loaded");
}

var Backup = require('./firebaseBackup');
var b = new Backup();