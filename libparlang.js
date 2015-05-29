/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* libparlang.js - load this before loading your compiled FlatJS program.
 *
 * Call FlatJS.init before using, see documentation below.
 */

if (typeof "SharedArrayBuffer" == "undefined") {
    SharedArrayBuffer = ArrayBuffer;
    SharedInt8Array = Int8Array;
    SharedUint8Array = Uint8Array;
    SharedInt16Array = Int16Array;
    SharedUint16Array = Uint16Array;
    SharedInt32Array = Int32Array;
    SharedUint32Array = Uint32Array;
    SharedFloat32Array = Float32Array;
    SharedFloat64Array = Float64Array;
}

if (typeof "Atomics" == "undefined") {
    Atomics = { load: function (a,n) { return a[n]; },
		store: function (a,n,v) { a[n]=v; return v; },
		add: function (a,n,v) { var old=a[n]; a[n]=old+v; return old; },
		sub: function (a,n,v) { var old=a[n]; a[n]=old-v; return old; },
		and: function (a,n,v) { var old=a[n]; a[n]=old&v; return old; },
		or: function (a,n,v) { var old=a[n]; a[n]=old|v; return old; },
		xor: function (a,n,v) { var old=a[n]; a[n]=old^v; return old; },
		compareExchange: function (a,n,x,v) { var old=a[n]; if (old==x) a[n] = v; return old; }
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

const FlatJS =
{
    /*
     * Initialize the local FlatJS instance.
     *
     * Buffer can be an ArrayBuffer or SharedArrayBuffer.  In the
     * latter case, all workers must pass the same buffer during
     * initialization.
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
     * power-of-two alignment, allocate an object of the necessary
     * size (or larger) and required alignment, and return its
     * address.
     *
     * Return NULL if no memory is available.
     */
    alloc: function (nbytes, alignment) {
	// Overridden during initialization.
	throw new Error("Not initialized" );
    },

    /*
     * As alloc, but zero-initialize the memory.  There is no
     * synchronization after initialization; the zero bits have not
     * been published.
     */
    calloc: function (nbytes, alignment) {
	// Allocate and zero at least four bytes.
	nbytes = (nbytes + 3) & ~3;
	var p = this.alloc(nbytes, alignment);
	if (p == 0)
	    return 0;
	var q = p / 4;
	for ( var i=0, lim=nbytes/4 ; i < lim ; i++ )
	    _mem_int32[q++] = 0;
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

    // TODO: Synchronic methods.  If we are using nonshared memory they
    // should probably throw.

    // Private.
    _idToType: {}
};

function _FlatJS_init_sab(parlang, sab, initialize) {
    var len = sab.byteLength & ~7;
    if (len < 16)
	throw new Error("The memory is too small even for metadata");
    parlang.alloc = _FlatJS_alloc_sab;
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

function _FlatJS_init_ab(parlang, ab, initialize) {
    var len = ab.byteLength & ~7;
    if (len < 16)
	throw new Error("The memory is too small even for metadata");
    parlang.alloc = _FlatJS_alloc_ab;
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

const NULL = 0;
const int8 = { SIZE:1, ALIGN:1 };
const uint8 = { SIZE:1, ALIGN:1 };
const int16 = { SIZE:2, ALIGN:2 };
const uint16 = { SIZE:2, ALIGN:2 };
const int32 = { SIZE:4, ALIGN:4 };
const uint32 = { SIZE:4, ALIGN:4 };
const float32 = { SIZE:4, ALIGN:4 };
const float64 = { SIZE:8, ALIGN:8 };
