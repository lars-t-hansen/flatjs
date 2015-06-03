# FlatJS

FlatJS is a "language fragment" layered on JavaScript (and JS dialects) that allows programs to use flat memory (ArrayBuffer and SharedArrayBuffer) conveniently with high performance.

FlatJS provides structs, classes, and arrays within flat memory, as well as atomic and synchronic fields when using shared memory.  Objects in flat memory are manually managed and represented in JavaScript as pointers into the shared memory, not as native JavaScript objects.  Virtual methods are provided for on class instances.

FlatJS is implemented as a preprocessor that translates JavaScript+FlatJS into plain JavaScript.

See SPEC.md for more information about the language, and test/ and demo/ for test programs.

See the wiki for notes on missing features and future evolution.

