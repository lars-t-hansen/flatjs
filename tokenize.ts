/* -*- mode: javascript -*- */


/* The way this will be used is this:

   Invoke on file
   Transduce tokens until "@flatjs"
   Then start parsing, to identify fields and methods etc
   Methods are parsed using syntax parsing for the signature and body
   Things we don't need to know turn into lists of strings or maybe [Token,string].

   This process will let us get rid of @method and @end, and will in principle
   lead to much saner parsing and macro substitution (since we can avoid substituting
   within literals and comments).
*/


enum Token {
    Unused,    // Also used for backtracking
    Id,
    Dot,
    DotDotDot,
    Colon,
    Semicolon,
    Comma,
    LBracket,
    RBracket,
    LParen,
    RParen,
    LBrace,
    RBrace,
    Assign,
    Other,
    Spaces,    // Also block comment that does not cross a line break, and line comment
    Linebreak, // One line break
    Comment,   // Block comment that crosses a line break, a SetLine will follow
    SetLine,   // Set the line number.  Payload is a comment: /*n*/ where n is the new line number
    FlatJS,
    New,
    EOI
};

// Really an object with an optional "value" property and other
// properties named by one-character strings.  A union type is not
// quite right, but casts might help.  Or the value property could
// always be there but its value type could be number|undefined,
// maybe.

type Trie = any;

const optrie = (function () {
    const operator = {
	".": Token.Dot,
	"...": Token.DotDotDot,
	";": Token.Semicolon,
	":": Token.Colon,
	",": Token.Comma,
	"(": Token.LParen,
	")": Token.RParen,
	"{": Token.LBrace,
	"}": Token.RBrace,
	"[": Token.LBracket,
	"]": Token.RBracket,
	"=": Token.Assign,
	"==": Token.Other,
	"===": Token.Other,
	"<": Token.Other,
	"<=": Token.Other,
	"<<": Token.Other,
	"<<=": Token.Assign,
	">": Token.Other,
	">>": Token.Other,
	">>=": Token.Assign,
	">>>": Token.Other,
	">>>=": Token.Assign,
	"!": Token.Other,
	"!=": Token.Other,
	"!==": Token.Other,
	"~": Token.Other,
	"+": Token.Other,
	"++": Token.Other,
	"+=": Token.Assign,
	"-": Token.Other,
	"--": Token.Other,
	"-=": Token.Assign,
	"*": Token.Other,
	"*=": Token.Assign,
	"/": Token.Other,
	"/=": Token.Assign,
	"%": Token.Other,
	"%=": Token.Assign,
	"&": Token.Other,
	"&&": Token.Other,
	"&=": Token.Assign,
	"|": Token.Other,
	"||": Token.Other,
	"|=": Token.Assign,
	"^": Token.Other,
	"^=": Token.Assign,
	"?": Token.Other
    };

    function enter(t:Trie, k:string, v:number) {
	if (k.length == 0) {
	    t.value = v;
	    return;
	}
	let c = k.charAt(0);
	if (typeof t[c] != "object")
	    t[c] = {};
	enter(t[c], k.substring(1), v);
    }

    let t = {};
    for ( let k in operator )
	enter(t, k, operator[k]);

    return t;
})();

interface Tokensource {
    next(): [Token,string];
}

class Retokenizer implements Tokensource
{
    constructor(private input:[Token,string][], private loc=0, private end=-1) {
	if (this.end == -1)
	    this.end = this.input.length;
    }

    next(): [Token,string] {
	if (this.loc == this.end)
	    return [Token.EOI,""];
	return this.input[this.loc++];
    }
}

class Tokenizer implements Tokensource
{
    private lineNumber = 0;
    private adjustLineNumber = false;

    // reportError must throw an exception.  line is the line number
    // within the input, counting the first line starting at loc.
    constructor(private input:string, private reportError:(line:number, msg:string) => void, private loc=0, private end=-1) {
	if (this.end == -1)
	    this.end = this.input.length;
    }

    // TODO: For typescript, we must worry about nested template
    // types, perhaps.  T<W<X>> would be context-sensitive, normally
    // >> is shift-right.

    next(): [Token,string] {
	for (;;) {
	    if (this.adjustLineNumber) {
		this.adjustLineNumber = false;
		return [Token.SetLine,"/*" + this.lineNumber + "*/"];
	    }

	    if (this.loc == this.end)
		return [Token.EOI,""];

	    let c = this.input.charAt(this.loc++);

	    if (this.isSpace(c))
		return this.lexSpaces(c);

	    if (this.isLinebreak(c))
		return this.lexLinebreak(c);

	    if (c == '"' || c == '\'')
		return this.lexString(c);

	    if (c == '`')
		return this.lexTemplate();

	    if (c == '/') {
		if (this.loc < this.end) {
		    let d = this.input.charAt(this.loc);
		    if (d == '/') {
			this.loc++;
			return this.lexLineComment();
		    }
		    if (d == '*') {
			this.loc++;
			return this.lexBlockComment()
		    }
		    // Regular expression?
		    //
		    // This can get regexes wrong, consider x / y / z which is a valid expression.
		    // If we get it wrong we still won't unbalance parentheses, but macro substitution
		    // won't be performed within the presumed regex / y /, so if y is SELF.zappa then
		    // we're sunk.
		    //
		    // To be correct, we must have a full expression parser.  However, a useful heuristic
		    // is to track the previous nonspace token, and to have a table that
		    // determines, based on that token, whether a possible-regex could ever be a
		    // valid-regex in that context.  The problem is, that token may have to be somewhat
		    // detailed - it must distinguish operators and literals, at least.
		    //
		    // TODO: implement that heuristic.
		    let s = this.lexRegexMaybe();
		    if (s)
			return [Token.Other, s];
		}
	    }

	    if (c == '@') {
		// FIXME: subsequent must not be ident char
		if (this.loc+6 <= this.end && this.input.substring(this.loc, this.loc+6) == "flatjs") {
		    this.loc += 6;
		    return [Token.FlatJS, "@flatjs"];
		}
		if (this.loc+3 <= this.end && this.input.substring(this.loc, this.loc+3) == "new") {
		    this.loc += 3;
		    return [Token.New, "@new"];
		}
		return [Token.Other,c];
	    }

	    if (this.isDigit(c) || c == "." && this.loc < this.end && this.isDigit(this.input.charAt(this.loc)))
		return this.lexNumber(c);

	    if (this.isInitial(c))
		return this.lexIdent(c);

	    if (optrie[c])
		return this.lexOperator(c);

	    return [Token.Other, c];
	}
    }

    private lexSpaces(s:string): [Token,string] {
	let c = " ";
	while (this.loc < this.end && this.isSpace(c = this.input.charAt(this.loc))) {
	    this.loc++;
	    s += c;
	}
	return [Token.Spaces,s];
    }

    private lexLinebreak(c:string): [Token,string] {
	this.lineNumber++;
	if (c == "\r" && this.loc < this.end && this.input.charAt(this.loc) == "\n") {
	    this.loc++;
	    return [Token.Linebreak,"\r\n"];
	}
	return [Token.Linebreak,c];
    }

    private lexString(terminator:string): [Token,string] {
	let s = terminator;
	let c = " ";
	for (;;) {
	    if (this.loc == this.end)
		this.reportError(this.lineNumber, "End-of-file inside string");
	    c = this.input.charAt(this.loc++);
	    if (this.isLinebreak(c))
		this.reportError(this.lineNumber, "End-of-line inside string");
	    if (c == terminator)
		break;
	    s += c;
	    if (c == '\\') {
		if (this.loc == this.end)
		    this.reportError(this.lineNumber, "End-of-file inside string");
		s += this.input.charAt(this.loc++);
	    }
	}
	s += terminator;
	return [Token.Other, s];
    }

    // TODO: Implement this properly - presumably there are escape
    // characters, at a minimum.
    private lexTemplate(): [Token,string] {
	let s = "`";
	let lineBefore = this.lineNumber;
	for (;;) {
	    if (this.loc == this.end)
		this.reportError(this.lineNumber, "End-of-file inside template string");
	    let c = this.input.charAt(this.loc++);
	    if (this.isLinebreak(c)) {
		let [t,q] = this.lexLinebreak(c);
		s += q;
	    }
	    else
		s += c;
	    if (c == "`")
		break;
	}
	if (this.lineNumber > lineBefore)
	    this.adjustLineNumber = true;
	// TODO: either get rid of Token.Comment and rely on line breaks to handle ASI,
	// or we need a similar token here.
	return [Token.Other,s];
    }

    // Returns null if this is thought not to be a regex, otherwise
    // the regex source.  If it returns null it does not advance the
    // input pointer.  It never throws an error.
    //
    // Algorithm:
    //  - start lexing as a regex
    //  - if it succeeds before end-of-line, pass it to new RegExp
    //  - if that does not throw, assume it's a RegExp
    private lexRegexMaybe(): string {
	// FIXME: Implement this
	return null;
    }

    private lexNumber(c:string): [Token, string] {
	let s = c;
	if (this.isDigit(c))
	    s += this.lexDigits(false);
	if (this.loc < this.end) {
	    c = this.input.charAt(this.loc);
	    if (c == '.') {
		s += c;
		this.loc++;
		s += this.lexDigits(true);
	    }
	    if (this.loc < this.end && (c = this.input.charAt(this.loc)) == 'e' || c == 'E') {
		s += c;
		this.loc++;
		if (this.loc < this.end && (c = this.input.charAt(this.loc)) == '+' || c == '-') {
		    s += c;
		    this.loc++;
		}
		s += this.lexDigits(true);
	    }
	}
	return [Token.Other, s];
    }

    private lexDigits(mustHave:boolean):string {
	let s = "";
	let c = " ";
	while (this.loc < this.end && this.isDigit(c = this.input.charAt(this.loc))) {
	    s += c;
	    this.loc++;
	}
	if (mustHave && s.length == 0)
	    this.reportError(this.lineNumber, "One or more digits required");
	return s;
    }

    private lexIdent(c:string): [Token, string] {
	let s = c;
	while (this.loc < this.end && this.isSubsequent(c = this.input.charAt(this.loc))) {
	    this.loc++;
	    s += c;
	}
	return [Token.Id, s];
    }

    private lexLineComment(): [Token, string] {
	let s = "//";
	let c = " ";
	while (this.loc < this.end && !this.isLinebreak(c = this.input.charAt(this.loc))) {
	    this.loc++;
	    s += c;
	}
	return [Token.Spaces, s];
    }

    private lexBlockComment(): [Token, string] {
	let lineBefore = this.lineNumber;
	let s = "/*";

	for (;;) {
	    if (this.loc == this.end)
		this.reportError(this.lineNumber, "End-of-file inside comment");
	    let c = this.input.charAt(this.loc++);
	    if (c == '*') {
		s += c;
		if (this.loc < this.end && this.input.charAt(this.loc) == '/') {
		    s += '/';
		    this.loc++;
		    break;
		}
	    }
	    else if (this.isLinebreak(c)) {
		let [t,x] = this.lexLinebreak(c);
		s += x;
	    }
	    else
		s += c;
	}

	if (this.lineNumber > lineBefore) {
	    this.adjustLineNumber = true;
	    return [Token.Comment, s];
	}
	return [Token.Spaces, s];
    }

    private lexOperator(c:string): [Token, string] {
	return this.search(optrie[c], c);
    }

    // Not a nested function because of "this" insanity in JS.
    private search(t:Trie, s:string): [Token, string] {
	if (this.loc == this.end)
	    return [Token.Unused, ""];
	let c = this.input.charAt(this.loc);
	if (typeof t[c] == "undefined") {
	    if (t.value)
		return [t.value, s];
	    return [Token.Unused, ""];
	}
	this.loc++;
	let [t2, s2] = this.search(t[c], s+c);
	if (t2 == Token.Unused) {
	    this.loc--;
	    if (t.value)
		return [t.value, s];
	}
	return [t2, s2];
    }

    // The following predicates are naive.

    private isInitial(c:string): boolean {
	if (c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c == '_' || c == '$')
	    return true;
	return false;
    }

    private isSubsequent(c:string): boolean {
	if (c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c == '_' || c == '$' || c >= '0' && c <= '9')
	    return true;
	return false;
    }

    private isDigit(c:string): boolean {
	return (c >= '0' && c <= '9');
    }

    private isLinebreak(c:string): boolean {
	switch (c) {
	case '\r':
	case '\n':
	    return true;
	default:
	    return false;
	}
    }

    private isSpace(c:string): boolean {
	switch (c) {
	case ' ':
	case '\t':
	    return true;
	default:
	    return false;
	}
    }
}
