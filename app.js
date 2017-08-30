/**
 * Created by Sukitha on 2/24/2017.
 */

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var fs = require('fs');
var DbConn = require('dvp-dbmodels');
var config = require('config');
const commandLineArgs = require('command-line-args');
var async =require("async");
var cli = require('cli');
var path = require("path");
var logger = require('dvp-common/LogHandler/CommonLogHandler.js').logger;
var auditTrailsHandler = require('dvp-common/AuditTrail/AuditTrailsHandler.js');
var mkdirp = require('mkdirp');
var jwt = require('jsonwebtoken');
var redis = require('redis');
var login = config.Url.login;

var options = cli.parse({
    object: [ 'a', 'The object category', 'string', "test" ],
    path: [ 'o', 'Archive location', 'string', "/" ],
    token: [ 's', 'The security token', 'string', "wrong token" ],
    date: [ 'd', 'Date of delete', 'string', new Date().toISOString()],
    company: [ 'c', 'company id', 'int', 0 ],
    tenant: [ 't', 'tenant id', 'int', 0 ]
});

var util = require('util');
var mongoip=config.Mongo.ip;
var mongoport=config.Mongo.port;
var mongodb=config.Mongo.dbname;
var mongouser=config.Mongo.user;
var mongopass = config.Mongo.password;
var mongoreplicaset= config.Mongo.replicaset;

var mongoose = require('mongoose');
var connectionstring = '';
if(util.isArray(mongoip)){

    mongoip.forEach(function(item){
        connectionstring += util.format('%s:%d,',item,mongoport)
    });

    connectionstring = connectionstring.substring(0, connectionstring.length - 1);
    connectionstring = util.format('mongodb://%s:%s@%s/%s',mongouser,mongopass,connectionstring,mongodb);

    if(mongoreplicaset){
        connectionstring = util.format('%s?replicaSet=%s',connectionstring,mongoreplicaset) ;
    }
}else{

    connectionstring = util.format('mongodb://%s:%s@%s:%d/%s',mongouser,mongopass,mongoip,mongoport,mongodb)
}



mongoose.connection.on('error', function (err) {
    console.error( new Error(err));
    mongoose.disconnect();

});

mongoose.connection.on('opening', function() {
    console.log("reconnecting... %d", mongoose.connection.readyState);
});


mongoose.connection.on('disconnected', function() {
    console.error( new Error('Could not connect to database'));
    mongoose.connect(connectionstring,{server:{auto_reconnect:true}});
});

//mongoose.connection.once('open', function() {
//    console.log("Connected to db");
//
//});


mongoose.connection.on('reconnected', function () {
    console.log('MongoDB reconnected!');
});



var redisip = config.Security.ip;
var redisport = config.Security.port;
var redisuser = config.Security.user;
var redispass = config.Security.password;


//[redis:]//[user][:password@][host][:port][/db-number][?db=db-number[&password=bar[&option=value]]]
//redis://user:secret@localhost:6379


var redisClient = redis.createClient(redisport, redisip);

redisClient.on('error', function (err) {
    console.log('Error ' + err);
});

redisClient.auth(redispass, function (error) {

    if(error != null) {
        console.log("Error Redis : " + error);
    }
});

process.on('SIGINT', function() {
    mongoose.connection.close(function () {
        console.log('Mongoose default connection disconnected through app termination');
        process.exit(0);
    });
});


var Grid = require('gridfs-stream');
Grid.mongo = mongoose.mongo;


mongoose.connect(connectionstring,{server:{auto_reconnect:true}});

mongoose.connection.once('open', function () {

    console.log('open');
    var payload = jwt.decode(options.token);


    if(payload && payload.iss && payload.jti) {
        var issuer = payload.iss;
        var jti = payload.jti;


        redisClient.get("token:iss:" + issuer + ":" + jti, function (err, key) {

            if (err) {
                return;
            }
            if (!key) {
                return;
            }

            jwt.verify(options.token, key, function(err, decoded) {

                if(decoded) {
                    DbConn.FileUpload.findAll({where: [{'createdAt': {$lt: options.date}}, {ObjCategory: options.object}, {CompanyId: options.company}, {TenantId: options.tenant}]}).then(function (resFile) {

                        if (resFile) {

                            var gfs = Grid(mongoose.connection.db);

                            async.eachLimit(resFile, 20,

                                function (item, callback) {

                                    /////////////////////////////////////////////////////////////////////////////////////
                                    //console.log(item);
                                    try {
                                        logger.info("Item - ", item.toJSON());
                                    } catch (ex) {

                                        console.log(ex);
                                    }

                                    var readstream = gfs.createReadStream({
                                        filename: item.UniqueId
                                    });


                                    var _path = path.join(options.path, item.createdAt.toISOString().substring(0, 10), item.UniqueId + path.extname(item.Filename));

                                    mkdirp(path.dirname(_path), function (err) {
                                        if (err) {

                                            callback();

                                        } else {


                                            var wstream = fs.createWriteStream(_path);
                                            readstream.pipe(wstream);

                                            readstream.on('error', function (err) {
                                                //console.log('An error occurred!', err);
                                                callback();
                                            });

                                            readstream.on('end', function () {
                                                gfs.remove({
                                                    filename: item.UniqueId
                                                }, function (err) {

                                                    if (err) {
                                                        console.log("error");
                                                        callback();
                                                    } else {
                                                        console.log('success');

                                                        item.destroy().then(function () {


                                                            var iss = issuer;

                                                            var auditData = {
                                                                KeyProperty: "FILE",
                                                                OldValue: item.UniqueId,
                                                                NewValue: "",
                                                                Description: "File delete",
                                                                Author: iss,
                                                                User: iss,
                                                                ObjectType: options.object,
                                                                Action: "DELETE",
                                                                Application: "File archive"
                                                            };

                                                            auditTrailsHandler.CreateAuditTrails(options.tenant, options.company, iss, auditData, function (err, obj) {
                                                                if (err) {
                                                                    console.log('addAuditTrail -  Fail To Save Audit trail-[%s]', err);
                                                                }

                                                                callback();
                                                            });

                                                        });
                                                    }
                                                });
                                            });
                                        }
                                    });
                                },

                                function (err) {

                                    console.log("completed ............");
                                    process.exit(0);
                                }
                            );
                        }
                    });
                }else{
                    console.log("Verification failed");
                }

            });
        });
    }else{
        return;
    }
});
