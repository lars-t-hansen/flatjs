/* -*- mode: javascript -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Simple multi-producer and multi-consumer shared-memory queue for
 * transmitting arrays of Int32 values - a useful building block for
 * other mechanisms.
 *
 * This version is built on flatjs.  The original version, in
 * parlib-simple, used hand-built shared-memory data structures.
 *
 * Here an IntQueue has two parts: a standard local front object in
 * each worker, and a shared representation in shared memory.
 *
 * An IntQueue front object and its shared representation are
 * allocated in a worker using "IntQueue.create".
 */

// Private FlatJS code here; JavaScript API is below.

@flatjs class IntQueue {
    spaceAvailable: int32.synchronic
    dataAvailable: int32.synchronic

    lock: int32.synchronic
    head: int32
    tail: int32
    used: int32
    queue: int32.Array
    length: int32

    @method init(SELF, length) {
	SELF.length = length;
	SELF.queue = @new int32.Array(length);
	return SELF;
    }

    @method enqueue(SELF, ints, timeout) {
	var required = ints.length + 1;

	if (!SELF.acquireWithSpaceAvailable(required, t))
	    return false;

	var q = SELF.queue;
	var qlen = SELF.length;
	var tail = SELF.tail;
	int32.Array.setAt(q, tail, ints.length);
	tail = (tail + 1) % qlen;
	for ( var i=0 ; i < ints.length ; i++ ) {
	    int32.Array.setAt(q, tail, ints[i]);
	    tail = (tail + 1) % qlen;
	}
	SELF.tail = tail;
	SELF.used += required;

	SELF.releaseWithDataAvailable();
	return true;
    }

    @method acquireWithSpaceAvailable(SELF, required, t) {
	var limit = typeof t != "undefined" ? Date.now() + t : Number.POSITIVE_INFINITY;
	for (;;) {
	    SELF.acquire();
	    var length = SELF.length;
	    if (length - SELF.used >= required)
		return true;
	    var probe = SELF.spaceAvailable;
	    SELF.release();
	    if (required > length)
		throw new Error("Queue will never accept " + required + " words");
	    var remaining = limit - Date.now();
	    if (remaining <= 0)
		return false;
	    SELF.spaceAvailable.expectUpdate(probe, remaining);
	}
    }

    @method acquireWithDataAvailable(SELF, t) {
	var limit = typeof t != "undefined" ? Date.now() + t : Number.POSITIVE_INFINITY;
	for (;;) {
	    SELF.acquire();
	    if (SELF.used > 0)
		return true;
	    var probe = SELF.dataAvailable;
	    SELF.release();
	    var remaining = limit - Date.now();
	    if (remaining <= 0)
		return false;
	    SELF.dataAvailable.expectUpdate(probe, remaining);
	}
    }

    @method releaseWithSpaceAvailable(SELF) {
	SELF.spaceAvailable += 1;
	SELF.release();
    }

    @method releaseWithDataAvailable(SELF) {
	SELF.dataAvailable += 1;
	SELF.release();
    }

    @method acquire(SELF) {
	while (SELF.lock.compareExchange(0, 1) != 0)
	    SELF.lock.expectUpdate(1, Number.POSITIVE_INFINITY);
    }

    @method release(SELF) {
	SELF.lock = 0;
    }

} @end

// Public code

/*
 * Allocate a new queue in shared memory, and its local front object.
 * "length" is the capacity of the queue in number of integer elements.
 */
IntQueue.create = function (length) {
    return new IntQueue(IntQueue.init(@new IntQueue, length));
}

/*
 * Enter an element into the queue; wait until space is available or
 * until t milliseconds (undefined == indefinite wait) have passed.
 *
 * ints is a dense Array of Int32 values.
 * Returns true if it succeeded, false if it timed out.
 */
IntQueue.prototype.enqueue = function(ints, t) {
    return IntQueue.enqueue(this.pointer, ints, t);
}

/*
 * Return an element from the queue if there's one; wait up to t
 * milliseconds (undefined == indefinite wait) for one to appear,
 * returning null if none appears in that time.
 *
 * The element is returned as a dense Array of Int32 values.
 */
IntQueue.prototype.dequeue = function(t) {
    return IntQueue.dequeue(this.pointer, t);
}
