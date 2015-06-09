/* -*- mode: javascript -*- */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

importScripts("../../../parlib-simple/src/marshaler.js",
	      "../../libflatjs.js",
	      "intqueue.js",
	      "channel.js");

onmessage =
    function (ev) {
	var [sab, iterations, channel_state] = ev.data;
	FlatJS.init(sab, false);

	var r = new ChannelReceiver(channel_state);
	var s = new ChannelSender(channel_state);

	// Let the master know we're ready to go

	postMessage("ready");

	var c = {item:-1};
	for ( var i=0 ; i < iterations ; i++ ) {
	    c = r.receive();
	    c.item++;
	    s.send(c);
	}

	console.log("Worker exiting");
    };
