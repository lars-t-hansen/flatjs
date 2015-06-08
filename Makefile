.SUFFIXES: .ts .js

fjsc.js: fjsc.ts
	tsc -t ES5 -m commonjs --noImplicitAny --suppressImplicitAnyIndexErrors fjsc.ts
