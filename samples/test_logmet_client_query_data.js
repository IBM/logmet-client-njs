/* eslint-disable no-console */

var LogmetConsumer = require('../LogmetConsumer'); 

var logmetQueryEndpoint = 'logmet.ng.bluemix.net';


// ********************************************************
// Export the environment variables TENANT_ID and BEARER_TOKEN to run this sample.
// ********************************************************
var tenantId = process.env.TENANT_ID;
var bearerToken = process.env.BEARER_TOKEN;

//The Elasticsearch type of the documents to be written to Logmet
var type = 'fabio-test-1';

var logmetClient = new LogmetConsumer(logmetQueryEndpoint);

var queryDSLBody = {
    _source: true,
    query: {
        filtered: {
            filter: {
                term: {
                    item: 15
                }
            }
        }
    }
};

logmetClient.query(tenantId, bearerToken, type, queryDSLBody, function(error, documents) {
    if (error != '') {
        console.log('Query returned an error: ' + error);
    } else {
        console.log('Documents returned by Logmet:');
        console.log(documents);
    }
});