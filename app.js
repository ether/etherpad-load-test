// Connect to the Socket Instance
var socket = require('socket.io-client')('http://localhost:9001/');
var Changeset = require('./Changeset');

var padState = {}; // The state of the pad, we hold this in memory

socket.on('message', function(obj){
  var type = obj.type;

  // Client is being told to disconnect
  if(obj.disconnect){
    console.warn("Disconnecting", obj);
    return;
  }
 
  // Client is connected so we should start sending messages at the server
  if(type === 'CLIENT_VARS'){
    padState.atext = obj.data.collab_client_vars.initialAttributedText;
    padState.apool = obj.data.collab_client_vars.apool;
    beginSendingMessages(obj);
  }

  // Get the new Revision number from a change
  else if(obj.type === 'COLLABROOM' && obj.data && obj.data.type === 'NEW_CHANGES'){
    console.log("new changes", obj.data);
    var unpacked = Changeset.unpack(obj.data.changeset); // Unpack the changeset
    var opiterator = Changeset.opIterator(unpacked.ops); // Look at each op
    console.log("opiterator", opiterator);
    padState.newRev = obj.data.newRev;
  }

  else if(obj.type === 'COLLABROOM' && obj.data && obj.data.type === 'USER_NEWINFO'){
    // We don't care about this.
  }

  else if(obj.type === 'COLLABROOM' && obj.data && obj.data.type === 'USER_LEAVE'){
    // We don't care about this.
  }

  else{ // Unhandled message
    console.log("Message from Server", obj);
  }
});

function beginSendingMessages(obj){
  console.log("Beggining to send messages to the Pad");
  var opiterator = Changeset.opIterator(padState.atext.attribs); // This seems pointless

  console.log("initial atext", padState.atext);
  console.log("initial apool", padState.apool);

  // Send a message every second
  setInterval(function(){
    /*
    var msg = {
      "component": "pad",
      "type": 'USER_CHANGES',
      "baseRev": padState.newRev, // TODO
      "changeset": "Z:6l>1|8=6k*0+1$x", // TODO,
      "apool": { // TODO
        nextNum: padState.apool.length+1,
        numToAttrib: padState.apool
      }
    };
 
    socket.json.send({
      type: "COLLABROOM",
      component: "pad",
      data: msg
    });

    */

  }, 1000);

}

socket.on('connect', function(data){
  var padId = 'test';
  sessionID = 'whatever';
  token = 'test';

  console.log("Sending Client Ready");

  var msg = {
    "component": "pad",
    "type": 'CLIENT_READY',
    "padId": padId,
    "sessionID": sessionID,
    "password": false,
    "token": token,
    "protocolVersion": 2
  };

  socket.json.send(msg);
});

