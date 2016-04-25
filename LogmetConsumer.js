/**
 *  This class encapsulates the Logmet client code, used to query data from Logmet.
 */

var https = require('https');

var logger = require('./logger');


/*
 * @constructor
 * @this {LogmetConsumer}
 *
 * @param {string} logmetQueryEndpoint The hostname or IP address of the Logmet server used for querying
 *  
 */
function LogmetConsumer(logmetQueryEndpoint) {
	this.endpoint = logmetQueryEndpoint;
}

//Export the constructor
module.exports = LogmetConsumer;


/*******************************************
 *  Public Interface of LogmetClient
 *******************************************/

/*
 * Queries Logmet for data.
 * 
 *  @param {string} tenantId The id of the tenant who owns the data
 *  @param {string} bearerToken The bearer token of the tenant
 *  @param {string} type The type associated with the Elasticsearch documents to be searched for
 *  @param {object} queryDSLBody An object representing a query expressed in terms of the Elasticsearch query DSL
 *  @param {function(error, data)} callback A callback function used to process errors or the data returned by the query
 *  
 *  @return An array of objects, where each object corresponds to an Elasticsearch document
 */
LogmetConsumer.prototype.query = function(tenantId, bearerToken, type, queryDSLBody, callback) {
	var validatedBearerToken = validateToken(bearerToken);
	var path = '/elasticsearch/logstash-' + tenantId + '-*/' + type + '/_search';
	var queryOptions = {
			hostname: this.endpoint,
			path: path,
			headers: {
				'Accept': 'application/json',
				'X-Auth-Token': validatedBearerToken,
				'X-Auth-Project-Id': tenantId
			},
			method: 'POST'
	};
	var queryBodyJSONString = JSON.stringify(queryDSLBody)
	
	logger.info('Performing Logmet query', {tenant_id: tenantId, doc_type: type, query_body: queryBodyJSONString});
	
	var retrievedString = '';
	var retrievedObject;
	
	var request = https.request(queryOptions, function(result) {
		result.on('data', function(chunk) {
			logger.debug('Received a chunk of Logmet data: ' + chunk);
			retrievedString += chunk;
		});
		
		result.on('end', function() {
			if (retrievedString) {
				retrievedObject = JSON.parse(retrievedString);
				callback('', retrievedObject.hits.hits);
			} else {
				callback('', []);
			}
		});
	});
	request.write(queryBodyJSONString);
	request.end();
	
	request.on('error', function (error) {
		logger.warn('ERROR returned by Logmet query: ' + error);
		callback(error);
	});
};


/*******************************************
 *  Module's private functions
 *******************************************/

function validateToken(bearerToken) {
	var validatedToken = bearerToken;
	if (bearerToken.startsWith('bearer ')) {
		validatedToken = bearerToken.replace('bearer ', '');
	}
	return validatedToken;
}