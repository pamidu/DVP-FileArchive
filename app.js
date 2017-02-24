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


    DbConn.FileUpload.findAll({where: [{'createdAt':{$lt: new Date('2016/09/04')}},{ObjCategory: 'CONVERSATION'},{CompanyId:103},{TenantId:1}]}).then(function (resFile) {

        if (resFile) {

            var gfs = Grid(mongoose.connection.db);

            async.each(resFile,

                function(item, callback){

                    gfs.remove({
                        filename : item.UniqueId
                    }, function (err) {

                        callback();

                        if (err) {

                            console.log("error");
                        }else {
                            console.log('success');
                        }
                    });
                },

                function(err){

                    console.log("done ............");
                }
            );
        }
    });

});