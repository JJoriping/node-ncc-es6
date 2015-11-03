import RawSession, { DEVICE_TYPE } from './rawSession.js';
import { CHAT_BROKER_SSL_URL,
  COMMAND_TYPE, COMMAND_RESULT_CODE } from './config.js';
import { MSG_TYPE } from './message.js';
import { translateSyncRoom } from './translate.js';

const VERSION = 1;
const COMMAND_URL = '/api/Command.nhn';

const CHAT_IMGS_URL = 'http://cafechat.phinf.naver.net';

const validateResponse = (body) => {
  if (body.retCode === COMMAND_RESULT_CODE.SUCCESS) {
    return body;
  }
  // Otherwise an error.
  const error = new Error(`${body.retTitle}, ${body.retMsg}`);
  error.retCode = body.retCode;
  throw error;
};

export default class CommandSession extends RawSession {
  constructor(server, credentials) {
    super(server, credentials);
  }
  sendCommand(command, body) {
    if (!this.connected) return Promise.reject(new Error('Not connected'));
    return this.request({
      url: CHAT_BROKER_SSL_URL + COMMAND_URL,
      method: 'POST',
      timeout: 10000,
      json: true,
      body: {
        ver: VERSION,
        uid: this.username,
        tid: +new Date(),
        sid: this.sid,
        deviceType: DEVICE_TYPE.WEB,
        cmd: COMMAND_TYPE[command],
        bdy: body
      }
    });
  }
  // This deletes room from the USER. which means, this doesn't terminate
  // the room.
  deleteRoom(room) {
    return this.sendCommand('DeleteRoom', {
      cafeId: room.cafe.id,
      roomId: room.id
    })
    .then(validateResponse)
    .then(() => {
      // Remove room from the list, I suppose
      delete room.users[this.username];
    }, body => {
      switch (body.retCode) {
      case COMMAND_TYPE.NOT_FOUND_ROOM:
        throw new Error(`DeleteRoom: Cannot find room ${room.id}`);
        // Remove room anyway
      case COMMAND_TYPE.NOT_ROOM_MEMBER:
        throw new Error(`DeleteRoom: Not a member of room ${room.id}`);
        // Still, remove room anyway
      default:
        throw body;
      }
    });
  }
  // This closes the room forcefully. Only staffs are able to do it.
  closeOpenroom(room) {
    return this.sendCommand('CloseOpenroom', {
      cafeId: room.cafe.id,
      roomId: room.id
    })
    .then(validateResponse)
    .then(() => {
      // The room has been terminated; Delete from cafe and room.
      delete this.rooms[room.id];
      delete room.cafe.rooms[room.id];
    }, body => {
      // TODO What's the error code of this?
      throw body;
    });
  }
  // Fetches data from the server and elevates loading level to 0
  syncRoom(room) {
    room.loading = true;
    return this.sendCommand('SyncRoom', {
      cafeId: room.cafe.id,
      roomId: room.id,
      // TODO What does this mean?
      updateTimeSec: 0,
      // TODO It's 1 or 20
      size: 1
    })
    .then(validateResponse)
    .then(command => {
      const body = command.bdy;
      translateSyncRoom(this, body);
      // Oh well doesn't matter. elevate loading level to 0
      room.load = 0;
      room.loading = false;
    }, body => {
      room.loading = false;
      // TODO What's the error code of this?
      throw body;
    });
  }
  // Syncs lost message from the server
  syncMsg(room) {
    if (room.sync) {
      room.sync = false;
      // TODO move this somewhere else?
      return this.sendCommand('SyncMsg', {
        cafeId: room.cafe.id,
        roomId: room.id,
        lastMsgSn: room.lastMsgSn,
        size: 100
      })
      .then(validateResponse)
      .then(res => {
        const body = res.bdy;
        // Digest missed messages
        room.lastMsgSn = body.lastMsgSn;
        room.sync = true;
        body.msgList.forEach(newMessage => {
          // Fill unsent information
          newMessage.cafeId = room.cafe.id;
          newMessage.roomId = room.id;
          // There's no way to obtain this information if unsync has occurred
          newMessage.msgId = null;
          this.handleMessage(newMessage);
        });
      })
      .catch(err => {
        console.log(err);
      });
    }
    return Promise.resolve();
  }
  // Sends a message to the server
  sendMsg(message) {
    const rawMsg = {
      cafeId: message.room.cafe.id,
      roomId: message.room.id,
      msgType: MSG_TYPE[message.type],
      // This doesn't mean anything! What's this for?
      msgId: new Date().valueOf(),
      msg: message.message
    };
    return this.sendCommand('SendMsg', rawMsg)
    .then(validateResponse)
    .then(command => {
      const body = command.bdy;
      // Combine rawMsg with body
      Object.assign(rawMsg, body, {
        // 'sent' flag shows that this is sent by itself so
        // bots and other things shouldn't process it
        sent: true,
        // Also, inject username simply because it's not sent from the server
        senderId: this.username
      });
      // TODO restore information if possible
      if (message.type === 'sticker') {
        rawMsg.msg = JSON.stringify({
          stickerId: rawMsg.msg
        });
      } else if (message.type === 'image') {
        rawMsg.msg = JSON.stringify(Object.assign({}, message.message, {
          orgUrl: CHAT_IMGS_URL + message.message.path
        }));
      }
      // Then, handle it
      this.handleMessage(rawMsg);
    }, body => {
      // TODO What's the error code of this?
      throw body;
    });
  }
  // While commandSession itself doesn't use polling, but we still need to
  // process message. Of course it's very raw and not ready to use.
  // Session will extend it to make it better.
  handleMessage(message) {
    // Emit an event...
    this.emit('rawMessage', message);
  }
}
