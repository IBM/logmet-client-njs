/* eslint-disable no-console */

var LogmetProducer = require('../LogmetProducer'); 

var logmetEndpoint = 'logs.opvis.bluemix.net';
var logmetPort = 9091;

//********************************************************
//Export the environment variables TENANT_ID and LOGMET_TOKEN to run this sample.
//********************************************************
var tenantId = process.env.TENANT_ID;
var logmetToken = process.env.LOGMET_TOKEN;

// The Elasticsearch type of the documents to be written to Logmet
var type = 'fabio-test-6';

// How many data points will be produced when running this sample
var NUMBER_OF_DATA_POINTS = 200;

// Time interval between consecutive operations to send data to Logmet
var timeBetweenData = 100; // milliseconds

var sample_data = {
    "toolchain_guid": "9e7fb7bd-77f7-4be3-aba1-3ec7189f71de",
    "event": "unbind",
    "services": [{
        "broker_id": "12345678-9123-4567-8912-345678012github",
        "service_id": "github",
        "organization_guid": "00a0ed6d-483a-4595-8210-3256b2f38fa2",
        "parameters": {
            "repo_name": "mjwtest4",
            "repo_url": "https://github.stage1.ng.bluemix.net/markwill/mjwtest4.git",
            "owner_id": "markwill",
            "label": "mjwtest4",
            "extra_capabilities": [{
                "capability_id": "github.issues",
                "display_name": "Issues",
                "dashboard_url": "https://github.stage1.ng.bluemix.net/markwill/mjwtest4/issues",
                "label": "mjwtest4",
                "tags": ["think", "code"],
                "enabled": true
            },
            {
                "capability_id": "github.commits",
                "display_name": "Commits",
                "dashboard_url": "https://github.stage1.ng.bluemix.net/markwill/mjwtest4/commits",
                "label": "mjwtest4",
                "tags": ["think", "code"],
                "enabled": true
            }],
            "api_root_url": "https://github.stage1.ng.bluemix.net/api/v3",
            "token_url": "https://otc-github-broker.stage1.ng.bluemix.net/github/token"
        },
        "status": {
            "state": "configured"
        },
        "dashboard_url": "https://github.stage1.ng.bluemix.net/markwill/mjwtest4",
        "instance_id": "2511d8b4-e584-4d32-9b59-8f83b004b066",
        "url": " https://otc-github-broker.stage1.ng.bluemix.net/github-broker/api",
        "description": "Store your source code with the GitHub Enterprise Service.",
        "tags": ["third-party", "code", "collaboration", "scm"]
    }],
    "token": "accessToken",
    "toolchain_id": "9e7fb7bd-77f7-4be3-aba1-3ec7189f71de",
    "id": "9e7fb7bd-77f7-4be3-aba1-3ec7189f71de",
    "id_type": "tool_id",
    "timestamp": 1457978965959.90,
    "fabio_test": {
        "dashboard_url": "https://github.stage1.ng.bluemix.net/markwill/mjwtest4",
        "instance_id": "2511d8b4-e584-4d32-9b59-8f83b004b066",
        "url": " https://otc-github-broker.stage1.ng.bluemix.net/github-broker/api",
        "description": "Store your source code with the GitHub Enterprise Service.",
        "tags": ["third-party", "code", "collaboration", "scm"],
        "my_array": [1, 4, 8]
    }
};

var logmetClient = new LogmetProducer(logmetEndpoint, logmetPort, tenantId, logmetToken, false);

logmetClient.connect(function(error, status) {
    if (error != '') {
        console.log('LogmetClient returned an error: ' + error);
    } else if (status.handshakeCompleted) {
        console.log('LogmetClient is ready to send data.');
	
        var data = sample_data;

        var i = 0;
        var timer = setInterval(function () {
            if (i < NUMBER_OF_DATA_POINTS) {
                data.item = i.toString();
                logmetClient.sendData(data, type, tenantId, function(error, data) {
                    if (error) {
                        console.log('Logmet client rejected the data.');
                        console.log('Error returned: ' + error);
                    } else {
                        console.log('Logmet client accepted the data; i = ' + i + '; connectionActive: ' + data.connectionActive);
                        i += 1;
                    }
                });
            } else {
                clearInterval(timer);
                logmetClient.terminate();
            }
        }, timeBetweenData);
    }
});