/* -*- mode: javascript -*- */
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
}

class PrimitiveDefn extends Defn {
    private _memory: string;

    constructor(name:string, size:number, align:number, public atomic:boolean=false, public synchronic:boolean=false) {
	super(name, DefnKind.Primitive);
	this.size = size;
	this.align = align;
	this._memory = "_mem_" + name.split("/").pop();
    }

    get memory(): string {
	return this._memory;
    }
}

class AtomicDefn extends PrimitiveDefn {
    constructor(name:string, size:number, align:number) {
	super(name, size, align, true, false);
    }
}

class SynchronicDefn extends PrimitiveDefn {
    constructor(name:string, size:number, align:number, public baseSize:number) {
	super(name, size, align, false, true);
    }

    // The byte offset within the structure for the payload
    static bias = 8;
}

class UserDefn extends Defn {
    typeRef: StructDefn = null;
    map: SMap<MapEntry> = null;
    live = false;
    checked = false;

    constructor(public file:string, public line:number, name:string, kind:DefnKind, public props:Prop[], public methods:Method[], public origin:number)  {
	super(name, kind);
    }

    findAccessibleFieldFor(operation:string, prop:string):MapEntry {
	let d = this.map.get(prop);
	if (!d)
	    return null;
	switch (operation) {
	case "get_":
	case "set_":
	case "ref_":
	    return d;
	case "add_":
	case "sub_":
	case "and_":
	case "or_":
	case "xor_":
	case "compareExchange_": {
	    if (d.type.kind != DefnKind.Primitive)
		return null;
	    let prim = <PrimitiveDefn> d.type;
	    if (!(prim.atomic || prim.synchronic))
		return null;
	    return d;
	}
	case "loadWhenEqual_":
	case "loadWhenNotEqual_":
	case "expectUpdate_":
	case "notify_": {
	    if (d.type.kind != DefnKind.Primitive)
		return null;
	    let prim = <PrimitiveDefn> d.type;
	    if (!prim.synchronic)
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

    hasMethod(name:string):boolean {
	for ( let m of this.methods )
	    if (m.name == name)
		return true;
	return false;
    }
}

class Virtual {
    constructor(public name:string, public reverseCases: SMap<number[]>, public default_:string) {}
}

class VirtualMethodNameIterator {
    private i = 0;
    private inherited = false;
    private filter = new SSet();

    constructor(private cls:ClassDefn) {}

    next(): [string,boolean] {
	for (;;) {
	    if (this.i == this.cls.methods.length) {
		if (!this.cls.baseTypeRef)
		    return ["", false];
		this.i = 0;
		this.cls = this.cls.baseTypeRef;
		this.inherited = true;
		continue;
	    }
	    let m = this.cls.methods[this.i++];
	    if (m.kind != MethodKind.Virtual) // In the future, we may have non-virtuals
		continue;
	    if (m.name == "init") // Not virtual
		continue;
	    if (this.filter.test(m.name))
		continue;
	    this.filter.put(m.name);
	    return [m.name, this.inherited];
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
    Get,
    Set
}

class Method {
    constructor(public line:number, public kind:MethodKind, public name:string, public body: string[]) {}
}

class MapEntry {
    constructor(public name:string, public expand:boolean, public offset:number, public type:Defn) {}

    get memory(): string {
	if (this.type.kind != DefnKind.Primitive)
	    throw new Error("No memory type available for non-primitive type " + this.type.name);
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
			 throw new Error("Generator invalidated by assignment");
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
			 throw new Error("Generator invalidated by assignment");
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

class Source {
    constructor(public input_file:string, public output_file:string, public defs:UserDefn[], public lines:string[]) {}
}

const allSources:Source[] = [];

function main(args: string[]):void {
    for ( let input_file of args ) {
	if (input_file.length < 10 ||
	    (input_file.slice(-10) != ".js.flatjs" && input_file.slice(-10) != ".ts.flatjs"))
	    throw new Error("Bad file name (must be .js.flatjs or .ts.flatjs): " + input_file);
	let text = fs.readFileSync(input_file, "utf8");
	let lines = text.split("\n");
	let [defs, residual] = collectDefinitions(input_file, lines);
	let output_file = input_file.replace(/\.flatjs$/,"");
	allSources.push(new Source(input_file, output_file, defs, residual));
    }

    buildTypeMap();
    resolveTypeRefs();
    checkRecursion();
    layoutTypes();
    createVirtuals();
    expandSelfAccessors();
    pasteupTypes();
    expandGlobalAccessorsAndMacros();

    for ( let s of allSources )
	fs.writeFileSync(s.output_file, s.lines.join("\n"), "utf8");
}

const Ws = "\\s+";
const Os = "\\s*";
const Id = "[A-Za-z][A-Za-z0-9]*"; // Note, no underscores are allowed
const Lbrace = Os + "\\{";
const Rbrace = Os + "\\}";
const Comment = Os + "(?:\\/\\/.*)?";

const start_re = new RegExp("^" + Os + "@flatjs" + Ws + "(?:struct|class)" + Ws + "(?:" + Id + ")");
const end_re = new RegExp("^" + Rbrace + Os + "@end" + Comment + "$");
const struct_re = new RegExp("^" + Os + "@flatjs" + Ws + "struct" + Ws + "(" + Id + ")" + Lbrace + Comment + "$");
const class_re = new RegExp("^" + Os + "@flatjs" + Ws + "class" + Ws + "(" + Id + ")" + Os + "(?:extends" + Ws + "(" + Id + "))?" + Lbrace + Comment + "$");
const special_re = new RegExp("^" + Os + "@(get|set|copy)" + Os + "(\\(" + Os + "SELF.*)$");
const method_re = new RegExp("^" + Os + "@method" + Ws + "(" + Id + ")" + Os + "(\\(" + Os + "SELF.*)$");
const blank_re = new RegExp("^" + Os + Comment + "$");
const space_re = new RegExp("^" + Os + "$");
const prop_re = new RegExp("^" + Os + "(" + Id + ")" + Os + ":" + Os + "(?:(atomic|synchronic)" + Ws + ")?(" + Id + ")" + Os + ";?" + Comment + "$");
const aprop_re = new RegExp("^" + Os + "(" + Id + ")" + Os + ":" + Os + "array" + Os + "\\(" + Os + "(" + Id + ")" + Os + "\\)" + Os + ";?" + Comment + "$");

function collectDefinitions(filename:string, lines:string[]):[UserDefn[], string[]] {
    let defs:UserDefn[] = [];
    let nlines:string[] = [];
    let i=0, lim=lines.length;
    while (i < lim) {
	let l = lines[i++];
	if (!start_re.test(l)) {
	    nlines.push(l);
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
	    throw new Error(filename + ":" + i + ": Syntax error: Malformed definition line");

	let properties:Prop[] = [];
	let methods:Method[] = [];
	let in_method = false;
	let mbody:string[] = null;
	let method_type = MethodKind.Virtual;
	let method_name = "";

	// Do not check for duplicate names here since that needs to
	// take into account inheritance.

	while (i < lim) {
	    l = lines[i++];
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
		}
		method_name = "";
		mbody = [m[2]];
	    }
	    else if (m = prop_re.exec(l)) {
		let qual = PropQual.None;
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
		// TODO: if we're going to be collecting random cruft
		// then blank and comment lines at the end of a method
		// really should be placed at the beginning of the
		// next method.  Also see hack in pasteupTypes() that
		// removes blank lines from the end of a method body.
		mbody.push(l);
	    }
	    else if (blank_re.test(l)) {
	    }
	    else
		throw new Error(filename + ":" + i + ": Syntax error: Not a property or method: " + l);
	}
	if (in_method)
	    methods.push(new Method(i, method_type, method_name, mbody));

	if (kind == "class")
	    defs.push(new ClassDefn(filename, lineno, name, inherit, properties, methods, nlines.length));
	else
	    defs.push(new StructDefn(filename, lineno, name, properties, methods, nlines.length));
    }
    return [defs, nlines];
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

    for ( let s of allSources ) {
	for ( let d of s.defs ) {
	    if (knownTypes.test(d.name))
		throw new Error(d.file + ":" + d.line + ": Duplicate type name: " + d.name);
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
		    throw new Error(cls.file + ":" + cls.line + ": Missing base type: " + cls.baseName);
		if (probe.kind != DefnKind.Class)
		    throw new Error(cls.file + ":" + cls.line + ": Base type is not class: " + cls.baseName);
		cls.baseTypeRef = <ClassDefn> probe;
		cls.baseTypeRef.subclasses.push(cls);
	    }
	}
	for ( let p of d.props ) {
	    if (!knownTypes.test(p.typeName))
		throw new Error(d.file + ":" + p.line + ": Undefined type: " + p.typeName);
	    let ty:Defn = null;
	    if (p.qual != PropQual.None) {
		if (p.qual == PropQual.Atomic)
		    ty = knownTypes.get("atomic/" + p.typeName);
		else
		    ty = knownTypes.get("synchronic/" + p.typeName);
		if (!ty)
		    throw new Error(d.file + ":" + p.line + ": Not " + (p.qual == PropQual.Atomic ? "an atomic" : "a synchronic") + " type: " + p.typeName);
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
		throw new Error("Recursive type reference to struct " + p.typeName + " from " + d.name); // TODO: file/line
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
		throw new Error("Recursive type reference to base class from " + d.name); // TODO: file/line
	    checkRecursionForClass(d.baseTypeRef);
	}
	d.live = false;
	d.checked = true;
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
	throw new Error("Duplicate class ID for " + d.className + ": previous=" + knownIds.get(idAsString).className);
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
	    size = (size + 3) & ~3;
	    align = Math.max(align, 4);
	    map.put(p.name, new MapEntry(p.name, true, size, knownTypes.get("int32")));
	    size += 4;
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
		let fldname = root + "_" + fld.name;
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
	    throw new Error("Internal error: Bad character in class name: " + c);
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
    let mnames = new VirtualMethodNameIterator(cls);
    for ( let [mname, isInherited] = mnames.next() ; mname != "" ; [mname, isInherited] = mnames.next() ) {
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
	vtable.push(new Virtual(mname, reverseCases, def));
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
    throw new Error("Internal error: Method not found: " + name);
}


// TODO: This will also match bogus things like XSELF. because there's
// no lookbehind.

const self_getter_re = /SELF\.(?:ref_|notify_)?[a-zA-Z0-9_]+/g;
const self_accessor_re = /SELF\.(?:set_|add_|sub_|or_|compareExchange_|loadWhenEqual_|loadWhenNotEqual_|expectUpdate_)[a-zA-Z0-9_]+\s*\(/g;

// TODO: really should check validity of the name here, not hard to do.
// Can fall back on that happening on the next pass probably.

function expandSelfAccessors():void {
    for ( var t of userTypes ) { // ES6 required for 'let' here
	for ( let m of t.methods ) {
	    let body = m.body;
	    for ( let k=0 ; k < body.length ; k++ ) {
		body[k] = body[k].replace(self_accessor_re, function (m, p, s) {
		    return t.name + "." + m.substring(5) + "SELF, ";
		});
		body[k] = body[k].replace(self_getter_re, function (m, p, s) {
		    return t.name + "." + m.substring(5) + "(SELF)";
		});
	    }
	}
    }
}

function pasteupTypes():void {
    for ( let source of allSources ) {
	let defs = source.defs;
	let lines = source.lines;
	let nlines: string[] = [];
	let k = 0;
	for ( let d of defs ) {
	    while (k < d.origin && k < lines.length)
		nlines.push(lines[k++]);
	    nlines.push("const " + d.name + " = {");
	    nlines.push("  NAME: \"" + d.name + "\",");
	    nlines.push("  SIZE: " + d.size + ",");
	    nlines.push("  ALIGN: " + d.align + ",");
	    if (d.kind == DefnKind.Class) {
		let cls = <ClassDefn> d;
		nlines.push("  CLSID: " + cls.classId + ",");
		nlines.push("  get BASE() { return " + (cls.baseName ? cls.baseName : "null") + "; },");
	    }

	    // Now do methods.
	    //
	    // Implementation methods are emitted directly in the defining type, with a name suffix _impl.
	    // For struct methods, the name is "_get_impl", "_set_impl", or "_copy_impl".

	    for ( let m of d.methods ) {
		let name = m.name;
		if (name == "") {
		    switch (m.kind) {
		    case MethodKind.Get: name = "_get_impl"; break;
		    case MethodKind.Set: name = "_set_impl"; break;
		    }
		}
		else if (name == "init")
		    ;
		else
		    name += "_impl";
		let body = m.body;
		// Formatting: useful to strip all trailing blank lines from
		// the body first.
		let last = body.length-1;
		while (last > 0 && /^\s*$/.test(body[last]))
		    last--;
		if (last == 0)
		    nlines.push("  " + name + " : function " + body[0] + ",");
		else {
		    nlines.push("  " + name + " : function " + body[0]);
		    for ( let x=1; x < last ; x++ )
			nlines.push(body[x]);
		    nlines.push(body[last] + ",");
		}
	    }

	    // Now do vtable, if appropriate.

	    // Issue 2: instead of using ...args we really must use a
	    // signature from one of the method defs, but it's tricky
	    // since we may have to strip annotations, and there's
	    // also a question about rest arguments.  (Not to mention
	    // the arguments object.)

	    // TODO: better error message?

	    if (d.kind == DefnKind.Class) {
		let cls = <ClassDefn> d;
		for ( let virtual of cls.vtable ) {
		    nlines.push(virtual.name + ": function (SELF, ...args) {");
		    nlines.push("  switch (_mem_int32[SELF>>2]) {");
		    let kv = virtual.reverseCases.keysValues();
		    for ( let [name,cases]=kv.next() ; name ; [name,cases]=kv.next() ) {
			for ( let c of cases )
			    nlines.push("    case " + c + ": ");
			nlines.push("      return " + name + "(SELF, ...args);");
		    }
		    nlines.push("    default:");
		    nlines.push("      " + (virtual.default_ ? ("return " + virtual.default_ + "(SELF, ...args)") : "throw new Error('Bad type')") + ";");
		    nlines.push("  }");
		    nlines.push("},");
		}
	    }

	    // Now do other methods: initInstance.

	    if (d.kind == DefnKind.Class) {
		let cls = <ClassDefn> d;
		nlines.push("initInstance:function(SELF) { _mem_int32[SELF>>2]=" + cls.classId + "; return SELF; },");
	    }

	    nlines.push("}");
	    if (d.kind == DefnKind.Class)
		nlines.push("FlatJS._idToType[" + (<ClassDefn> d).classId + "] = " + d.name + ";");
	}
	while (k < lines.length)
	    nlines.push(lines[k++]);
	source.lines = nlines;
    }
}

function expandGlobalAccessorsAndMacros():void {
    for ( let source of allSources ) {
	let lines = source.lines;
	let nlines: string[] = [];
	for ( let j=0 ; j < lines.length ; j++ )
	    nlines.push(expandMacrosIn(lines[j]))
	source.lines = nlines;
    }
}

const acc_re = /([A-Za-z][A-Za-z0-9]*)\.(add_|sub_|and_|or_|xor_|compareExchange_|loadWhenEqual_|loadWhenNotEqual_|expectUpdate_|notify_|set_|ref_)?([a-zA-Z0-9_]+)\s*\(/g;
const arr_re = /([A-Za-z][A-Za-z0-9]*)\.array_(get|set)(?:_([a-zA-Z0-9_]+))?\s*\(/g;
const new_re = /@new\s+(?:array\s*\(\s*([A-Za-z][A-Za-z0-9]*)\s*,|([A-Za-z][A-Za-z0-9]*))/g;

function expandMacrosIn(text:string):string {
    return myExec(new_re, newMacro, myExec(arr_re, arrMacro, myExec(acc_re, accMacro, text)));
}

function myExec(re:RegExp, macro:(string, number, RegExpExecArray)=>[string,number], text:string):string {
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
	let [newText, newStart] = macro(text, re.lastIndex-m[0].length, m);
	text = newText;
	re.lastIndex = newStart;
    }

    re.lastIndex = old;
    return text;
}

class ParamParser {
    private lim = 0;
    private done = false;

    constructor(private input:string, private pos:number) {
	this.lim = input.length;
    }

    // Returns null on failure to find a next argument
    private nextArg():string {
	if (this.done)
	    return null;
	let depth = 0;
	let start = this.pos;
	// Issue 8: Really should handle regular expressions, but much harder, and somewhat marginal
	// Issue 7: Really should handle /* .. */ comments
	while (this.pos < this.lim) {
	    switch (this.input.charAt(this.pos++)) {
	    case ',':
		if (depth == 0)
		    return cleanupArg(this.input.substring(start, this.pos-1));
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
		    return cleanupArg(this.input.substring(start, this.pos-1));
		}
		depth--;
		break;
	    case '\'':
	    case '"':
		// Issue 5: implement this
		throw new Error("Internal error: Avoid strings in arguments for now");
	    }
	}
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
}

function cleanupArg(s:string):string {
    s = s.replace(/^\s*|\s*$/g, "");
    if (s == "")
	return null;
    return s;
}

// Here, arity includes the self argument

const OpAttr = {
    "get_": { arity: 1, atomic: "load", synchronic: "" },
    "notify_": { arity: 1, atomic: "", synchronic: "_synchronicNotify" },
    "set_": { arity: 2, atomic: "store", synchronic: "_synchronicStore" },
    "add_": { arity: 2, atomic: "add", synchronic: "_synchronicAdd" },
    "sub_": { arity: 2, atomic: "sub", synchronic: "_synchronicSub" },
    "and_": { arity: 2, atomic: "and", synchronic: "_synchronicAnd" },
    "or_": { arity: 2, atomic: "or", synchronic: "_synchronicOr" },
    "xor_": { arity: 2, atomic: "xor", synchronic: "_synchronicXor" },
    "loadWhenEqual_": { arity: 2, atomic: "", synchronic: "_synchronicLoadWhenEqual" },
    "loadWhenNotEqual_": { arity: 2, atomic: "", synchronic: "_synchronicLoadWhenNotEqual" },
    "expectUpdate_": { arity: 3, atomic: "", synchronic: "_synchronicExpectUpdate" },
    "compareExchange_": { arity: 3, atomic: "compareExchange", synchronic: "_synchronicCompareExchange" },
};

function accMacro(s:string, p:number, ms:RegExpExecArray):[string,number] {
    let m = ms[0];
    let className = ms[1];
    let operation = ms[2];
    let propName = ms[3];

    let nomatch:[string,number] = [s, p+m.length];
    let left = s.substring(0,p);

    if (!operation)
	operation = "get_";
    let ty = knownTypes.get(className);
    if (!ty || !(ty.kind == DefnKind.Class || ty.kind == DefnKind.Struct))
	return nomatch;
    let cls = <UserDefn> ty;

    // findAccessibleFieldFor will vet the operation against the field type,
    // so atomic/synchronic ops will only be allowed on appropriate types

    let fld = cls.findAccessibleFieldFor(operation, propName);
    if (!fld) {
	//console.log("No match for " + className + "  " + operation + "  " + propName);
	return nomatch;
    }

    // Issue 6: Emit warnings for arity abuse, at a minimum.

    let pp = new ParamParser(s, p+m.length);
    let as = (pp).allArgs();
    if (OpAttr[operation].arity != as.length) {
	console.log(`Bad set arity ${propName} / ${as.length}`);
	return nomatch;
    };

    let ref = `(${expandMacrosIn(endstrip(as[0]))} + ${fld.offset})`;
    if (operation == "ref_") {
	return [left + ref + s.substring(pp.where),
		left.length + ref.length];
    }

    return loadFromRef(ref, fld.type, s, left, operation, pp, as[1], as[2], nomatch);
}

function loadFromRef(ref:string, type:Defn, s:string, left:string, operation:string, pp:ParamParser,
		     rhs:string, rhs2:string, nomatch:[string,number]):[string,number]
{
    let mem="", size=0, synchronic=false, atomic=false, shift=-1;
    if (type.kind == DefnKind.Primitive) {
	let prim = <PrimitiveDefn> type;
	mem = prim.memory;
	synchronic = prim.synchronic;
	atomic = prim.atomic;
	if (synchronic)
	    shift = log2((<SynchronicDefn> prim).baseSize);
	else
	    shift = log2(prim.size);
    }
    else if (type.kind == DefnKind.Class) {
	mem = "_mem_int32";
	shift = 2;
    }
    if (shift >= 0) {
	let expr = "";
	let op = "";
	switch (OpAttr[operation].arity) {
	case 1:
	    break;
	case 2:
	    rhs = expandMacrosIn(endstrip(rhs));
	    break;
	case 3:
	    rhs = expandMacrosIn(endstrip(rhs));
	    rhs2 = expandMacrosIn(endstrip(rhs2));
	    break;
	default:
	    throw new Error("Internal error: no operator: " + operation);
	}
	let fieldIndex = synchronic ? `(${ref} + ${SynchronicDefn.bias}) >> ${shift}` : `${ref} >> ${shift}`;
	switch (operation) {
	case "get_":
	    if (atomic || synchronic)
		expr = `Atomics.load(${mem}, ${fieldIndex})`;
	    else
		expr = `${mem}[${fieldIndex}]`;
	    break;
	case "notify_":
	    expr = `FlatJS.${OpAttr[operation].synchronic}(${ref})`;
	    break;
	case "set_":
	case "add_":
	case "sub_":
	case "and_":
	case "or_":
	case "xor_":
	case "loadWhenEqual_":
	case "loadWhenNotEqual_":
	    if (atomic)
		expr = `Atomics.${OpAttr[operation].atomic}(${mem}, ${fieldIndex}, ${rhs})`;
	    else if (synchronic)
		expr = `FlatJS.${OpAttr[operation].synchronic}(${ref}, ${mem}, ${fieldIndex}, ${rhs})`;
	    else
		expr = `${mem}[${ref} >> ${shift}] = ${rhs}`;
	    break;
	case "compareExchange_":
	case "expectUpdate_":
	    if (atomic)
		expr = `Atomics.${OpAttr[operation].atomic}(${mem}, ${fieldIndex}, ${rhs}, ${rhs2})`;
	    else
		expr = `FlatJS.${OpAttr[operation].synchronic}(${ref}, ${mem}, ${fieldIndex}, ${rhs}, ${rhs2})`;
	    break;
	default:
	    throw new Error("Internal: No operator: " + operation);
	}
	expr = `(${expr})`;
	return [left + expr + s.substring(pp.where), left.length + expr.length];
    }
    else {
	let t = <StructDefn> type;
	let expr = "";
	// Field type is a structure.  If the structure type has a getter then getting is allowed
	// and should be rewritten as a call to the getter, passing the field reference.
	// Ditto setter, which will also pass secondArg.
	switch (operation) {
	case "get_":
	    if (t.hasGetMethod)
		expr = `${t.name}._get_impl(${ref})`;
	    break;
	case "set_":
	    if (t.hasSetMethod)
		expr = `${t.name}._set_impl(${ref}, ${expandMacrosIn(endstrip(rhs))})`;
	    break;
	}
	if (expr == "")
	    return nomatch;	// Issue 6: Warning desired
	expr = `(${expr})`;
	return [left + expr + s.substring(pp.where), left.length + expr.length];
    }
}

// operation is get, set
// typename is the base type, which could be any type at all
// field may be blank, but if it is not then it is the field name within the
//   type, eg, for a struct Foo with field x we may see Foo.array_get_x(SELF, n)
// firstArg and secondArg are non-optional; thirdArg is used if the operation is set

// FIXME: for fields within a structure, operation could be ref, too

function arrMacro(s:string, p:number, ms:RegExpExecArray):[string,number] {
    let m=ms[0];
    let typeName=ms[1];
    let operation=ms[2];
    let field=ms[3];
    let nomatch:[string,number] = [s,p+m.length];

    let type = findType(typeName);
    if (!type)
	return nomatch;

    let pp = new ParamParser(s, p+m.length);
    let as = (pp).allArgs();

    // Issue 6: Emit warnings for arity abuse, at a minimum.  This is clearly very desirable.

    // FIXME: atomics on fields of structs within array, syntax would be
    // T.array_add_x(p,v), T.array_expectUpdate_y(p, v, t).

    switch (operation) {
    case "get": if (as.length != 2) return nomatch; operation = "get_"; break;
    case "set": if (as.length != 3) return nomatch; operation = "set_"; break;
    }

    if (type.kind == DefnKind.Primitive) {
	if (field)
	    return nomatch;
    }
    else if (type.kind == DefnKind.Class) {
	if (field)
	    return nomatch;
    }
    let ref = "(" + expandMacrosIn(endstrip(as[0])) + "+" + type.size + "*" + expandMacrosIn(endstrip(as[1])) + ")";
    if (field) {
	let fld = (<StructDefn> type).findAccessibleFieldFor(operation, field);
	if (!fld)
	    return nomatch;
	ref = "(" + ref + "+" + fld.offset + ")";
	type = fld.type;
    }

    return loadFromRef(ref, type, s, s.substring(0,p), operation, pp, as[2], as[3], nomatch);
}

// Since @new is new syntax, we throw errors for all misuse.

function newMacro(s:string, p:number, ms:RegExpExecArray):[string,number] {
    let m=ms[0];
    let arrayType=ms[1];
    let classType=ms[2];
    let left = s.substring(0,p);
    if (classType !== undefined) {
	let t = knownTypes.get(classType);
	if (!t)
	    throw new Error("Unknown type argument to @new: " + classType);
	let expr = "(" + classType + ".initInstance(FlatJS.allocOrThrow(" + t.size + "," + t.align + ")))";
	return [left + expr + s.substring(p + m.length),
		left.length + expr.length ];
    }

    let pp = new ParamParser(s, p+m.length);
    let as = pp.allArgs();
    if (as.length != 1)
	throw new Error("Wrong number of arguments to @new array(" + arrayType + ")")

    let t = findType(arrayType);
    if (!t)
	throw new Error("Unknown type argument to @new array: " + arrayType);
    let expr = "(FlatJS.allocOrThrow(" + t.size + " * " + expandMacrosIn(endstrip(as[0])) + ", " + t.align + "))";
    return [left + expr + s.substring(pp.where),
	    left.length + expr.length];
}

function findType(name:string):Defn {
    if (!knownTypes.test(name))
	throw new Error("Internal: Unknown type in sizeofType: " + name);
    return knownTypes.get(name);
}

// This can also check if x is already properly parenthesized, though that
// involves counting parens, at least trivially (and then does it matter?).
// Consider (a).(b), which should be parenthesized as ((a).(b)).

function endstrip(x:string):string {
    if (/^[a-zA-Z0-9]+$/.test(x))
	return x;
    return "(" + x + ")";
}

function log2(x:number):number {
    if (x <= 0)
	throw new Error("log2: " + x);
    let i = 0;
    while (x > 1) {
	i++;
	x >>= 1;
    }
    return i;
}

main(process.argv.slice(2));
