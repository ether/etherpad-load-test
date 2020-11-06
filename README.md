## IMPORTANT
Don't forget to enable Load Testing in your Etherpad ``settings.json``.  ``"loadTest":true``

## Basic Load Test Example
``etherpad-loadtest``

## Specify the Etherpad instance
``etherpad-loadtest http://127.0.0.1:9001``

## Specify how many pads to test against
``etherpad-loadtest http://127.0.0.1:9001 -p 10``

## Test Specific Etherpad Instance for 60 seconds
``etherpad-loadtest http://127.0.0.1:9001 -d 60``

## Test a specific Pad
``etherpad-loadtest http://127.0.0.1:9001/p/test``

## 50 Lurkers, 10 authors
``etherpad-loadtest http://127.0.0.1:9001 -l 50 -a 10``

## Parameters
``-p`` number of pads to test against (padIds are random).  Testing is done in parallel.

``-l`` number of lurkers.

``-a`` number of active authors.

``-d`` duration in seconds to test for.  Default is unlimited.


Basic load test will increase # of lurkers and authors every 5 seconds until changesets are stopped processing in a timely fashion.
At this point the # of lurkers and authors tells the admin how many people could use their instance.  Roughly.  Take into account as documents grow they have heavier computing costs.  

You should modify your tests to your use case.


# License
Apache 2
