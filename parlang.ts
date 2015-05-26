//#!/usr/bin/env nodejs

/*
 * Usage:
 *   parlang input-file ...
 *
 * One output file will be produced for each input file.  Each input
 * file must have extension .xx.parlang, where x is typically js or
 * ts.  On output the .parlang suffix will be stripped.
 */

/// <reference path='typings/node/node.d.ts' />

import fs = require("fs");

enum DefnKind {
    Class,
    Struct,
    Primitive
}

class Defn {
    size: number = 0;
    align: number = 0;

    constructor(public file:string, public line:number, public name:string, public kind:DefnKind) { }
}

class PrimitiveDefn extends Defn {
    atomic: boolean = false;
}

class UserDefn extends Defn {
    typeRef: StructDefn = null;

    constructor(file:string, line:number, name:string, kind:DefnKind, public props:Prop[], public methods:Method[], public origin:number)  {
	super(file, line, name, kind);
    }
}

class ClassDefn extends UserDefn {
    baseTypeRef: ClassDefn = null;

    constructor(file:string, line:number, name:string, public baseName:string, props:Prop[], methods:Method[], origin:number) {
	super(file, line, name, DefnKind.Class, props, methods, origin);
    }
}

class StructDefn extends UserDefn {
    checked: boolean = false;
    live: boolean = false;

    constructor(file:string, line:number, name:string, props:Prop[], methods:Method[], origin:number) {
	super(file, line, name, DefnKind.Struct, props, methods, origin);
    }
}

enum PropQual {
    None,
    Atomic,
    Synchronic
}

class Prop {
    typeRef: Defn = null;

    constructor(public line:number, public name:string, public qual:PropQual, public isArray:boolean, public typeName:string) {
    }
}

enum MethodKind {
    Virtual,
    Get,
    Set,
    Copy
}

class Method {
    constructor(public line:number, public kind:MethodKind, public name:string, public body: string[]) {
    }
}

var allDefs:[UserDefn[],string[]][] = [];

function main(args: string[]) {
    for ( var i=0 ; i < args.length ; i++ ) {
	var input_file = args[i];
	if (input_file.length < 10 ||
	    (input_file.substring(-10) != ".js.parlib" && input_file.substring(-10) != ".ts.parlib"))
	    throw new Error("Bad file name: " + input_file);
	var text = fs.readFileSync(input_file, "utf8");
	var lines = text.split("\n");
	allDefs.push(collectDefinitions(input_file, lines));
    }

    buildTypeMap();
    resolveTypeRefs();
    checkRecursion();
    layoutTypes();
    expandSelfAccessors();
    pasteupTypes();
    expandGlobalAccessorsAndMacros();

    for ( var i=0 ; i < args.length ; i++ ) {
	var output_file = args[i].replace(/\.parlib$/,"");
	var text = allDefs[i][1].join("\n")
	fs.writeFileSync(output_file, "utf8");
    }
}

var Ws = "\\s+";
var Os = "\\s*";
var Id = "[A-Za-z_][A-Za-z0-9_]*";
var Lbrace = Os + "\\{";
var Rbrace = Os + "\\}";
var Comment = Os + "(?:\\/\\/.*)?";

var start_re = new RegExp("^" + Os + "@shared" + Ws + "(?:struct|class)" + Ws + "(?:" + Id + ")");
var end_re = new RegExp("^" + Rbrace + Os + "@end" + Comment + "$");
var struct_re = new RegExp("^" + Os + "@shared" + Ws + "struct" + Ws + "(" + Id + ")" + Lbrace + Comment + "$");
var class_re = new RegExp("^" + Os + "@shared" + Ws + "class" + Ws + "(" + Id + ")" + Os + "(?:extends" + Ws + "(" + Id + "))?" + Lbrace + Comment + "$");
var special_re = new RegExp("^" + Os + "@(get|set|copy)" + Os + "(\\(" + Os + "self.*)$");
var method_re = new RegExp("^" + Os + "@method" + Ws + "(" + Id + ")" + Os + "(\\(" + Os + "self.*)$");
var blank_re = new RegExp("^" + Os + Comment + "$");
var space_re = new RegExp("^" + Os + "$");
var prop_re = new RegExp("^" + Os + "(" + Id + ")" + Os + ":" + Os + "(atomic|synchronic)?" + Ws + "(" + Id + ")" + Os + ";?" + Comment + "$");
var aprop_re = new RegExp("^" + Os + "(" + Id + ")" + Os + ":" + Os + "array" + Os + "\\(" + Os + "(" + Id + ")" + Os + "\\)" + Os + ";?" + Comment + "$");

function collectDefinitions(filename:string, lines:string[]):[UserDefn[], string[]] {
    var defs:UserDefn[] = [];
    var nlines:string[] = [];
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
	var m:string[] = null;
	if (m = struct_re.exec(l)) {
	    kind = "struct";
	    name = m[1];
	}
	else if (m = class_re.exec(l)) {
	    kind = "class";
	    name = m[1];
	    inherit = m[2] ? m[2] : "";
	}
	else
	    throw new Error(filename + ":" + i + ": Syntax error: Malformed definition line");

	var properties:Prop[] = [];
	var methods:Method[] = [];
	var in_method = false;
	var mbody = null;
	var method_type = MethodKind.Virtual;
	var method_name = "";

	// Do not check for duplicate names here since that needs to
	// take into account inheritance.

	while (i < lim) {
	    var l = lines[i++];
	    if (end_re.test(l))
		break;
	    if (m = method_re.exec(l)) {
		if (in_method)
		    methods.push(new Method(i, method_type, method_name, mbody));
		in_method = true;
		method_type = MethodKind.Virtual;
		method_name = m[1];
		mbody = [m[2]];
	    }
	    else if (m = special_re.exec(l)) {
		if (in_method)
		    methods.push(new Method(i, method_type, method_name, mbody));
		in_method = true;
		switch (m[1]) {
		case "get": method_type = MethodKind.Get; break;
		case "set": method_type = MethodKind.Set; break;
		case "copy": method_type = MethodKind.Copy; break;
		}
		method_name = "";
		mbody = [m[2]];
	    }
	    else if (m = prop_re.exec(l)) {
		var qual = PropQual.None;
		switch (m[2]) {
		case "synchronic": qual = PropQual.Synchronic; break;
		case "atomic": qual = PropQual.Atomic; break;
		}
		properties.push(new Prop(i, m[1], qual, false, m[3]));
	    }
	    else if (m = aprop_re.exec(l)) {
		properties.push(new Prop(i, m[1], PropQual.None, true, m[2]));
	    }
	    else if (in_method) {
		mbody.push(l);
	    }
	    else
		throw new Error(filename + ":" + i + ": Syntax error: Not a property or method: " + l);
	}

	if (kind == "class")
	    defs.push(new ClassDefn(filename, lineno, name, inherit, properties, methods, nlines.length));
	else
	    defs.push(new StructDefn(filename, lineno, name, properties, methods, nlines.length));
    }
    return [defs, lines];
}

var atomicTypes = {int8:true, uint8:true, int16:true, uint16:true, int32:true, uint32:true};
var builtinTypes = {int8:1, uint8:1, int16:2, uint16:2, int32:4, uint32:4, float32:4, float64:8};
var knownTypes = {};		// Map from string to UserDefn
var allTypes:UserDefn[] = [];

// TODO: This will also match bogus things like XSELF_ because there's no lookbehind,
// could compensate below.

var self_getter_re = /SELF_(?:ref_|notify_)?[a-zA-Z0-9_]+/g;
var self_accessor_re = /SELF_(?:set_|add_|sub_|or_|compareExchange_|loadWhenEqual_|loadWhenNotEqual_|expectUpdate_)[a-zA-Z0-9_]+/g;

// TODO: really should check validity of the name here, not hard to do.
// Can fall back on that happening on the next pass probably.

function expandSelfAccessors():void {
    for ( var i=0 ; i < allTypes.length ; i++ ) {
	var t = allTypes[i];
	var meths = t.methods;
	for ( var j=0 ; j < meths.length ; j++ ) {
	    var m = meths[j];
	    var body = m.body;
	    for ( var k=0 ; k < body.length ; k++ ) {
		body[k] = body[k].replace(self_accessor_re, function (m, p, s) {
		    return t.name + "." + m.substring(5) + "(self";
		});
		body[k] = body[k].replace(self_getter_re, function (m, p, s) {
		    return t.name + "." + m.substring(5) + "(self)";
		});
	    }
	}
    }
}

function expandGlobalAccessorsAndMacros():void {
    var ts = "";
    var cs = "";
    for ( var i=0 ; i < allTypes.length ; i++ ) {
	if (ts != "")
	    ts += "|";
	ts += allTypes[i].name;
	if (allTypes[i].kind == DefnKind.Class) {
	    if (cs != "")
		cs += "|";
	    cs += allTypes[i].name;
	}
    }

    // TODO: the accessor regex can mismatch because we ignore the left context.
    var acc_re = new RegExp("(?:" + cs + ")\\.[a-zA-Z0-9_]+\\s*\\(");
    var new_re = new RegExp("@new\s+(?:(?:" + cs + ")|(?:array\s*\\(" + ts + "\\)))");

    for ( var i=0 ; i < allDefs.length ; i++ ) {
	var t = allTypes[i];
	var meths = t.methods;
	for ( var j=0 ; j < meths.length ; j++ ) {
	    var m = meths[j];
	    var body = m.body;
	    for ( var k=0 ; k < body.length ; k++ ) {
		body[k] = body[k].replace(self_accessor_re, function (m, p, s) {
		    return t.name + "." + m.substring(5) + "(self";
		});
		body[k] = body[k].replace(self_getter_re, function (m, p, s) {
		    return t.name + "." + m.substring(5) + "(self)";
		});
	    }
	}
    }
}

function pasteupTypes():void {
    // Emit all code for a type where the type was defined.
}

function buildTypeMap() {
    for ( var i=0 ; i < allDefs.length ; i++ ) {
	var defs = allDefs[i][0];
	for ( var j=0 ; j < defs.length ; j++ ) {
	    var d = defs[j];
	    if (knownTypes.hasOwnProperty(d.name))
		throw new Error(d.file + ":" + d.line + ": Duplicate type name: " + d.name);
	    knownTypes[d.name] = d;
	    allTypes.push(d);
	}
    }
}

// Reference checking:
//  - For each class type, check inheritance, and add a property inheritRef that references the definition
//  - For each property, check that the referenced type exists, and add a property typeRef that references the definition
//  - For each property, check that atomic/synchronic is only used on appropriate types

function resolveTypeRefs():void {
    for ( var i=0 ; i < allTypes.length ; i++ ) {
	var d = allTypes[i];
	if (d.kind == DefnKind.Class) {
	    var cls = <ClassDefn> d;
	    if (cls.baseName != "") {
		if (!knownTypes.hasOwnProperty(cls.baseName))
		    throw new Error(cls.file + ":" + cls.line + ": Missing base type: " + cls.baseName);
		cls.baseTypeRef = knownTypes[cls.baseName];
	    }
	}
	var props = d.props;
	for ( var j=0 ; j < props.length ; j++ ) {
	    var p = props[i];
	    if (p.qual != PropQual.None) {
		// TODO: better line number here
		if (!atomicTypes.hasOwnProperty(p.typeName))
		    throw new Error(d.file + ":" + d.line + ": Not an atomic type: " + p.typeName);
	    }
	    if (builtinTypes.hasOwnProperty(p.typeName)) {
		p.typeRef = builtinTypes[p.typeName]; // Will be a number
		continue;
	    }
	    if (!knownTypes.hasOwnProperty(p.typeName))
		throw new Error(d.file + ":" + d.line + ": Undefined type: " + p.typeName);
	    p.typeRef = knownTypes[p.typeName];
	}
    }
}

// For each record type, check that it does not reference itself recursively.

function checkRecursion():void {
    for ( var i=0 ; i < allTypes.length ; i++ ) {
	var d = allTypes[i];
	if (d.kind != DefnKind.Struct)
	    continue;
	checkRecursionFor(<StructDefn> d);
    }

    function checkRecursionFor(d:StructDefn):void {
	if (d.checked)
	    return;
	d.live = true;
	var props = d.props;
	for ( var j=0 ; j < props.length ; j++ ) {
	    var p = props[i];
	    if (p.isArray)
		continue;
	    var probe:UserDefn = knownTypes[p.typeName];
	    if (probe.kind != DefnKind.Struct)
		continue;
	    var s = <StructDefn> probe;
	    if (s.live)
		throw new Error("Recursive type reference");
	    checkRecursionFor(s.typeRef);
	}
	d.live = false;
	d.checked = true;
    }
}

// Layout:
//  - For each class and record type, create a type map from name to offset, and compute
//    size and alignment
//  - For each record type, ensure that it is not circularly included
//  - For each method, ...
//  - NOTE, must also check uniqueness of all field names along a path, for classes

function layoutTypes():void {
    for ( var i=0 ; i < allTypes.length ; i++ ) {
	var d = allTypes[i];
	var map = [];
	if (d.kind == DefnKind.Class)
	    layoutClass(<ClassDefn> d);
	else
	    layoutStruct(<StructDefn> d);
    }
}

// What's in a layout map?  And what else do we need?
//
//   It has the 

function layoutClass(d:ClassDefn):void {
    var map = [];
    var size = 4;
    /*
    if (d.baseName != "") {
	if (d.typeRef.map === undefined)
	    layoutClass(d.typeRef);
	map = d.typeRef.map.slice(0);
	size = d.typeRef.size;
    }
    for ( each prop ) {
	if (prop is struct) {
	    if (struct not laid out)
		layoutStruct(...);
	    insert fields here;
	}
    }*/
    
}

function layoutStruct(d:StructDefn):void {
/*
    var map = [];
    var size = 0;
    var align = 0;
    if (d.live)
	throw new Error("Recursive");
    d.live = true;
    for (props) {
	if (field type is int or float) {
	    { round up alloc to fields size; set align=max(align,field size)  }
	    size += field size;
	}
	else if (field type is class) {
	    { round up alloc to 4; set align=max(align,4)  }
	    size += 4;
	}
	else if (field type is struct) {
	    // layout struct if not laid out
	    round up alloc to struct align
	    set align=max(align, struct align)
	    size += struct size
            append struct fields into our fields
        }
    }
    d.live = false;
*/
}

main(process.argv.slice(2));
