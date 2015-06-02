JSSHELL=../../mozilla-shmem/js/src/build-release/dist/bin/js
FJSC=nodejs ../fjsc.js

test:
	$(FJSC) basic-tests.js.flatjs
	$(JSSHELL) basic-tests.js
	$(FJSC) atomic-tests.js.flatjs
	$(JSSHELL) atomic-tests.js
	$(FJSC) synchronic-tests.js.flatjs
	$(JSSHELL) synchronic-tests.js
	$(FJSC) typescript-tests.ts.flatjs
