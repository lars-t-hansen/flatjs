/* -*- mode: javascript -*- */

load("../libflatjs.js");
var ab = new SharedArrayBuffer(65536);
FlatJS.init(ab, true);

// Synchronic fields of class

@flatjs class Counter {
    count:int32.synchronic
    xyzzy:uint8.synchronic

    @method init(SELF, x) {
	SELF.count.set(x);	// synchronic store
	return SELF;
    }

    // Should turn into synchronic ops.

    @method fnord(SELF) {
	SELF.count = 0;
	SELF.count += 5;
    }
} @end

var c = Counter.init(@new Counter, 7);

Counter.count.add(c, 1);
assertEq(Counter.count(c), 8);	// Atomics.load, here and below

Counter.count.compareExchange(c, 8, 4);
assertEq(Counter.count(c), 4);

Counter.count.sub(c, 1);
assertEq(Counter.count(c), 3);

Counter.count.or(c, 0xB1);
assertEq(Counter.count(c), 0xB3);

Counter.count.and(c, 0x1A2);
assertEq(Counter.count(c), 0xA2);

Counter.count.xor(c, 0xFF);
assertEq(Counter.count(c), 0x5D);

Counter.xyzzy.add(c, 384);
assertEq(Counter.xyzzy(c), 384%256);

// Synchronic fields of structures within array

@flatjs struct Cnt {
    count:int32.synchronic
} @end

var p = @new Cnt.Array(10);

Cnt.Array.count.add(p, 5, 1);
assertEq(Cnt.Array.count.at(p, 5), 1);

setSharedArrayBuffer(ab);
Counter.count.set(c, 0);

evalInWorker(`
load("../libflatjs.js");
var ab = getSharedArrayBuffer();
FlatJS.init(ab);

var c = ${c};

// This is gross.  Counter is defined in *this file* so its macro
// definitions are visible here and will be replaced, and that's
// enough to make this test work.  But if we had methods to invoke
// they would not work, because the Counter object is not visible
// within the worker's code.
//
// That would normally be fixed by putting the worker program in a
// file and just having a one-liner program here, to load that file.
// That file could be preprocessed independently.

Counter.count.loadWhenNotEqual(c, 0);
var then = Date.now();
sleep(1);
Counter.count.set(c, 2);
console.log("Should be about 1000: " + (Date.now() - then));
`);

sleep(1);
var then = Date.now();
Counter.count.set(c, 1);
Counter.count.loadWhenNotEqual(c, 1);
console.log("Should be about 1000: " + (Date.now() - then));

console.log("Done");
