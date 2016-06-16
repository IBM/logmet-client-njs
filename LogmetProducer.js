/**
 *  This class encapsulates the Logmet client code, used to ship data to Logmet.
 */

var os = require('os');
var tls = require('tls');

var logger = require('./logger');

/*******************************************
 *  Module-level variables and constants
 *******************************************/

// Socket used for communicating with Logmet
var tlsSocket;

// Keeps track of the last ACK received from Logmet on the current network connection
var lastACK = -1;

// Keeps track of the last sequence number we sent out to Logmet on the current network connection
var currentSequenceNumber = 0;

// Logmet mandatory field for identifying the data owner
var ALCHEMY_TENANT_ID_KEY = 'ALCH_TENANT_ID';

// Max Lumberjack sequence number before rolling over 
var MAX_SEQ_NUMBER = Number.MAX_SAFE_INTEGER - 1;

// Used to buffer data that needs to be sent out to Logmet
var pendingDataElements = [];

// Data element currently in-flight and not ACKED
var currentDataElement = null;

// Flag indicating whether or not the current data element has been ACKed
var currentDataElementACKED = false;

// Maximum number of pending data elements we are willing to buffer
var MAX_PENDING_ELEMENTS = 50;

// Used for constructing a window frame
var windowFramebuffer;

// Flag indicating if an initial connection has been established
var initialConnection = false;

// Flag indicating if we are recovering from a connection error
var reconnecting = false;

// When a call to terminate() is made, how frequently we should check if all data has been flushed.
var TERMINATE_POLL_INTERVAL = 300; // milliseconds 

// How much time until we detect an unexpected network error 
var INACTIVITY_TIMEOUT = 30000; // milliseconds

// How much time until we re-try when a connection drops
var RETRY_DELAY = 2; // seconds
var CURRENT_EXPONENT_BACKOFF = 0; // variable to increment with consecutive failures (exponential backoff)


/*
 * @constructor
 * @this {LogmetProducer}
 *
 * @param {string} endpoint The hostname or IP address of the target Logmet server
 * @param {number} port The Logmet port
 * @param {string} tenantOrSuperTenantId It represents either a Logmet supertenant id or a Bluemix space id
 * @param {string} logmetToken The Logmet token (API key) used for authentication
 * @param {boolean} isSuperTenant Flag indicating whether or not the value passed to tenantOrSupertenantId represents a supertenant
 * @param {object} options Additional optional parameters that override defaults. Supported overrides: bufferSize
 *  
 */
function LogmetProducer(endpoint, port, tenantOrSupertenantId, logmetToken, isSuperTenant, options) {
	this.endpoint = endpoint;
	this.port = port;
	this.tenantOrSupertenantId = tenantOrSupertenantId;
	this.logmetToken = logmetToken;
	this.isSuperTenant = isSuperTenant;

	if (options && options.bufferSize && parseInt(options.bufferSize, 10)) {
		MAX_PENDING_ELEMENTS = parseInt(options.bufferSize, 10);
	}
		
	windowFramebuffer = new Buffer(6);
	windowFramebuffer.write('1W', 0, 2);	
	
}

// Export the constructor
module.exports = LogmetProducer;


/*******************************************
 *  Public Interface of LogmetClient
 *******************************************/

/*
 * Establishes a connection with Logmet for sending data.
 * This function must be called once to enable the sendData function
 * 
 * @param {function(error,data)} callback Callback function to be invoked in case of error or for signaling that 
 *  the handshake with Logmet has successfully completed. The returned error message is assigned to the 
 *  first argument of callback; if any data is available, it is assigned to the second argument of callback.
 */

LogmetProducer.prototype.connect = function(callback) {
	// Connect to Logmet so that data can be sent out
	connectToMTLumberjackServer(this.endpoint, this.port, this.tenantOrSupertenantId, this.logmetToken, this.isSuperTenant, callback);
};

/*
 * Sends data to Logmet. 
 * 
 * A call to the connectToMTLumberjackServer() function must be made before sendData() can be called.
 * 
 * @param {object} data The object representing the data to be sent out to Logmet
 * @param {string} type The type that identifies the data
 * @param {function} callback(error, data) A callback function that is called to notify the caller of the operation result
 * @param {string} tenantId The id of the tenant who owns the data 
 */
LogmetProducer.prototype.sendData = function(data, type, tenantId, callback) {	
	var connection = initialConnection && !reconnecting;

	if (pendingDataElements.length >= MAX_PENDING_ELEMENTS) {
		// Our buffer is full. Apply back pressure.
		logger.warn('Buffer of data elements is full. Rejecting new data');
		callback('ERROR: Buffer of data elements is full', {connectionActive: connection});
		return;
	}
	
	var augmentedData = Object.assign({}, data);
	augmentedData[ALCHEMY_TENANT_ID_KEY] = tenantId;
	augmentedData['type'] = type;
	
	pendingDataElements.push(augmentedData);
	
	logger.debug('Current size of pending data buffer: ' + pendingDataElements.length);
	
	callback('', {connectionActive: connection});
	if (connection) {
		processDataBuffer();
	}
};


/*
 *  Gracefully stops the connection with Logmet's MT Lumberjack server
 *  It will close the connection only after all locally-buffered data has been received by Logmet.
 */
LogmetProducer.prototype.terminate = function() {
	if (pendingDataElements.length == 0 && currentDataElementACKED) {
		tlsSocket.destroy();
		logger.info('Logmet client has been stopped.');
	} else {
		logger.info('Started a timer to stop the Logmet client. Poll frequency: ' + TERMINATE_POLL_INTERVAL + ' ms');
		var timer = setInterval(function() {
			if (pendingDataElements.length == 0 && currentDataElementACKED) {
				tlsSocket.destroy();
				logger.info('Logmet client has been stopped.');
				clearInterval(timer);
			}
		}, TERMINATE_POLL_INTERVAL);
	}
};


/*******************************************
 *  Module's private functions
 *******************************************/

/*
 * Call parameter retryFunction after certain number of seconds
 * the number of seconds is dependent on the number of consecutive connection failures
 * and uses an exponential backoff equation.
 */
function retryWithExponentialBackoff(retryFunction) {
	setTimeout(retryFunction, RETRY_DELAY*(Math.pow(2, CURRENT_EXPONENT_BACKOFF)) * 1000);
	CURRENT_EXPONENT_BACKOFF++; // for next time.
};

/*
 * Establishes a connection with Logmet.
 */
function connectToMTLumberjackServer(endpoint, port, tenantOrSupertenantId, logmetToken, isSuperTenant, callback) {
	currentSequenceNumber = 0;
	lastACK = -1;
	
	var conn_options = {
			host: endpoint,
			port: port
	};
	tlsSocket = tls.connect(conn_options, function() {
		  if (tlsSocket.authorized) {
		    logger.info('Successfully established a connection with Logmet');
		    
		    // Now that the connection has been established, let's perform the handshake with Logmet
		    authenticate(tenantOrSupertenantId, logmetToken, isSuperTenant);
		  } else {
		    logger.error('Failed to establish a connection with Logmet: ' + tlsSocket.authorizationError);
		    callback('SSL connection with Logmet has not been authorized. ERROR: ' + tlsSocket.authorizationError, '');
		  }
	});

	var retryFunction = connectToMTLumberjackServer.bind(this, endpoint, port, tenantOrSupertenantId, logmetToken, isSuperTenant, callback);

	
	// Define callbacks to handle the network communication with Logmet
	
	tlsSocket.setTimeout(INACTIVITY_TIMEOUT, function() {
		// Something unexpected happened to our connection with Logmet. Let's reconnect.
		
		if (reconnecting) {
			logger.debug('Caught "timeout" event while reconnecting. Allow current reconnection attempt to proceed');
			return;
		}
		
		logger.info('A "timeout" event was caught. Proactively re-creating logmet connection.');
		reconnecting = true;
		tlsSocket.destroy();
		retryFunction();
	});
	
	tlsSocket.on('error', function(error) {
		// Something unexpected happened to our connection with Logmet. Let's reconnect.
		
		logger.debug('Caught error event', error);
		
		if (error.code == 'ECONNREFUSED' || error.code == 'ENOTFOUND') {
			//   While trying to connect or reconnect, either the connection attempt was refused 
			// or the network was down. Retry...
			logger.warn('Connection refused or network down. Will attempt to reconnect in ' + RETRY_DELAY*(Math.pow(2, CURRENT_EXPONENT_BACKOFF)) + ' seconds.');
			reconnecting = true;
			tlsSocket.destroy();
			retryWithExponentialBackoff(retryFunction);
			return;
		}
		
		if (reconnecting) {
			logger.debug('Caught "error" event while reconnecting. Allow current reconnection attempt to proceed');
			return;
		}
		
		logger.warn('An "error" event was caught. Detected a connection error with Logmet. Will attempt to reconnect in ' + RETRY_DELAY*(Math.pow(2, CURRENT_EXPONENT_BACKOFF)) + ' seconds.');
		reconnecting = true;
		tlsSocket.destroy();
		retryWithExponentialBackoff(retryFunction);
	});
	
	tlsSocket.on('disconnect', function() {
		// Something unexpected happened to our connection with Logmet. Let's reconnect.
		if (reconnecting) {
			logger.debug('Caught "disconnect" event while reconnecting. Allow current reconnection attempt to proceed');
			return;
		}
		
		logger.warn('A "disconnect" event was caught. The connection with Logmet was lost. Will attempt to reconnect in ' + RETRY_DELAY*(Math.pow(2, CURRENT_EXPONENT_BACKOFF)) + ' seconds.');
		reconnecting = true;
		tlsSocket.destroy();
		retryWithExponentialBackoff(retryFunction);
	});
	
	tlsSocket.on('end', function() {
		// Something unexpected happened to our connection with Logmet. Let's reconnect.
		if (reconnecting) {
			logger.debug('Caught "end" event while reconnecting. Allow current reconnection attempt to proceed');
			return;
		}
		
		logger.warn('An "end" event was caught. The connection with Logmet was lost. Will attempt to reconnect in ' + RETRY_DELAY*(Math.pow(2, CURRENT_EXPONENT_BACKOFF)) + ' seconds.');
		reconnecting = true;
		tlsSocket.destroy();
		retryWithExponentialBackoff(retryFunction);
	});
	
	
	tlsSocket.on('data', function(data) {
		// We must have received an ACK from Logmet. Let's process it.
		var buffer = new Buffer(data);
		var version = buffer[0];
		var type = buffer[1];
		if (type != 65) {
			// Unknown ACK type
			logger.error('Received an unknown ACK type from Logmet: ' + String.fromCharCode(type));
		} else if (version == 48) {
			// Got a "0A" from Logmet, that is, an invalid combination of tenant id and password was used
			logger.error('Logmet indicated an unauthorized connection due to invalid credentials.');
			tlsSocket.destroy();
			callback('ERROR: Invalid Logmet credentials; check your tenant id and password.', '');
		} else if (version == 49) {
			// We got a '"1A"<ack_number>'. Let's read the ACK number.
			logger.debug("Reading ACK number");
			lastACK = buffer.readInt32BE(2);
			logger.info('Last ACK received: ' + lastACK);
			if (lastACK == 0) {
				// The connection has just been established.
				
				// If this is a reconnection after a failure, let's check if there is unACKED data to be sent
				if (currentDataElement != null && !currentDataElementACKED) {
					var frame = convertDataToFrame(currentDataElement, incrementSequenceNumber());
					tlsSocket.write(frame);
				}
				
				logger.info('Initialized the Logmet client. The Logmet handshake is complete.');

				// Reset the backoff exponent, as we have just successfully connected.
				CURRENT_EXPONENT_BACKOFF = 0;
				
				if (!reconnecting) {
					// Let's signal the constructor caller that the connection is established.
					// We only notify the constructor caller when the first connection is established.
					// We should NOT call back to the caller every time we reconnect due to an error.
					initialConnection = true;
					callback('', {handshakeCompleted: true});
				}
			} else {
				// A data frame has been ACKed
				if (!reconnecting) {
					currentDataElement = null;
					currentDataElementACKED = true;
				}
			}
			
			reconnecting = false;
			processDataBuffer();
		} else {
			// Unknown ACK version
			logger.error('Received an unknown ACK version from Logmet: ' + String.fromCharCode(version));
		}
	});
}

/*
 * Performs the Logmet authentication handshake
 */
function authenticate(tenantOrSupertenantId, logmetToken, isSuperTenant) {
	// Identification frame:
	// 1 | I | id_size | id
	var idFrameTypeAndVersion = "1I";
	var clientIdString = "standalone_dlms_data_client_v0.0.1_" + os.hostname();
	logger.info('Identifying the Logmet client: ' + clientIdString);
	
	var idDataBuffer = new Buffer(idFrameTypeAndVersion.length + 1 + clientIdString.length);
	
	idDataBuffer.write(idFrameTypeAndVersion, 0 , idFrameTypeAndVersion.length);
	
	idDataBuffer.writeUIntBE(clientIdString.length, idFrameTypeAndVersion.length, 1);
	idDataBuffer.write(clientIdString, idFrameTypeAndVersion.length + 1, clientIdString.length);
	
	// Send the identification frame to Logmet
	tlsSocket.write(idDataBuffer);
	
	// Authentication frame:
	// 2 | S or T | tenant_id_size | tenant_id | token_size | token
	var authFrameTypeAndVersion = isSuperTenant ? '2S' : '2T';
	logger.info('Authenticating with Logmet with frame type: ' + authFrameTypeAndVersion[1]);
	
	var bufferSize = authFrameTypeAndVersion.length + tenantOrSupertenantId.length + logmetToken.length + 2;
	var authDataBuffer = new Buffer(bufferSize);
	
	authDataBuffer.write(authFrameTypeAndVersion, 0, authFrameTypeAndVersion.length);
	
	authDataBuffer.writeUIntBE(tenantOrSupertenantId.length, authFrameTypeAndVersion.length, 1);
	authDataBuffer.write(tenantOrSupertenantId, authFrameTypeAndVersion.length + 1, tenantOrSupertenantId.length);
	
	authDataBuffer.writeUIntBE(logmetToken.length, authFrameTypeAndVersion.length + 1 + tenantOrSupertenantId.length, 1);
	authDataBuffer.write(logmetToken, authFrameTypeAndVersion.length + 1 + tenantOrSupertenantId.length + 1, logmetToken.length);
	
	// Send the authentication frame to Logmet
	tlsSocket.write(authDataBuffer);
}

/*
 * Converts an object into a Lumberjack data frame
 * 
 * @param {object} data The object to be converted into a Lumberjack frame
 * 
 * @return A Buffer with a Lumberjack frame representing the provided data object
 */
function convertDataToFrame(data, sequence) {
	// Data frame:
	// 1 | D | <sequence> | <nkeys> | <key_length_i> | <key_i> | <val_length_i> | <val_i> | ...
	
	var dottedNotationData = {};
	objectToFlatDottedNotation(data, '', dottedNotationData);
	logger.debug('Key-value pairs in dotted notation', dottedNotationData);
	
	var numberOfPairs = Object.keys(dottedNotationData).length;
	var bufferSize = 1 + 1 + 4 + 4 + (4 * numberOfPairs) + (4 * numberOfPairs); // "1" | "D" | <seq> | <nkeys> | 4 * <key_length> | 4 * <val_length>
	
	for (var k in dottedNotationData) {
		bufferSize += dottedNotationData[k].length + k.length;
	}
	
	var buffer = new Buffer(bufferSize);
	buffer.write("1D", 0, 2);
	buffer.writeUInt32BE(sequence, 2);
	buffer.writeUInt32BE(numberOfPairs, 6);
	
	var offset = 10;
	for (k in dottedNotationData) {
		buffer.writeUInt32BE(k.length, offset);
		buffer.write(k, offset + 4, k.length);
		buffer.writeUInt32BE(dottedNotationData[k].length, offset + 4 + k.length);
		buffer.write(dottedNotationData[k], offset + 4 + k.length + 4, dottedNotationData[k].length);
		offset += 4 + k.length + 4 + dottedNotationData[k].length;
	}

	return buffer;
}

function objectToFlatDottedNotation(data, prefix, dottedNotationData) {
	if (typeof prefix === 'undefined') {
		prefix = '';
	}
	if (typeof dottedNotationData === 'undefined') {
		dottedNotationData = {};
	}
	for (var k in data) {
		if (typeof data[k] === 'string' || typeof data[k] === 'number') {
			var newKey = (prefix == '') ? k : prefix + '.' + k; 
			dottedNotationData[newKey] = data[k].toString();
		} else if (Array.isArray(data[k]) && (typeof data[k][0] === 'string' || typeof data[k][0] === 'number')) {
			var newKey = (prefix == '') ? k : prefix + '.' + k;
			dottedNotationData[newKey] = data[k].join(',');
		} 
		else if (typeof data[k] === 'object') {
			var newPrefix = (prefix == '') ? k : prefix + '.' + k;
			objectToFlatDottedNotation(data[k], newPrefix, dottedNotationData);
		}
	}
}

function incrementSequenceNumber() {
	currentSequenceNumber = (currentSequenceNumber + 1 > MAX_SEQ_NUMBER) ? 0 : currentSequenceNumber;
	currentSequenceNumber += 1;
	return currentSequenceNumber;
}

function processDataBuffer() {
	if (pendingDataElements.length > 0) {
		if (lastACK >= currentSequenceNumber) {
			currentDataElement = pendingDataElements.shift();
			currentDataElementACKED = false;
			var frame = convertDataToFrame(currentDataElement, incrementSequenceNumber());
			
			logger.debug('About to send window frame');
			sendWindowFrame(1);
			logger.debug('Sent window frame: ' + windowFramebuffer);

			if (reconnecting) {
				logger.debug('Returned from processDataBuffer() before sending data due to an ongoing reconnection.');
				return;
			}
			
			logger.debug('Data frame to be sent: ' + frame);
			tlsSocket.write(frame);
			logger.info("Sent data frame. Sequence number: " + currentSequenceNumber);
		}	
	}
}

function sendWindowFrame(numberOfFrames) {
	windowFramebuffer.writeUInt32BE(numberOfFrames, 2);
	tlsSocket.write(windowFramebuffer);
}