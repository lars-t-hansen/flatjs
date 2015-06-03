/* -*- mode: javascript -*- */

enum Token {
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
    Other,
    Spaces,
    Linebreak,
    FlatJS,
    EOI
};

/* The way this will be used is this:

   Invoke on file
   Transduce tokens until "@flatjs"
   Then start parsing, to identify fields and methods etc
   Methods are parsed using syntax parsing for the signature and body
   Things we don't need to know turn into lists of strings or maybe [Token,string].

   This process will let us get rid of @method and @end, and will in principle
   lead to much saner parsing and macro substitution (since we can avoid substituting
   within literals and comments).

   May also have other tokens of interest, eg, "=", "+=", and other assignment ops.
*/

class Tokenizer {
    constructor(private input:string, private loc=0, private end=-1) {
	if (this.end == -1)
	    this.end = this.input.length;
    }

    // This needs to return "Spaces" for strings of white space and comments.
    // The string is never null, it is always the string representation of
    // the token.

    // For typescript, worry about nested template types? T<W<X>> is
    // context-sensitive, normally >> is shift-right.

    next(): [Token,string] {
	var here = this.start;
	for (;;) {
	    if (this.loc == this.end)
		return [Token.EOI,""];
	    let c = " ";
	    switch (c = this.input.charAt(this.loc++)) {
	    case ' ':
	    case '\t':
		return this.spaces(c);
	    case '\r':
	    case '\n':
		return this.linebreak(c);
	    case ':':
		return [Token.Colon,c];
	    case ';':
		return [Token.Semicolon,c];
	    case ',':
		return [Token.Comma,c];
	    case '(':
		return [Token.LParen,c];
	    case ')':
		return [Token.RParen,c];
	    case '[':
		return [Token.LBracket,c];
	    case ']':
		return [Token.RBracket,c];
	    case '{':
		return [Token.LBrace,c];
	    case '}':
		return [Token.RBrace,c];
	    case '.': {
		if (this.loc+2 <= this.end && this.input.charAt(this.loc) == '.' && this.input.charAt(this.loc+1) == '.') {
		    this.loc += 2;
		    return [Token.DotDotDot,"..."];
		}
		// TODO: Is eg .075 legal number syntax?
		return [Token.Dot,c];
	    }
	    case '"':
	    case '\'': {
		// Scan a string literal
		return [Token.Other, ...];
	    }
	    case '`': {
		// Scan a backtick literal
		return [Token.Other, ...];
	    }
	    case '/': {
		// Comment, division operator, regular expression literal
		// Within /* .. */ comments track the line number, but this turns into a single "Spaces" thing (note ASI?)
		// Regular expressions are hard if we don't want to parse expressions.   The thing to do is probably this:
		//  - start lexing as a regex
		//  - if it succeeds before end-of-line, pass it to new RegExp
		//  - if that does not throw, assume it's a RegExp
		//  - it is possible to get this wrong, consider x / y / z which is a valid expression.
		//    if we get it wrong we still won't unbalance parentheses, but macro substitution
		//    won't be performed within the presumed regex / y /, so if y is SELF.zappa then
		//    we're sunk.  To do better, we must have a full expression parser.  However,
		//    a useful heuristic is to track the previous nonspace token, and to have a table that
		//    determines, based on that token, whether a possible-regex could ever be a
		//    valid-regex in that context.  The problem is, that token may have to be somewhat
		//    detailed - it must distinguish operators and literals, at least.
		...;
	    }
	    case '@': {
		if (this.loc+6 <= this.end && this.input.substring(this.pos, this.pos+6) == "flatjs") {
		    this.pos += 6;
		    return [Token.FlatJS, "@flatjs"];
		}
		return [Token.Other,c];
	    }
	    default: {
		if (c >= '0' && c <= '9') {
		    // Scan a number
		    return [Token.Other, ...];
		}
		if (isIdentChar(c)) {
		    // Scan an identifier or keyword
		    return [Token.Id, ...];
		}
		// String of spaces starting with unconventional space
		if (isSpace(c))
		    return scanSpaces(c);

		// Otherwise, probably some sort of operator, one or more letters.  We could gobble
		// a char at a time until we see something invalid.  We might be able to use that for "most things"
		// actually, though note "." to "..." requires a leap of faith.  Longest operator is four chars: >>>=.
	    }
	}
    }

    private spaces(s:string): [Token,string] {
	var c = " ";
	while (this.loc < this.end && this.isSpace(c = this.input.charAt(this.loc))) {
	    this.loc++;
	    s += c;
	}
	return [Token.Spaces,s];
    }

    private linebreak(c:string): [Token,string] {
	if (c == "\r" && this.loc < this.end && this.input.charAt(this.loc) == "\n") {
	    this.loc++;
	    return [Token.Linebreak,"\r\n"];
	}
	return [Token.Linebreak,c];
    }

    private isSpace(c:string): boolean {
	// FIXME
    }
}
