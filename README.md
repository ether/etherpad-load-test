## IMPORTANT
Don't forget to enable Load Testing in your Etherpad ``settings.json``.  ``"loadTest":true``

## Basic Load Test Example
``etherpad-loadtest``

## Specify the Etherpad instance
``etherpad-loadtest http://127.0.0.1:9001``

## Test Specific Etherpad Instance for 60 seconds
``etherpad-loadtest http://127.0.0.1:9001 -d 60``

## Test a specific Pad
``etherpad-loadtest http://127.0.0.1:9001/p/test``

## 50 Lurkers, 10 authors
``etherpad-loadtest http://127.0.0.1:9001 -l 50 -a 10``

## Parameters
``-l`` number of lurkers.

``-a`` number of active authors.

``-d`` duration in seconds to test for.  Default is unlimited.


Basic load test will increase # of lurkers and authors every 5 seconds until changesets are stopped processing in a timely fashion.
At this point the # of lurkers and authors tells the admin how many people could use their instance.  Roughly.  Take into account as documents grow they have heavier computing costs.  

You should modify your tests to your use case.

# Testing multiple pads at once
``node multi.js numberOfPads``

## Example
``node multi.js 10``

The above command will put 3 authors on 10 pads for 30 seconds.  This creates a total of 30 authors.

# Test Results
* On a reasonable machine you can expect 40 authors on one pad. (-a 40)
* On a reasonable machine you can expect to achieve around 3 authors on 200 pads [node multi.js 200]. 
Remember that most authors will not contribute as agressively as our logic here, we implement max(worst case) user load testing.
Note: Citation and test results needed.

# License
Apache 2
