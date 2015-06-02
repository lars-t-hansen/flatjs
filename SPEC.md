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

  Type ::= AtomicType | ValType | ArrayType
  AtomicType ::= ("atomic" | "synchronic") ("int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32")
  ValType ::= "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32"
            | "float32" | "float64"
	    | "int32x4" | "float32x4" | "float64x2"
            | Id
  ArrayType ::= array(ValType)

  Struct-Method ::= "@get" "(" "SELF" ")" Function-body
                  | "@set" "(" "SELF" ("," Parameter)* ("," "..." Id)? ")" Function-body

  Parameter ::= Id (":" Tokens-except-comma-or-rightparen )?

  Id ::= [A-Za-z][A-Za-z0-9]*
```

Note the following:

* Underscore is not currently a legal character in an Id.  That is because the
  underscore is used as part of the macro syntax.
* The annotation on the Parameter is not used by FlatJS, but is allowed in order
  to interoperate with TypeScript.
* The restriction of properties before methods is a matter of economizing on the
  markup; as it is, properties don't need eg ```@var``` before them.  This restriction
  can be lifted once we have a better parser, see Issue #11.


### Static semantics

Fields within a user-defined type must have names unique within that type.
Every field name must be unique within the struct.

The struct type must not reference itself directly or indirectly via a
chain of struct-typed fields.


### Translation

For a struct type named R, with field names F1 .. Fn, the following
will be defined, where "self" denotes an address of memory that can
hold an instance of R.


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
* R.set_Fk(self, v) => void; set value of self.Fk field to v

If a field Fk is designated "atomic" then the getter and setter just
shown use atomic loads and stores.  In addition, the following atomic
functions are defined:
  
* R.compareExchange_Fk(self, o, n) => if the value of self.Fk field is o then store n; return old value
* R.add_Fk(self, v) => add v to value of self.Fk field; return old value
* R.sub_Fk(self, v) => subtract v from value of self.Fk field; return old value
* R.and_Fk(self, v) => and v into value of self.Fk field; return old value
* R.or_Fk(self, v) => or v into value of self.Fk field; return old value
* R.xor_Fk(self, v) => xor v to value of self.Fk field; return old value

If a field Fk is designated "synchronic" then the setter and atomics
just shown are synchronic-aware (every update sends a notification).
In addition, the following synchronic functions are defined:

* R.expectUpdate_Fk(self, v, t) => void; wait until the value of the self.Fk field is observed not to hold v, or until t milliseconds have passed
* R.loadWhenEqual_Fk(self, v) => wait until the value of the self.Fk field is observed to hold v, then return the value of that field (which might have changed since it was observed to hold v)
* R.loadWhenNotEqual_Fk(self, v) => wait until the value of the self.Fk field is observed not to hold v, then return the value of that field (which might have changed back to v since it was observed)
* R.notify_Fk(self) => wake all waiters on self.Fk, making them re-check their conditions.

If a field Fk has a struct type T with fields G1 .. Gm then the
following functions are defined:

* R.Fk(self) => if T does not have a @get method then this is undefined. Otherwise, a function that invokes the @get method on a reference to self.Fk.
* R.set_Fk(self, ...args) => if T does not have a @set method then this is undefined.  Otherwise, a function that invokes the @set method on a reference to self.Fk and ...args
* R.ref_Fk(self) => A reference to self.FK.

Getters, setters, and accessors for fields G1 through Gm within Fk,
with the general pattern R.Fk_Gi(self) and R.Fk_op_Gi(self,...), by
the rules above.


## Class types.

A class describes a reference type with mutable fields.

It takes the form of a number of fields followed by a number of
methods.  As for structs, if a field type is a struct type then the
fields of that struct will appear as subfields of the class being
defined.  If a field type is a class type then the value of the field
is a class instance address.

### Syntax

```
  Class-def ::= (lookbehind EOL)
                "@flatjs" "class" Id ("extends" Id)? "{" Comment? EOL
                ((Comment | Field) EOL)*
                ((Comment | Class-Method) EOL)*
                "}" "@end" Comment? EOL

  Class-method ::= "@method" Id "(" "SELF" ("," Parameter)* ("," "..." Id)? ")" Function-body
```

### Static semantics

No cycles in the inheritance graph.

Uniqueness as for structs (classes and structs share the same
namespace).
  
Base types may be forward declared.


### Dynamic semantics

Before memory for a class instance can be used as a class instance,
the class's initInstance method must be invoked on the memory.

Methods are currently always virtual except for the method called
'init', which is not.


### Translation

The first field of an object is a hidden int32 field that holds a
globally invariant type identifier, see below.

The fields of a supertype are prepended to the fields of the
subtype, for purposes of layout.
  
* R.SIZE as for structs.
* R.ALIGN as for structs.
* R.NAME as for structs.
* R.CLSID for the type ID for the type.
* R.BASE for the base type of R, or null.

Field getters/setters are translated as for structs.
  
A method "meth" for object type O with subtypes J and K where J
overrides meth but K does not (and in this case J could be a subtype
of K, or not), turns into this global function:

```
    function O_meth(self, arg, ...) {
        switch (_mem_i32[self>>2]) {
        case J_ID: return J_meth_impl(self, arg, ...); 
        default:   return O_meth_impl(self, arg, ...);
        }
    }
```

where the arguments keep their annotations, the annotations on
O_meth are those of the method defined on O, the others may differ.

NOTE: _impl method and how to invoke on super


## Array types

FlatJS arrays are primitive reference types that do /not/ carry their
length: they are simply a sequence of elements of a given type within
memory.

Allocating an array of type T of length n requires only allocating
memory for n*T.SIZE.

* R.array_get(ptr, i)  => Read the ith element of an array of R whose base address is ptr.  Not bounds checked.  If the base type of the array is a structure type this will only work if the type has a @get method.
* R.array_set(ptr, i, v) => Set ditto / @set

These accessors are macro-expanded, as for named field accessors.


## @new macro

An instance of the class type may be allocated and initialized with
the operator-like @new macro.  Specifically, @new T for FlatJS class
type T expands into this:

  T.initInstance(FlatJS.alloc(T.SIZE, T.ALIGN))

An array of values may also be allocated and initialized with @new.
Specifically, @new array(T,n) for FlatJS value type T expands into
this:

  FlatJS.alloc(n*<size>, <align>)

where <size> is the size of an int32 if T is a reference type or the
size of the value type T otherwise, and <align> is 4 if T is a
reference type and the alignment of value type T otherwise.


## SELF accessor macros

Inside the method for a struct or class R with a suite of accessor
methods M1..Mn, there will be defined non-hygienic macros
SELF.M1..SELF.Mk.  A reference to SELF.Mj(arg,...) is rewritten
as a reference to R.Mj(SELF, arg, ...).

In the special case of a field getter Mg, which takes only the self
argument, the form of the macro invocation shall be SELF.Mg, that
is, without the empty parameter list.


## Environment

There is a new global object called "FlatJS".  This is defined in
libflatjs.js, which must be loaded once before application files that
are translated from FlatJS.

For each primitive type (int8, uint8, int16, uint16, int32, uint32,
float32, float64, int32x4, float32x4, float64x2) there is a global
variable with the type name containing the following properties:

* SIZE is the size in bytes of the type
* ALIGN is the required alignment in bytes of the type
* NAME is the name of the type

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
Error.  It is thrown on some allocation failures.

## How to run the translator

The translator has to be run on all files in the application
simultaneously, and will resolve all types in all files.  It would
normally output a file for each input file.


*** WARNING The translator is currently implemented by means of a
            fairly crude regular expression matcher.  Occasionally
            this leads to problems.

            * Do not use expressions containing commas or parentheses
            in the arguments to accessor macros (including array
            accessors).

            * Do not split calls to accessor macros across multiple
            lines.


## Type IDs

Type IDs must be unique and invariant across workers, which are all
running different programs.

A type ID could be the hash value of a string representing the name
and structure of a type.

If a program has two types with the same type ID then the program
cannot be translated.  A fix is likely to change the name of one of
the conflicting types.  If this turns out to be a constant problem we
can introduce a notion of a "brand" on a type which is just a fudge
factor to make the type IDs work out.  (This scales poorly but is
probably OK in practice.)

Eg, O>Triangle>Surface>> is a unique identifier but does not help us
catch errors easily.


## Rationale

Struct types and class types are separate because class types need
different initialization (vtable, chiefly).  By keeping these
separate, it becomes sensible to always give a class type a vtable and
never pay for that in a struct.
