const zlib = require('zlib');
const deferred = require('deferred');
const async = require('async');
const fs = require('fs');
const gzip = zlib.createGzip();
const child_process = require('child_process');
const AWS = require('./aws');

function Backup() {
  this.getParams();
  this.validate();
  this.perform();
}
Backup.prototype.convertToMB = function convertToMB(bytes) {
  return parseFloat(bytes / 1024 / 1024);
}
Backup.prototype.getParams = function getParams() {
  this.params = {};
  for (var i=2; i < process.argv.length; i++) {
    var param = process.argv[i].split('=');
    this.params[param[0].replace(/-/, '')] = param[1];
  }
}
Backup.prototype.removeFile = function removeFile(filePath) {
  fs.unlink(filePath);
};
Backup.prototype.startBackup = function startBackup() {
  var self = this;
  
  self.backupDB().then( function backupSucceeded(filePath) {
    self.removeFile(filePath);
  }, function backupRejected(filePath) {
    self.removeFile(filePath);
  });
};
Backup.prototype.startRestore = function startRestore() {
  console.log(`Starting restore of ${this.params.dbHostName}`);
  if (typeof this.params.restoreS3 === 'undefined') {
    this.restoreDB();
  } else if (typeof this.params.restoreS3 !== 'undefined') {
    this.restoreDBfromS3();
  }
};
Backup.prototype.perform = function perform() {
  var self = this;
  
  if (this.params.restore === 'false') {
    console.log(`Starting backup of ${this.params.name}`);
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
          console.log( `${files[file].Key} - ${self.convertToMB(files[file].Size).toFixed(2)} MB`);
        }
      }
    }
  );
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
  var folderQueue = async.queue( function folderQueue(folderPath, pathComplete) {
    var parentDir = folderPath
    if (!fs.existsSync(parentDir)) {
    	fs.mkdirSync(parentDir);
    }
    finalPath = parentDir; 
    pathComplete();
  },1);
  folderQueue.drain = function folderQueueDrain() {
    makeStructurePromise.resolve(finalPath);
  };
  folderQueue.pause();
  
  var folders = folderPath.split('/');
  var completePath = '';
  for (var folder in folders) {
    if (!this.isFilename(folders[folder])) {
      completePath = completePath + folders[folder] + '/';
      folderQueue.push( completePath );
    }
  }
  folderQueue.resume();
  return makeStructurePromise.promise;
};
Backup.prototype.backupDB = function backupDB() {
  var downloadPromise = deferred();
  var self = this;
  this.makeFolderFromStructure(this.params.tempDirectory).then(
    function makeFolderStructureResult(filePath) {
      var URL = `https://${self.params.dbHostName}.firebaseio.com/.json?print=pretty&auth=${self.params.dbToken}`;
      var FILENAME_DATE = new Date().toISOString().split('-').join('').split(':').join('').split('.').join('');
      var fileName = filePath+FILENAME_DATE+'.json';
      
      child_process.execFile('curl', ['-o', fileName, URL], function curlResult(error, stdout, stderr) {
        if (error) {
          downloadPromise.reject();
        } else {
          self.compress(fileName).then(function(compressedFileName){
            self.saveS3(compressedFileName, self.params.dbHostName ).then(
              function() {
                downloadPromise.resolve(compressedFileName);
              }, function(err) {
                throw new Error `Unable to save ${err.message}`;
              }
            );
          });
        }
      });
    }
  )
  return downloadPromise.promise;
};
Backup.prototype.saveS3 = function saveS3(path, filename) {
  var savePromise = deferred();
  
  if(this.params.saveS3 === 'true') {
    setTimeout(function() {
      AWS.uploadS3(path,filename).then(
        function(complete) {
          savePromise.resolve();
        },function(error) {
          savePromise.reject(error);
        }
      );
    },5000); 
  } else {
    console.log('skip s3');
    savePromise.resolve();
  }
  return savePromise.promise;
};
Backup.prototype.restoreDB = function restoreDB() {
  var self = this;
  self.decompress(this.params.tempDirectory).then(
    function(decompressedFileLocation) {
      
      setTimeout(function() {
        var URL = `https://${self.params.dbHostName}.firebaseio.com/.json?print=pretty&auth=${self.params.dbToken}`;
        child_process.execFile('curl', ['-X', 'PUT', URL, '--upload-file', decompressedFileLocation], function(error, stdout, stderr) {

          if (error || JSON.parse(stdout).error) {
            if (error === null) {
              error = JSON.parse(stdout).error;
            }
            console.log(`Error restoring ${decompressedFileLocation} to ${URL} : ${error}`);
          } else {
            console.log(`Restored file ${decompressedFileLocation} to ${URL}`);
          }
        });
      },5000);
      
    }
  );  
};
Backup.prototype.restoreDBfromS3 = function restoreDBfromS3() {
  var self = this;
  console.log('Restore from s3');
  self.makeFolderFromStructure(`restores/${self.params.restoreLocation}`).then(
    function(restoreFilePath) {
      AWS.getFromAWS(self.params.restoreLocation, restoreFilePath).then(
        function(decompressedFileLocation) {
          console.log('File downloaded');
          self.decompress(decompressedFileLocation).then(
            function(decompressedFileLocation) {
              console.log('file decompressed ');
              console.log( 'To Restore Run Command:');
              var URL = `'https://${self.params.dbHostName}.firebaseio.com/.json?print=pretty&auth=${self.params.dbToken}'`;
              console.log(`curl -X PUT ${URL} --progress-bar --upload-file ${decompressedFileLocation}`);
          
              if (typeof self.params.saveLocal === 'undefined' || self.params.saveLocal !== 'true') {
                fs.unlink(decompressedFileLocation);
                fs.unlink(`${decompressedFileLocation}.gz`);
              }
              
              /* TODO: GET THIS WORKING 
              child_process.execFile('curl', ['-X', 'PUT', URL, '--progress-bar', '--upload-file', decompressedFileLocation], function(error, stdout, stderr){
                console.log( 'error ', error );
                console.log( 'stdout ', stdout );
                console.log( 'stderr ', stderr );

                if( error || JSON.parse(stdout).error ){
                  if( error === null){
                    error = JSON.parse(stdout).error;
                  }
                  console.log(`Error restoring to ${URL} : ${error}`);
                } else {
                  console.log(`Restored file to ${URL}`);
                }
              });
              */
            }, function(error) {
              console.log('error ', error );
            }
          );
        }
      );  
    }
  );
};
Backup.prototype.compress = function compress(fileName) {
  var compressPromise= deferred();
  var inp = fs.createReadStream(fileName);
  var out = fs.createWriteStream(`${fileName}.gz`);

  inp.pipe(gzip).pipe(out);
  fs.unlink(fileName);
  console.log(`Backup saved Locally at : ${fileName}.gz`);
  compressPromise.resolve(`${fileName}.gz`);
  return compressPromise.promise;
};
Backup.prototype.decompress = function decompress(filePath) {
  var decompressPromise = deferred();
  var inp2 = fs.createReadStream(filePath);
  var outputPath = filePath.split('.gz')[0];
  var out2 = fs.createWriteStream(outputPath, {false:'w'});
  var inflater = inp2.pipe(zlib.createGunzip()).pipe(out2); /* Uncompress the .gz file */
  var deflatedFilePath = filePath.replace(/\.gz/, '');
  var buffer = [];
  var gunzip = zlib.createGunzip();
  
  inp2.pipe(gunzip);
  gunzip.on('data', function(data) {
      buffer.push(data.toString())
  }).on("end", function() {
    fs.writeFile(deflatedFilePath, buffer.join(""), function(err) {
        if(err) {
          return console.log(err);
        }
        console.log("The file was saved locally");
        decompressPromise.resolve(deflatedFilePath);
    }); 
  }).on("error", function(e) {
    console.log( e );
    decompressPromise.reject( e );
  })    
  
  return decompressPromise.promise;
};

module.exports = Backup;
