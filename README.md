# firebase-backups
:no_entry_sign: **Does not backup security rules**

Provides a mechanism for backup and restoration of firebase databases. 

##Install
Clone this repo and run `npm install`

##Backup Database
_Using curl this will download the complete json data and store it in a local file._
```sh
node run.js -restore=false -name=<NAME> -dbHostName=<NAME> -dbToken=<FIREBASE_TOKEN> -tempDirectory=<RELATIVE_PATH>
echo Example Call
node run.js -restore=false -name=firefly -dbHostName=firefly1529 -dbToken=1234567890 -tempDirectory=backups/firefly/prod
```

##Restore Database
_Using curl this will inflate the gz file and `PUT` the complete json data in the database._
```sh
node run.js -restore=true -name=<NAME> -dbHostName=<NAME> -dbToken=<FIREBASE_TOKEN> -tempDirectory=<RELATIVE_PATH>
echo Example Call
node run.js -restore=true -name=firefly -dbHostName=firefly1529 -dbToken=1234567890 -tempDirectory=backups/firefly/prod
```

## Enable S3
To enable S3 you must first setup your S3 account with permissions and a bucket to write the data to

### Required environment variables
- `FBR_SECRET_ACCESS_KEY`
- `FBR_REGION`
- `FBR_S3_BUCKET`
- `FBR_ACCESS_KEY_ID`

### Command Parameters
- `-restore` : `true|false` 
- `-name=<NAME>` : The name of the database `Serenity-Mal-1`
- `-dbHostName=<NAME>` : The hostname of the database `Serenity-Mal-1`. It can be different from <NAME> if you have had to restore 
- `-dbToken=<FIREBASE_TOKEN>` : The token for the database name in `NAME`
- `-tempDirectory=<PATH>` : A path on the local system that restore is written to before saving to s3 : `Serenity-Mal-1/20170131T181548358Z.json.gz`. It will be deleted when the backup is done. Unless `-saveLocal=true` is set. Consider using the /tmp directory.
- `-saveS3` : `true|false`
- `-saveLocal=true` 

### List Backups On S3 
List backups for hostname: `node run.js -list=true -dbHostname=<NAME>`
List all backups on s3: `node run.js -list=true -dbHostname=<NAME>`
  
### Backup to S3
```sh
node run.js -restore=false -name=<NAME> -dbHostName=<NAME> -dbToken=<FIREBASE_TOKEN> -tempDirectory=<RELATIVE_PATH> -saveS3=true
```

### Restore from S3
```sh
node run.js -restore=true -dbHostName=<NAME> -dbToken=<FIREBASE_TOKEN> -restoreS3=true -restoreLocation=<FILE_ON_S3>`
```
