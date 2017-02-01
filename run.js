try {
  require('dotenv').config();
  console.log('dotenv loaded');
} catch(e) {
  console.log("dotenv is not loaded");
}

var Backup = require('./firebaseBackup');
var b = new Backup();
