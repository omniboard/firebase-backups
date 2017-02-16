const fs = require('fs');
const AWS = require('aws-sdk');
const deferred = require('deferred');

var getAwsParams = function getAwsParams() {
  var AWS = {};
  
  if (process.env.hasOwnProperty('FBR_S3_BUCKET')) { 
    AWS.FBR_S3_BUCKET = process.env.FBR_S3_BUCKET;
  } else {
    console.log('Bucket Not Configured in Environment.');
    AWS.FBR_S3_BUCKET = null;
  }
  if (process.env.hasOwnProperty('FBR_AWS_REGION')) { 
    AWS.FBR_REGION = process.env.FBR_AWS_REGION;
  } else {
    console.log('Region Not Configured in Environment.');
    AWS.FBR_REGION = null;
  }
  return AWS;
};

exports.getFromAWS = function getFromAWS(bucketLocation, fullPath) {
  var fileName = `RESTORE_${bucketLocation.split('/')[1]}`;
  var fullPathToFileName = `${fullPath}${fileName}`;
  var def = deferred();
  var AWSData = getAwsParams();
  var getParams = {
    Bucket: AWSData.FBR_S3_BUCKET,
    Key: bucketLocation,
  };
  var s3 = new AWS.S3({params: {Bucket: AWSData.FBR_S3_BUCKET}});
  
  s3.getObject(getParams, function getObjectResults(err, data) {
    if (err) {
      console.error('get object error: ', err.message);
      def.resolve();
    } else if (data == null || data.Body == null) {
      console.error('... missing file innerDefnformation');
    } else {
      // download compressed file
      var fd = fs.openSync(fullPathToFileName, 'w');
      fs.writeSync(fd, data.Body, 0, data.Body.length, 0);
      fs.closeSync(fd);
      def.resolve(fullPathToFileName);
    }
  });

  return def.promise;
},

exports.uploadS3 = function uploadS3(filepath, bucketLocation) {
  var def = deferred();
  var filePathPart = filepath.split('/').pop();
  var s3KeyName = `${bucketLocation}/${filePathPart}`;
  var AWSData = getAwsParams();
  var s3 = new AWS.S3({params: {Bucket: AWSData.FBR_S3_BUCKET}});
  
  AWS.config.region = AWSData.FBR_REGION;
  fs.readFile(filepath, function readFileResults(err, filedata) {
    if (err) {
      def.reject('unable to read file to upload to s3');
    } else {
      var data = {
        Bucket: AWSData.FBR_S3_BUCKET,
        Key: s3KeyName,
        Body: filedata,
      };
      var result;
      
      s3.putObject(data, function s3PutResults(err, data) {
        if (err) {
          result = {
            msg: `Error uploading data: ${bucketLocation}`,
          };
          def.reject(result);
        } else {
          result = {
            msg: `Backup saved to s3 drive : ${AWSData.FBR_S3_BUCKET}/${s3KeyName}`,
            url: `https://s3.amazonaws.com/${AWSData.FBR_S3_BUCKET}/${s3KeyName}`,
            key: s3KeyName,
          };
          console.log(result.msg);
          def.resolve(result);
        }
      });
    }
  });

  return def.promise;
}

exports.listS3 = function listS3(bucket) {
  var listPromise = deferred();
  var AWSData = getAwsParams();
  var s3 = new AWS.S3({params: {Bucket: AWSData.FBR_S3_BUCKET}});
  var params = {
    Bucket: AWSData.FBR_S3_BUCKET,
    Delimiter: ',',
    Prefix: bucket,
  };
 
  s3.listObjects(params, function listObjectsResults(error, response) {
    if (error) {
      listPromise.resolve(error);
    } else {
      listPromise.resolve(response.Contents);
    }
  });
  return listPromise.promise;
};
