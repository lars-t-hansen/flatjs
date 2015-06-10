# FlatJS

FlatJS is a "language fragment" layered on JavaScript that allows programs to use flat memory -- ArrayBuffer and SharedArrayBuffer -- conveniently with high performance.

FlatJS provides structs, classes, and arrays within flat memory, as well as atomic and synchronic fields when using shared memory.  There is single inheritance among classes and class instances carry virtual methods.

Objects in flat memory are manually managed and represented in JavaScript as pointers into the flat memory, not as native JavaScript objects.   However, a second layer provides for simple, optional reification of objects in flat memory as true JavaScript objects.

FlatJS is implemented as a preprocessor that translates JavaScript+FlatJS into plain JavaScript.  JavaScript dialects, such as TypeScript, are supported.

See the wiki for tutorials and notes on future evolution; see SPEC.md for a language specification.

See test/ and demo/ for complete test programs.
