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
var Token;
(function (Token) {
    Token[Token["Unused"] = 0] = "Unused";
    Token[Token["Id"] = 1] = "Id";
    Token[Token["Dot"] = 2] = "Dot";
    Token[Token["DotDotDot"] = 3] = "DotDotDot";
    Token[Token["Colon"] = 4] = "Colon";
    Token[Token["Semicolon"] = 5] = "Semicolon";
    Token[Token["Comma"] = 6] = "Comma";
    Token[Token["LBracket"] = 7] = "LBracket";
    Token[Token["RBracket"] = 8] = "RBracket";
    Token[Token["LParen"] = 9] = "LParen";
    Token[Token["RParen"] = 10] = "RParen";
    Token[Token["LBrace"] = 11] = "LBrace";
    Token[Token["RBrace"] = 12] = "RBrace";
    Token[Token["Assign"] = 13] = "Assign";
    Token[Token["Other"] = 14] = "Other";
    Token[Token["Spaces"] = 15] = "Spaces";
    Token[Token["Linebreak"] = 16] = "Linebreak";
    Token[Token["Comment"] = 17] = "Comment";
    Token[Token["SetLine"] = 18] = "SetLine";
    Token[Token["FlatJS"] = 19] = "FlatJS";
    Token[Token["New"] = 20] = "New";
    Token[Token["EOI"] = 21] = "EOI"; // Always the last token
})(Token || (Token = {}));
;
var optrie = (function () {
    var operator = {
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
    function enter(t, k, v) {
        if (k.length == 0) {
            t.value = v;
            return;
        }
        var c = k.charAt(0);
        if (typeof t[c] != "object")
            t[c] = {};
        enter(t[c], k.substring(1), v);
    }
    var t = {};
    for (var k in operator)
        enter(t, k, operator[k]);
    return t;
})();
var Retokenizer = (function () {
    function Retokenizer(input, loc, end) {
        if (loc === void 0) { loc = 0; }
        if (end === void 0) { end = -1; }
        this.input = input;
        this.loc = loc;
        this.end = end;
        if (this.end == -1)
            this.end = this.input.length;
    }
    Retokenizer.prototype.next = function () {
        if (this.loc == this.end)
            return [Token.EOI, ""];
        return this.input[this.loc++];
    };
    return Retokenizer;
})();
var Tokenizer = (function () {
    // reportError must throw an exception.  line is the line number
    // within the input, counting the first line starting at loc.
    function Tokenizer(input, reportError, loc, end) {
        if (loc === void 0) { loc = 0; }
        if (end === void 0) { end = -1; }
        this.input = input;
        this.reportError = reportError;
        this.loc = loc;
        this.end = end;
        this.lineNumber = 0;
        this.adjustLineNumber = false;
        if (this.end == -1)
            this.end = this.input.length;
    }
    // TODO: For typescript, we must worry about nested template
    // types, perhaps.  T<W<X>> would be context-sensitive, normally
    // >> is shift-right.
    Tokenizer.prototype.next = function () {
        for (;;) {
            if (this.adjustLineNumber) {
                this.adjustLineNumber = false;
                return [Token.SetLine, "/*" + this.lineNumber + "*/"];
            }
            if (this.loc == this.end)
                return [Token.EOI, ""];
            var c = this.input.charAt(this.loc++);
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
                    var d = this.input.charAt(this.loc);
                    if (d == '/') {
                        this.loc++;
                        return this.lexLineComment();
                    }
                    if (d == '*') {
                        this.loc++;
                        return this.lexBlockComment();
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
                    var s = this.lexRegexMaybe();
                    if (s)
                        return [Token.Other, s];
                }
            }
            if (c == '@') {
                // FIXME: subsequent must not be ident char
                if (this.loc + 6 <= this.end && this.input.substring(this.loc, this.loc + 6) == "flatjs") {
                    this.loc += 6;
                    return [Token.FlatJS, "@flatjs"];
                }
                if (this.loc + 3 <= this.end && this.input.substring(this.loc, this.loc + 3) == "new") {
                    this.loc += 3;
                    return [Token.New, "@new"];
                }
                return [Token.Other, c];
            }
            if (this.isDigit(c) || c == "." && this.loc < this.end && this.isDigit(this.input.charAt(this.loc)))
                return this.lexNumber(c);
            if (this.isInitial(c))
                return this.lexIdent(c);
            if (optrie[c])
                return this.lexOperator(c);
            return [Token.Other, c];
        }
    };
    Tokenizer.prototype.lexSpaces = function (s) {
        var c = " ";
        while (this.loc < this.end && this.isSpace(c = this.input.charAt(this.loc))) {
            this.loc++;
            s += c;
        }
        return [Token.Spaces, s];
    };
    Tokenizer.prototype.lexLinebreak = function (c) {
        this.lineNumber++;
        if (c == "\r" && this.loc < this.end && this.input.charAt(this.loc) == "\n") {
            this.loc++;
            return [Token.Linebreak, "\r\n"];
        }
        return [Token.Linebreak, c];
    };
    Tokenizer.prototype.lexString = function (terminator) {
        var s = terminator;
        var c = " ";
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
    };
    // TODO: Implement this properly - presumably there are escape
    // characters, at a minimum.
    Tokenizer.prototype.lexTemplate = function () {
        var s = "`";
        var lineBefore = this.lineNumber;
        for (;;) {
            if (this.loc == this.end)
                this.reportError(this.lineNumber, "End-of-file inside template string");
            var c = this.input.charAt(this.loc++);
            if (this.isLinebreak(c)) {
                var _a = this.lexLinebreak(c), t = _a[0], q = _a[1];
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
        return [Token.Other, s];
    };
    // Returns null if this is thought not to be a regex, otherwise
    // the regex source.  If it returns null it does not advance the
    // input pointer.  It never throws an error.
    //
    // Algorithm:
    //  - start lexing as a regex
    //  - if it succeeds before end-of-line, pass it to new RegExp
    //  - if that does not throw, assume it's a RegExp
    Tokenizer.prototype.lexRegexMaybe = function () {
        // FIXME: Implement this
        return null;
    };
    Tokenizer.prototype.lexNumber = function (c) {
        var s = c;
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
    };
    Tokenizer.prototype.lexDigits = function (mustHave) {
        var s = "";
        var c = " ";
        while (this.loc < this.end && this.isDigit(c = this.input.charAt(this.loc))) {
            s += c;
            this.loc++;
        }
        if (mustHave && s.length == 0)
            this.reportError(this.lineNumber, "One or more digits required");
        return s;
    };
    Tokenizer.prototype.lexIdent = function (c) {
        var s = c;
        while (this.loc < this.end && this.isSubsequent(c = this.input.charAt(this.loc))) {
            this.loc++;
            s += c;
        }
        return [Token.Id, s];
    };
    Tokenizer.prototype.lexLineComment = function () {
        var s = "//";
        var c = " ";
        while (this.loc < this.end && !this.isLinebreak(c = this.input.charAt(this.loc))) {
            this.loc++;
            s += c;
        }
        return [Token.Spaces, s];
    };
    Tokenizer.prototype.lexBlockComment = function () {
        var lineBefore = this.lineNumber;
        var s = "/*";
        for (;;) {
            if (this.loc == this.end)
                this.reportError(this.lineNumber, "End-of-file inside comment");
            var c = this.input.charAt(this.loc++);
            if (c == '*') {
                s += c;
                if (this.loc < this.end && this.input.charAt(this.loc) == '/') {
                    s += '/';
                    this.loc++;
                    break;
                }
            }
            else if (this.isLinebreak(c)) {
                var _a = this.lexLinebreak(c), t = _a[0], x = _a[1];
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
    };
    Tokenizer.prototype.lexOperator = function (c) {
        return this.search(optrie[c], c);
    };
    // Not a nested function because of "this" insanity in JS.
    Tokenizer.prototype.search = function (t, s) {
        if (this.loc == this.end)
            return [Token.Unused, ""];
        var c = this.input.charAt(this.loc);
        if (typeof t[c] == "undefined") {
            if (t.value)
                return [t.value, s];
            return [Token.Unused, ""];
        }
        this.loc++;
        var _a = this.search(t[c], s + c), t2 = _a[0], s2 = _a[1];
        if (t2 == Token.Unused) {
            this.loc--;
            if (t.value)
                return [t.value, s];
        }
        return [t2, s2];
    };
    // The following predicates are naive.
    Tokenizer.prototype.isInitial = function (c) {
        if (c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c == '_' || c == '$')
            return true;
        return false;
    };
    Tokenizer.prototype.isSubsequent = function (c) {
        if (c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c == '_' || c == '$' || c >= '0' && c <= '9')
            return true;
        return false;
    };
    Tokenizer.prototype.isDigit = function (c) {
        return (c >= '0' && c <= '9');
    };
    Tokenizer.prototype.isLinebreak = function (c) {
        switch (c) {
            case '\r':
            case '\n':
                return true;
            default:
                return false;
        }
    };
    Tokenizer.prototype.isSpace = function (c) {
        switch (c) {
            case ' ':
            case '\t':
                return true;
            default:
                return false;
        }
    };
    return Tokenizer;
})();
