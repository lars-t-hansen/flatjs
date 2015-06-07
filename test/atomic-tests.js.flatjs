/* -*- mode: javascript -*- */

load("../libflatjs.js");
var ab = new SharedArrayBuffer(65536);
FlatJS.init(ab, true);

// Atomic fields of class

@flatjs class Counter {
    count: int32.atomic
    xyzzy: uint8.atomic

    @method init(SELF, x) {
	SELF.count.set(x);	// Atomics.store
	return SELF;
    }

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

// Atomic fields of structures within array

@flatjs struct Cnt {
    count: int32.atomic
} @end

var p = @new Cnt.Array(10);

Cnt.Array.count.add(p, 5, 1);
assertEq(Cnt.Array.count.at(p, 5), 1);

console.log("Done");
