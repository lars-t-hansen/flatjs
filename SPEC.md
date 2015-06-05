# FlatJS

## Introduction

FlatJS is a "language fragment" layered on JavaScript (and JS dialects)
that allows programs to use flat memory (ArrayBuffer and SharedArrayBuffer)
conveniently with good performance.

FlatJS provides structs, classes, and arrays within flat memory, as well
as atomic and synchronic fields when using shared memory.  There is also
some support for SIMD values.  Objects in flat memory are manually
managed and represented in JavaScript as pointers into the shared
memory (ie, integer addresses), not as native JavaScript objects.
Virtual methods are provided for on class instances.

FlatJS is a fairly static language and is implemented as a preprocessor
that translates  JavaScript+FlatJS into plain JavaScript.

The following is the bare specification.  Full programs are in test/
and demo/.

## Caveats

For ease of processing *only*, the syntax is currently line-oriented:
Line breaks are explicit in the grammars below and some "@" characters
appear here and there to make recognition easier.  Please don't get
hung up on this, it's mostly a matter of programming to fix it but that
is not my focus right now.

The translator is implemented by means of a set of regular expression
matchers and an unforgiving, context-insensitive, nonhygienic macro
expander.  Occasionally this leads to problems.  Some things to watch
out for:

* Do not use expressions containing strings, comments, or regular expressions
  in the arguments to accessor macros (including array accessors).
* Do not split calls to accessors across multiple source lines, because
  frequently the translator must scan for the end of the call
* If using the assignment shorthand, keep the right-hand-side entirely
  on the same line as the assignment operator.
* Occasionally, the translator fails to parenthesize code correctly because
  it can't insert parentheses blindly as that interacts badly with
  automatic semicolon insertion (yay JavaScript).


Failures to obey these rules will sometimes lead to mysterious parsing
and runtime errors.  A look at the generated code is usually enough to
figure out what's going on; problems tend to be local.

## Programs

A program comprises a set of files that are processed together by the FlatJS
compiler.  In a Web context, all the files loaded into a tab, or all the files
loaded into a worker, would normally be processed together.

## Types

There is a program-wide namespace for FlatJS types.  This namespace contains
the predefined primitive types and every user-defined (struct or class) type.
Type names in a program must be unique in this namespace.

Every type that is referenced from an annotation or as a base type must be
defined in the set of files processed together.  Types can be defined in any
order and in any file of the program.

Within the bodies of methods, 'this' has an undetermined binding (for now)
and should not be referenced.

## Primitive types

There are predefined global type objects with the following names: *int8*, *uint8*,
*int16*, *uint16*, *int32*, *uint32*, *float32*, *float64*, *int32x4*,
*float32x4*, and *float64x2*.

Each predefined type object has three properties:

* NAME is the name of the type (a string)
* SIZE is the size in bytes of the type
* ALIGN is the required alignment for the type

## Struct types

A struct describes a value type (instances do not have object identity)
with named, mutable fields.

### Syntax

```
  Struct-def ::= (lookbehind EOL)
                 "@flatjs" "struct" Id "{" Comment? EOL
                 ((Comment | Field) EOL)*
                 ((Comment | Struct-Method) EOL)*
                 "}" "@end" Comment? EOL

  Field ::= Ident ":" Type ";"? Comment? EOL

  Comment ::= "//" Not-EOL*

  Type ::= ValType | ArrayType
  ValType ::= ("int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32") (".atomic" | ".synchronic")?
            | "float32" | "float64"
	    | "int32x4" | "float32x4" | "float64x2"
            | Id
  ArrayType ::= ValType ".Array"

  Struct-Method ::= "@get" "(" "SELF" ")" Function-body
                  | "@set" "(" "SELF" ("," Parameter)* ("," "..." Id)? ")" Function-body

  Parameter ::= Id (":" Tokens-except-comma-or-rightparen )?

  Id ::= [A-Za-z_][A-Za-z0-9_]*
```

Note the following:

* The annotation on the Parameter is not used by FlatJS, but is allowed in order
  to interoperate with TypeScript.
* The restriction of properties before methods is a matter of economizing on the
  markup; as it is, properties don't need eg ```@var``` before them.  This restriction
  can be lifted once we have a better parser, see Issue #11.


### Static semantics

Every field name in a struct must be unique within that struct.

A field of struct type gives rise to a named substructure within the
outer structure that contains the fields of the nested struct.  No struct
may in this way include itself.


### Dynamic semantics

Within the body of a method, "this" denotes the type object carrying
the method.

### Translation

For a struct type named R, with field names F1 .. Fn, the following
will be defined, where "self" denotes a memory offset properly aligned
for R and with a value such that memory offset self+R.size-1 is within
the memory.


#### Global value properties

R is a global "const" holding an object designating the type.

R.SIZE is the size in bytes of R, rounded up such that an array of R
structures can be traversed by adding R.SIZE to a pointer to one
element of the array to get to the next element, and allocating
n*R.SIZE will allocate space enough to hold n such elements.

R.ALIGN is the required alignment for R, in bytes.

R.NAME is the name of the type R.


#### Global function properties

If a field Fk does not have struct type then the following functions
are defined:

* R.Fk(self) => value of self.Fk field
* R.Fk.set(self, v) => void; set value of self.Fk field to v

If a field Fk is designated "atomic" then the getter and setter just
shown use atomic loads and stores.  In addition, the following atomic
functions are defined:
  
* R.Fk.compareExchange(self, o, n) => if the value of self.Fk field is o then store n; return old value
* R.Fk.add(self, v) => add v to value of self.Fk field; return old value
* R.Fk.sub(self, v) => subtract v from value of self.Fk field; return old value
* R.Fk.and(self, v) => and v into value of self.Fk field; return old value
* R.Fk.or(self, v) => or v into value of self.Fk field; return old value
* R.Fk.xor(self, v) => xor v to value of self.Fk field; return old value

If a field Fk is designated "synchronic" then the setter and atomics
just shown are synchronic-aware (every update sends a notification).
In addition, the following synchronic functions are defined:

* R.Fk.expectUpdate(self, v, t) => void; wait until the value of the 
  self.Fk field is observed not to hold v, or until t milliseconds have passed
* R.Fk.loadWhenEqual(self, v) => wait until the value of the self.Fk
  field is observed to hold v, then return the value of that field
  (which might have changed since it was observed to hold v)
* R.loadWhenNotEqual_Fk(self, v) => wait until the value of the self.Fk
  field is observed not to hold v, then return the value of that field
  (which might have changed back to v since it was observed)
* R.Fk.notify(self) => wake all waiters on self.Fk, making them re-check
  their conditions.

If a field Fk has a struct type T with fields G1 .. Gm then the
following functions are defined:

* R.Fk(self) => if T does not have a @get method then this is undefined.
  Otherwise, a function that invokes the @get method on a reference to self.Fk.
* R.Fk.set(self, ...args) => if T does not have a @set method then this
  is undefined.  Otherwise, a function that invokes the @set method on a
  reference to self.Fk and ...args
* R.Fk.ref(self) => A reference to self.FK.
* Getters, setters, and accessors for fields G1 through Gm within Fk,
  with the general pattern R.Fk.Gi(self) and R.Fk.Gi.op(self,...), by
  the rules above.


## Class types

A class describes a reference type (instances have object identity)
with mutable fields.

### Syntax

A class definition takes the form of a number of fields followed
by a number of methods:

```
  Class-def ::= (lookbehind EOL)
                "@flatjs" "class" Id ("extends" Id)? "{" Comment? EOL
                ((Comment | Field) EOL)*
                ((Comment | Class-Method) EOL)*
                "}" "@end" Comment? EOL

  Class-method ::= ("@method"|"@virtual") Id "(" "SELF" ("," Parameter)* ("," "..." Id)? ")" Function-body
```

### Static semantics

If a class definition contains an extends clause then the Id in
the extends clause must name a class (the "base class").
No class may extend itself directly or indirectly.

No field within a class definition must have a name that
matches any other field or method within the class definition
or within the definition of any base class.

No method within a class definition must have a name that matches any
method within the class definition.  However, a method in a class may
match the name of a method in the base class if they are either both
designated virtual or if neither is designated virtual.

(The case for neither being designated virtual is to accomodate the
```init``` method.  I suspect that a special-case rule for ```init```
may be better, but I'm not sure yet.)

A virtual method whose name matches the name of a method in a base
class is said to override the base class method.  Overriding methods
must have the same signature (number and types of arguments) as the
overridden method.

The first argument to a method is always the keyword SELF.

As for structs, a field of struct type gives rise to a named substructure
within the outer class that contains the fields of the nested struct.

A field of class type gives rise to a pointer field.

The layout of a class is compatible with the layout of its base class:
any accessor on a field of a base class, and any invoker of a method
defined on the base class can be used on an instance of the derived
class.


### Dynamic semantics

Before memory for a class instance can be used as a class instance,
the class's initInstance method must be invoked on the memory. 
If used, the ```@new``` operator (see below) invokes initInstance
on behalf of the program.

Within the body of a method, "this" denotes the type object carrying
the method.  (Thus the calls ```SELF.method(...)``` and
```this.method(SELF,...)``` are equivalent.)


### Translation

For a class type named C, with field names F1 .. Fn and method names M1 .. Mn
(including inherited fields and methods), the following
will be defined, where "self" denotes a memory offset properly aligned
for C and with a value such that memory offset self+C.size-1 is within
the memory.


#### Global value properties

C is a global "const" holding an object designating the type.

C.SIZE is the size in bytes of C.  Note that since C is a reference
type, to allocate an "array of C" means to allocate an array of
pointers, which are int32 values.

C.ALIGN is the required alignment for C, in bytes.

C.NAME is the name of the type C.

C.CLSID for the type ID for the type.

C.BASE for the base type of R, or null.

#### Global function properties

Getters and setters for fields are translated exactly for structs.
If class D derives from class B and class B has a field x, then 
there will be accessors for x defined on D as well.

If a method Mk is defined on class C or is a virtual method inherited
from class B, then an invoker is defined for Mk on C:

* C.Mk(self, ...)

The invoker for a virtual method will determine the actual type of
self and invoke the correct method implementation; the invoker for a
direct method will just contain the method implementation.

self must reference an instance of type C or a subclass of C.  The
type is determined by consulting a hidden field within the instance
that contains the class ID of the object.

If a virtual method Mk is defined on class C, then an implementation
is defined for Mk on C:

* C.Mk_impl(self, ...)

The implementation is the actual method body defined within the class.


## Array types

FlatJS arrays are primitive reference types that do /not/ carry their
length: they are simply a sequence of elements of a given type within
memory.

Allocating an array of primitive or structure type T of length n requires only allocating
memory for n*T.SIZE.

Allocating an array of class type T of length n requires only allocating
memory for n*int32.SIZE.

### Translation

Suppose A is some type.

* A.Array.at(ptr, i) reads the ith element of an array of A
  whose base address is ptr.  Not bounds checked.  If the base
  type of the array is a structure type this will only work if
  the type has a ```@get``` method.
* A.Array.setAt(ptr, i, v) writes the ith element of an array of A
  whose base address is ptr.  Not bounds checked.  If the base
  type of the array is a structure type this will only work if
  the type has an ```@set``` method.
* If the base type A is a structure type then the path to a field
  within the structure can be denoted: A.Array.x.y.at(ptr, i)
  returns the x.y field of the ith element of the array ptr.
  Ditto for setAt.

NOTE: Arrays of atomics and synchronics, and operations on those, will appear.


## @new macro

An instance of the class type may be allocated and initialized with
the operator-like ```@new``` macro.  Specifically, ```@new T``` for FlatJS class
type T expands into this:
```
  T.initInstance(FlatJS.allocOrThrow(T.SIZE, T.ALIGN))
```
An array may also be allocated and initialized with ```@new```.
Specifically, ```@new T.Array(n)``` for type T expands into
this:
```
  FlatJS.allocOrThrow(n*<size>, <align>)
```
where *size* is int32.SIZE if T is a reference type or T.SIZE
otherwise, and *align* is int32.ALIGN if T is a reference type
and T.ALIGN otherwise.

NOTE: Arrays of atomics and synchronics, and operations on those, will appear.

## SELF accessor macros

Inside the method for a struct or class T, the identifier SELF acts as
a keyword identifying the object pointer that is the target of the
method.

Within the method, a number of macros are tied to the syntax "SELF.",
as follows.

If the type T has a suite of accessor methods F1..Fn, there will be
macros SELF.F1..SELF.Fk.  A reference to SELF.Fj(arg,...) is rewritten
at translation time as a reference to T.Fj(SELF, arg, ...).

In the special case of a field getter Fg, which takes only the SELF
argument, the form of the macro invocation shall be SELF.Fj, that is,
without the empty parameter list.  This is rewritten as T.Fj(SELF).

If a macro invocation has the form SELF.Fj op expr, where op is one of
the assignment operators =, +=, -=, &=, |=, and ^=, then the macro
invocation is rewritten as T.operation_Fj(SELF, expr), where operation
is "set", "add", "sub", "and", "or", and "xor", respectively.

The plain assignment operator can be chained, eg, SELF.x=SELF.y=0, but
not for SIMD field types (at present).

Furthermore, if there exists a method Mg and the syntax that is being
used is SELF.Mg(arg, ...) then this is rewritten as T.Mg(SELF,arg,...).



## Global macros

All field accessors to simple fields are macro-expanded at translation time.

Note carefully that the field accessors that are macro-expanded are not,
in fact, available as properties on the type objects at run-time.


## Environment

There is a new global object called "FlatJS".  This is defined in
libflatjs.js, which must be loaded once before application files that
are translated from FlatJS.

For each primitive type (int8, uint8, int16, uint16, int32, uint32,
float32, float64, int32x4, float32x4, float64x2) there is a global
variable with the type name.

There is a global variable called NULL whose value is the null
pointer, whose integer value is zero.

The FlatJS object has the following public methods:

* init(buffer [, initialize]) takes an ArrayBuffer or
  SharedArrayBuffer and installs it as the global heap.  The buffer
  must be cleared to all zeroes before being used, and client code
  should assume it may not modify it directly after calling init() on
  it.  If initialize=true then the memory is also appropriately
  initialized.  Initialize must be true in the first call to init(),
  and the call that performs initialization must return before any
  other calls to init() are made.  [Normally this means you
  init(...,true) on the main thread before you send a
  SharedArrayBuffer to other workers.]
* alloc(numBytes, byteAlignment) allocates and zero-initializes an
  object of size numBytes with alignment at least byteAlignment and
  returns it.  If the allocation fails then returns the NULL pointer.
* allocOrThrow(numBytes, byteAlignment) allocates and zero-initializes
  an object of size numBytes with alignment at least byteAlignment and
  returns it.  If the allocation fails then throws a MemoryError
  exception.
* free(p) frees an object p that was obtained from alloc(), or does
  nothing if p is the NULL pointer.
* identify(p) returns the Class object if p is a pointer to a class
  instance, or null.

The allocator operates on the flat memory and is thread-safe if that
memory is shared.

There is a new global constructor called MemoryError, derived from
Error.  It is thrown by allocOrThrow if there is not enough memory to
fulfill the request.

## How to run the translator

The translator has to be run on all files in the program
simultaneously, and will resolve all types in all files.  It will
output a file for each input file.

## Type IDs

Type IDs must be unique and invariant across workers, which are all
running different programs.

A type ID is the hash value of a string representing the name of a
type.

NOTE: If a program has two types with the same type ID then the program
cannot be translated.  A workaround is to change the name of one of
the conflicting types.  If this turns out to be a constant problem we
can introduce a notion of a "brand" on a type which is just a fudge
factor to make the type IDs work out.  (This scales poorly but is
probably OK in practice.)
