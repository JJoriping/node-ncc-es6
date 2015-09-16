import request from 'request-promise';
import { DEVICE_TYPE, CONNECT_URL, POLL_URL, CHAT_HOME_URL, TIME,
  COMMAND_RESULT_CODE, COMMAND_TYPE } from './config.js';
import { EventEmitter } from 'events';

function getCallbackFn() {
  // Mimic Jindo's behaviour
  return 'window.__jindo2_callback._' + (Math.floor(Math.random() * 900 + 100));
}

// Extract from JSONP data
function extractResponse(body) {
  // Or we could use regular expression..
  const unpacked = body.slice(body.indexOf('"') + 1, body.lastIndexOf('"'));
  // This breaks Korean text... Not sure why though.
  const decrypted = new Buffer(unpacked, 'base64').toString('utf8');
  return JSON.parse(decrypted);
}

// validate response...
const validateResponse = command => message => {
  if (message.retCode !== COMMAND_RESULT_CODE.SUCCESS ||
    message.cmd !== command) {
    throw message;
  }
  return message.bdy;
};

/**
 * Low-level session object to communicate with the chat server
 */
export default class RawSession extends EventEmitter {
  constructor(server, credentials) {
    super();
    /**
     * The chat server's URL address. Should not end with '/'.
     * @type {String}
     */
    this.server = server;
    /**
     * The credentials information used to connect to the server.
     * @type {Credentials}
     */
    this.credentials = credentials;
    this.sid = null;
    // And tons of internal variables
    this.connected = false;
  }
  connect() {
    if (this.connected) return Promise.reject('Already connected');
    // Recreate request object here because of cookieJar object
    this.request = request.defaults({
      jar: this.credentials.cookieJar,
      // TODO test connection without it?
      strictSSL: false,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Referer': CHAT_HOME_URL
      },
      timeout: TIME.POLLING_TIMEOUT * 1000
    });
    return this.request({
      url: this.server + CONNECT_URL,
      qs: {
        'callback_fn': getCallbackFn(),
        uid: this.credentials.username,
        tid: +new Date(),
        devType: DEVICE_TYPE.WEB,
        crypto: false
      }
    })
    .then(extractResponse)
    .then(validateResponse(COMMAND_RESULT_CODE.CONN_RESP))
    .then(body => {
      // Why the server is sending AES encryption information? ...
      // Anyway, we've got the session id at this point if we don't have
      // an error.
      console.log(body);
      this.sid = body.sid;
      this.connected = true;
      // Start polling
      setTimeout(this.poll.bind(this), 1000);
    });
  }
  poll() {
    return this.request({
      url: this.server + POLL_URL,
      qs: {
        'callback_fn': getCallbackFn(),
        sid: this.sid,
        tid: +new Date(),
        crypto: false
      }
    })
    .then(extractResponse)
    .then(message => {
      console.log(message);
    });
  }
}