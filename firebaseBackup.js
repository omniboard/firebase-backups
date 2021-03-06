const zlib = require('zlib');
const deferred = require('deferred');
const async = require('async');
const fs = require('fs');
const gzip = zlib.createGzip();
const childProcess = require('child_process');
const AWS = require('./aws');
const logger = require('./logger');

function Backup() {
  this.getParams();
  this.validate();
  this.perform();
}
Backup.prototype.convertToMB = function convertToMB(bytes) {
  return parseFloat(bytes / 1024 / 1024);
};
Backup.prototype.getParams = function getParams() {
  this.params = {};
  for (var i = 2; i < process.argv.length; i++) {
    var param = process.argv[i].split('=');
    this.params[param[0].replace(/-/, '')] = param[1];
  }
};
Backup.prototype.removeFile = function removeFile(filePath) {
  fs.unlink(filePath);
};
Backup.prototype.startBackup = function startBackup() {
  var self = this;
  
  self.backupDB().then(function backupSucceeded(filePath) {
    self.removeFile(filePath);
  }, function backupRejected(filePath) {
    self.removeFile(filePath);
  }).catch(function catchError(e) {
    throw e;
  });
};
Backup.prototype.startRestore = function startRestore() {
  logger.info(`Starting restore of ${this.params.dbHostName}`);
  if (typeof this.params.restoreS3 === 'undefined') {
    this.restoreDB();
  } else if (typeof this.params.restoreS3 !== 'undefined') {
    this.restoreDBfromS3();
  }
};
Backup.prototype.perform = function perform() {
  var self = this;
  
  if (this.params.restore === 'false') {
    logger.info(`Starting backup of ${this.params.name}`);
    self.startBackup();
  }
  if (this.params.restore === 'true') {
    self.startRestore();
  }
  if (this.params.list === 'true') {
    this.listBackups();
  }
};
Backup.prototype.isParamDefined = function isParamDefined(paramName) {
  if (typeof this.params[paramName] === 'undefined') {
    return false;
  } else {
    return true;
  }
};
Backup.prototype.paramsExists = function paramsExists() {
  if (typeof this.params === 'undefined') {
    return false;
  } else {
    return true;
  }
};
Backup.prototype.validate = function validate() {
  if (this.paramsExists()) {
    if (this.isParamDefined('list')) {
      return true;
    } else if (this.isParamDefined('restoreS3')) {
      return true;
    } else if (!this.isParamDefined('dbHostName') ||
      !this.isParamDefined('name') ||
      !this.isParamDefined('dbToken') ||
      !this.isParamDefined('tempDirectory')) {
      throw new Error('Improperly configured backup!');
    }
  }
  return true;
};
Backup.prototype.listBackups = function listBackups() {
  var self = this;
  AWS.listS3(this.params.dbHostName).then(
    function listS3Success(files) {
      for (var file in files) {
        if (typeof files[file] !== 'undefined') {
          logger.info(`${files[file].Key} - ${self.convertToMB(files[file].Size).toFixed(2)} MB`);
        }
      }
    }
  ).catch(function catchError(e) {
    throw e;
  });
};
Backup.prototype.isFilename = function isFilename(name) {
  if (name.indexOf('.') > -1) {
    return true;
  } else {
    return false;
  }
};
Backup.prototype.makeFolderFromStructure = function makeFolderFromStructure(folderPath) {
  var makeStructurePromise = deferred();
  var finalPath = null;
  var folderQueue = async.queue(function folderQueue(folderPath, pathComplete) {
    var parentDir = folderPath
    if (!fs.existsSync(parentDir)) {
    	fs.mkdirSync(parentDir);
    }
    finalPath = parentDir;
    pathComplete();
  }, 1);
  folderQueue.drain = function folderQueueDrain() {
    makeStructurePromise.resolve(finalPath);
  };
  folderQueue.pause();
  
  var folders = folderPath.split('/');
  var completePath = '';
  for (var folder in folders) {
    if (!this.isFilename(folders[folder])) {
      completePath = `${completePath}${folders[folder]}/`;
      folderQueue.push(completePath);
    }
  }
  folderQueue.resume();
  return makeStructurePromise.promise;
};
Backup.prototype.cleanUpDate = function cleanUpDate(){
  return new Date().toISOString().split('-').join('').split(':').join('').split('.').join('');
};
Backup.prototype.backupDB = function backupDB() {
  var downloadPromise = deferred();
  var self = this;
  this.makeFolderFromStructure(this.params.tempDirectory).then(
    function makeFolderStructureResult(filePath) {
      var URL = `https://${self.params.dbHostName}.firebaseio.com/.json?print=pretty&auth=${self.params.dbToken}`;
      var FILENAME_DATE = self.cleanUpDate();
      var fileName = `${filePath}${FILENAME_DATE}.json`;
      
      childProcess.execFile('curl', ['-o', fileName, URL], function result(error, out) {
        if (error) {
          downloadPromise.reject();
        } else {
          self.compress(fileName).then(function compressResults(compressedFileName) {
            self.saveS3(compressedFileName, self.params.dbHostName).then(
              function saveS3Success() {
                downloadPromise.resolve(compressedFileName);
              }, function saveS3Error(err) {
                throw new Error `Unable to save ${err.message}`;
              }
            ).catch(function catchError(e) {
              throw e;
            });
          }).catch(function catchError(e) {
            throw e;
          });
        }
      });
    }
  ).catch(function catchError(e) {
    throw e;
  });
  return downloadPromise.promise;
};
Backup.prototype.saveS3 = function saveS3(path, filename) {
  var savePromise = deferred();
  
  if (this.params.saveS3 === 'true') {
    setTimeout(function timeoutFunction() {
      AWS.uploadS3(path, filename).then(
        function uploadComplete() {
          savePromise.resolve();
        }, function uploadError(error) {
          savePromise.reject(error);
        }
      ).catch(function catchError(e) {
        throw e;
      });
    }, 5000); 
  } else {
    logger.info('skip s3');
    savePromise.resolve();
  }
  return savePromise.promise;
};
Backup.prototype.restoreDB = function restoreDB() {
  var self = this;
  self.decompress(this.params.tempDirectory).then(
    function decompressSuccess(fileLocation) {
      
      setTimeout(function decompressTimeout() {
        var URL = `https://${self.params.dbHostName}.firebaseio.com/.json?print=pretty&auth=${self.params.dbToken}`;
        childProcess.execFile('curl', ['-X', 'PUT', URL, '--upload-file', fileLocation], 
          function childProcessResult(error, stdout, stderr) {
            if (error || JSON.parse(stdout).error) {
              if (error === null) {
                error = JSON.parse(stdout).error;
              }
              logger.info(`Error restoring ${decompressedFileLocation} to ${URL} : ${error} - ${stderr}`);
            } else {
              logger.info(`Restored file ${decompressedFileLocation} to ${URL}`);
            }
          }
        );
      },5000);
      
    }
  ).catch(function catchError(e) {
    throw e;
  });
};
Backup.prototype.buildRestoreURL = function() {
  var host = this.params.dbHostName;
  var token = this.params.token;
  
  return `'https://${host}.firebaseio.com/.json?print=pretty&auth=${token}'`;
};
Backup.prototype.restoreDBfromS3 = function restoreDBfromS3() {
  var self = this;
  logger.info('Restore from s3');
  self.makeFolderFromStructure(`restores/${self.params.restoreLocation}`).then(
    function makeFolderFromStructureResult(restoreFilePath) {
      AWS.getFromAWS(self.params.restoreLocation, restoreFilePath).then(
        function getFromAWSResults(decompressedFileLocation) {
          logger.info('File downloaded');
          self.decompress(decompressedFileLocation).then(
            function decompressResults(decompressedFileLocation) {
              logger.info('file decompressed ');
              logger.info( 'To Restore Run Command:');
              var URL = self.buildRestoreURL();
              logger.info(`curl -X PUT ${URL} --progress-bar --upload-file ${decompressedFileLocation}`);
          
              if (typeof self.params.saveLocal === 'undefined' || self.params.saveLocal !== 'true') {
                fs.unlink(decompressedFileLocation);
                fs.unlink(`${decompressedFileLocation}.gz`);
              }
              
              /* TODO: GET THIS WORKING 
              childProcess.execFile('curl', ['-X', 'PUT', URL, '--progress-bar', '--upload-file', decompressedFileLocation], function(error, stdout, stderr){
                logger.info( 'error ', error );
                logger.info( 'stdout ', stdout );
                logger.info( 'stderr ', stderr );

                if( error || JSON.parse(stdout).error ){
                  if( error === null){
                    error = JSON.parse(stdout).error;
                  }
                  logger.info(`Error restoring to ${URL} : ${error}`);
                } else {
                  logger.info(`Restored file to ${URL}`);
                }
              });
              */
            }, function(error) {
              logger.info('error ', error );
            }
          ).catch(function catchError(e) {
            throw e;
          });
        }
      ).catch(function catchError(e) {
        throw e;
      });
    }
  ).catch(function catchError(e) {
    throw e;
  });
};
Backup.prototype.compress = function compress(fileName) {
  var compressPromise= deferred();
  var inp = fs.createReadStream(fileName);
  var out = fs.createWriteStream(`${fileName}.gz`);

  inp.pipe(gzip).pipe(out);
  fs.unlink(fileName);
  logger.info(`Backup saved Locally at : ${fileName}.gz`);
  compressPromise.resolve(`${fileName}.gz`);
  return compressPromise.promise;
};
Backup.prototype.decompress = function decompress(filePath) {
  var decompressPromise = deferred();
  var inp2 = fs.createReadStream(filePath);
  var outputPath = filePath.split('.gz')[0];
  var out2 = fs.createWriteStream(outputPath, {false:'w'});
  var deflatedFilePath = filePath.replace(/\.gz/, '');
  var buffer = [];
  var gunzip = zlib.createGunzip();
  
  inp2.pipe(gunzip);
  gunzip.on('data', function(data) {
    buffer.push(data.toString());
  }).on('end', function gunzipEnd() {
    fs.writeFile(deflatedFilePath, buffer.join(''), function gunzipWriteError(err) {
      if (err) {
        return logger.info(err);
      }
      logger.info('The file was saved locally');
      decompressPromise.resolve(deflatedFilePath);
      return true;
    });
  }).on('error', function gunzipError(e) {
    logger.info(e);
    decompressPromise.reject(e);
  })
  
  return decompressPromise.promise;
};

module.exports = Backup;
