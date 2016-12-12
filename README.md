

# logmet-client

This is a nodejs module for sending data to and querying data from Logmet. This module defines two classes: `LogmetProducer` and `LogmetConsumer`. This document describes these two classes and provides some guidance on how to use them to, respectively, send and query data.

## License

This library is released under the [Apache 2.0 license](https://github.com/IBM/logmet-client-njs/blob/master/LICENSE.txt).

## Contributing

Contributions are welcome via pull requests. Please submit your pull request against the [Developer's Certificate of Origin](https://github.com/IBM/logmet-client-njs/blob/master/DCO.txt), adding a line like the following to the end of the file, using your name and e-mail address:

```
Signed-off-by: John Doe john.doe@example.org
```


## LogmetProducer Class

This class can be used to send nodejs objects to Logmet. It translates the objects into a format that allows the object structure to be preserved on Logmet so that the data becomes queriable. It is important to note that this class must be treated as a singleton, that is, in one nodejs program it makes sense to have only one instance of this class.

The constructor `LogmetProducer` is defined as follows:

```javascript
function LogmetProducer(endpoint, port, tenantOrSupertenantId, logmetToken, isSuperTenant, options)
```

The above constructor takes the  following parameters:

* `logmetEndpoint`: The Logmet host to which the data will be sent. For example, if the target is the production environment of the _US-South_ datacenter, the value of this parameter should be `logs.opvis.bluemix.net`.
* `logmetPort`: The port Logmet to which Logmet clients should connect for sending data.
* `logmetTenant`: The value of this parameter represents either a Bluemix space id (tenant id), or the id of a Logmet _supertenant_.
* `logmetToken`: This is the Logmet token associated with the chosen `logmetTenant`. This token can be obtained by querying Logmet. It never expires.
* `isSuperTenant`: This is a Boolean-valued parameter indicating whether or not the value passed to `logmetTenant` represents a _supertenant_.
* `options`: This object allows you to optionally override defaults in the client. Currently, the only supported override is for `bufferSize`

### Usage

Below is a sample code showing how to use the `LogmetProducer` class. In the example, we assume that the _logmet-client_ module code is one level up in the directory hierarchy relative to the sample code.

```javascript
var logmet = require('../logmet-client');

var logmetEndpoint = 'logs.opvis.bluemix.net';
var logmetPort = 9091;
var logmetTenant = process.env.LOGMET_TENANT;
var logmetToken = process.env.LOGMET_TOKEN;

var logmetProducer = new logmet.LogmetProducer(logmetEndpoint, logmetPort, logmetTenant, logmetToken, false, {bufferSize: 100});

logmetProducer.connect(function(error, status) {
    if (error) {
        console.log('Connection with Logmet failed. ERROR: ' + error);
    } else if (status.handshakeCompleted) {
        console.log('LogmetClient is ready to send data.');
    }
});

function sendData(event) {
    logmetProducer.sendData(event, 'tool_id', logmetTenant, function(error, status) {
        if (error) {
            console.log('Logmet client rejected the data. ERROR: ' + error);
        } else {
            console.log('Logmet client accepted the data.');
            if (!status.connectionActive) {
                console.log('WARNING: Logmet client not connected to Logmet, data waiting in buffer.')
            }
        }
    });
}
```

Before calling the `sendData` function for the first time, the program should call the function `connect`. This function will establish a persistent connection with Logmet. The `connect` function takes a callback as its only argument. Upon successfully connecting to Logmet, `connect` will pass to the callback a `status` object with the Boolean-valued field `handshakeCompleted` set to `true`. If the `sendData` function is called before the `connect` function callback returns, incoming data will be placed in the buffer and will be sent to Logmet once a connection with Logmet is established.

The `sendData` function, as shown in the sample above, takes the following parameters in that order:

* the object to be send to Logmet.
* the Elasticsearch type to be associated with the object.
* the Bluemix space id corresponding to the owner of the data. If the constructor was called with a regular tenant id, that is, `isSuperTenant` was set to `false`, then the value of this parameter must match the id given to the constructor. Differently, if the constructor was called with `isSuperTenant` set to `true`, then the value of this parameter will contain a Bluemix space id corresponding to the tenant who will own the data, on behalf of whom the _supertenant_ is sending the data.
* A callback function, indicating whether the data was accepted or not.

If the data buffer is full, the data will not be accepted and the callback function will receive an error message in the `error` argument. The data returned by the callback function in the `status` argument is an object containing a Boolean-valued field:

```javascript
{
  connectionActive: false
}
```

The `connectionActive` field indicates whether the `logmet-client` is currently connected to Logmet. When the connection is inactive, data is placed in the buffer but won't be sent to Logmet until a connection is established.

## LogmetConsumer Class

This class can be used to query Logmet for data. This is by no means the only way to query Logmet for data stored with the `LogmetProducer` class. It is just a convenient way to abstract a few details such as setting Logmet HTTP headers and dealing with the Logmet multitenancy-based index-naming approach.

The constructor `LogmetConsumer` is defined as follows:

```javascript
function LogmetConsumer(logmetQueryEndpoint)
```

The above constructor takes one argument, namely, `logmetQueryEndpoint`. The value of that argument must be the host name exposed by Logmet for querying purposes. For example, if the target is the production environment of the _US-South_ datacenter, the value of this parameter should be `logmet.ng.bluemix.net`.

### Usage

Below is a sample code showing how to use the `LogmetConsumer` class. In the example, we assume that the _logmet-client_ module code is one level up in the directory hierarchy relative to the sample code.

```javascript
var logmet = require('../logmet-client');

var logmetQueryEndpoint = 'logmet.ng.bluemix.net';

var logmetConsumer = new logmet.LogmetConsumer(logmetQueryEndpoint);

var queryDSLBody = {
		query: {
			match: {
				id: "fabioPipeline1"
			}
        }
};

// Omitted initializations of tenantId and bearerToken

logmetConsumer.query(tenantId, bearerToken, 'tool_id', queryDSLBody, function(error, documents) {
	if (error != '') {
		console.log('Query returned an error: ' + error);
	} else {
		console.log('Documents returned by Logmet:');
		console.log(documents);
	}
});
```
The `query` function, used in the sample above, takes the following parameters in that order:

* The id of the tenant (Bluemix space id) who owns the data that is being queried.
* A valid Bluemix bearer token belonging to the identified tenant.
* The Elasticsearch type that has been associated with the data being queried.
* A query expressed in the Elasticsearch query DSL codified as a nodejs object.
* A callback function used to process errors as well as the actual data returned by the query.

In case of error, the callback function will receive the error message in the `error` argument. All documents retrieved by the query will be passed to the callback function as an array of objects assigned to the argument `documents`.

### Debugging

The default logging level for the library is `warn`, to customize it set the environment variable `logmet_client_njs_level` to your desired logging level. Example: `export logmet_client_njs_level='debug' && node index`. Other valid logging options are `trace`, `info`, `warn`, `error` and `fatal`.
