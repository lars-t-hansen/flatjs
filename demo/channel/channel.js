// Generated from channel.flat_js by fjsc 0.5; github.com/lars-t-hansen/flatjs
/* -*- mode: javascript -*- */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Simple unidirectional marshaling shared-memory channel.  There can
 * be multiple senders and multiple receivers.
 *
 * This is by and large like postMessage() except that it cannot
 * transfer ArrayBuffer values (it can only copy them), and it cannot
 * send or receive SharedArrayBuffer values at all.  Also, the
 * marshaler currently does not deal with circular/shared structure
 * but that's fixable.
 */

// REQUIRE:
//   marshaler.js (from parlib-simple)
//   intqueue.js  (from this directory)

"use strict";

/*
 * Create shared data for the channel.  This is opaque; the returned
 * value can be sent among workers with postMessage and passed to the
 * constructors for ChannelSender and ChannelReceiver.
 *
 * "size" is the capacity of the underlying message queue, in bytes.
 *
 * How much space will you need?  The channel transmits a stream of
 * tag+value pairs, or fieldname+tag+value triples in objects.  It
 * optimizes transmission of typed data structures (strings,
 * TypedArrays) by omitting tags when it can.  If mostly small data
 * structures are being sent then a few kilobytes should be enough to
 * allow a number of messages to sit in a queue at once.
 */
function makeChannelSharedState(size) {
    return IntQueue.init(IntQueue.initInstance(FlatJS.allocOrThrow(68,4)), Math.floor(size/4));
}

/*
 * Create a sender endpoint of the channel.
 *
 * "shared_state" is a data structure created with makeChannelSharedState.
 */
function ChannelSender(shared_state) {
    this._queue = shared_state;
    this._marshaler = new Marshaler();
}

/*
 * Send a message on the channel, waiting for up to t milliseconds for
 * available space (undefined == indefinite wait), and then return
 * without waiting for the recipient to pick up the message.
 *
 * Returns true if the message was sent, false if space did not become
 * available.
 *
 * Throws ChannelEncodingError on encoding error.
 */
ChannelSender.prototype.send = function(msg, t) {
    try {
	var {values, newSAB} = this._marshaler.marshal([msg]);
    }
    catch (e) {
	// TODO: This could be improved by making the Marshaler throw useful errors.
	throw new ChannelEncodingError("Marshaler failed:\n" + e);
    }
    if (newSAB.length)
	throw new ChannelEncodingError("SharedArrayBuffer not supported");
    return IntQueue.enqueue(this._queue, values, t);
}

/*
 * Create a receiver endpoint.  See comments on the sender endpoint.
 */
function ChannelReceiver(shared_state) {
    this._queue = shared_state;
    this._marshaler = new Marshaler();
}

/*
 * Receive a message from the channel, waiting for up to t
 * milliseconds (undefined == indefinite wait) until there is a
 * message if necessary.  Returns the message, or the noMessage value
 * if none was received.
 */
ChannelReceiver.prototype.receive = function (t, noMessage) {
    var M = IntQueue.dequeue(this._queue, t);
    if (M == null)
	return noMessage;
    return this._marshaler.unmarshal(M, 0, M.length)[0];
}

/*
 * Error object.
 */
function ChannelEncodingError(message) {
    this.message = message;
}
ChannelEncodingError.prototype = new Error;
