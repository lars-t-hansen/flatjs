/* -*- mode: javascript -*- */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var iterations = 100000;
var qsize = 4096;

var w = new Worker("test-sendmsg-worker.js");

var sab = new SharedArrayBuffer(65536);
FlatJS.init(sab, true);

// Setup our state first.

var channel_state = makeChannelSharedState(qsize);

var s = new ChannelSender(channel_state);
var r = new ChannelReceiver(channel_state);

// Kick off the worker and wait for a message that it is ready.

w.onmessage = workerReady;
w.postMessage([sab, iterations, channel_state], [sab]);

console.log("Master waiting");

function workerReady(ev) {
    var start = Date.now();

    var c = {item:0};
    for ( var i=0 ; i < iterations ; i++ ) {
	s.send(c);
	c = r.receive();
    }

    var end = Date.now();

    console.log("Should be " + iterations + ": " + c.item);
    console.log(Math.round(1000 * (2*iterations) / (end - start)) + " messages/s");
}
