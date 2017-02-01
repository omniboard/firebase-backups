const logger = require("./logger");
const zlib = require("zlib");
const deferred = require("deferred");
const path = require("path");
const async = require("async");
const fs = require("fs");
const gzip = zlib.createGzip();
const childProcess = require("child_process");
const execFile = require("child_process").execFile;
const AWS = require("./aws");

function Backup(){
  this.getParams();
  this.validate();
  this.perform();
}
Backup.prototype.convertToMB = function(bytes){
  return parseFloat(bytes / 1024 / 1024);
};
Backup.prototype.getParams = function(){
  this.params = {};
  for( var i=2;i<process.argv.length; i++){
    var param = process.argv[i].split("=");
    this.params[ param[0].replace(/-/,"") ] = param[1];
  }
}
Backup.prototype.perform = function(){
  if(this.params.restore === "false"){
    logger.info(`Starting backup of ${this.params.name}`);
    this.backupDB();
  }
  if(this.params.restore === "true"){
    logger.info(`Starting restore of ${this.params.dbHostName}`);
    if(typeof this.params.restoreS3 === "undefined"){
      this.restoreDB();
    } else if(typeof this.params.restoreS3 !== "undefined"){
      this.restoreDBfromS3();
    }
  }
  if(this.params.list === "true"){
    this.listBackups();
  }
};
Backup.prototype.validate = function(){  
  if( typeof this.params !== "undefined" ) {
    if(typeof this.params.list !== "undefined"){
      return true;
    } else if(typeof this.params.restoreS3 !== "undefined"){
      return true;
    } else if (typeof this.params.dbHostName === "undefined" || 
      typeof this.params.name === "undefined" || 
      typeof this.params.dbToken === "undefined" || 
      typeof this.params.tempDirectory === "undefined") {
      throw new Error("Improperly configured backup!");
    }
  } else {
    return true;
  }
};
Backup.prototype.listBackups = function(){
  var self = this;
  AWS.listS3(this.params.dbHostName).then(
    function(files){
      for(var file in files){
        logger.info( files[file].Key, self.convertToMB(files[file].Size).toFixed(2)+" MB" );
      }
    }
  );
};
Backup.prototype.isFilename = function(name) {
  if( name.indexOf(".") > -1){
    return true;
  } else {
    return false;
  }
};
Backup.prototype.makeFolderFromStructure = function(folderPath){
  var makeStructurePromise = deferred();
  var finalPath = null;
  var folderQueue = async.queue( function (folderPath,pathComplete){
    var parentDir = folderPath
    if (!fs.existsSync(parentDir)){
      fs.mkdirSync(parentDir);
    }
    finalPath = parentDir; 
    pathComplete();
  },1);
  folderQueue.drain = function(){
    makeStructurePromise.resolve(finalPath);
  };
  folderQueue.pause();
  
  var folders = folderPath.split("/");
  var completePath = "";
  for(var folder in folders){
    if (!this.isFilename(folders[folder])) {
      completePath = completePath + folders[folder] + "/";
      folderQueue.push( completePath );
    }
  }
  folderQueue.resume();
  return makeStructurePromise.promise;
};
Backup.prototype.backupDB = function(){
  var downloadPromise = deferred();
  var self = this;
  this.makeFolderFromStructure(this.params.tempDirectory).then(
    function(filePath){
      var URL = `https://${self.params.dbHostName}.firebaseio.com/.json?print=pretty&auth=${self.params.dbToken}`;
      var FILENAME_DATE = new Date().toISOString().split("-").join("").split(":").join("").split(".").join("");
      var fileName = filePath+FILENAME_DATE+".json";
      childProcess.execFile("curl", ["-o", fileName, URL], function(error, stdout, stderr){
        if( error ){
          downloadPromise.reject();
        } else {
          self.compress(fileName).then(function(compressedFileName){
            self.saveS3(compressedFileName, self.params.dbHostName ).then(
              function(){
                downloadPromise.resolve();
              }, function(){
                downloadPromise.resolve();
              }
            );
          });
        }
      });
    }
  );
  return downloadPromise.promise;
};
Backup.prototype.saveS3 = function(path, filename){
  var savePromise = deferred();
  if(this.params.saveS3 === "true") {
    
    setTimeout(function(){
      AWS.uploadS3(path,filename).then(
        function(complete){
          savePromise.resolve();
        },function(error){
          savePromise.reject();
        }
      );
    },5000); 
  } else {
    logger.info("skip s3");
    savePromise.resolve();
  }
  return savePromise.promise;
};
Backup.prototype.restoreDB = function(){
  var self = this;
  self.decompress(this.params.tempDirectory).then(
    function(decompressedFileLocation){
      
      setTimeout(function(){
        var URL = `https://${self.params.dbHostName}.firebaseio.com/.json?print=pretty&auth=${self.params.dbToken}`;
        childProcess.execFile("curl", ["-X", "PUT", URL, "--upload-file", decompressedFileLocation], function(error, stdout, stderr){

          if( error || JSON.parse(stdout).error ){
            if( error === null){
              error = JSON.parse(stdout).error;
            }
            logger.info(`Error restoring ${decompressedFileLocation} to ${URL} : ${error}`);
          } else {
            logger.info(`Restored file ${decompressedFileLocation} to ${URL}`);
          }
        });        
      },5000);
      
    }
  );  
};
Backup.prototype.restoreDBfromS3 = function(){
  var self = this;
  logger.info("Restore from s3");
  self.makeFolderFromStructure(`restores/${self.params.restoreLocation}`).then(
    function(restoreFilePath){
      AWS.getFromAWS(self.params.restoreLocation, restoreFilePath).then(
        function(decompressedFileLocation){
          logger.info("File downloaded");
          self.decompress(decompressedFileLocation).then(
            function(decompressedFileLocation){
              logger.info("file decompressed ");
              logger.info( "To Restore Run Command:");
              var URL = `"https://${self.params.dbHostName}.firebaseio.com/.json?print=pretty&auth=${self.params.dbToken}"`;
              logger.info(`curl -X PUT ${URL} --progress-bar --upload-file ${decompressedFileLocation}`);
          
              if( typeof self.params.saveLocal === "undefined" || self.params.saveLocal !== "true"){
                fs.unlink(decompressedFileLocation);
                fs.unlink(`${decompressedFileLocation}.gz`);
              }
              
              /* TODO: GET THIS WORKING 
              childProcess.execFile("curl", ["-X", "PUT", URL, "--progress-bar", "--upload-file", decompressedFileLocation], function(error, stdout, stderr){
                logger.info( "error ", error );
                logger.info( "stdout ", stdout );
                logger.info( "stderr ", stderr );

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
            }, function(error){
              logger.info("error ", error );
            }
          );
        }
      );  
    }
  );
};
Backup.prototype.compress = function(fileName){
  var compressPromise= deferred();
  var inp = fs.createReadStream(fileName);
  var out = fs.createWriteStream(`${fileName}.gz`);

  inp.pipe(gzip).pipe(out);
  fs.unlink(fileName);
  logger.info(`Backup saved Locally at : ${fileName}.gz`);
  compressPromise.resolve(`${fileName}.gz`);
  return compressPromise.promise;
};
Backup.prototype.decompress = function(filePath){
  var decompressPromise = deferred();
  var inp2 = fs.createReadStream(filePath);
  var outputPath = filePath.split(".gz")[0];
  var out2 = fs.createWriteStream(outputPath, {false:"w"});
  var inflater = inp2.pipe(zlib.createGunzip()).pipe(out2); /* Uncompress the .gz file */
  var deflatedFilePath = filePath.replace(/\.gz/, "");
  var buffer = [];
  var gunzip = zlib.createGunzip();
  inp2.pipe(gunzip);
  gunzip.on("data", function(data) {
      buffer.push(data.toString())
  }).on("end", function() {
    fs.writeFile(deflatedFilePath, buffer.join(""), function(err) {
        if(err) {
            return logger.info(err);
        }
        logger.info("The file was saved locally");
        decompressPromise.resolve(deflatedFilePath);
    }); 
  }).on("error", function(e) {
    logger.info( e );
    decompressPromise.reject( e );
  })    
  
  return decompressPromise.promise;
};

module.exports = Backup;
