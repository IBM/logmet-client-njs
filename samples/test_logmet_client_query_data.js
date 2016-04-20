var LogmetConsumer = require('../LogmetConsumer'); 

var logmetQueryEndpoint = 'logmet.ng.bluemix.net';


// ********************************************************
// Export the environment variables TENANT_ID and BEARER_TOKEN to run this sample.
// ********************************************************
var tenantId = process.env.TENANT_ID;
var bearerToken = process.env.BEARER_TOKEN;

var logmetClient = new LogmetConsumer(logmetQueryEndpoint, tenantId, bearerToken);

var queryDSLBody = {
		_source: true,
		query: {
			filtered: {
				filter: {
					term: {
						item: '98'
					}
				}
			}
		}
};

logmetClient.query(tenantId, bearerToken, 'fabio-normal-big-5', queryDSLBody, function(error, documents) {
	if (error != '') {
		consolelog('Query returned an error: ' + error);
	} else {
		console.log(documents);
	}
});