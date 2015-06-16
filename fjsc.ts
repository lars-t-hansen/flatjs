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
 * file must have extension .flat_xx where xx is typically js or ts.
 * On output the ".flat" qualifier will be stripped.
 *
 * ---
 *
 * This is source code for TypeScript 1.5 and node.js 0.10 / ECMAScript 5.
 * Tested with tsc 1.5.0-beta and nodejs 0.10.25 and 0.12.0, on Linux and Mac OS X.
 */

/// <reference path='typings/node/node.d.ts' />

import fs = require("fs");

const VERSION = "0.6";

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
    constructor(public line:number, public kind:MethodKind, public name:string, public signature:string[], public body:[Token,string][]) {}
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

// Temporary hack
class SourceLine {
    constructor(public file:string, public line:number, public text:string) {}
}

class Source {
    lines: SourceLine[] = null;	// A hack

    constructor(public input_file:string, public output_file:string, public defs:UserDefn[], public tokens:[Token,string][]) {}

    allText(): string {
	if (this.lines)
	    return this.lines.map(function (x) { return x.text }).join("\n");
	return this.tokens.map(function (x) { return x[1] }).join("");
    }
}

class CapturedError {
    constructor(public name:string, public message:string) {}
}

class InternalError extends CapturedError {
    constructor(msg:string) {
	super("InternalError", "Internal error: " + msg);
    }
}

class UsageError extends CapturedError {
    constructor(msg:string) {
	super("UsageError", "Usage error: " + msg);
    }
}

class ProgramError extends CapturedError {
    constructor(file:string, line:number, msg:string) {
	super("ProgramError", file + ":" + line + ": " + msg);
    }
}

const allSources:Source[] = [];

function main(args: string[]):void {
    try {
	for ( let input_file of args ) {
	    if (!(/.\.flat_[a-zA-Z0-9]+$/.test(input_file)))
		throw new UsageError("Bad file name (must be *.flat_<extension>): " + input_file);
	    let text = fs.readFileSync(input_file, "utf8");
	    //let lines = text.split("\n");
	    let [defs, residual] = collectDefinitions(input_file, text);
	    let output_file = input_file.replace(/\.flat_([a-zA-Z0-9]+)$/, ".$1");
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

	for ( let s of allSources ) {
	    fs.writeFileSync(s.output_file,
			     "// Generated from " + s.input_file + " by fjsc " + VERSION + "; github.com/lars-t-hansen/flatjs\n" + s.allText(),
			     "utf8");
	}
    }
    catch (e) {
	if (e instanceof CapturedError)
	    console.log(e.message);
	else
	    console.log(e);
	process.exit(1);
    }
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

//////////////////////////////////////////////////////////////////////////////////////////
//
// Parsing

class TokenScanner
{
    // The current token, always valid.  Do not set this directly.
    current: [Token,string];

    // The current line number.  Do not set this directly.
    line = 0;

    constructor(private ts:Tokensource, private reportError:(line:number, msg:string) => void, line=1) {
	this.current = ts.next();
	this.line = line;
    }

    // Advance to next token, return current token.  Update line
    // numbers.  This is used for all token advance, even internally,
    // and can be overridden to add functionality such as a
    // transducer.
    advance():[Token,string] {
	switch (this.current[0]) {
	case Token.Linebreak:
	    this.line++;
	    break;
	case Token.SetLine:
	    this.line = extractLine(this.current[1]);
	    break;
	}
	let result = this.current;
	this.current = this.ts.next();
	return result;
    }

    // Shorthand for matching an Id with the given ID name.
    matchName(name:string): void {
	let s = this.matchId();
	if (s != name)
	    this.reportError(this.line, "Expected '" + name + "' but encountered '" + s + "'");
    }

    // Shorthand for matching an Id; return the ID name.
    matchId(): string {
	return this.match(Token.Id)[1];
    }

    // Skip spaces.  If the leading token then matches t then return it and advance.
    // Otherwise signal an error.
    match(t:Token): [Token,string] {
	if (!this.lookingAt(t))
	    this.reportError(this.line, "Expected " + Token[t] + " but encountered " + Token[this.current[0]]);
	return this.advance();
    }

    // Skip spaces.  Return true iff the leading token then matches t.
    lookingAt(t:Token): boolean {
	this.skipSpace();
	return this.current[0] == t;
    }

    // Skip across whitespace and comments, maintaining line number.
    skipSpace():void {
	loop:
	for (;;) {
	    switch (this.current[0]) {
	    case Token.Spaces:
	    case Token.Comment:
	    case Token.Linebreak:
	    case Token.SetLine:
		this.advance();
		continue;
	    default:
		break loop;
	    }
	}
    }
}

// Given a string of the form "/*n*/", return n as a number.
function extractLine(tk:string):number {
    return parseInt(tk.substring(2,tk.length-2));
}

class ParenCounter
{
    private pstack:Token[] = [];

    level = 0;
    isUnbalanced = false;

    constructor(private ts:TokenScanner) {}

    lookingAt(t:Token): boolean {
	return this.ts.lookingAt(t);
    }

    advance():[Token,string] {
	let t = this.ts.advance();
	switch (t[0]) {
	case Token.EOI:
	    break;
	case Token.LParen:
	case Token.LBrace:
	case Token.LBracket:
	    this.pstack.push(t[0]);
	    this.level++;
	    break;
	case Token.RParen:
	    if (this.pstack.pop() != Token.LParen)
		this.isUnbalanced = true;
	    this.level--;
	    break;
	case Token.RBrace:
	    if (this.pstack.pop() != Token.LBrace)
		this.isUnbalanced = true;
	    this.level--;
	    break;
	case Token.RBracket:
	    if (this.pstack.pop() != Token.LBracket)
		this.isUnbalanced = true;
	    this.level--;
	    break;
	}
	return t;
    }
}

class TokenTransducer extends TokenScanner {
    private output:[Token,string][] = [];
    private loc = 0;

    constructor(ts:Tokensource, reportError:(line:number, msg:string) => void, line=1) {
	super(ts, reportError, line);
    }

    get tokens(): [Token,string][] {
	let result = this.output;
	this.output = [];
	return result;
    }

    advance():[Token,string] {
	let t = super.advance();
	this.output.push(t);
	return t;
    }

    inject(t:[Token,string]): void {
	this.output.push(t);
    }

    mark(): number {
	return this.output.length;
    }

    release(mark:number) {
	this.output.length = mark;
    }
}

class TokenSet {
    ts:boolean[] = [];

    constructor(...tokens:Token[]) {
	for ( let i=0 ; i <= Token.EOI ; i++ )
	    this.ts[i] = false;
	for ( let t of tokens )
	    this.ts[t] = true;
    }

    contains(t:Token):boolean {
	return this.ts[t];
    }
}

function collectDefinitions(file:string, input:string):[UserDefn[], [Token,string][]] {
    let defs:UserDefn[] = [];
    let ntokens:[Token,string][] = [];
    let residualLines = 1;
    let lineAfter = 1;
    let ts = new TokenScanner(new Tokenizer(input, standardErrHandler(file)), standardErrHandler(file));
  loop:
    for (;;) {
	let t = ts.advance();
	switch (t[0]) {
	case Token.EOI:
	    break loop;
	case Token.FlatJS: {
	    residualLines += ts.line - lineAfter;
	    defs.push(parseDefn(file, ts, residualLines));
	    lineAfter = ts.line;
	    break;
	}
	default:
	    ntokens.push(t);
	    break;
	}
    }
    return [defs, ntokens];
}

function parseDefn(file:string, ts:TokenScanner, origin:number): UserDefn {
    let kind = ts.matchId();
    if (kind != "struct" && kind != "class")
	throw new ProgramError(file, ts.line, "Syntax error: Expected 'class' or 'struct'");

    let defLine = ts.line;
    let defName = ts.matchId();

    let inherit = "";
    if (kind == "class") {
	if (ts.lookingAt(Token.Id)) {
	    ts.matchName("extends");
	    inherit = ts.matchId();
	}
    }

    let properties:Prop[] = [];
    let methods:Method[] = [];

    ts.match(Token.LBrace);

    while (!ts.lookingAt(Token.RBrace)) {
	let memberName = ts.matchId();
	let memberLine = ts.line;

	if (ts.lookingAt(Token.Colon)) {
	    ts.advance();
	    let basename = ts.matchId();
	    let lineOfDefn = ts.line;
	    let qual = PropQual.None;
	    let isArray = false;
	    // Currently only [.atomic|.synchronic][.Array]
	    if (ts.lookingAt(Token.Dot)) {
		ts.advance();
		let mustHaveArray = false;
		let q1 = ts.matchId();
		lineOfDefn = ts.line;
		if (q1 == "atomic")
		    qual = PropQual.Atomic;
		else if (q1 == "synchronic")
		    qual = PropQual.Synchronic;
		else
		    mustHaveArray = true;
		if (qual != PropQual.None && ts.lookingAt(Token.Dot)) {
		    ts.advance();
		    q1 = ts.matchId();
		    lineOfDefn = ts.line;
		    mustHaveArray = true;
		}
		if (mustHaveArray) {
		    if (q1 != "Array")
			throw new ProgramError(file, ts.line, "'Array' required here");
		    isArray = true;
		}
	    }
	    ts.skipSpace();
	    if (ts.line > lineOfDefn)
		;
	    else if (ts.lookingAt(Token.Semicolon))
		ts.advance();
	    else
		throw new ProgramError(file, ts.line, "Junk following definition: " + ts.current);

	    properties.push(new Prop(memberLine, memberName, qual, isArray, basename));
	}
	else {
	    let method_type = MethodKind.NonVirtual;

	    if (memberName == "virtual") {
		if (kind == "struct")
		    throw new ProgramError(file, ts.line, `virtual methods are not allowed in structs`);
		method_type = MethodKind.Virtual;
		memberName = ts.matchId();
	    }

	    if (memberName == "set") {
		method_type = MethodKind.Set;
		memberName = "";
	    }
	    else if (memberName == "get") {
		method_type = MethodKind.Get;
		memberName = "";
	    }

	    if (kind != "struct" && (method_type == MethodKind.Set || method_type == MethodKind.Get))
		throw new ProgramError(file, ts.line, MethodKind[method_type] + " methods are only allowed in structs");

	    // This will go away
	    if (kind == "struct" && !(method_type == MethodKind.Set || method_type == MethodKind.Get))
		throw new ProgramError(file, ts.line, "Methods are only allowed in classes");

	    let mbody:[Token,string][] = []
	    let pstack:Token[] = [];

	    let pc = new ParenCounter(ts);
	    for (;;) {
		let t = pc.advance();
		if (t[0] == Token.EOI)
		    throw new ProgramError(file, ts.line, "End of input inside method definition");
		mbody.push(t);
		if (pc.level < 0 || pc.isUnbalanced)
		    throw new ProgramError(file, ts.line, "Unbalanced parentheses");
		if (pc.level == 0 && t[0] == Token.RBrace)
		    break;
	    }

	    methods.push(new Method(memberLine, method_type, memberName, parseSignature(file, ts.line, mbody), mbody));
	}
    }

    ts.match(Token.RBrace);

    if (kind == "class")
	return new ClassDefn(file, defLine, defName, inherit, properties, methods, origin);
    else
	return new StructDefn(file, defLine, defName, properties, methods, origin);
}

function parseSignature(file:string, line:number, mbody:[Token,string][]): string[] {
    let ts2 = new TokenScanner(new Retokenizer(mbody), standardErrHandler(file), line);
    let method_signature:string[] = [];
    ts2.match(Token.LParen);
    ts2.matchName("SELF");
    // SELF is not part of the signature, it is always implied
    while (ts2.lookingAt(Token.Comma)) {
	ts2.advance();
	if (ts2.lookingAt(Token.DotDotDot)) {
	    ts2.advance();
	    method_signature.push("..." + ts2.matchId()); // FIXME: Bad hack
	}
	else
	    method_signature.push(ts2.matchId());
	// Skip annotations, to support TypeScript etc
	if (ts2.lookingAt(Token.Colon)) {
	    ts2.advance();
	    let pc = new ParenCounter(ts2);
	    while (pc.level > 0 || !pc.lookingAt(Token.Comma) && !pc.lookingAt(Token.RParen)) {
		let t = pc.advance();
		if (t[0] == Token.EOI || pc.isUnbalanced)
		    throw new ProgramError(file, ts2.line, "Unbalanced parentheses");
	    }
	}
    }
    ts2.match(Token.RParen);
    return method_signature;
}

// Parse one argument expression, ends at rightparen or comma@level0, EOI is an error.
// Does not consume either of the terminators.  Any leading leftparen has been skipped.
// An empty expression is an error.

function parseArgument(file:string, line:number, tokens:TokenScanner): [Token,string][] {
    return parseExpr(file, line, tokens, new TokenSet(Token.Comma, Token.RParen));
}

// Parse one stand-alone expression.  This is necessarily approximate
// since we don't do accurate ASI.  So stop at a linebreak when at
// paren level 0; when a right paren would unbalance the expression.
//
// Another problem is whether to stop at comma or not.  If the
// expression happens to be within an argument list, ie, f(x, y=z, w),
// then we should, but if it isn't, and it is a comma expression, then
// we shouldn't.  The former case is probably more common, so bias in
// favor of it.
//
// An interesting issue here is if semicolon should stop parsing or be
// an error even not at level 0.  EOI is an error if not at level 0.

// TODO: Document that comma expressions are brittle on the rhs of
// assignment, maybe other places.

function parseExpression(file:string, line:number, tokens:TokenScanner): [Token,string][] {
    return parseExpr(file, line, tokens,
		     new TokenSet(Token.Comma, Token.RParen, Token.RBrace, Token.RBracket,
				  Token.Linebreak, Token.Comment, Token.Semicolon, Token.EOI));
}

function parseExpr(file:string, line:number, ts2:TokenScanner, stopset:TokenSet): [Token,string][] {
    let pc = new ParenCounter(ts2);
    let expr:[Token,string][] = [];
    while (pc.level > 0 || !stopset.contains(ts2.current[0])) {
	let t = pc.advance();
	if (t[0] == Token.EOI || pc.isUnbalanced)
	    throw new ProgramError(file, ts2.line, "Unbalanced parentheses");
	if (t[0] == Token.Spaces || t[0] == Token.Comment || t[0] == Token.Linebreak)
	    expr.push([Token.Spaces, " "]);
	else
	    expr.push(t);
    }
    if (expr.length == 0)
	throw new ProgramError(file, ts2.line, "Missing expression");
    return expr;
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

	let result = this.cleanupArg(this.input.substring(start, fellOff ? this.pos : this.pos-1));

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

function isInitial(c:string):boolean {
    return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c == '_';
}

function isSubsequent(c:string):boolean {
    return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_';
}

//////////////////////////////////////////////////////////////////////////////////////////
//
// Type checking

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

function findType(name:string):Defn {
    if (!knownTypes.test(name))
	throw new InternalError("Unknown type in sizeofType: " + name);
    return knownTypes.get(name);
}

//////////////////////////////////////////////////////////////////////////////////////////
//
// Macro expansion and pasteup

// Arity for SELF expansion is one less than this

const OpAttr = {
    "get":              { withSelf: true,  selfArg: false, arity: 1, atomic: "load",            synchronic: "" }, // FIXME, holdover from old expander
    "ref":              { withSelf: true,  selfArg: false, arity: 1, atomic: "",                synchronic: "" },
    "notify":           { withSelf: true,  selfArg: false, arity: 1, atomic: "",                synchronic: "_synchronicNotify" },
    "set":              { withSelf: true,  selfArg: true,  arity: 2, atomic: "store",           synchronic: "_synchronicStore", vanilla: "=" },
    "add":              { withSelf: true,  selfArg: true,  arity: 2, atomic: "add",             synchronic: "_synchronicAdd", vanilla: "+=" },
    "sub":              { withSelf: true,  selfArg: true,  arity: 2, atomic: "sub",             synchronic: "_synchronicSub", vanilla: "-=" },
    "and":              { withSelf: true,  selfArg: true,  arity: 2, atomic: "and",             synchronic: "_synchronicAnd", vanilla: "&=" },
    "or":               { withSelf: true,  selfArg: true,  arity: 2, atomic: "or",              synchronic: "_synchronicOr", vanilla: "|=" },
    "xor":              { withSelf: true,  selfArg: true,  arity: 2, atomic: "xor",             synchronic: "_synchronicXor", vanilla: "^=" },
    "loadWhenEqual":    { withSelf: true,  selfArg: true,  arity: 2, atomic: "",                synchronic: "_synchronicLoadWhenEqual" },
    "loadWhenNotEqual": { withSelf: true,  selfArg: true,  arity: 2, atomic: "",                synchronic: "_synchronicLoadWhenNotEqual" },
    "expectUpdate":     { withSelf: true,  selfArg: true,  arity: 3, atomic: "",                synchronic: "_synchronicExpectUpdate" },
    "compareExchange":  { withSelf: true,  selfArg: true,  arity: 3, atomic: "compareExchange", synchronic: "_synchronicCompareExchange" },
    "at":               { withSelf: false, selfArg: false, arity: 1, atomic: "",                synchronic: "" },
    "setAt":            { withSelf: false, selfArg: false, arity: 2, atomic: "",                synchronic: "" },
};

const AssignmentOps =
    { "=": "set",
      "+=": "add",
      "-=": "sub",
      "&=": "and",
      "|=": "or",
      "^=": "xor"
    };

function expandSelfAccessors():void {
    for ( let t of userTypes )
	for ( let m of t.methods )
	    m.body = doExpandSelfAccessors(t, m.body, m.line);
}

function doExpandSelfAccessors(t:UserDefn, tokens:[Token,string][], line:number):[Token,string][] {
    let ts2 = new TokenTransducer(new Retokenizer(tokens), standardErrHandler(t.file), line);
    let hasDot = false;
    for (;;) {
	if (ts2.lookingAt(Token.EOI))
	    break;
	if (!ts2.lookingAt(Token.Id)) {
	    // Filter by name in general
	    hasDot = ts2.lookingAt(Token.Dot);
	    ts2.advance();
	    continue;
	}
	if (hasDot) {
	    // Skip if the name follows "."
	    ts2.advance();
	    hasDot = false;
	    continue;
	}
	if (ts2.current[1] != "SELF") {
	    // Filter by names that are in scope
	    ts2.advance();
	    continue;
	}
	let mark = ts2.mark();
	ts2.advance();
	let path:string[] = [];
	while (ts2.lookingAt(Token.Dot)) {
	    ts2.advance();
	    path.push(ts2.matchId());
	}
	if (path.length == 0) {
	    // If the name is not part of a path then leave it alone
	    continue;
	}

	let operator = path[path.length-1];
	let needArguments = false;
	let requireArityCheck = false;
	let args:[Token,string][][] = [];

	if (operator in OpAttr) {
	    if (!OpAttr[operator].withSelf)
		throw new ProgramError(t.file, ts2.line, "Operator cannot be used with SELF reference: " + operator);
	    path.pop();
	    if (path.length == 0)
		throw new ProgramError(t.file, ts2.line, "Operator requires nonempty path: " + operator);
	    if (!OpAttr[operator].selfArg && ts2.lookingAt(Token.LParen))
		throw new ProgramError(t.file, ts2.line, "Operator cannot precede '(': " + operator);
	    if (OpAttr[operator].selfArg) {
		if (!ts2.lookingAt(Token.LParen))
		    throw new ProgramError(t.file, ts2.line, "Operator requires arguments: " + operator);
		needArguments = true;
		requireArityCheck = true;
	    }
	    var pathname = path.join(".");
	    if (!t.findAccessibleFieldFor(operator, pathname))
		throw new ProgramError(t.file, ts2.line, "Inappropriate operation for " + pathname);
	}
	else if (ts2.lookingAt(Token.Assign)) {
	    // FIXME: += etc should only be allowed for atomic and synchronic fields, but
	    // that limitation is commented out currently.
	    let tok = ts2.advance();
	    var pathname = path.join(".");
	    if (!(tok[1] in AssignmentOps) || !t.findAccessibleFieldFor((operator = AssignmentOps[tok[1]]), pathname))
		throw new ProgramError(t.file, ts2.line, "Inappropriate operation for " + pathname);

	    args.push(parseExpression(t.file, ts2.line, ts2));
	}
	else if (ts2.lookingAt(Token.LParen)) {
	    // Invocation.  Leave operator blank.
	    operator = "";
	    needArguments = true;
	    // TODO: Path must denote a method, right now that should just be an immediate check on the type
	    // TODO: If we know the method's arity we can record it here and check it below
	}
	else {
	    // Get.  Leave operator blank.
	    operator = "";
	    var pathname = path.join(".");
	    if (!t.findAccessibleFieldFor("get", pathname))
		throw new ProgramError(t.file, ts2.line, "Inappropriate operation for " + pathname);
	}

	if (needArguments) {
	    ts2.match(Token.LParen);
	    if (!ts2.lookingAt(Token.RParen)) {
		args.push(parseArgument(t.file, ts2.line, ts2));
		while (ts2.lookingAt(Token.Comma)) {
		    ts2.advance();
		    args.push(parseArgument(t.file, ts2.line, ts2));
		}
	    }
	    ts2.match(Token.RParen);
	    if (requireArityCheck) {
		if (args.length != OpAttr[operator].arity-1)
		    throw new ProgramError(t.file, ts2.line, "Wrong number of arguments for operator: " + operator);
	    }
	}

	ts2.release(mark);
	ts2.inject([Token.Id, t.name]);
	for ( let name of path ) {
	    ts2.inject([Token.Dot, "."]);
	    ts2.inject([Token.Id, name]);
	}
	if (operator != "") {
	    ts2.inject([Token.Dot, "."]);
	    ts2.inject([Token.Id, operator]);
	}
	ts2.inject([Token.LParen, "("]);
	ts2.inject([Token.Id, "SELF"]);
	for ( let arg of args ) {
	    ts2.inject([Token.Comma, ","]);
	    // TODO: Not quite right line number, should keep the line number with argument expression
	    for ( let x of doExpandSelfAccessors(t, arg, ts2.line))
		ts2.inject(x);
	}
	ts2.inject([Token.RParen, ")"]);
    }
    return ts2.tokens;
}

function pasteupTypes():void {

    // ES5 hacks
    function otherPusher(ntokens:[Token,string][]):(x:string)=>void {
	return function (text:string):void {
	    ntokens.push([Token.Other, text]);
	}
    }

    function linebreakPusher(ntokens:[Token,string][]):() => void {
	return function ():void {
	    ntokens.push([Token.Linebreak, "\n"]);
	}
    }

    function manyPusher(ntokens:[Token,string][]):(...xs:[Token,string][]) => void {
	return function (...xs:[Token,string][]):void {
	    for ( let x of xs )
		ntokens.push(x);
	}
    }

    for ( let source of allSources ) {
	let defs = source.defs;
	let tokens = source.tokens;
	let ntokens: [Token,string][] = [];
	let k = 0;
	let lineno = 1;

	let push = otherPusher(ntokens);
	let pushLinebreak = linebreakPusher(ntokens);
	let pushMany = manyPusher(ntokens);

	for ( let d of defs ) {
	    while (lineno < d.origin && k < tokens.length) {
		let t:[Token,string];
		ntokens.push((t = tokens[k++]));
		switch (t[0]) {
		case Token.Linebreak:
		    lineno++;
		    break;
		case Token.SetLine:
		    lineno = extractLine(t[1]);
		    break;
		}
	    }

	    ntokens.push([Token.SetFile, "/*" + d.file + "[class definition]*/"]);
	    ntokens.push([Token.SetLine, "/*" + d.line + "*/"]);
	    pushLinebreak();

	    if (d.kind == DefnKind.Class)
		push("function " + d.name + "(p) { this._pointer = (p|0); }");
	    else
		push("function " + d.name + "() {}");
	    pushLinebreak();
	    if (d.kind == DefnKind.Class) {
		let cls = <ClassDefn> d;
		if (cls.baseName)
		    push(d.name + ".prototype = new " + cls.baseName + ";");
		else
		    push("Object.defineProperty(" + d.name + ".prototype, 'pointer', { get: function () { return this._pointer } });");
		pushLinebreak();
	    }
	    push(d.name + ".NAME = \"" + d.name + "\";");
	    pushLinebreak();
	    push(d.name + ".SIZE = " + d.size + ";");
	    pushLinebreak();
	    push(d.name + ".ALIGN = " + d.align + ";");
	    pushLinebreak();
	    if (d.kind == DefnKind.Class) {
		let cls = <ClassDefn> d;
		push(d.name + ".CLSID = " + cls.classId + ";");
		pushLinebreak();
		push("Object.defineProperty(" + d.name + ", 'BASE', {get: function () { return " + (cls.baseName ? cls.baseName : "null") + "; }});");
		pushLinebreak();
	    }

	    // Now do methods.
	    //
	    // Implementation methods are emitted directly in the defining type, with a name suffix _impl.
	    // For struct methods, the name is "_get_impl" or "_set_impl"

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
		pushMany([Token.SetFile, "/*" + d.file + "[method " + name + "]*/"],
			 [Token.SetLine, "/*" + m.line + "*/"]);
		pushLinebreak();
		pushMany([Token.Id, d.name],
			 [Token.Dot, "."],
			 [Token.Id, name],
			 [Token.Assign, "="],
			 [Token.Id, "function"]);
		for ( let token of m.body )
		    ntokens.push(token);
		pushLinebreak();
	    }

	    // Now default methods, if appropriate.

	    if (d.kind == DefnKind.Struct) {
		let struct = <StructDefn> d;
		if (!haveGetter) {
		    let local = gensym();
		    pushMany([Token.Id, d.name],
			     [Token.Dot, "."],
			     [Token.Id, "_get_impl"],
			     [Token.Assign, "="],
			     [Token.Id, "function"],
			     [Token.LParen, "("],
			     [Token.Id, "SELF"],
			     [Token.RParen, ")"],
			     [Token.LBrace, "{"]);
		    pushLinebreak();
		    pushMany([Token.Id, "var"],
			     [Token.Spaces, " "],
			     [Token.Id, local],
			     [Token.Assign, "="],
			     [Token.Id, "new"],
			     [Token.Spaces, " "],
			     [Token.Id, d.name],
			     [Token.Semicolon, ";"]);
		    pushLinebreak();

		    // Use longhand for access, since self accessors are expanded before pasteup.
		    // TODO: Would be useful to fix that.
		    for ( let p of d.props ) {
			pushMany([Token.Id, local],
				 [Token.Dot, "."],
				 [Token.Id, p.name],
				 [Token.Assign, "="],
				 [Token.Id, d.name],
				 [Token.Dot, "."],
				 [Token.Id, p.name],
				 [Token.LParen, "("],
				 [Token.Id, "SELF"],
				 [Token.RParen, ")"],
				 [Token.Semicolon, ";"]);
			pushLinebreak();
		    }
		    pushMany([Token.Id, "return"], [Token.Spaces, " "], [Token.Id, local], [Token.Semicolon, ";"]);
		    pushLinebreak();
		    ntokens.push([Token.RBrace, "}"]);
		    pushLinebreak();
		    struct.hasGetMethod = true;
		}

		if (!haveSetter) {
		    let local = gensym();
		    pushMany([Token.Id, d.name],
			     [Token.Dot, "."],
			     [Token.Id, "_set_impl"],
			     [Token.Assign, "="],
			     [Token.Id, "function"],
			     [Token.LParen, "("],
			     [Token.Id, "SELF"],
			     [Token.Comma, ","],
			     [Token.Id, local],
			     [Token.RParen, ")"],
			     [Token.LBrace, "{"]);
		    pushLinebreak();
		    // TODO: as above, useful to be able to use shorthand?
		    for ( let p of d.props ) {
			pushMany([Token.Id, d.name],
				 [Token.Dot, "."],
				 [Token.Id, p.name],
				 [Token.Dot, "."],
				 [Token.Id, "set"],
				 [Token.LParen, "("],
				 [Token.Id, "SELF"],
				 [Token.Comma, ","],
				 [Token.Id, local],
				 [Token.Dot, "."],
				 [Token.Id, p.name],
				 [Token.RParen, ")"],
				 [Token.Semicolon, ";"]);
			pushLinebreak();
		    }
		    ntokens.push([Token.RBrace, "}"]);
		    pushLinebreak();
		    struct.hasSetMethod = true;
		}
	    }

	    // Now do vtable, if appropriate.

	    if (d.kind == DefnKind.Class) {
		let cls = <ClassDefn> d;
		for ( let virtual of cls.vtable ) {
		    // Shouldn't matter much
		    ntokens.push([Token.SetFile, "/*" + d.file + "[vtable " + virtual.name + "]*/"]);
		    ntokens.push([Token.SetLine, "/*" + d.line + "*/"]);
		    pushLinebreak();
		    let signature = virtual.signature();
		    push(d.name + "." + virtual.name + " = function (SELF " + signature + ") {");
		    pushLinebreak();
		    push("  switch (_mem_int32[SELF>>2]) {");
		    pushLinebreak();
		    let kv = virtual.reverseCases.keysValues();
		    for ( let [name,cases]=kv.next() ; name ; [name,cases]=kv.next() ) {
			for ( let c of cases ) {
			    push(`    case ${c}:`);
			    pushLinebreak();
			}
			push(`      return ${name}(SELF ${signature});`);
			pushLinebreak();
		    }
		    push("    default:");
		    pushLinebreak();
		    push("      " + (virtual.default_ ?
				     `return ${virtual.default_}(SELF ${signature})` :
				     "throw FlatJS._badType(SELF)") + ";");
		    pushLinebreak();
		    push("  }");
		    pushLinebreak();
		    push("}");
		    pushLinebreak();
		}
	    }

	    // Now do other methods: initInstance.

	    if (d.kind == DefnKind.Class) {
		let cls = <ClassDefn> d;
		push(d.name + ".initInstance = function(SELF) { _mem_int32[SELF>>2]=" + cls.classId + "; return SELF; }");
		pushLinebreak();
	    }

	    if (d.kind == DefnKind.Class) {
		push("FlatJS._idToType[" + (<ClassDefn> d).classId + "] = " + d.name + ";");
		pushLinebreak();
	    }

	    // TODO: This is not right.  Here we should pick up the
	    // line number following the definition?  Depends on how
	    // this information will be used later.

	    //ntokens.push([Token.SetFile, "/*" + d.file + "*/"]);
	    //ntokens.push([Token.SetLine, "/*" + d.line + "*/"]);
	}
	while (k < tokens.length)
	    ntokens.push(tokens[k++]);
	source.tokens = ntokens;
    }
}

let gensym_counter = 1000;

function gensym():string {
    return "__l" + gensym_counter++;
}

function reFormLines(ts:[Token,string][]): SourceLine[] {
    return ts.map(function (x) { return x[1] }).join("").split("\n").map(function (l) { return new SourceLine("", 0, l) });
}

function expandGlobalAccessorsAndMacros():void {
    for ( let source of allSources ) {
	let lines = reFormLines(source.tokens);
	let nlines: SourceLine[] = [];
	for ( let l of lines )
	    nlines.push(new SourceLine(l.file, l.line, expandMacrosIn(l.file, l.line, l.text)));
	source.lines = nlines;
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

// TODO: it's likely that the expandMacrosIn is really better
// represented as a class, with a ton of methods and locals (eg for
// file and line), performing expansion on one line.

const new_re = new RegExp("@new\\s+(" + Id + ")" + QualifierOpt + "(?:\\.(Array)" + LParen + ")?", "g");

const acc_re = new RegExp("(" + Id + ")" + PathOptLazy + "(?:" + Operation + "|)" + LParen, "g");

// It would sure be nice to avoid the explicit ".Array" here, but I don't yet know how.
const arr_re = new RegExp("(" + Id + ")" + QualifierOpt + "\\.Array" + PathOpt + Operation + LParen, "g");

// Field accessors:
//
// For every ID not inside a path, if it names a known type and is followed by ., collect a path, no interior element should be SELF or an operator
// The path must be followed by "(".
// Apply in order:
// If the path ends with any operator then it must be followed by leftparen, we do arity checking
// If the path references a field then it is a field reference
// Otherwise it is an invocation, so leave it alone.  [Ideally: check against available methods, but patching is allowed]
//
// Arguments are themselves subject to substitution, I smell more recursion.

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

function newMacro(file:string, line:number, s:string, p:number, ms:RegExpExecArray):[string,number] {
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

function standardErrHandler(file:string):(line:number,msg:string)=>void {
    return function(line:number, msg:string):void {
	throw new ProgramError(file, line, msg);
    }
}

function printToks(ts:[Token,string][]):void {
    let s = "";
    for ( let t of ts )
	s += "[" + t.join(" ") + "]";
    console.log(s);
}

main(process.argv.slice(2));
