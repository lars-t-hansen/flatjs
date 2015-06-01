.SUFFIXES: .ts .js

fcsc.js: fjsc.ts
	tsc -t ES5 -m commonjs fjsc.ts
