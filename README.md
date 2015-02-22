## Basic Load Test Example
``etherpad-loadtest``

## Specify the Etherpad instance
``etherpad-loadtest http://127.0.0.1:9001``

## Test Specific Etherpad Instance for 60 seconds``
``etherpad-loadtest http://127.0.0.1:9001 -d 60``

## Test a specific Pad
``etherpad-loadtest http://127.0.0.1:9001/p/test``

## 50 Lurkers, 10 authors, 10 pads (so 600 connections in total)
``etherpad-loadtest http://127.0.0.1:9001 -l 50 -a 10 -p 10``
Note ``-p`` Will create 10 random pads and assign -l and -a to each.  ``-p`` Cannot be used with an explicity pad ergo -p 1 is pointless

## Parameters
``-l`` number of lurkers.
``-a`` number of active authors.
``-p`` number of pads to test against.
``-d`` duration in seconds to test for.  Default is unlimited.

Basic load test will increase # of lurkers and authors every second until changesets are stopped processing
At this point the # of lurkers and authors tells the admin how many people could use
their instance
