JSSHELL=../../mozilla-shmem/js/src/build-release/dist/bin/js
FJSC=nodejs ../fjsc-exe.js

test:
	$(FJSC) basic-tests.flat_js
	$(JSSHELL) basic-tests.js
	$(FJSC) atomic-tests.flat_js
	$(JSSHELL) atomic-tests.js
	$(FJSC) synchronic-tests.flat_js
	$(JSSHELL) synchronic-tests.js
	$(FJSC) simd-tests.flat_js
	$(JSSHELL) simd-tests.js
	$(FJSC) typescript-tests.flat_ts
