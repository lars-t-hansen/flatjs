.SUFFIXES: .ts .js

fjsc.js: fjsc.ts
	tsc -t ES5 -m commonjs fjsc.ts
