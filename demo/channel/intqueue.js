// Generated from intqueue.flat_js by fjsc 0.5; github.com/lars-t-hansen/flatjs
/* -*- mode: javascript -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. *//*3*/

/*
 * Simple multi-producer and multi-consumer shared-memory queue for
 * transmitting arrays of Int32 values - a useful building block for
 * other mechanisms.
 *
 * This version is built on flatjs.  The original version, in
 * parlib-simple, used hand-built shared-memory data structures.
 *//*12*/

function IntQueue(p) { this._pointer = (p|0); }
Object.defineProperty(IntQueue.prototype, 'pointer', { get: function () { return this._pointer } });
IntQueue.NAME = "IntQueue";
IntQueue.SIZE = 68;
IntQueue.ALIGN = 4;
IntQueue.CLSID = 160160494;
Object.defineProperty(IntQueue, 'BASE', {get: function () { return null; }});
IntQueue.init = function (SELF, length) {
	 _mem_int32[(SELF + 64) >> 2] = length; 
	 _mem_int32[(SELF + 60) >> 2] = (FlatJS.allocOrThrow(4 * length, 4)); 
	return SELF;
    }
IntQueue.enqueue = function (SELF, ints, timeout) {
	var required = ints.length + 1;

	if (!IntQueue.acquireWithSpaceAvailable(SELF, required, timeout))
	    return false;

	var q = _mem_int32[(SELF + 60) >> 2];
	var qlen = _mem_int32[(SELF + 64) >> 2];
	var tail = _mem_int32[(SELF + 52) >> 2];
	_mem_int32[(q+4*tail) >> 2] = (ints.length);
	tail = (tail + 1) % qlen;
	for ( var i=0 ; i < ints.length ; i++ ) {
	    _mem_int32[(q+4*tail) >> 2] = (ints[i]);
	    tail = (tail + 1) % qlen;
	}
	 _mem_int32[(SELF + 52) >> 2] = tail; 
	 _mem_int32[(SELF + 56) >> 2] += required; 

	IntQueue.releaseWithDataAvailable(SELF );
	return true;
    }
IntQueue.dequeue = function (SELF, timeout) {
	if (!IntQueue.acquireWithDataAvailable(SELF, timeout))
	    return null;

	var A = [];
	var q = _mem_int32[(SELF + 60) >> 2];
	var qlen = _mem_int32[(SELF + 64) >> 2];
	var head = _mem_int32[(SELF + 48) >> 2];
	var count = _mem_int32[(q+4*head) >> 2];
	head = (head + 1) % qlen;
	while (count-- > 0) {
	    A.push(_mem_int32[(q+4*head) >> 2]);
	    head = (head + 1) % qlen;
	}
	 _mem_int32[(SELF + 48) >> 2] = head; 
	 _mem_int32[(SELF + 56) >> 2] -= (A.length + 1); 

	IntQueue.releaseWithSpaceAvailable(SELF );
	return A;
    }
IntQueue.acquireWithSpaceAvailable = function (SELF, required, t) {
	var limit = typeof t != "undefined" ? Date.now() + t : Number.POSITIVE_INFINITY;
	for (;;) {
	    IntQueue.acquire(SELF );
	    var length = _mem_int32[(SELF + 64) >> 2];
	    if (length - _mem_int32[(SELF + 56) >> 2] >= required)
		return true;
	    var probe = Atomics.load(_mem_int32, ((SELF + 4) + 8) >> 2);
	    IntQueue.release(SELF );
	    if (required > length)
		throw new Error("Queue will never accept " + required + " words");
	    var remaining = limit - Date.now();
	    if (remaining <= 0)
		return false;
	    FlatJS._synchronicExpectUpdate((SELF + 4), _mem_int32, ((SELF + 4) + 8) >> 2, probe, remaining);
	}
    }
IntQueue.acquireWithDataAvailable = function (SELF, t) {
	var limit = typeof t != "undefined" ? Date.now() + t : Number.POSITIVE_INFINITY;
	for (;;) {
	    IntQueue.acquire(SELF );
	    if (_mem_int32[(SELF + 56) >> 2] > 0)
		return true;
	    var probe = Atomics.load(_mem_int32, ((SELF + 16) + 8) >> 2);
	    IntQueue.release(SELF );
	    var remaining = limit - Date.now();
	    if (remaining <= 0)
		return false;
	    FlatJS._synchronicExpectUpdate((SELF + 16), _mem_int32, ((SELF + 16) + 8) >> 2, probe, remaining);
	}
    }
IntQueue.releaseWithSpaceAvailable = function (SELF) {
	 FlatJS._synchronicAdd((SELF + 4), _mem_int32, ((SELF + 4) + 8) >> 2, 1); 
	IntQueue.release(SELF );
    }
IntQueue.releaseWithDataAvailable = function (SELF) {
	 FlatJS._synchronicAdd((SELF + 16), _mem_int32, ((SELF + 16) + 8) >> 2, 1); 
	IntQueue.release(SELF );
    }
IntQueue.acquire = function (SELF) {
	while (FlatJS._synchronicCompareExchange((SELF + 36), _mem_int32, ((SELF + 36) + 8) >> 2, 0, 1) != 0)
	    FlatJS._synchronicExpectUpdate((SELF + 36), _mem_int32, ((SELF + 36) + 8) >> 2, 1, (Number.POSITIVE_INFINITY));
    }
IntQueue.release = function (SELF) {
	 FlatJS._synchronicStore((SELF + 36), _mem_int32, ((SELF + 36) + 8) >> 2, 0); 
    }
IntQueue.initInstance = function(SELF) { _mem_int32[SELF>>2]=160160494; return SELF; }
FlatJS._idToType[160160494] = IntQueue;

