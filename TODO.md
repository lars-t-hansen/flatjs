## Immediate things to do:

* More test cases
* Test on ray tracer
* v1 targeted issues
* Generate ES that runs in all major current browsers (consider that
  splat may not be implemented everywhere, for example).  This
  means some ES5+ dialect, likely.
* This list could go into the wiki section of the repo.

## Language ideas to investigate

### Likely high value

* Structs should be allowed to carry named non-virtual methods
* It would be useful to distinguish between '@method' and '@virtual'
  class methods possibly - depends on how far we can optimize the
  current virtual methods using devirtualization etc.  Also, the
  special case of the init function is regrettable.
* The use of an init function is very 1980s' - indeed the pattern
  comes from Modula-3.  A standard Java/C++ style constructor is
  probably better.  That also requires a provision for super() within
  the constructor.  Of course @new should invoke the constructor
  automatically, and the constructor needs to invoke the constructors
  of members.  Structs should allow for constructors.  When allocating
  an array of structs, struct constructors should be called.  Such a
  change is compatible with the current system (trivial constructors
  all the way).
* A destructor will be useful, since memory management is manual.
  A destructor would call member destructors and base destructors.
  Presumably there would be some @delete operator?  [Though see
  below, re syntax]

### Likely medium value

* The @flatjs syntax conflicts with, or at least can be confused with,
  ES7/TS1.6 decorator syntax.  It may be the other uses of @ are also,
  or even more, problematic, if only because we'd want to be kind to
  decorators that are embedded within flatjs code.  Useful to fix this.
* SIMD primitive types (non-atomic): float32x4, int32x4, others?  (Not
  yet high value because status and utility of SIMD in JavaScript,
  sans value types, is unclear.  Must investigate.)
* Structs should be allowed to inherit from other structs
* In-line fixed-length array types, these are effectively unnamed struct
  types, eg, xs: array(int32,10)
* Nested array types, these fit in with in-line fixed-length arrays.
* Private properties would be helpful: "private x : int32"
* Private methods ditto.
* Final classes would be helpful (devirtualization, privacy)
* Remove (somehow) the restriction on the use of '_'.  This may
  not be too hard in practice, mostly a question of flagging
  ambiguities to force the use of other names when it becomes
  a problem.

### Unclear value

* Is there really a need to use '@new' instead of just 'new'?
* There's really no reason to stick with @new and @delete, the
  syntax could be ClassName.create(arg, ...) and
  ClassName.destroy(p, arg, ...).  For arrays, it would be
  TypeName.array.create(arg, n) and
  TypeName.array.destroy(p, arg, n).
* Allow the use of $ in identifiers, so that it's possible to
  create a poor man's private properties, since _ is illegal.
* Class constructor and static properties.  Really quite unclear how
  to handle this, since there is no shared-memory representation of
  the class at present.  Clearly it's possible for the runtime to
  create such a representation lazily, and to invoke the class
  constructor the first time etc.  A static property would then
  live in such a shared class object.
* Static methods only make sense once we have private fields and
  private methods, I think.
* Array elements cannot be atomic/synchronic primitives for reasons of
  type system syntax (mostly); this is a regrettable restriction.
  we'd want eg atomic_int32.array_add(v, x), which is pretty clunky
  but would work.
* There's the possibility of a syntax change.  Consider int32.atomic
  as naming the atomic int32 type.  T.array would be an array of T.
  Check out what TypedObject is doing about that.  T.array(10).array
  is a nice representation of array-of-array.  So we'd have T.array.set(p,k,v).
* Once you have a macro processor that replaces instances of
  TypeName.propname with anything else, it's a short slide down the
  slippery slope to add enums and compile-time constants (which would
  be necessary for in-line arrays with symbolically defined lengths,
  "@flatjs const x = 10").  Sliding further, constant expressions.
* String types, maybe?  Easy enough to define a SharedString class
  that references an underlying array, probably.  Doing so would get
  into interesting territory about sharing and refcounting and
  assignment, maybe.
* Instead of T.ref_fld(self) we could operate with T.offset_fld as a
  constant, if it matters
* Each type object could contain a map of its names to offsets within
  the struct
