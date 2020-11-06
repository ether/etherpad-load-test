// tests 10 pads (unless specified by "node multi.js X[int]" for 30 seconds
var child_process = require('child_process');

var maxPads = process.argv[2] || 10; // 10 padIds
var padCount = 0;
var messageCount = 0;

while(padCount < maxPads){
  var child = child_process.fork('./app', ['-a', 3, '-d', 30]);
  padCount++;
  // below still not working...
  child.on('error', function(){
    console.log("total pads made");
    console.log("total messages", messageCount);
    process.exit(1);
  });
}
