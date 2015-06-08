.SUFFIXES: .ts .js

# TODO: Want to get rid of --suppressImplicitAnyIndexErrors here

fjsc.js: fjsc.ts
	tsc -t ES5 -m commonjs --noImplicitAny --suppressImplicitAnyIndexErrors fjsc.ts

tokenize.js: tokenize.ts
	tsc -t ES5 -m commonjs --noImplicitAny --suppressImplicitAnyIndexErrors tokenize.ts
