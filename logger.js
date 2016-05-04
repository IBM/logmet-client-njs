/**
 * Module defining a common logger
 */

var bunyan = require('bunyan');

var logger = bunyan.createLogger({name:'logmet_client', src:false, level: process.env.logmet_client_njs_level || 'warn'});

module.exports = logger;