# FlatJS

## Introduction

FlatJS is a "language fragment" layered on JavaScript that allows
programs to use flat memory (ArrayBuffer and SharedArrayBuffer)
conveniently and with good performance.

FlatJS provides structs, classes, and arrays within flat memory, as
well as atomic and synchronic fields when using shared memory.  There
is support for SIMD values.  Objects in flat memory are manually
managed and normally represented in JavaScript as pointers into the
shared memory (ie, integer addresses), not as native JavaScript
objects.  Virtual methods are provided for on class instances.

FlatJS is a static language and is implemented as a preprocessor that
translates JavaScript+FlatJS into plain JavaScript.

A slightly more dynamic layer sits on top of the static layer,
allowing objects in flat memory to be exposed as JavaScript classes
within a single JavaScript context.


## Caveats

The translator is implemented by means of a superficial parser and a
nonhygienic macro expander.  Occasionally this leads to problems.
Some things to watch out for:

* Do not use expressions containing template strings or regular expressions
  in the arguments to accessor macros (including array accessors).
* Occasionally, the translator may fail to parenthesize code correctly
  because it can't insert parentheses blindly as that interacts badly
  with automatic semicolon insertion (yay JavaScript).  When in doubt,
  use semicolons.

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

Each predefined type object T has five properties:

* T.NAME is the name of the type (a string)
* T.SIZE is the size in bytes of the type
* T.ALIGN is the required alignment for the type
* T.get(self) => value of a cell of the type
* T.set(self, v) => set the value of a cell of the type

## Struct types

A struct describes a value type (instances do not have object identity)
with named, mutable fields.

### Syntax

```
  Struct-def ::= "@flatjs" "struct" Id "{"
                 (Comment | Field | Struct-Method)*
                 "}"

  Field ::= Ident ":" Type (";"|EOL)

  Type ::= ValType | ArrayType
  ValType ::= ("int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32") (".atomic" | ".synchronic")?
            | "float32" | "float64"
	    | "int32x4" | "float32x4" | "float64x2"
            | Id
  ArrayType ::= ValType ".Array"

  Struct-Method ::= "get" "(" "SELF" ")" Function-body
                  | "set" "(" "SELF" ("," Parameter)* ("," "..." Id)? ")" Function-body

  Parameter ::= Id (":" Tokens-except-comma-or-rightparen )?

  Id ::= [A-Za-z_][A-Za-z0-9_]*
```

NOTE: The annotation on the Parameter is not used by FlatJS, but is
allowed in order to interoperate with TypeScript.


### Static semantics

Every field name in a struct must be unique within that struct.

A field of struct type gives rise to a named substructure within the
outer structure that contains the fields of the nested struct.  No struct
may in this way include itself.

No field may be named with the name of an operator: set, at, setAt,
ref, add, sub, and, or, xor, compareExchange, loadWhenEqual,
loadWhenNotEqual, expectUpdate, or notify.

No field may be named SELF.

The first parameter of a method is always the keyword SELF.


### Dynamic semantics

Within the body of a method, "this" denotes the type object carrying
the method.

### Translation

For a struct type named R, with field names F1 .. Fn, the following
will be defined, where "self" denotes a memory offset properly aligned
for R and with a value such that memory offset self+R.size-1 is within
the memory.


#### Global value properties

R is a global variable holding a function object designating the type.
See "JavaScript front objects", later.

R.SIZE is the size in bytes of R, rounded up such that an array of R
structures can be traversed by adding R.SIZE to a pointer to one
element of the array to get to the next element, and allocating
n*R.SIZE will allocate space enough to hold n such elements.

R.ALIGN is the required alignment for R, in bytes.

R.NAME is the name of the type R.


#### Global function properties

Whole-type accessors:

* R.get(self) => reified value of the structure, 
* R.set(self, v) => set the value of the structure from a reified value

Field accessors for all field types:

* R.Fk(self) => Shorthand for R.fk.get(self)
* R.Fk.get(self) => value of self.Fk field
  If the field is a structure then the getter reifies the structure as a JavaScript object.
  If the field type T does not have a ```get``` method then the getter returns a new instance
  of the JavaScript type R, with properties whose values are the values
  extracted from the flat object, with standard getters.  If T does have
  a ```get``` method then R.Fk(self) invokes that method on SELF.Fk.ref and returns its
  result.
* R.Fk.set(self, v) => void; set value of self.Fk field to v.
  If the field is a structure then the setter is a function that updates the shared object from ```v```.
  If the field type T does not have a ```set``` method then this method will set each field
  of self.Fk in order from same-named properties extracted from ```value```.
  If T does have a ```set``` method then this method will invoke that method
  on SELF.Fk.ref and ```value```.
* R.Fk.ref(self, v) => reference to the self.Fk field

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
  Class-def ::= "@flatjs" "class" Id ("extends" Id)? "{"
                (Comment | Field | Class-Method)*
                "}"

  Class-method ::= "virtual"? Id "(" "SELF" ("," Parameter)* ("," "..." Id)? ")" Function-body
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

The first parameter of a method is always the keyword SELF.

As for structs, a field of struct type gives rise to a named
substructure within the outer class that contains the fields of the
nested struct.  Restrictions on field names are as for struct.

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

C is a global variable holding a function object designating the type.
See "JavaScript front objects", later.

C.SIZE is the size in bytes of C.  Note that since C is a reference
type, to allocate an "array of C" means to allocate an array of
pointers, which are int32 values.

C.ALIGN is the required alignment for C, in bytes.

C.NAME is the name of the type C.

C.CLSID for the type ID for the type.

C.BASE for the base type of R, or null.

C.prototype is an instance of the function object designating the base
type, if there is a base type, otherwise an Object.

NOTE, C.get() and C.set() are not defined, those are defined only on
value types.


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
  the type has a ```get``` method.
* A.Array.setAt(ptr, i, v) writes the ith element of an array of A
  whose base address is ptr.  Not bounds checked.  If the base
  type of the array is a structure type this will only work if
  the type has an ```set``` method.
* A.Array.ref(ptr, i) returns a reference to the ith element.
* If the base type A is a structure type then the path to a field
  within the structure can be denoted: A.Array.x.y.at(ptr, i)
  returns the x.y field of the ith element of the array ptr.
  Ditto for setAt.

NOTE: Arrays of atomics and synchronics, and operations on those, will appear.


## ```@new``` macro

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

Value types may be allocated with ```@new```, and are
default-initialized (all zero bits).  ```@new int32``` and ```@new T``` for
some struct type T expand to this code:
```
   FlatJS.allocOrThrow(int32.SIZE, int32.ALIGN)
   FlatJS.allocOrThrow(T.SIZE, T.ALIGN);
```

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


## JavaScript front objects

The objects that describe FlatJS types are also JavaScript functions,
that is, standard JS class types.

These JS types are used in situations where JavaScript objects act as
front objects or proxies for flat objects, as described next.

Going via the front objects will generally be slower than going
directly to the flat objects, but provide a better interface to
JavaScript programs.


### Struct front objects

If a struct descriptor object is invoked as a function, it does
nothing and returns nothing.  If it is invoked as a constructor, it
returns a completely empty JavaScript object of that JS type.

The default struct getter will return a JavaScript object that is an
instance of the struct's descriptor object, with fields named by the
fields of the struct, and field values extracted from the struct.  The
JS object does not reference the shared struct in any way.

### Class front objects

If a class descriptor object is invoked as a function, it does nothing
and returns nothing.  If it is invoked as a constructor, it should be
passed one argument (defaults to NULL), which must be a pointer to a
shared object of the type denoted by the descriptor or one of its
subtypes.

The JS front object for a class has a getter called ```pointer``` that
extracts the pointer stored in the object.  There are no other
prototype methods, and there are no restrictions on what methods can
be stored in the prototype.

NOTE: It may be that we want to automatically create proxy methods on
the prototype for (some) shared object methods and fields.

NOTE: As the constructor for the front object already has a
definition, any construction protocols for them that pass additional
arguments will have to be implemented via a static constructor.  This
is a weakness of the system.  (It's fixable, and may be fixed.)

The front object for a FlatJS class normally holds no values of its
own except the pointer to the shared object.

If there is a FlatJS class D that has a base class B, then the D
function's prototype property holds an empty instance of B, that is,
the "instanceof" operator will function correctly on front objects.


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
