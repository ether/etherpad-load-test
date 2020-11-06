// parent.js
var child_process = require('child_process');

var maxPads = 999;
var padCount = 0;
var messageCount = 0;

while(padCount < maxPads){
  var child = child_process.fork('./app', ['-a', 3]);
  padCount++;
  child.on('message', function(message) {
    console.log('[parent] received message from child:', message);
    if (numchild > maxPads) {
      console.log("total pads made");
      console.log("total messages", messageCount);
      console.log('[parent] received all results');
      process.exit(0);
    }
  });
  child.on('error', function(){
    console.log("total pads made");
    console.log("total messages", messageCount);
    process.exit(1);
  });
}
