// Connect to the Socket Instance
var etherpad = require("etherpad-cli-client");
var async = require("async");

var host = "http://127.0.0.1:9001/p/test";

// For now let's create 5 lurking clients and 1 author.
var c = ["l","l","l","l","l","a"]

async.eachSeries(c, function(type, callback){
  setTimeout(function(){
    if(type === "l"){
      newLurker();
      callback();
    }
    if(type === "a"){
      newAuthor();
      callback();
    }

  }, 1000);
}, function(err){
  
});

function newAuthor(){
  var pad = etherpad.connect(host);
  pad.on("connected", function(padState){
    console.log("Connected Author to", padState.host);
    console.log("Sending contents at pad");
    setInterval(function(){
      try{
        console.log("Sending contents at pad");
        pad.append(randomString); // Appends Hello to the Pad contents
      }
      catch(e){
        console.log("Error probably mismatch");
      }
    }, 5000);
  });
}

function newLurker(){
  var pad = etherpad.connect(host);
  pad.on("connected", function(padState){
    console.log("Connected new lurker to", padState.host);
  });
}

function randomString() {
  var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";
  var string_length = Math.floor(Math.random() *10);
  var randomstring = '';
  for (var i=0; i<string_length; i++) {
    var rnum = Math.floor(Math.random() * chars.length);
    randomstring += chars.substring(rnum,rnum+1);
  }
  return randomstring;
}
