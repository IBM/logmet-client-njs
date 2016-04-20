/**
 * Module defining a common logger
 */

var bunyan = require('bunyan');

var logger = bunyan.createLogger({name:'logmet_client', src:false, level:'debug'});

module.exports = logger;