

# logmet-client

This is a nodejs module for sending data to and querying data from Logmet. This module defines two classes: `LogmetProducer` and `LogmetConsumer`.


## LogmetProducer Class

This class can be used to send nodejs objects to Logmet. It translates the objects into a format that allows the object structure to be preserved on Logmet so that the data becomes queriable.

The constructor `LogmetProducer` is defined as follows:

```javascript
function LogmetProducer(endpoint, port, tenantOrSupertenantId, logmetToken, isSuperTenant)
```

The above constructor takes the  following parameters:

* `logmetEndpoint`: The Logmet host to which the data will be sent. For example, if the target is the production environment of the _US-South_ datacenter, the value of this parameter should be `logs.opvis.bluemix.net`.
* `logmetPort`: The port Logmet to which Logmet clients should connect for sending data.
* `logmetTenant`: The value of this parameter represents either a Bluemix space id (tenant id), or the id of a Logmet _supertenant_.
* `logmetToken`: This is the Logmet token associated with the chosen `logmetTenant`. This token can be obtained by querying Logmet. It never expires.
* `isSuperTenant`: This is a Boolean-valued parameter indicating whether or not the value passed to `logmetTenant` represents a _supertenant_.

### Usage

Below is a sample code showing how to instantiate the LogmetProducer class. In the example, we assume that the _logmet-client_ module code is one level up in the directory hierarchy relative to the sample code.

```javascript
var logmet = require('../logmet-client');

var logmetEndpoint = 'logs.opvis.bluemix.net';
var logmetPort = 9091;
var logmetTenant = process.env.LOGMET_TENANT;
var logmetToken = process.env.LOGMET_TOKEN;

var logmetProducer = new logmet.LogmetProducer(logmetEndpoint, logmetPort, logmetTenant, logmetToken, false);

// event contains the object to be sent to Logmet. Omitting the initialization...
// event = {
//    ...
// } 

logmetProducer.sendData(event, 'tool_id', logmetTenant, function(error, data) {
  if (error) {
    if (!data.isDataAccepted) {
      console.log('Logmet client rejected the data. ERROR: ' + error);
      // Retry logic goes here
    } 
  else if (data.isDataAccepted) {
    console.log('Logmet client accepted the data.');
  }
});
```

The `sendData` function, used in the sample above, takes the following parameters in that order:

* the object to be send to Logmet.
* the Elasticsearch type to be associated with the object.
* the Bluemix space id corresponding to the owner of the data. If the constructor was called with a regular tenant id, that is, `isSuperTenant` was set to `false`, then the value of this parameter must match the id given to the constructor. Differently, if the constructor was called with `isSuperTenant` set to `true`, then the value of this parameter will contain a Bluemix space id corresponding to the tenant who will own the data, on behalf of whom the _supertenant_ is sending the data.
* A callback function, indicating whether the data was accepted or not.

In case of error, the callback function will receive the error message in the `error` argument. The data returned by the callback function in the `data` argument is an object containing three Boolean-valued fields, namely:

```javascript
{
  isBufferFull: false, 
  connectionError: false, 
  isDataAccepted: true
}
```

If `isDataAccepted` is true, the data was accepted by the `logmet-client` code and will be eventually indexed by Logmet. Otherwise, the reason for the data rejection can be known based on the value of the fields `isBufferFull` and `connectionError`.

## LogmetConsumer Class