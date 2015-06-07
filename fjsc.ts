/* -*- mode: javascript; electric-indent-local-mode: nil -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Author: Lars T Hansen, lhansen@mozilla.com
 */

/*
 * FlatJS compiler.  Desugars FlatJS syntax in JavaScript programs.
 *
 * Usage:
 *   fjsc input-file ...
 *
 * One output file will be produced for each input file.  Each input
 * file must have extension .xx.flatjs, where x is "js" or "ts".  On
 * output the .flatjs suffix will be stripped.
 *
 *
 * This is source code for TypeScript 1.5 and node.js 0.10 / ECMAScript 5.
 * Tested with tsc 1.5.0-beta and nodejs 0.10.25.
 *
 * To compile:
 *   tsc -t ES5 -m commonjs fjsc.ts
 */

/// <reference path='typings/node/node.d.ts' />

import fs = require("fs");

enum DefnKind {
    Class,
    Struct,
    Primitive
}

class Defn {
    size = 0;
    align = 0;

    constructor(public name:string, public kind:DefnKind) { }

    get elementSize(): number { return this.size; }
    get elementAlign(): number { return this.align; }

    static pointerSize = 4;
    static pointerAlign = 4;
    static pointerTypeName = "int32";
    static pointerMemName = "_mem_int32";
}

enum PrimKind {
    Vanilla,
    Atomic,
    Synchronic,
    SIMD
}

class PrimitiveDefn extends Defn {
    private _memory: string;

    constructor(name:string, size:number, align:number, public primKind:PrimKind=PrimKind.Vanilla) {
	super(name, DefnKind.Primitive);
	this.size = size;
	this.align = align;
	if (primKind == PrimKind.SIMD)
	    this._memory = "_mem_" + name.split("x")[0];
	else
	    this._memory = "_mem_" + name.split("/").pop();
    }

    get memory(): string {
	return this._memory;
    }
}

class AtomicDefn extends PrimitiveDefn {
    constructor(name:string, size:number, align:number) {
	super(name, size, align, PrimKind.Atomic);
    }
}

class SynchronicDefn extends PrimitiveDefn {
    constructor(name:string, size:number, align:number, public baseSize:number) {
	super(name, size, align, PrimKind.Synchronic);
    }

    // The byte offset within the structure for the payload
    static bias = 8;
}

class SIMDDefn extends PrimitiveDefn {
    constructor(name:string, size:number, align:number, public baseSize:number) {
	super(name, size, align, PrimKind.SIMD);
    }
}

class UserDefn extends Defn {
    typeRef: StructDefn = null;
    map: SMap<MapEntry> = null;
    live = false;
    checked = false;

    constructor(public file:string, public line:number, name:string, kind:DefnKind, public props:Prop[],
		public methods:Method[], public origin:number)
    {
	super(name, kind);
    }

    findAccessibleFieldFor(operation:string, prop:string):MapEntry {
	let d = this.map.get(prop);
	if (!d)
	    return null;
	switch (operation) {
	case "get":
	case "set":
	case "ref":
	    return d;
	case "add":
	case "sub":
	case "and":
	case "or":
	case "xor":
	case "compareExchange": {
	    if (d.type.kind != DefnKind.Primitive)
		return null;
	    let prim = <PrimitiveDefn> d.type;
	    // add, sub, and, or, and xor are defined on plain primitives too, for
	    // internal reasons, but that is not documented.
	    //if (prim.primKind != PrimKind.Atomic && prim.primKind != PrimKind.Synchronic)
	    //    return null;
	    return d;
	}
	case "loadWhenEqual":
	case "loadWhenNotEqual":
	case "expectUpdate":
	case "notify": {
	    if (d.type.kind != DefnKind.Primitive)
		return null;
	    let prim = <PrimitiveDefn> d.type;
	    if (prim.primKind != PrimKind.Synchronic)
		return null;
	    return d;
	}
	default:
	    return null;
	}
    }
}

class ClassDefn extends UserDefn {
    baseTypeRef: ClassDefn = null;
    className = "";		// Base1>Base2>name
    classId = 0;
    subclasses: ClassDefn[] = []; // direct proper subclasses
    vtable:Virtual[] = null;

    constructor(file:string, line:number, name:string, public baseName:string, props:Prop[], methods:Method[], origin:number) {
	super(file, line, name, DefnKind.Class, props, methods, origin);
    }

    get elementSize(): number { return Defn.pointerSize; }
    get elementAlign(): number { return Defn.pointerAlign; }

    hasMethod(name:string):boolean {
	for ( let m of this.methods )
	    if (m.name == name)
		return true;
	return false;
    }

    getMethod(name:string):Method {
	for ( let m of this.methods )
	    if (m.name == name)
		return m;
	return null;
    }
}

class Virtual {
    constructor(public name:string, private sign:string[], public reverseCases: SMap<number[]>, public default_:string) {}

    signature():string {
	if (this.sign == null)
	    return ", ...args";
	if (this.sign.length == 0)
	    return "";
	return ", " + this.sign.join(",");
    }
}

class VirtualMethodIterator {
    private i = 0;
    private inherited = false;
    private filter = new SSet();

    constructor(private cls:ClassDefn) {}

    next(): [string,string[],boolean] {
	for (;;) {
	    if (this.i == this.cls.methods.length) {
		if (!this.cls.baseTypeRef)
		    return ["", null, false];
		this.i = 0;
		this.cls = this.cls.baseTypeRef;
		this.inherited = true;
		continue;
	    }
	    let m = this.cls.methods[this.i++];
	    if (m.kind != MethodKind.Virtual)
		continue;
	    if (this.filter.test(m.name))
		continue;
	    this.filter.put(m.name);
	    return [m.name, m.signature, this.inherited];
	}
    }
}

class InclusiveSubclassIterator {
    private stack:(ClassDefn|number|ClassDefn[])[] = [];

    constructor(cls:ClassDefn) {
	this.stack.push(cls);
    }

    next(): ClassDefn {
	if (this.stack.length == 0)
	    return null;
	let top = this.stack.pop();
	if (typeof top == "number") {
	    let x = <number> top;
	    let xs = <ClassDefn[]> this.stack.pop();
	    let cls = xs[x++];
	    if (x < xs.length) {
		this.stack.push(xs);
		this.stack.push(x);
	    }
	    if (cls.subclasses.length > 0) {
		this.stack.push(cls.subclasses);
		this.stack.push(0);
	    }
	    return cls;
	}
	else {
	    let x = <ClassDefn> top;
	    if (x.subclasses.length > 0) {
		this.stack.push(x.subclasses);
		this.stack.push(0);
	    }
	    return x;
	}
    }
}

class StructDefn extends UserDefn {
    hasGetMethod = false;
    hasSetMethod = false;

    constructor(file:string, line:number, name:string, props:Prop[], methods:Method[], origin:number) {
	super(file, line, name, DefnKind.Struct, props, methods, origin);
	for ( let m of methods ) {
	    if (m.kind == MethodKind.Get)
		this.hasGetMethod = true;
	    else if (m.kind == MethodKind.Set)
		this.hasSetMethod = true;
	}
    }
}

enum PropQual {
    None,
    Atomic,
    Synchronic
}

class Prop {
    typeRef: Defn = null;

    constructor(public line:number, public name:string, public qual:PropQual, public isArray:boolean, public typeName:string) {}
}

enum MethodKind {
    Virtual,
    NonVirtual,
    Get,
    Set
}

class Method {
    constructor(public line:number, public kind:MethodKind, public name:string, public signature:string[], public body: string[]) {}
}

class MapEntry {
    constructor(public name:string, public expand:boolean, public offset:number, public type:Defn) {}

    get memory(): string {
	if (this.type.kind != DefnKind.Primitive)
	    throw new InternalError("No memory type available for non-primitive type " + this.type.name);
	return (<PrimitiveDefn> this.type).memory;
    }

    get size(): number {
	return this.type.size;
    }

    toString():string {
	return "(" + this.name + " " + this.expand + " " + this.offset + " " + this.type.name + ")";
    }
}

// Simple map from string to T.  Allows properties to be added and
// updated, but not to be removed.

class SMap<T> {
    private props: {name:string, value:T}[] = [];
    private mapping = {};	// Map from name to index
    private generation = 0;	// Incremented on update (but not on add)

    test(n:string):boolean {
	return typeof this.mapping[n] == "number";
    }

    get(n:string):T {
	let probe = this.mapping[n];
	if (typeof probe == "number")
	    return this.props[probe].value;
	return null;
    }

    put(n:string, v:T):void {
	let probe = this.mapping[n];
	if (typeof probe == "number") {
	    this.props[probe].value = v;
	    this.generation++;
	}
	else {
	    this.mapping[n] = this.props.length;
	    this.props.push({name:n, value:v});
	}
    }

    copy(): SMap<T> {
	let newMap = new SMap<T>();
	newMap.props = this.props.slice(0);
	for ( let n in this.mapping )
	    if (this.mapping.hasOwnProperty(n))
		newMap.mapping[n] = this.mapping[n];
	return newMap;
    }

    values(): { next: () => T } {
	const theMap = this;
	const generation = this.generation;
	const props = this.props;
	let i = 0;
	return { next:
		 function (): T {
		     if (theMap.generation != generation)
			 throw new InternalError("Generator invalidated by assignment");
		     if (i == props.length)
			 return null;
		     return props[i++].value;
		 } };
    }

    keysValues(): { next: () => [string,T] } {
	const theMap = this;
	const generation = this.generation;
	const props = this.props;
	let i = 0;
	return { next:
		 function (): [string,T] {
		     if (theMap.generation != generation)
			 throw new InternalError("Generator invalidated by assignment");
		     if (i == props.length)
			 return [null,null];
		     let x = props[i++];
		     return [x.name,x.value];
		 } };
    }
}

// String set

class SSet {
    private mapping = {};	// Map from name to true

    test(n:string):boolean {
	return typeof this.mapping[n] == "boolean";
    }

    put(n:string):void {
	this.mapping[n] = true;
    }
}

class SourceLine {
    constructor(public file:string, public line:number, public text:string) {}
}

class Source {
    constructor(public input_file:string, public output_file:string, public defs:UserDefn[], public lines:SourceLine[]) {}

    allText(): string {
	return this.lines.map(function (x) { return x.text }).join("\n");
    }
}

function CapturedError(name) { this.name = name; }
CapturedError.prototype = new Error("CapturedError");

function InternalError(msg) { this.message = "Internal error: " + msg; }
InternalError.prototype = new CapturedError("InternalError");

function UsageError(msg) { this.message = "Usage error: " + msg; }
UsageError.prototype = new CapturedError("UsageError");

function ProgramError(file, line, msg) { this.message = file + ":" + line + ": " + msg; };
ProgramError.prototype = new CapturedError("ProgramError");

const allSources:Source[] = [];

function main(args: string[]):void {
    try {
	for ( let input_file of args ) {
	    if (!(/.\.[a-zA-Z0-9]+\.flatjs$/.test(input_file)))
		throw new UsageError("Bad file name (must be .some-extension.flatjs): " + input_file);
	    let text = fs.readFileSync(input_file, "utf8");
	    let lines = text.split("\n");
	    let [defs, residual] = collectDefinitions(input_file, lines);
	    let output_file = input_file.replace(/\.flatjs$/,"");
	    allSources.push(new Source(input_file, output_file, defs, residual));
	}

	buildTypeMap();
	resolveTypeRefs();
	checkRecursion();
	checkMethods();
	layoutTypes();
	createVirtuals();
	expandSelfAccessors();
	pasteupTypes();
	expandGlobalAccessorsAndMacros();

	for ( let s of allSources )
	    fs.writeFileSync(s.output_file, s.allText(), "utf8");
    }
    catch (e) {
	console.log(e.message);
	//console.log(e);
	process.exit(1);
    }
}

const Ws = "\\s+";
const Os = "\\s*";
const Id = "[A-Za-z][A-Za-z0-9]*"; // Note, no underscores are allowed yet
const Lbrace = Os + "\\{";
const Rbrace = Os + "\\}";
const LParen = Os + "\\(";
const CommentOpt = Os + "(?:\\/\\/.*)?";
const QualifierOpt = "(?:\\.(atomic|synchronic))?"
const OpNames = "at|get|setAt|set|ref|add|sub|and|or|xor|compareExchange|loadWhenEqual|loadWhenNotEqual|expectUpdate|notify";
const Operation = "(?:\\.(" + OpNames + "))";
const OperationOpt = Operation + "?";
const OperationLParen = "(?:\\.(" + OpNames + ")" + LParen + ")";
const NullaryOperation = "(?:\\.(ref|notify))";
const Path = "((?:\\." + Id + ")+)";
const PathLazy = "((?:\\." + Id + ")+?)";
const PathOpt = "((?:\\." + Id + ")*)";
const PathOptLazy = "((?:\\." + Id + ")*?)";
const AssignOp = "(=|\\+=|-=|&=|\\|=|\\^=)(?!=)";

const start_re = new RegExp("^" + Os + "@flatjs" + Ws + "(?:struct|class)" + Ws + "(?:" + Id + ")");
const end_re = new RegExp("^" + Rbrace + Os + "@end" + CommentOpt + "$");
const struct_re = new RegExp("^" + Os + "@flatjs" + Ws + "struct" + Ws + "(" + Id + ")" + Lbrace + CommentOpt + "$");
const class_re = new RegExp("^" + Os + "@flatjs" + Ws + "class" + Ws + "(" + Id + ")" + Os + "(?:extends" + Ws + "(" + Id + "))?" + Lbrace + CommentOpt + "$");
const special_re = new RegExp("^" + Os + "@(get|set)" + "(" + LParen + Os + "SELF.*)$");
const method_re = new RegExp("^" + Os + "@(method|virtual)" + Ws + "(" + Id + ")" + "(" + LParen + Os + "SELF.*)$");
const blank_re = new RegExp("^" + Os + CommentOpt + "$");
const space_re = new RegExp("^" + Os + "$");
const prop_re = new RegExp("^" + Os + "(" + Id + ")" + Os + ":" + Os + "(" + Id + ")" + QualifierOpt + "(?:\.(Array))?" + Os + ";?" + CommentOpt + "$");

function collectDefinitions(filename:string, lines:string[]):[UserDefn[], SourceLine[]] {
    let defs:UserDefn[] = [];
    let nlines:SourceLine[] = [];
    let i=0, lim=lines.length;
    while (i < lim) {
	let l = lines[i++];
	if (!start_re.test(l)) {
	    nlines.push(new SourceLine(filename, i, l));
	    continue;
	}

	let kind = "";
	let name = "";
	let inherit = "";
	let lineno = i;
	let m:string[] = null;
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
	    throw new ProgramError(filename, i, "Syntax error: Malformed definition line");

	let properties:Prop[] = [];
	let methods:Method[] = [];
	let in_method = false;
	let mbody:string[] = null;
	let method_type = MethodKind.Virtual;
	let method_name = "";
	let method_line = 0;
	let method_signature:string[] = null;

	// Do not check for duplicate names here since that needs to
	// take into account inheritance.

	while (i < lim) {
	    l = lines[i++];
	    if (end_re.test(l))
		break;
	    if (m = method_re.exec(l)) {
		if (kind != "class")
		    throw new ProgramError(filename, i, "@method is only allowed in classes");
		if (in_method)
		    methods.push(new Method(method_line, method_type, method_name, method_signature, mbody));
		in_method = true;
		method_line = i;
		method_type = (m[1] == "method" ? MethodKind.NonVirtual : MethodKind.Virtual);
		method_name = m[2];
		// Parse the signature.  Just use the param parser for now,
		// but note that what we get back will need postprocessing.
		let pp = new ParamParser(filename, i, m[3], /* skip left paren */ 1);
		let args = pp.allArgs();
		args.shift();	               // Discard SELF
		// Issue #15: In principle there are two signatures here: there is the
		// parameter signature, which we should keep intact in the
		// virtual, and there is the set of arguments extracted from that,
		// including any splat.
		method_signature = args.map(function (x) { return parameterToArgument(filename, i, x) });
		mbody = [m[3]];
	    }
	    else if (m = special_re.exec(l)) {
		if (kind != "struct")
		    throw new ProgramError(filename, i, `@${m[1]} is only allowed in structs`);
		if (in_method)
		    methods.push(new Method(method_line, method_type, method_name, method_signature, mbody));
		method_line = i;
		in_method = true;
		switch (m[1]) {
		case "get": method_type = MethodKind.Get; break;
		case "set": method_type = MethodKind.Set; break;
		}
		method_name = "";
		method_signature = null;
		mbody = [m[2]];
	    }
	    else if (in_method) {
		// TODO: if we're going to be collecting random cruft
		// then blank and comment lines at the end of a method
		// really should be placed at the beginning of the
		// next method.  Also see hack in pasteupTypes() that
		// removes blank lines from the end of a method body.
		mbody.push(l);
	    }
	    else if (m = prop_re.exec(l)) {
		let qual = PropQual.None;
		switch (m[3]) {
		case "synchronic": qual = PropQual.Synchronic; break;
		case "atomic": qual = PropQual.Atomic; break;
		}
		properties.push(new Prop(i, m[1], qual, m[4] == "Array", m[2]));
	    }
	    else if (blank_re.test(l)) {
	    }
	    else
		throw new ProgramError(filename, i, "Syntax error: Not a property or method: " + l);
	}
	if (in_method)
	    methods.push(new Method(method_line, method_type, method_name, method_signature, mbody));

	if (kind == "class")
	    defs.push(new ClassDefn(filename, lineno, name, inherit, properties, methods, nlines.length));
	else
	    defs.push(new StructDefn(filename, lineno, name, properties, methods, nlines.length));
    }
    return [defs, nlines];
}

// The input is Id, Id:Blah, or ...Id.  Strip any :Blah annotations.
function parameterToArgument(file, line, s:string):string {
    if (/^\s*(?:\.\.\.)[A-Za-z_$][A-Za-z0-9_$]*\s*$/.test(s))
	return s;
    let m = /^\s*([A-Za-z_\$][A-Za-z0-9_\$]*)\s*:?/.exec(s);
    if (!m)
	throw new ProgramError(file, line, "Unable to understand argument to virtual function: " + s);
    return m[1];
}


class ParamParser {
    private lim = 0;
    private done = false;

    sawSemi = false;

    constructor(private file:string, private line:number, private input:string, private pos:number,
		private requireRightParen=true, private stopAtSemi=false)
    {
	this.lim = input.length;
    }

    // Returns null on failure to find a next argument
    nextArg():string {
	if (this.done)
	    return null;
	let depth = 0;
	let start = this.pos;
	let sawRightParen = false;
	let sawComma = false;
	let fellOff = false;
	// Issue #8: Really should handle regular expressions, but much harder, and somewhat marginal
      loop:
	for (;;) {
	    if (this.pos == this.lim) {
		this.done = true;
		fellOff = true;
		break loop;
	    }
	    switch (this.input.charAt(this.pos++)) {
	    case '/':
		if (this.pos < this.lim && this.input.charAt(this.pos) == '/') {
		    this.done = true;
		    break loop;
		}
		if (this.pos < this.lim && this.input.charAt(this.pos) == '*') {
		    this.pos++;
		    for (;;) {
			if (this.pos == this.lim)
			    throw new ProgramError(this.file, this.line, "Line ended unexpectedly - still nested within comment.");
			if (this.input.charAt(this.pos++) == '*' && this.pos < this.lim && this.input.charAt(this.pos) == '/')
			    break;
		    }
		}
		break;
	    case ';':
		if (depth == 0 && this.stopAtSemi) {
		    this.done = true;
		    this.sawSemi = true;
		    break loop;
		}
		break;
	    case ',':
		if (depth == 0) {
		    sawComma = true;
		    break loop;
		}
		break;
	    case '(':
	    case '{':
	    case '[':
		depth++;
		break;
	    case '}':
	    case ']':
		depth--;
		break;
	    case ')':
		if (depth == 0) {
		    this.done = true;
		    sawRightParen = true;
		    break loop;
		}
		depth--;
		break;
	    case '\'':
	    case '"': {
		let c = this.input.charAt(this.pos-1);
		for (;;) {
		    if (this.pos == this.lim)
			throw new ProgramError(this.file, this.line, "Line ended unexpectedly - within a string.");
		    let d = this.input.charAt(this.pos++);
		    if (d == c)
			break;
		    if (d == '\\') {
			if (this.pos < this.lim)
			    this.pos++;
		    }
		}
		break;
	    }
	    case '`':
		// Issue #25: Allow template strings
		throw new ProgramError(this.file, this.line, "Avoid template strings in arguments for now");
	    }
	}

	var result = this.cleanupArg(this.input.substring(start, fellOff ? this.pos : this.pos-1));

	// Don't consume it if we don't know if we're going to find it.
	if (sawRightParen && !this.requireRightParen)
	    this.pos--;

	if (this.done && depth > 0)
	    throw new ProgramError(this.file, this.line, "Line ended unexpectedly - still nested within parentheses.");
	if (this.done && this.requireRightParen && !sawRightParen)
	    throw new ProgramError(this.file, this.line, "Line ended unexpectedly - expected ')'.  " + this.input);

	return result;
    }

    allArgs():string[] {
	let as:string[] = [];
	let a:string;
	while (a = this.nextArg())
	    as.push(a);
	return as;
    }

    get where(): number {
	return this.pos;
    }

    cleanupArg(s:string):string {
	s = s.replace(/^\s*|\s*$/g, "");
	if (s == "")
	    return null;
	return s;
    }
}

const knownTypes = new SMap<Defn>();
const knownIds = new SMap<ClassDefn>();
const userTypes:UserDefn[] = [];

function buildTypeMap():void {
    knownTypes.put("int8", new PrimitiveDefn("int8", 1, 1));
    knownTypes.put("uint8", new PrimitiveDefn("uint8", 1, 1));
    knownTypes.put("int16", new PrimitiveDefn("int16", 2, 2));
    knownTypes.put("uint16", new PrimitiveDefn("uint16", 2, 2));
    knownTypes.put("int32", new PrimitiveDefn("int32", 4, 4));
    knownTypes.put("uint32", new PrimitiveDefn("uint32", 4, 4));

    knownTypes.put("atomic/int8", new AtomicDefn("atomic/int8", 1, 1));
    knownTypes.put("atomic/uint8", new AtomicDefn("atomic/uint8", 1, 1));
    knownTypes.put("atomic/int16", new AtomicDefn("atomic/int16", 2, 2));
    knownTypes.put("atomic/uint16", new AtomicDefn("atomic/uint16", 2, 2));
    knownTypes.put("atomic/int32", new AtomicDefn("atomic/int32", 4, 4));
    knownTypes.put("atomic/uint32", new AtomicDefn("atomic/uint32", 4, 4));

    knownTypes.put("synchronic/int8", new SynchronicDefn("synchronic/int8", 12, 4, 1));
    knownTypes.put("synchronic/uint8", new SynchronicDefn("synchronic/uint8", 12, 4, 1));
    knownTypes.put("synchronic/int16", new SynchronicDefn("synchronic/int16", 12, 4, 2));
    knownTypes.put("synchronic/uint16", new SynchronicDefn("synchronic/uint16", 12, 4, 2));
    knownTypes.put("synchronic/int32", new SynchronicDefn("synchronic/int32", 12, 4, 4));
    knownTypes.put("synchronic/uint32", new SynchronicDefn("synchronic/uint32", 12, 4, 4));

    knownTypes.put("float32", new PrimitiveDefn("float32", 4, 4));
    knownTypes.put("float64", new PrimitiveDefn("float64", 8, 8));

    knownTypes.put("int32x4", new SIMDDefn("int32x4", 16, 16, 4));
    knownTypes.put("float32x4", new SIMDDefn("float32x4", 16, 16, 4));
    knownTypes.put("float64x2", new SIMDDefn("float64x2", 16, 16, 8));

    for ( let s of allSources ) {
	for ( let d of s.defs ) {
	    if (knownTypes.test(d.name))
		throw new ProgramError(d.file, d.line, "Duplicate type name: " + d.name);
	    knownTypes.put(d.name, d);
	    userTypes.push(d);
	}
    }
}

// Reference checking:
//  - For each class type, check inheritance, and add a property inheritRef that references the definition
//  - For each property, check that the referenced type exists, and add a property typeRef that references the definition
//  - For each property, check that atomic/synchronic is only used on appropriate types

function resolveTypeRefs():void {
    for ( let d of userTypes ) {
	if (d.kind == DefnKind.Class) {
	    let cls = <ClassDefn> d;
	    if (cls.baseName != "") {
		let probe = knownTypes.get(cls.baseName);
		if (!probe)
		    throw new ProgramError(cls.file, cls.line, "Missing base type: " + cls.baseName);
		if (probe.kind != DefnKind.Class)
		    throw new ProgramError(cls.file, cls.line, "Base type is not class: " + cls.baseName);
		cls.baseTypeRef = <ClassDefn> probe;
		cls.baseTypeRef.subclasses.push(cls);
	    }
	}
	for ( let p of d.props ) {
	    if (!knownTypes.test(p.typeName))
		throw new ProgramError(d.file, p.line, "Undefined type: " + p.typeName);
	    let ty:Defn = null;
	    if (p.qual != PropQual.None) {
		if (p.qual == PropQual.Atomic)
		    ty = knownTypes.get("atomic/" + p.typeName);
		else
		    ty = knownTypes.get("synchronic/" + p.typeName);
		if (!ty)
		    throw new ProgramError(d.file, p.line, ": Not " + (p.qual == PropQual.Atomic ? "an atomic" : "a synchronic") + " type: " + p.typeName);
	    }
	    else
		ty = knownTypes.get(p.typeName);
	    p.typeRef = ty;
	}
    }
}

function checkRecursion():void {
    for ( let d of userTypes ) {
	if (d.kind == DefnKind.Struct)
	    checkRecursionForStruct(<StructDefn> d);
	else if (d.kind == DefnKind.Class)
	    checkRecursionForClass(<ClassDefn> d);
    }

    // For a struct type, check that it does not include itself.
    function checkRecursionForStruct(d:StructDefn):void {
	if (d.checked)
	    return;
	d.live = true;
	for ( let p of d.props ) {
	    if (p.isArray)
		continue;
	    let probe = knownTypes.get(p.typeName);
	    if (!probe || probe.kind != DefnKind.Struct)
		continue;
	    let s = <StructDefn> probe;
	    if (s.live)
		throw new ProgramError(d.file, p.line, "Recursive type reference to struct " + p.typeName + " from " + d.name);
	    p.typeRef = s;
	    checkRecursionForStruct(s);
	}
	d.live = false;
	d.checked = true;
    }

    // For a class type, check that it does not inherit from itself.
    function checkRecursionForClass(d:ClassDefn):void {
	if (d.checked)
	    return;
	d.live = true;
	if (d.baseTypeRef) {
	    if (d.baseTypeRef.live)
		throw new ProgramError(d.file, d.line, "Recursive type reference to base class from " + d.name);
	    checkRecursionForClass(d.baseTypeRef);
	}
	d.live = false;
	d.checked = true;
    }
}

// Ugh, this is wrong for init(), where we want each class to have its
// own.  Really there's no reason to outlaw same-named methods in base
// or subclass, except it's confusing to allow it.

function checkMethods():void {
    for ( let d of userTypes ) {
	if (d.kind != DefnKind.Class)
	    continue;
	let cls = <ClassDefn> d;
	for ( let m of d.methods ) {
	    for ( let b=cls.baseTypeRef ; b ; b=b.baseTypeRef ) {
		let bm = b.getMethod(m.name);
		if (!bm)
		    continue;
		if (m.kind == MethodKind.NonVirtual && bm.kind == MethodKind.Virtual)
		    throw new ProgramError(cls.file, m.line,
					   "Non-virtual method " + m.name + " is defined virtual in a base class " + b.name + " (" + b.file + ":" + b.line + ")");
		if (m.kind == MethodKind.Virtual && bm.kind != MethodKind.Virtual)
		    throw new ProgramError(cls.file, m.line,
					   "Virtual method " + m.name + " is defined non-virtual in a base class " + b.name + " (" + b.file + ":" + b.line + ")");
		if (m.kind == MethodKind.Virtual) {
		    // Issue #34: check arity of methods, requires parsing parameter lists etc.
		}
	    }
	}
    }
}

function layoutTypes():void {
    for ( let d of userTypes ) {
	if (d.kind == DefnKind.Class)
	    layoutClass(<ClassDefn> d);
	else
	    layoutStruct(<StructDefn> d);
    }
}

function layoutClass(d:ClassDefn):void {
    let map = new SMap<MapEntry>();
    let size = 4;
    let align = 4;
    if (d.baseName != "") {
	if (d.baseTypeRef.map == null)
	    layoutClass(d.baseTypeRef);
	map = d.baseTypeRef.map.copy();
	size = d.baseTypeRef.size;
	align = d.baseTypeRef.align;
    }
    layoutDefn(d, map, size, align);
    // layoutDefn updates d.map, d.size, d.align
    d.className = (d.baseTypeRef ? (d.baseTypeRef.className + ">") : "") + d.name;
    d.classId = computeClassId(d.className);
    let idAsString = String(d.classId);
    if (knownIds.test(idAsString))
	throw new ProgramError(d.file, d.line, "Duplicate class ID for " + d.className + ": previous=" + knownIds.get(idAsString).className);
    knownIds.put(idAsString, d);
}

function layoutStruct(d:UserDefn):void {
    layoutDefn(d, new SMap<MapEntry>(), 0, 0);
}

function layoutDefn(d:UserDefn, map:SMap<MapEntry>, size:number, align:number):void {
    for ( let p of d.props ) {
	let k = p.typeRef.kind;
	if (p.isArray)
	    k = DefnKind.Class;
	switch (k) {
	case DefnKind.Primitive: {
	    let pt = <PrimitiveDefn> p.typeRef;
	    size = (size + pt.size - 1) & ~(pt.size - 1);
	    align = Math.max(align, pt.align);
	    map.put(p.name, new MapEntry(p.name, true, size, pt));
	    size += pt.size;
	    break;
	}
	case DefnKind.Class: {
	    // Could also be array, don't look at the contents
	    size = (size + (Defn.pointerAlign - 1)) & ~(Defn.pointerAlign - 1);
	    align = Math.max(align, Defn.pointerAlign);
	    map.put(p.name, new MapEntry(p.name, true, size, knownTypes.get(Defn.pointerTypeName)));
	    size += Defn.pointerSize;
	    break;
	}
	case DefnKind.Struct: {
	    let st = <StructDefn> p.typeRef;
	    if (st.map == null)
		layoutStruct(st);
	    size = (size + st.align - 1) & ~(st.align - 1);
	    align = Math.max(align, st.align);
	    map.put(p.name, new MapEntry(p.name, false, size, st));
	    let root = p.name;
	    let mIter = st.map.values();
	    for ( let fld=mIter.next() ; fld ; fld=mIter.next() ) {
		let fldname = root + "." + fld.name;
		map.put(fldname, new MapEntry(fldname, fld.expand, size + fld.offset, fld.type));
	    }
	    size += st.size;
	    break;
	}
	}
    }
    // Struct size must be rounded up to alignment so that n*SIZE makes a valid array:
    // each array element must be suitably aligned.
    if (d.kind == DefnKind.Struct)
	size = (size + align - 1) & ~(align - 1);
    d.map = map;
    d.size = size;
    d.align = align;
}

// Compute a 28-bit nonnegative hash value for the name.  This needs
// to be *globally* unique (ie across workers).  There's really no
// easy way to guarantee that, but we check uniqueness within each
// program and so long as a type used in both programs is unique
// within both programs we're mostly fine.  The risk is that type A in
// program P1 is misidentified as type B in program P2 because A and B
// have the same class ID and P1 does not include B and P2 does not
// include A.  But that's technically a bug in the programs.

function computeClassId(name:string):number {
    let n = name.length;
    for (let i=0 ; i < name.length ; i++ ) {
	let c = name.charAt(i);
	let v = 0;
	if (c >= 'A' && c <= 'Z')
	    v = c.charCodeAt(0) - 'A'.charCodeAt(0);
	else if (c >= 'a' && c <= 'z')
	    v = c.charCodeAt(0) - 'a'.charCodeAt(0) + 26;
	else if (c >= '0' && c <= '9')
	    v = c.charCodeAt(0) - '0'.charCodeAt(0) + 52;
	else if (c == '_')
	    v = 62;
	else if (c == '>')
	    v = 63;
	else
	    throw new InternalError("Bad character in class name: " + c);
	n = (((n & 0x1FFFFFF) << 3) | (n >>> 25)) ^ v;
    }
    return n;
}

// For each class, create a representation of its vtable

function createVirtuals():void {
    for ( let t of userTypes )
	if (t.kind == DefnKind.Class)
	    createVirtualsFor(<ClassDefn> t);
}

/*
    for ( a given virtual name in me or my parent )
        for ( my subclass ids including me )
   	    create a case that tests that id:
                dispatch to the first impl in the chain starting at that subclass, if any, stopping at me
        create a default
            if the virtual is inherited by me then dispatch to the first impl in the chain starting at my parent
            otherwise throw
*/

function createVirtualsFor(cls: ClassDefn): void {
    let vtable:Virtual[] = [];
    let virts = new VirtualMethodIterator(cls);
    for ( let [mname, sign, isInherited] = virts.next() ; mname != "" ; [mname, sign, isInherited] = virts.next() ) {
	let reverseCases = new SMap<number[]>();
	let subs = new InclusiveSubclassIterator(cls);
	for ( let subcls = subs.next() ; subcls ; subcls = subs.next() ) {
	    let impl = findMethodImplFor(subcls, cls.baseTypeRef, mname);
	    if (!impl)
		continue;
	    if (!reverseCases.test(impl))
		reverseCases.put(impl, []);
	    reverseCases.get(impl).push(subcls.classId);
	}
	let def:string = null;
	if (isInherited && cls.baseTypeRef)
	    def = findMethodImplFor(cls.baseTypeRef, null, mname);
	vtable.push(new Virtual(mname, sign, reverseCases, def));
    }
    cls.vtable = vtable;
}

function findMethodImplFor(cls:ClassDefn, stopAt:ClassDefn, name:string):string {
    if (cls == stopAt)
	return null;
    if (cls.hasMethod(name))
	return cls.name + "." + name + "_impl";
    if (cls.baseTypeRef)
	return findMethodImplFor(cls.baseTypeRef, stopAt, name);
    throw new InternalError("Method not found: " + name);
}


// Issue #17: This will also match bogus things like XSELF, because
// there's no reliable left-context handling.  Need to add
// programmatic guards for that.

const self_getter1_re = new RegExp("SELF" + Path + NullaryOperation, "g");
const self_getter2_re = new RegExp("SELF" + Path, "g");
const self_accessor_re = new RegExp("SELF" + Path + OperationLParen, "g");
const self_setter_re = new RegExp("SELF" + Path + Os + AssignOp + Os, "g");
const self_invoke_re = new RegExp("SELF\\.(" + Id + ")" + LParen, "g");

// Name validity will be checked on the next expansion pass.

function expandSelfAccessors():void {
    for ( var t of userTypes ) { // ES6 required for 'let' here
	for ( let m of t.methods ) {
	    let body = m.body;
	    for ( let k=0 ; k < body.length ; k++ ) {
		body[k] = myExec(t.file, t.line, self_setter_re,
				 function (file:string, line:number, s:string, p:number, m:RegExpExecArray):[string,number] {
				     return replaceSetterShorthand(file, line, s, p, m, t);
				 },
				 body[k]);
		body[k] = body[k].replace(self_accessor_re, function (m, path, operation, p, s) {
		    return t.name + path + "." + operation + "(SELF, ";
		});
		body[k] = body[k].replace(self_invoke_re, function (m, id, p, s) {
		    var pp = new ParamParser(t.file, t.line, s, p+m.length);
		    var args = pp.allArgs();
		    return t.name + "." + id + "(SELF" + (args.length > 0 ? ", " : " ");
		});
		body[k] = body[k].replace(self_getter1_re, function (m, path, operation, p, s) {
		    return t.name + path + "." + operation + "(SELF)";
		});
		body[k] = body[k].replace(self_getter2_re, function (m, path, p, s) {
		    return t.name + path + "(SELF)";
		});
	    }
	}
    }
}

// We've eaten "SELF.id op " and need to grab a plausible RHS.
//
// Various complications here:
//
//   nested fields: SELF.x_y_z += 10
//   stacked:  SELF.x = SELF.y = SELF.z = 0
//   used for value:  v = (SELF.x = 10)
//
// Easiest fix is to change the spec so that a setter returns a value,
// which is the rhs.  The regular assignment and Atomics.store
// already does that.  I just changed _synchronicsStore so that it
// does that too.  BUT SIMD STORE INSTRUCTIONS DO NOT.  Good grief.
//
// For now, disallow stacking of simd values (but don't detect it).

const AssignmentOps =
    { "=": "set",
      "+=": "add",
      "-=": "sub",
      "&=": "and",
      "|=": "or",
      "^=": "xor"
    };

function replaceSetterShorthand(file:string, line:number, s:string, p:number, ms:RegExpExecArray, t:UserDefn):[string,number] {
    //return [s, p+m.length];
    let m = ms[0];
    let path = ms[1];
    let operation = ms[2];
    let left = s.substring(0,p);
    let pp = new ParamParser(file, line, s, p+m.length, false, true);
    let rhs = pp.nextArg();
    if (!rhs)
        throw new ProgramError(file, line, "Missing right-hand-side expression in assignment");
    // Be sure to re-expand the RHS.
    let substitution_left = `${left} ${t.name}${path}.${AssignmentOps[operation]}(SELF, `;
    return [`${substitution_left} ${rhs})${pp.sawSemi ? ';' : ''} ${s.substring(pp.where)}`,
	    substitution_left.length];
}

function linePusher(info:() => [string,number], nlines:SourceLine[]): (string) => void {
    return function (text:string):void {
	let [file,line] = info();
	nlines.push(new SourceLine(file, line, text));
    }
}

function pasteupTypes():void {
    var emitFn = "";		// ES5 workaround - would otherwise be local to inner "for" loop
    var emitLine = 0;		// ditto
    for ( let source of allSources ) {
	let defs = source.defs;
	let lines = source.lines;
	let nlines: SourceLine[] = [];
	let k = 0;
	for ( let d of defs ) {
	    while (k < d.origin && k < lines.length)
		nlines.push(lines[k++]);

	    let push = linePusher(function ():[string,number] { return [emitFn, emitLine++] }, nlines);

	    emitFn = d.file + "[class definition]";
	    emitLine = d.line;
	    if (d.kind == DefnKind.Class)
		push("function " + d.name + "(p) { this._pointer = (p|0); }");
	    else
		push("function " + d.name + "() {}");
	    if (d.kind == DefnKind.Class) {
		let cls = <ClassDefn> d;
		if (cls.baseName)
		    push(d.name + ".prototype = new " + cls.baseName + ";");
		else
		    push("Object.defineProperty(" + d.name + ".prototype, 'pointer', { get: function () { return this._pointer } });");
	    }
	    push(d.name + ".NAME = \"" + d.name + "\";");
	    push(d.name + ".SIZE = " + d.size + ";");
	    push(d.name + ".ALIGN = " + d.align + ";");
	    if (d.kind == DefnKind.Class) {
		let cls = <ClassDefn> d;
		push(d.name + ".CLSID = " + cls.classId + ";");
		push("Object.defineProperty(" + d.name + ", 'BASE', {get: function () { return " + (cls.baseName ? cls.baseName : "null") + "; }});");
	    }

	    // Now do methods.
	    //
	    // Implementation methods are emitted directly in the defining type, with a name suffix _impl.
	    // For struct methods, the name is "_get_impl", "_set_impl", or "_copy_impl".

	    let haveSetter = false;
	    let haveGetter = false;
	    for ( let m of d.methods ) {
		let name = m.name;
		if (name == "") {
		    switch (m.kind) {
		    case MethodKind.Get:
			if (haveGetter)
			    throw new ProgramError(d.file, m.line, "Duplicate struct getter");
			name = "_get_impl";
			haveGetter = true;
			break;
		    case MethodKind.Set:
			if (haveSetter)
			    throw new ProgramError(d.file, m.line, "Duplicate struct setter");
			name = "_set_impl";
			haveSetter = true;
			break;
		    }
		}
		else if (m.kind == MethodKind.NonVirtual)
		    ;
		else
		    name += "_impl";
		emitFn = d.file + "[method " + name + "]";
		emitLine = m.line;
		let body = m.body;
		// Formatting: useful to strip all trailing blank lines from
		// the body first.
		let last = body.length-1;
		while (last > 0 && /^\s*$/.test(body[last]))
		    last--;
		if (last == 0)
		    push(d.name + "." + name + " = function " + body[0]);
		else {
		    push(d.name + "." + name + " = function " + body[0]);
		    for ( let x=1; x < last ; x++ )
			push(body[x]);
		    push(body[last]);
		}
	    }

	    // Now default methods, if appropriate.

	    if (d.kind == DefnKind.Struct) {
		var struct = <StructDefn> d;
		if (!haveGetter) {
		    push(d.name + "._get_impl = function (SELF) {");
		    push("  var v = new " + d.name + ";");
		    // Use longhand for access, since self accessors are expanded before pasteup.
		    // TODO: Would be useful to fix that.
		    for ( var p of d.props )
			push("  v." + p.name + " = " + d.name + "." + p.name + "(SELF);");
		    push("  return v;");
		    push("}");
		    struct.hasGetMethod = true;
		}

		if (!haveSetter) {
		    push(d.name + "._set_impl = function (SELF, v) {");
		    // TODO: as above.
		    for ( var p of d.props )
			push("  " + d.name + "." + p.name + ".set(SELF, v." + p.name + ");");
		    push("}");
		    struct.hasSetMethod = true;
		}
	    }

	    // Now do vtable, if appropriate.

	    if (d.kind == DefnKind.Class) {
		let cls = <ClassDefn> d;
		for ( let virtual of cls.vtable ) {
		    // Shouldn't matter much
		    emitFn = d.file + "[vtable " + virtual.name + "]";
		    emitLine = d.line;
		    let signature = virtual.signature();
		    push(d.name + "." + virtual.name + " = function (SELF " + signature + ") {");
		    push("  switch (_mem_int32[SELF>>2]) {");
		    let kv = virtual.reverseCases.keysValues();
		    for ( let [name,cases]=kv.next() ; name ; [name,cases]=kv.next() ) {
			for ( let c of cases )
			    push(`    case ${c}:`);
			push(`      return ${name}(SELF ${signature});`);
		    }
		    push("    default:");
		    push("      " + (virtual.default_ ?
				     `return ${virtual.default_}(SELF ${signature})` :
				     "throw FlatJS._badType(SELF)") + ";");
		    push("  }");
		    push("}");
		}
	    }

	    // Now do other methods: initInstance.

	    if (d.kind == DefnKind.Class) {
		let cls = <ClassDefn> d;
		push(d.name + ".initInstance = function(SELF) { _mem_int32[SELF>>2]=" + cls.classId + "; return SELF; }");
	    }

	    if (d.kind == DefnKind.Class)
		push("FlatJS._idToType[" + (<ClassDefn> d).classId + "] = " + d.name + ";");
	}
	while (k < lines.length)
	    nlines.push(lines[k++]);
	source.lines = nlines;
    }
}

function expandGlobalAccessorsAndMacros():void {
    for ( let source of allSources ) {
	let lines = source.lines;
	let nlines: SourceLine[] = [];
	for ( let l of lines )
	    nlines.push(new SourceLine(l.file, l.line, expandMacrosIn(l.file, l.line, l.text)));
	source.lines = nlines;
    }
}

// TODO: it's likely that the expandMacrosIn is really better
// represented as a class, with a ton of methods and locals (eg for
// file and line), performing expansion on one line.

const new_re = new RegExp("@new\\s+(" + Id + ")" + QualifierOpt + "(?:\\.(Array)" + LParen + ")?", "g");

const acc_re = new RegExp("(" + Id + ")" + PathOptLazy + "(?:" + Operation + "|)" + LParen, "g");

// It would sure be nice to avoid the explicit ".Array" here, but I don't yet know how.
const arr_re = new RegExp("(" + Id + ")" + QualifierOpt + "\\.Array" + PathOpt + Operation + LParen, "g");

function expandMacrosIn(file:string, line:number, text:string):string {
    return myExec(file, line, new_re, newMacro,
		  myExec(file, line, arr_re, arrMacro,
			 myExec(file, line, acc_re, accMacro, text)));
}

function myExec(file:string, line:number, re:RegExp, macro:(fn:string, l:number, s:string, p:number, m:RegExpExecArray)=>[string,number], text:string):string {
    let old = re.lastIndex;
    re.lastIndex = 0;

    for (;;) {
	let m = re.exec(text);
	if (!m)
	    break;
	// The trick here is that we may replace more than the match:
	// the macro may eat additional input.  So the macro should
	// be returning a new string, as well as the index at which
	// to continue the search.
	let [newText, newStart] = macro(file, line, text, re.lastIndex-m[0].length, m);
	text = newText;
	re.lastIndex = newStart;
    }

    re.lastIndex = old;
    return text;
}

// Here, arity includes the self argument

const OpAttr = {
    "get": { arity: 1, atomic: "load", synchronic: "" },
    "ref": { arity: 1, atomic: "", synchronic: "" },
    "notify": { arity: 1, atomic: "", synchronic: "_synchronicNotify" },
    "set": { arity: 2, atomic: "store", synchronic: "_synchronicStore", vanilla: "=" },
    "add": { arity: 2, atomic: "add", synchronic: "_synchronicAdd", vanilla: "+=" },
    "sub": { arity: 2, atomic: "sub", synchronic: "_synchronicSub", vanilla: "-=" },
    "and": { arity: 2, atomic: "and", synchronic: "_synchronicAnd", vanilla: "&=" },
    "or": { arity: 2, atomic: "or", synchronic: "_synchronicOr", vanilla: "|=" },
    "xor": { arity: 2, atomic: "xor", synchronic: "_synchronicXor", vanilla: "^=" },
    "loadWhenEqual": { arity: 2, atomic: "", synchronic: "_synchronicLoadWhenEqual" },
    "loadWhenNotEqual": { arity: 2, atomic: "", synchronic: "_synchronicLoadWhenNotEqual" },
    "expectUpdate": { arity: 3, atomic: "", synchronic: "_synchronicExpectUpdate" },
    "compareExchange": { arity: 3, atomic: "compareExchange", synchronic: "_synchronicCompareExchange" },
};

//    "at": { arity: 1, atomic: "", synchronic: "" }

function accMacro(file:string, line:number, s:string, p:number, ms:RegExpExecArray):[string,number] {
    let m = ms[0];
    let className = ms[1];
    let propName = "";
    let operation = "";

    let nomatch:[string,number] = [s, p+m.length];
    let left = s.substring(0,p);

    if (!ms[2] && !ms[3])
	return nomatch;		// We're looking at something else

    propName = ms[2] ? ms[2].substring(1) : ""; // Strip the leading "."
    operation = ms[3] ? ms[3] : "get";

    let ty = knownTypes.get(className);
    if (!ty)
	return nomatch;

    let offset = 0;
    let targetType: Defn = null;

    if (propName == "") {
	if (!(ty.kind == DefnKind.Primitive || ty.kind == DefnKind.Struct))
	    throw new ProgramError(file, line, "Operation '" + operation + "' without a path requires a value type: " + s);
	offset = 0;
	targetType = ty;
    }
    else {
	if (!(ty.kind == DefnKind.Class || ty.kind == DefnKind.Struct)) {
	    //throw new ProgramError(file, line, "Operation with a path requires a structured type: " + s);
	    return nomatch;
	}

	let cls = <UserDefn> ty;
	// findAccessibleFieldFor will vet the operation against the field type,
	// so atomic/synchronic ops will only be allowed on appropriate types

	let fld = cls.findAccessibleFieldFor(operation, propName);
	if (!fld) {
	    let fld2 = cls.findAccessibleFieldFor("get", propName);
	    if (fld2)
		warning(file, line, "No match for " + className + "  " + operation + "  " + propName);
	    return nomatch;
	}
	offset = fld.offset;
	targetType = fld.type;
    }

    let pp = new ParamParser(file, line, s, p+m.length);
    let as = (pp).allArgs();
    if (OpAttr[operation].arity != as.length) {
	warning(file, line, `Bad accessor arity ${propName} / ${as.length}: ` + s);
	return nomatch;
    };

    // Issue #16: Watch it: Parens interact with semicolon insertion.
    let ref = `(${expandMacrosIn(file, line, endstrip(as[0]))} + ${offset})`;
    if (operation == "ref") {
	return [left + ref + s.substring(pp.where),
		left.length + ref.length];
    }

    return loadFromRef(file, line, ref, targetType, s, left, operation, pp, as[1], as[2], nomatch);
}

function loadFromRef(file:string, line:number,
		     ref:string, type:Defn, s:string, left:string, operation:string, pp:ParamParser,
		     rhs:string, rhs2:string, nomatch:[string,number]):[string,number]
{
    let mem="", size=0, synchronic=false, atomic=false, simd=false, shift=-1, simdType="";
    if (type.kind == DefnKind.Primitive) {
	let prim = <PrimitiveDefn> type;
	mem = prim.memory;
	synchronic = prim.primKind == PrimKind.Synchronic;
	atomic = prim.primKind == PrimKind.Atomic;
	simd = prim.primKind == PrimKind.SIMD;
	if (synchronic)
	    shift = log2((<SynchronicDefn> prim).baseSize);
	else if (simd)
	    shift = log2((<SIMDDefn> prim).baseSize);
	else
	    shift = log2(prim.size);
	if (simd)
	    simdType = prim.name;
    }
    else if (type.kind == DefnKind.Class) {
	mem = Defn.pointerMemName;
	shift = log2(Defn.pointerSize);
    }
    if (shift >= 0) {
	let expr = "";
	let op = "";
	switch (OpAttr[operation].arity) {
	case 1:
	    break;
	case 2:
	    rhs = expandMacrosIn(file, line, endstrip(rhs));
	    break;
	case 3:
	    rhs = expandMacrosIn(file, line, endstrip(rhs));
	    rhs2 = expandMacrosIn(file, line, endstrip(rhs2));
	    break;
	default:
	    throw new InternalError("No operator: " + operation + " " + s);
	}
	let fieldIndex = "";
	if (synchronic)
	    fieldIndex = `(${ref} + ${SynchronicDefn.bias}) >> ${shift}`;
	else
	    fieldIndex = `${ref} >> ${shift}`;
	switch (operation) {
	case "get":
	    if (atomic || synchronic)
		expr = `Atomics.load(${mem}, ${fieldIndex})`;
	    else if (simd)
		expr = `SIMD.${simdType}.load(${mem}, ${fieldIndex})`;
	    else
		expr = `${mem}[${fieldIndex}]`;
	    break;
	case "notify":
	    expr = `FlatJS.${OpAttr[operation].synchronic}(${ref})`;
	    break;
	case "set":
	case "add":
	case "sub":
	case "and":
	case "or":
	case "xor":
	case "loadWhenEqual":
	case "loadWhenNotEqual":
	    if (atomic)
		expr = `Atomics.${OpAttr[operation].atomic}(${mem}, ${fieldIndex}, ${rhs})`;
	    else if (synchronic)
		expr = `FlatJS.${OpAttr[operation].synchronic}(${ref}, ${mem}, ${fieldIndex}, ${rhs})`;
	    else if (simd)
		expr = `SIMD.${simdType}.store(${mem}, ${fieldIndex}, ${rhs})`;
	    else
		expr = `${mem}[${ref} >> ${shift}] ${OpAttr[operation].vanilla} ${rhs}`;
	    break;
	case "compareExchange":
	case "expectUpdate":
	    if (atomic)
		expr = `Atomics.${OpAttr[operation].atomic}(${mem}, ${fieldIndex}, ${rhs}, ${rhs2})`;
	    else
		expr = `FlatJS.${OpAttr[operation].synchronic}(${ref}, ${mem}, ${fieldIndex}, ${rhs}, ${rhs2})`;
	    break;
	default:
	    throw new InternalError("No operator: " + operation + " line: " + s);
	}
	// Issue #16: Parens interact with semicolon insertion.
	//expr = `(${expr})`;
	return [left + expr + s.substring(pp.where), left.length + expr.length];
    }
    else {
	let t = <StructDefn> type;
	let expr = "";
	// Field type is a structure.  If the structure type has a getter then getting is allowed
	// and should be rewritten as a call to the getter, passing the field reference.
	// Ditto setter, which will also pass secondArg.
	switch (operation) {
	case "get":
	    if (t.hasGetMethod)
		expr = `${t.name}._get_impl(${ref})`;
	    break;
	case "set":
	    if (t.hasSetMethod)
		expr = `${t.name}._set_impl(${ref}, ${expandMacrosIn(file, line, endstrip(rhs))})`;
	    break;
	case "ref":
	    expr = ref;
	    break;
	}
	if (expr == "") {
	    warning(file, line, "No operation " + operation + " allowed");
	    return nomatch;
	}
	// Issue #16: Parens interact with semicolon insertion.
	//expr = `(${expr})`;
	return [left + expr + s.substring(pp.where), left.length + expr.length];
    }
}

function arrMacro(file:string, line:number, s:string, p:number, ms:RegExpExecArray):[string,number] {
    let m=ms[0];
    let typeName=ms[1];
    let qualifier=ms[2];
    let field=ms[3] ? ms[3].substring(1) : "";
    let operation=ms[4];
    let nomatch:[string,number] = [s,p+m.length];

    if (operation == "get" || operation == "set")
	throw new ProgramError(file, line, "Use 'at' and 'setAt' on Arrays");
    if (operation == "at")
	operation = "get";
    if (operation == "setAt")
	operation = "set";

    let type = findType(typeName);
    if (!type)
	return nomatch;

    let pp = new ParamParser(file, line, s, p+m.length);
    let as = (pp).allArgs();

    if (as.length != OpAttr[operation].arity+1) {
	warning(file, line, `Wrong arity for accessor ${operation} / ${as.length}`);
	return nomatch;
    };

    let multiplier = type.elementSize;
    if (type.kind == DefnKind.Primitive) {
	if (field)
	    return nomatch;
    }
    else if (type.kind == DefnKind.Class) {
	if (field)
	    return nomatch;
    }
    let ref = "(" + expandMacrosIn(file, line, endstrip(as[0])) + "+" + multiplier + "*" + expandMacrosIn(file, line, endstrip(as[1])) + ")";
    if (field) {
	let fld = (<StructDefn> type).findAccessibleFieldFor(operation, field);
	if (!fld)
	    return nomatch;
	// Issue #16: Watch it: Parens interact with semicolon insertion.
	ref = "(" + ref + "+" + fld.offset + ")";
	type = fld.type;
    }
    if (operation == "ref") {
	let left = s.substring(0,p);
	return [left + ref + s.substring(pp.where),
		left.length + ref.length];
    }

    return loadFromRef(file, line, ref, type, s, s.substring(0,p), operation, pp, as[2], as[3], nomatch);
}

// Since @new is new syntax, we throw errors for all misuse.

function newMacro(file, line, s:string, p:number, ms:RegExpExecArray):[string,number] {
    let m=ms[0];
    let baseType=ms[1];
    let qualifier=ms[2];
    let isArray=ms[3] == "Array";
    let left = s.substring(0,p);

    // Issue #27 - implement this.
    if (qualifier)
	throw new InternalError("Qualifiers on array @new not yet implemented");

    let t = knownTypes.get(baseType);
    if (!t)
	throw new ProgramError(file, line, "Unknown type argument to @new: " + baseType);

    if (!isArray) {
	let expr = "FlatJS.allocOrThrow(" + t.size + "," + t.align + ")";
	if (t.kind == DefnKind.Class) {
	    // NOTE, parens removed here
	    // Issue #16: Watch it: Parens interact with semicolon insertion.
	    expr = baseType + ".initInstance(" + expr + ")";
	}
	return [left + expr + s.substring(p + m.length),
		left.length + expr.length ];
    }

    let pp = new ParamParser(file, line, s, p+m.length);
    let as = pp.allArgs();
    if (as.length != 1)
	throw new ProgramError(file, line, "Wrong number of arguments to @new " + baseType + ".Array");

    // NOTE, parens removed here
    // Issue #16: Watch it: Parens interact with semicolon insertion.
    let expr = "FlatJS.allocOrThrow(" + t.elementSize + " * " + expandMacrosIn(file, line, endstrip(as[0])) + ", " + t.elementAlign + ")";
    return [left + expr + s.substring(pp.where),
	    left.length + expr.length];
}

function findType(name:string):Defn {
    if (!knownTypes.test(name))
	throw new InternalError("Unknown type in sizeofType: " + name);
    return knownTypes.get(name);
}

// This can also check if x is already properly parenthesized, though that
// involves counting parens, at least trivially (and then does it matter?).
// Consider (a).(b), which should be parenthesized as ((a).(b)).
//
// Issue #16: Parentheses are not actually reliable.

function endstrip(x:string):string {
    if (/^[a-zA-Z0-9]+$/.test(x))
	return x;
    return "(" + x + ")";
}

function log2(x:number):number {
    if (x <= 0)
	throw new InternalError("log2: " + x);
    let i = 0;
    while (x > 1) {
	i++;
	x >>= 1;
    }
    return i;
}

function warning(file:string, line:number, msg:string):void {
    console.log(file + ":" + line + ": Warning: " + msg);
}

main(process.argv.slice(2));
