Immediate things to do:

* More test cases
* Test on ray tracer
* v1 targeted issues

Language ideas to investigate, not yet Issue-worthy:

* SIMD primitive types (non-atomic): float32x4, int32x4, others?
* It would be useful to distinguish between '@method' and '@virtual', possibly.
* Clearly at least private properties would be helpful: "private x : int32"
* Clearly final classes might be helpful (for devirtualization, if nothing else)
* No particularly good reason why struct types can't inherit
* No particularly good reason why struct types can't have non-virtual methods
* In-line fixed-length array types, these are effectively unnamed struct
  types, eg, xs: array(int32,10)
* String types, maybe?  Easy enough to define a SharedString class that
  references an underlying array, probably.  Doing so would get into
  interesting territory about sharing and refcounting and assignment, maybe.
* Nested array types
* Instead of T.ref_fld(self) we could operate with T.offset_fld as a constant, if it matters
* Each type object could contain a map of its names to offsets within the struct
* Once you have a macro processor that replaces instances of TypeName.propname with
  anything else, it's a short slide down the slippery slope to add enums and
  compile-time constants (which would be necessary for in-line arrays
  with symbolically defined lengths, "@flatjs const x = 10").  Sliding further,
  constant expressions.
* ES7 might use the '@' character for annotations, maybe consider something else?
