// Simple lock.
//
// Note, this is not currently legal since structs can't carry methods.

@flatjs struct Lock {
    // Clearly "private" is desirable
    lock: int32.synchronic

    @method init(SELF) {
	SELF.lock = 0;
	return SELF;
    }

    @method acquire(SELF) {
	while (SELF.lock.compareExchange(0, 1) != 0)
	    SELF.lock.expectUpdate(1, Number.POSITIVE_INFINITY);
    }

    @method release(SELF) {
	SELF.lock = 0;
    }
} @end
