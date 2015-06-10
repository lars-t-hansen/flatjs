/// <reference path='typings/node/node.d.ts' />

import fs = require("fs");

function test() {
    let fn = "test/basic-tests.js.flatjs";
    //let fn = "test.x";
    let text = fs.readFileSync(fn, "utf8");
    var tokenizer = new Tokenizer(text, function (line:number, msg:string) {
	throw new Error(fn + ":" + line + ": " + msg);
    });
    for (;;) {
	let [t, s] = tokenizer.next();
	if (t == Token.EOI)
	    break;
	console.log(t + " " + s);
    }
}

test();
