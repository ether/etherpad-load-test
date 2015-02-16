var socket = require('socket.io-client')('http://localhost:9001/');

var newRev;

socket.on('message', function(obj){
  var type = obj.type;

  // Client is being told to disconnect, better drink my own piss.
  if(obj.disconnect){
    console.warn("Disconnecting", obj);
    return;
  }
 
  // Client is connected so we should start sending messages at the server
  if(type === 'CLIENT_VARS'){
    beginSendingMessages(obj);
  }

  // Get the new Revision number
  else if(obj.type === 'COLLABROOM' && obj.data && obj.data.type === 'NEW_CHANGES'){
    newRev = obj.data.newRev;
  }

  else{
    console.log("Message from Server", obj);
  }
});

function beginSendingMessages(obj){
  console.log("Beggining to send messages to the Pad");

  // Send a message every X 
  setInterval(function(){
    console.log("newRev", newRev);

    var msg = {
      "component": "pad",
      "type": 'USER_CHANGES',
      "baseRev": newRev, // TODO
      "changeset": "Z:6l>1|8=6k*0+1$x", // TODO,
      "apool": { // TODO
        nextNum: 1,
        numToAttrib: {
          0: ["author", "a.XHPfn6F9btKuwP0Y"]
        }
      }
    };
 
    socket.json.send({
      type: "COLLABROOM",
      component: "pad",
      data: msg
    });
  }, 1000);
}

socket.on('connect', function(data){
  var padId = 'test';
  sessionID = 'whatever';
  token = 'test';

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

