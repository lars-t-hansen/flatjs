.SUFFIXES: .ts .js

# TODO: Want to get rid of --suppressImplicitAnyIndexErrors here

fjsc.js: fjsc.ts
	tsc -t ES5 -m commonjs --noImplicitAny --suppressImplicitAnyIndexErrors fjsc.ts

tokenize.js: tokenize.ts
	tsc -t ES5 -m commonjs --noImplicitAny --suppressImplicitAnyIndexErrors tokenize.ts

test-tokenize.js: tokenize.ts tokenize-test.ts
	tsc -t ES5 -m commonjs --noImplicitAny --suppressImplicitAnyIndexErrors tokenize.ts tokenize-test.ts
	cat tokenize.js tokenize-test.js > test-tokenize.js

clean:
	rm -f fjsc.js tokenize.js tokenize-test.js test-tokenize.js
