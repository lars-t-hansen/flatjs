JSSHELL=../../mozilla-shmem/js/src/build-release/dist/bin/js
FJSC=nodejs ../fjsc.js

test:
	$(FJSC) basic-tests.flat.js
	$(JSSHELL) basic-tests.js
	$(FJSC) atomic-tests.flat.js
	$(JSSHELL) atomic-tests.js
	$(FJSC) synchronic-tests.flat.js
	$(JSSHELL) synchronic-tests.js
	$(FJSC) typescript-tests.flat.ts
