#!/usr/bin/env nodejs

/* Usage:
   parlang [--debug] input-file output-file

   Conventionally, parlang inputs have type .parlang and outputs have type .js.
*/

var fs = require("fs");

var Ws = "\\s+";
var Os = "\\s*";
var Id = "[A-Za-z_][A-Za-z0-9_]*";
var Lbrace = Os + "\\{";
var Rbrace = Os + "\\}";
var Comment = Os + "(?:\\/\\/.*)?";

var start_re = new RegExp("^" + Os + "DEFINE" + Ws + "(?:RECORD|OBJECT)" + Ws + "(?:" + Id + ")");
var end_re = new RegExp("^" + Rbrace + Os + "END" + Comment + "$");
var record_re = new RegExp("^" + Os + "DEFINE" + Ws + "RECORD" + Ws + "(" + Id + ")" + Lbrace + Comment + "$");
var object_re = new RegExp("^" + Os + "DEFINE" + Ws + "OBJECT" + Ws + "(" + Id + ")"
			    + Os + "(?:EXTENDS" + Ws + "(" + Id + "))?" + Lbrace + Comment + "$");

function collectDefinitions(filename, lines) {
    var defs = [];
    var nlines = [];
    var i=0, lim=lines.length;
    while (i < lim) {
	var l = lines[i++];
	if (!start_re.test(l)) {
	    nlines.push(l);
	    continue;
	}

	var kind = "";
	var name = "";
	var inherit = "";
	var lineno = i;
	var m;
	if (m = record_re.match(l)) {
	    kind = "record";
	    name = m[1];
	}
	else if (m = object_re.match(l)) {
	    kind = "object";
	    name = m[1];
	    inherit = m[2] ? m[2] : "";
	}
	else
	    throw new Error(filename + ":" + i + ": Syntax error: Malformed definition line");

	while (i < lim) {
	    var l = lines[i++];
	    if (end_re.test(l))
		break;
	}

	defs.push({file:filename, line:lineno, kind:kind, name:name, inherit:inherit, ...});
    }
    return {definitions:defs, lines:nlines};
}

function main(args) {
    var input_file = args[0];
    var text = fs.readFileSync(input_file, "utf8");
    var xs = collectDefinitions(text.split("\n"));
    for ( var i=0 ; i < xs.lines.length ; i++ )
	console.log(xs.lines[i]);
    for ( var i=0 ; i < xs.definitions.length ; i++ ) {
	console.log("-----");
	console.log(xs.definitions[i].join("\n"));
    }
}

main(process.argv.slice(2));
