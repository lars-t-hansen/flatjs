Immediate things to do:

* Make spec.txt catch up with implementation, and rename as spec.md
* Flesh out README.md a little, link to spec
* More test cases
* Test on ray tracer
* Get rid of the rest arguments in virtual calls
* Atomics + synchronics
* File issues for or fix FIXME / TODO comments in the code




## TODO

These are ideas it would be nice to support:

v1:
* Clearly SELF method calls would be a winner (with required parens even if
  the number of args falls to zero) [A little work]

Desirable for v1, but must investigate:
* It would be useful to distinguish between '@method' and '@virtual', possibly.
* SIMD primitive types (non-atomic): float32x4, int32x4, others?
* Some sort of macro for SELF_x = expr would be lovely, to avoid SELF_set_x(expr),
  but is it syntactically more risky?  Things are already risky.

Later:
* More assignment operators: support +=, etc, and deal with atomics/synchronics
* Clearly at least private properties would be helpful: "private x : int32"
* No particularly good reason why struct types can't inherit
* No particularly good reason why struct types can't have non-virtual methods
* In-line fixed-length array types, these are effectively unnamed struct
  types, eg, xs: array(int32,10)
* String types, maybe?  Easy enough to define a SharedString class that
  references an underlying array, probably.  Doing so would get into
  interesting territory about sharing and refcounting and assignment, maybe.
* Instead of T.ref_fld(self) we could operate with T.offset_fld as a constant, if it matters
* Each type object could contain a map of its names to offsets within the struct
* Once you have a macro processor that replaces instances of TypeName.propname with
  anything else, it's a short slide down the slippery slope to add enums and
  compile-time constants (which would be necessary for in-line arrays
  with symbolically defined lengths, "@flatjs const x = 10").  Sliding further,
  constant expressions.
* ES7 might use the '@' character for annotations, maybe consider something else?
* Proper parser, to deal with a lot of syntactic footguns
