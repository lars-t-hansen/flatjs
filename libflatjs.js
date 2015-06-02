/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Author: Lars T Hansen, lhansen@mozilla.com
 */

/* libflatjs.js - load this before loading your compiled FlatJS program.
 *
 * Call FlatJS.init before using, see documentation below.
 *
 * NOTE: The following needs to be valid "ES5+" code - close enough
 * to ES5 to run in all major browsers.
 */

/*
 * If no Atomics, then polyfill with versions that throw.  These will
 * ensure that atomics and synchronics throw if the memory is not
 * shared.
 */
if (typeof "Atomics" == "undefined") {
    Atomics = { load: function () { throw "No Atomics"; },
		store: function () { throw "No Atomics"; },
		add: function () { throw "No Atomics"; },
		sub: function () { throw "No Atomics"; },
		and:  function () { throw "No Atomics"; },
		or:  function () { throw "No Atomics"; },
		xor:  function () { throw "No Atomics"; },
		compareExchange:  function () { throw "No Atomics"; }
	      };
}

var _mem_int8 = null;
var _mem_uint8 = null;
var _mem_int16 = null;
var _mem_uint16 = null;
var _mem_int32 = null;
var _mem_uint32 = null;
var _mem_float32 = null;
var _mem_float64 = null;

var FlatJS =
{
    /*
     * Initialize the local FlatJS instance.
     *
     * Buffer can be an ArrayBuffer or SharedArrayBuffer.  In the
     * latter case, all workers must pass the same buffer during
     * initialization.
     *
     * The buffer must be zero-initialized before being passed to
     * init().  FlatJS assumes ownership of the buffer, client code
     * should not access it directly after using it to initialize
     * the heap.
     *
     * "initialize" must be true in exactly one agent and that call
     * must return before any agent can call any other methods on
     * their local FlatJS objects.  Normally, you would allocate your
     * memory in the main thread, call FlatJS.init(buffer, true) in
     * the main thread, and then distribute the buffer to workers.
     */
    init: function (buffer, initialize) {
	if (buffer instanceof ArrayBuffer)
	    _FlatJS_init_ab(this, buffer, initialize);
	else if (buffer instanceof SharedArrayBuffer)
	    _FlatJS_init_sab(this, buffer, initialize);
	else
	    throw new Error("FlatJS can be initialized only on SharedArrayBuffer or ArrayBuffer");
    },

    /*
     * Given a nonnegative size in bytes and a nonnegative
     * power-of-two alignment, allocate and zero-initialize an object
     * of the necessary size (or larger) and required alignment, and
     * return its address.
     *
     * Return NULL if no memory is available.
     */
    alloc: function (nbytes, alignment) {
	// Overridden during initialization.
	throw new Error("Not initialized" );
    },

    /*
     * Ditto, but throw if no memory is available.
     *
     * Interesting possibility is to avoid this function
     * and instead move the test into each initInstance().
     */
    allocOrThrow: function (nbytes, alignment) {
	var p = this.alloc(nbytes, alignment);
	if (p == 0)
	    throw new MemoryError("Out of memory");
	return p;
    },

    /*
     * Given a pointer returned from alloc or calloc, free the memory.
     * p may be NULL in which case the call does nothing.
     */
    free: function (p) {
	// Drop it on the floor, for now
	// In the future: figure out the size from the header or other info,
	// add to free list, etc etc.
    },

    /*
     * Given an pointer to a class instance, return its type object.
     * Return null if no type object is found.
     */
    identify: function (p) {
	if (p == 0)
	    return null;
	if (this._idToType.hasOwnProperty(_mem_int32[p>>2]))
	    return this._idToType[_mem_int32[p>>2]];
	return null;
    },

    // Map of class type IDs to type objects.

    _idToType: {},

    _badType: function (self) {
	var t = this.identify(self);
	return new Error("Observed type: " + (t ? t.NAME : "*invalid*") + ", address=" + self);
    },

    // Synchronic layout is 8 bytes (2 x int32) of metadata followed by
    // the type-specific payload.  The two int32 words are the number
    // of waiters and the wait word (generation count).
    //
    // In the following:
    //
    // self is the base address for the Synchronic.
    // mem is the array to use for the value
    // idx is the index in mem of the value: (p+8)>>log2(mem.BYTES_PER_ELEMENT)
    //
    // _synchronicLoad is just Atomics.load, expand it in-line.

    _synchronicStore: function (self, mem, idx, value) {
	Atomics.store(mem, idx, value);
	this._notify(self);
    },

    _synchronicCompareExchange: function (self, mem, idx, oldval, newval) {
	var v = Atomics.compareExchange(mem, idx, oldval, newval);
	if (v == oldval)
	    this._notify(self);
	return v;
    },

    _synchronicAdd: function (self, mem, idx, value) {
	var v = Atomics.add(mem, idx, value);
	this._notify(self);
	return v;
    },

    _synchronicSub: function (self, mem, idx, value) {
	var v = Atomics.sub(mem, idx, value);
	this._notify(self);
	return v;
    },

    _synchronicAnd: function (self, mem, idx, value) {
	var v = Atomics.and(mem, idx, value);
	this._notify(self);
	return v;
    },

    _synchronicOr: function (self, mem, idx, value) {
	var v = Atomics.or(mem, idx, value);
	this._notify(self);
	return v;
    },

    _synchronicXor: function (self, mem, idx, value) {
	var v = Atomics.xor(mem, idx, value);
	this._notify(self);
	return v;
    },

    _synchronicLoadWhenNotEqual: function (self, mem, idx, value) {
	for (;;) {
	    var tag = Atomics.load(_mem_int32, (self+4)>>2);
	    var v = Atomics.load(mem, idx) ;
	    if (v !== value)
		break;
	    this._waitForUpdate(self, tag, Number.POSITIVE_INFINITY);
	}
	return v;
    },

    _synchronicLoadWhenEqual: function (self, mem, idx, value) {
	for (;;) {
	    var tag = Atomics.load(_mem_int32, (self+4)>>2);
	    var v = Atomics.load(mem, idx) ;
	    if (v === value)
		break;
	    this._waitForUpdate(self, tag, Number.POSITIVE_INFINITY);
	}
	return v;
    },

    _synchronicExpectUpdate: function (self, mem, idx, value, timeout) {
	var now = this._now();
	var limit = now + timeout;
	for (;;) {
	    var tag = Atomics.load(_mem_int32, (self+4)>>2);
	    var v = Atomics.load(mem, idx) ;
	    if (v !== value || now >= limit)
		break;
	    this._waitForUpdate(self, tag, limit - now);
	    now = this._now();
	}
    },

    _waitForUpdate: function (self, tag, timeout) {
	// Spin for a short time before going into the futexWait.
	//
	// Hard to know what a good count should be - it is machine
	// dependent, for sure, and "typical" applications should
	// influence the choice.  If the count is high without
	// hindering an eventual drop into futexWait then it will just
	// decrease performance.  If the count is low it is pointless.
	// (This is why Synchronic really wants a native implementation.)
	//
	// Data points from a 2.6GHz i7 MacBook Pro:
	//
	// - the simple send-integer benchmark (test-sendint.html),
	//   which is the very simplest case we can really imagine,
	//   gets noisy timings with an iteration count below 4000
	//
	// - the simple send-object benchmark (test-sendmsg.html)
	//   gets a boost when the count is at least 10000
	//
	// 10000 is perhaps 5us (CPI=1, naive) and seems like a
	// reasonable cutoff, for now - but note, it is reasonable FOR
	// THIS SYSTEM ONLY, which is a big flaw.
	//
	// The better fix might well be to add some kind of spin/nanosleep
	// functionality to futexWait, see https://bugzil.la/1134973.
	// That functionality can be platform-dependent and even
	// adaptive, with JIT support.
	var i = 10000;
	do {
	    // May want this to be a relaxed load, though on x86 it won't matter.
	    if (Atomics.load(_mem_int32, (self+4)>>2) != tag)
		return;
	} while (--i > 0);
	Atomics.add(_mem_int32, self>>2, 1);
	Atomics.futexWait(_mem_int32, (self+4)>>2, tag, timeout);
	Atomics.sub(_mem_int32, self>>2, 1);
    },

    _notify: function (self) {
	Atomics.add(_mem_int32, (self+4)>>2, 1);
	// Would it be appropriate & better to wake n waiters, where n
	// is the number loaded in the load()?  I almost think so,
	// since our futexes are fair.
	if (Atomics.load(_mem_int32, self>>2) > 0)
	    Atomics.futexWake(_mem_int32, (self+4)>>2, Number.POSITIVE_INFINITY);
    },

    _now: (typeof 'performance' != 'undefined' && typeof performance.now == 'function'
	   ? performance.now.bind(performance)
	   : Date.now.bind(Date))
};

function _FlatJS_init_sab(flatjs, sab, initialize) {
    var len = sab.byteLength & ~7;
    if (len < 16)
	throw new Error("The memory is too small even for metadata");
    flatjs.alloc = _FlatJS_alloc_sab;
    _mem_int8 = new SharedInt8Array(sab, 0, len);
    _mem_uint8 = new SharedUint8Array(sab, 0, len);
    _mem_int16 = new SharedInt16Array(sab, 0, len/2);
    _mem_uint16 = new SharedUint16Array(sab, 0, len/2);
    _mem_int32 = new SharedInt32Array(sab, 0, len/4);
    _mem_uint32 = new SharedUint32Array(sab, 0, len/4);
    _mem_float32 = new SharedFloat32Array(sab, 0, len/4);
    _mem_float64 = new SharedFloat64Array(sab, 0, len/8);
    if (initialize) {
	_mem_int32[2] = len;
	Atomics.store(_mem_int32, 1, 16);
    }
}

function _FlatJS_init_ab(flatjs, ab, initialize) {
    var len = ab.byteLength & ~7;
    if (len < 16)
	throw new Error("The memory is too small even for metadata");
    flatjs.alloc = _FlatJS_alloc_ab;
    _mem_int8 = new Int8Array(ab, 0, len);
    _mem_uint8 = new Uint8Array(ab, 0, len);
    _mem_int16 = new Int16Array(ab, 0, len/2);
    _mem_uint16 = new Uint16Array(ab, 0, len/2);
    _mem_int32 = new Int32Array(ab, 0, len/4);
    _mem_uint32 = new Uint32Array(ab, 0, len/4);
    _mem_float32 = new Float32Array(ab, 0, len/4);
    _mem_float64 = new Float64Array(ab, 0, len/8);
    if (initialize) {
	_mem_int32[2] = len;
	_mem_int32[1] = 16;
    }
}

// For allocators: Do not round up nbytes, for now.  References to
// fields within structures can be to odd addresses and there's no
// particular reason that an object can't be allocated on an odd
// address.  (Later, with a header or similar info, it will be
// different.)

// Note, actual zero-initialization is not currently necessary
// since the buffer must be zero-initialized by the client code
// and this is a simple bump allocator.

function _FlatJS_alloc_sab(nbytes, alignment) {
    do {
	var p = Atomics.load(_mem_int32, 1);
	p = (p + (alignment-1)) & ~(alignment - 1);
	var top = p + nbytes;
	if (top >= _mem_int32[2])
	    return 0;
    } while (Atomics.compareExchange(_mem_int32, 1, p, top) != p);
    return p;
}

function _FlatJS_alloc_ab(nbytes, alignment) {
    var p = _mem_int32[1];
    p = (p + (alignment-1)) & ~(alignment - 1);
    var top = p + nbytes;
    if (top >= _mem_int32[2])
	return 0;
    _mem_int32[1] = top;
    return p;
}

var NULL = 0;
var int8 = { SIZE:1, ALIGN:1, NAME:"int8" };
var uint8 = { SIZE:1, ALIGN:1, NAME:"uint8" };
var int16 = { SIZE:2, ALIGN:2, NAME:"int16" };
var uint16 = { SIZE:2, ALIGN:2, NAME:"uint16" };
var int32 = { SIZE:4, ALIGN:4, NAME:"int32" };
var uint32 = { SIZE:4, ALIGN:4, NAME:"uint32" };
var float32 = { SIZE:4, ALIGN:4, NAME:"float32" };
var float64 = { SIZE:8, ALIGN:8, NAME:"float64" };
var int32x4 = { SIZE:16, ALIGN:16, NAME:"int32x4" };
var float32x4 = { SIZE:16, ALIGN:16, NAME:"float32x4" };
var float64x2 = { SIZE:16, ALIGN:16, NAME:"float64x2" };

function MemoryError(msg) {
    this.msg = msg;
}
MemoryError.prototype = new Error("Memory Error");
