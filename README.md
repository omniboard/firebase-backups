# firebase-backups
:no_entry_sign: **Does not backup security rules**

Provides a mechanism for backup and restoration of firebase databases. 

##Install
Clone this repo and run `npm install`

##Backup Database
_Using curl this will download the complete json data and store it in a local file._
```sh
node run.js false <name for database> <database hostname> <database toke> <folder_location>
```
###Example Backup
```sh
node run.js false firefly firefly1529 1234567890 backups/firefly/prod
```

##Restore Database
_Using curl this will inflate the gz file and `PUT` the complete json data in the database._
```sh
node run.js true <name for database> <database hostname> <database toke> <folder_location>
```

###Example Restore
```sh
node run.js true firefly firefly1529 1234567890 backups/firefly/prod/20170124T155919388Z.json.gz
```

## Enable S3
To enable S3 you must first setup your S3 account with permissions and a bucket to write the data to

### Required environment variables
- `FBR_SECRET_ACCESS_KEY`
- `FBR_REGION`
- `FBR_S3_BUCKET`
- `FBR_ACCESS_KEY_ID`

### Command Parameter
- `-saveS3=true`
