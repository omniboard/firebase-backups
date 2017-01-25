const zlib = require('zlib');
const deferred = require('deferred');
const path = require('path');
const async = require('async');
const fs = require('fs');
const gzip = zlib.createGzip();
const child_process = require('child_process');
const execFile = require('child_process').execFile;
const AWS = require('./aws');

function Backup(){
  this.getParams();
  this.validate();
  this.perform();
}
Backup.prototype.getParams = function(){
  this.params = {};
  for( var i=2;i<process.argv.length; i++){
    var param = process.argv[i].split('=');
    this.params[ param[0].replace(/-/,"") ] = param[1];
  }
}
Backup.prototype.perform = function(){
  if(this.params.restore === 'false'){
    console.log(`starting backup of ${this.params.name}`);
    this.backupDB();
  }
  if(this.params.restore === 'true'){
    console.log(`starting restore of ${this.params.name}`);
    this.restoreDB();
  }
};
Backup.prototype.validate = function(){  
  if( typeof this.params !== 'undefined' && 
    (typeof this.params.dbHostName === 'undefined' || 
      typeof this.params.name === 'undefined' || 
      typeof this.params.dbToken === 'undefined' || 
      typeof this.params.folderLocation === 'undefined')) {
    throw new Error("Improperly configured backup!");
  } else {
    return true;
  }
};
Backup.prototype.makeFolderFromStructure = function(folderPath){
  var makeStructurePromise = deferred();
  var finalPath = null;  
  var folderQueue = async.queue( function (folderPath,pathComplete){
    var parentDir = path.join(__dirname, folderPath);
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
  
  var folders = folderPath.split('/');
  var completePath = '';
  for(var folder in folders){
    completePath = completePath + folders[folder] + '/';
    folderQueue.push( completePath );
  }
  folderQueue.resume();
  return makeStructurePromise.promise;
};
Backup.prototype.backupDB = function(){
  var downloadPromise = deferred();
  var self = this;
  this.makeFolderFromStructure(this.params.folderLocation).then(
    function(filePath){
      var URL = `https://${self.params.dbHostName}.firebaseio.com/.json?print=pretty&auth=${self.params.dbToken}`;
      var FILENAME_DATE = new Date().toISOString().split('-').join('').split(':').join('').split('.').join('');
      var fileName = filePath+FILENAME_DATE+'.json';
      child_process.execFile('curl', ['-o', fileName, URL], function(error, stdout, stderr){
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
  )
  return downloadPromise.promise;
};
Backup.prototype.saveS3 = function(path, filename){
  var savePromise = deferred();
  if(this.params.saveS3 === 'true') {
    
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
    console.log('skip s3');
    savePromise.resolve();
  }
  return savePromise.promise;
};
Backup.prototype.restoreDB = function(){
  var self = this;
  var FILEPATH = path.join(__dirname, this.params.folderLocation);
  self.decompress(FILEPATH).then(
    function(decompressedFileLocation){
      
      setTimeout(function(){
        var URL = `https://${self.params.dbHostName}.firebaseio.com/.json?print=pretty&auth=${self.params.dbToken}`;
        child_process.execFile('curl', ['-X', 'PUT', URL, '--upload-file', decompressedFileLocation], function(error, stdout, stderr){

          if( error || JSON.parse(stdout).error ){
            if( error === null){
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
Backup.prototype.compress = function(fileName){
  var compressPromise= deferred();
  var inp = fs.createReadStream(fileName);
  var out = fs.createWriteStream(`${fileName}.gz`);

  inp.pipe(gzip).pipe(out);
  fs.unlink(fileName);
  console.log(`Backup saved Locally at : ${fileName}.gz`);
  compressPromise.resolve(`${fileName}.gz`);
  return compressPromise.promise;
};
Backup.prototype.decompress = function(filePath){
  var decompressPromise = deferred();
  var inp2 = fs.createReadStream(filePath);
  var outputPath = filePath.split('.gz')[0];
  var out2 = fs.createWriteStream(outputPath);
  inp2.pipe(zlib.createGunzip()).pipe(out2); /* Uncompress the .gz file */
  decompressPromise.resolve(outputPath);
  return decompressPromise.promise;
};

module.exports = Backup;
