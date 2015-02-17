// Connect to the Socket Instance
var socket = require('socket.io-client')('http://localhost:9001/');
var Changeset = require('./Changeset');
var AttributePool = require('./AttributePool');

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
    padState.apool = new AttributePool().fromJsonable(obj.data.collab_client_vars.apool);
    padState.baseRev = obj.data.collab_client_vars.rev;
    // padState.apool = obj.data.collab_client_vars.apool;
    beginSendingMessages(obj);
  }

  // Get the new Revision number from a change
  else if(obj.type === 'COLLABROOM' && obj.data && obj.data.type === 'NEW_CHANGES'){
    // console.log("new changes", obj.data);
    var unpacked = Changeset.unpack(obj.data.changeset); // Unpack the changeset
    var opiterator = Changeset.opIterator(unpacked.ops); // Look at each op
    // console.log("opiterator", opiterator);
    padState.newRev = obj.data.newRev;

    if(obj.data.text){
      padState.atext = obj.data.text;
    }else{
      obj.data.text = padState.atext;
    }

    // Document has an attribute pool this is padState.apool
    // Each change also has an attribute pool.
    var wireApool = new AttributePool().fromJsonable(obj.data.apool);
    // console.log("wireApool", wireApool);

    // Returns a changeset....
    var c = Changeset.moveOpsToNewPool(obj.data.changeset, wireApool, padState.apool);
    // console.log("new changeset with wireApool applied", c);

    // We clone the atext
    var baseAText = Changeset.cloneAText(padState.atext);
    // console.log("baseAText", baseAText);

    // Apply the changeset
    baseAText = Changeset.applyToAText(c, baseAText, padState.apool);

    // Set the text
    padState.atext = baseAText;
    console.log("new baseAText", baseAText);

  }

  else if(obj.type === 'COLLABROOM' && obj.data && obj.data.type === 'ACCEPT_COMMIT'){
    // Server accepted a commit so bump the newRev..
    console.log("ACCEPT_COMMIT", obj);
    padState.baseRev = obj.data.newRev;
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
//  setInterval(function(){

    // Get the previous atext.text length
    // var oldLength = padState.atext.length;
    // Given atext.text of "hello" append "world"
    // Get the new length
// console.log("padState.atext", padState.atext);

    var newChangeset = Changeset.makeSplice(padState.atext.text, padState.atext.text.length-1, 0, "world");

console.log("newChjangeset", newChangeset);

    // pad.appendRevision(nlChangeset); // see how this is done


    var newAText = Changeset.applyToAText(newChangeset, padState.atext, padState.apool);
console.log("newAText", newAText);
    padState.atext = newAText;

    var wireApool = new AttributePool().toJsonable();

console.log("wireApool", wireApool);

// Find out what is wrong with this msg

    var msg = {
      "component": "pad",
      "type": 'USER_CHANGES',
      "baseRev": padState.baseRev, // TODO
      "changeset": newChangeset, // TODO,
      "apool": wireApool
    };

    socket.json.send({
      type: "COLLABROOM",
      component: "pad",
      data: msg
    });


padState.baseRev = padState.baseRev+1;
console.log("sent", msg);

//  }, 1000);

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

