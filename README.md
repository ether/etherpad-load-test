![Publish Status](https://github.com/ether/etherpad-load-test/workflows/Node.js%20Package/badge.svg) ![Backend Tests Status](https://github.com/ether/etherpad-load-test/workflows/Backend%20tests/badge.svg)

# Etherpad Loadtest
## Setup
1. Enable Load Testing in your Etherpad ``settings.json`` by setting ``"loadTest":true``.
2. Reload Etherpad instance.
3. Install etherpad-load-test globally via ``npm install -g etherpad-load-test``.
4. Use etherpad-loadtest command (cf. Usage).

(**Important:** Don't forget to set ``"loadTest":false`` afterwards)

## Usage

``etherpad-loadtest [<url> -l <num-lurkers> -a <num-active-authors> -d <duration>]``

Basic load test will increase # of lurkers and authors every 5 seconds until changesets are stopped processing in a timely fashion.
At this point the # of lurkers and authors tells the admin how many people could use their instance.  Roughly.  Take into account as documents grow they have heavier computing costs.  

You should modify your tests to your use case.

### Parameters
``-l`` number of lurkers.

``-a`` number of active authors.

``-d`` duration in seconds to test for. Default is unlimited.

### Examples
- ``etherpad-loadtest``(Basic Example, url defaults to http://127.0.0.1:9001)
- ``etherpad-loadtest http://127.0.0.1:9001`` (Test specific Etherpad instance)
- ``etherpad-loadtest http://127.0.0.1:9001/p/test`` (Test specific Pad)
- ``etherpad-loadtest -d 60`` (Test for 60 seconds)
- ``etherpad-loadtest -l 50 -a 10`` (Test with 50 lurkers and 10 authors)

### Testing multiple pads at once
``etherpad-loadtest-multi [<num of pads>]`` (default is 10 pads)

(Example: ``etherpad-loadtest-multi 10``)

The above command will put 3 authors on 10 pads for 30 seconds. This creates a total of 30 authors.

## Test Results
* On a reasonable machine you can expect 40 authors on one pad. (-a 40)
* On a reasonable machine you can expect to achieve around 3 authors on 200 pads [node multi.js 200]. 

Note that most authors will not contribute as agressively as our logic here, we implement max(worst case) user load testing.
If you hit limitations, remember etherpad-proxy is a thing to rewrite to multiple backend instances 🔥

*TODO/Note:* Citation and test results needed.

## License
Apache 2
