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
    Token[Token["SetFile"] = 19] = "SetFile";
    Token[Token["FlatJS"] = 20] = "FlatJS";
    Token[Token["New"] = 21] = "New";
    Token[Token["EOI"] = 22] = "EOI"; // Always the last token
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
/* -*- mode: javascript; electric-indent-local-mode: nil -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Author: Lars T Hansen, lhansen@mozilla.com
 */
var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
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
var fs = require("fs");
var VERSION = "0.6";
var DefnKind;
(function (DefnKind) {
    DefnKind[DefnKind["Class"] = 0] = "Class";
    DefnKind[DefnKind["Struct"] = 1] = "Struct";
    DefnKind[DefnKind["Primitive"] = 2] = "Primitive";
})(DefnKind || (DefnKind = {}));
var Defn = (function () {
    function Defn(name, kind) {
        this.name = name;
        this.kind = kind;
        this.size = 0;
        this.align = 0;
    }
    Object.defineProperty(Defn.prototype, "elementSize", {
        get: function () { return this.size; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Defn.prototype, "elementAlign", {
        get: function () { return this.align; },
        enumerable: true,
        configurable: true
    });
    Defn.pointerSize = 4;
    Defn.pointerAlign = 4;
    Defn.pointerTypeName = "int32";
    Defn.pointerMemName = "_mem_int32";
    return Defn;
})();
var PrimKind;
(function (PrimKind) {
    PrimKind[PrimKind["Vanilla"] = 0] = "Vanilla";
    PrimKind[PrimKind["Atomic"] = 1] = "Atomic";
    PrimKind[PrimKind["Synchronic"] = 2] = "Synchronic";
    PrimKind[PrimKind["SIMD"] = 3] = "SIMD";
})(PrimKind || (PrimKind = {}));
var PrimitiveDefn = (function (_super) {
    __extends(PrimitiveDefn, _super);
    function PrimitiveDefn(name, size, align, primKind) {
        if (primKind === void 0) { primKind = PrimKind.Vanilla; }
        _super.call(this, name, DefnKind.Primitive);
        this.primKind = primKind;
        this.size = size;
        this.align = align;
        if (primKind == PrimKind.SIMD)
            this._memory = "_mem_" + name.split("x")[0];
        else
            this._memory = "_mem_" + name.split("/").pop();
    }
    Object.defineProperty(PrimitiveDefn.prototype, "memory", {
        get: function () {
            return this._memory;
        },
        enumerable: true,
        configurable: true
    });
    return PrimitiveDefn;
})(Defn);
var AtomicDefn = (function (_super) {
    __extends(AtomicDefn, _super);
    function AtomicDefn(name, size, align) {
        _super.call(this, name, size, align, PrimKind.Atomic);
    }
    return AtomicDefn;
})(PrimitiveDefn);
var SynchronicDefn = (function (_super) {
    __extends(SynchronicDefn, _super);
    function SynchronicDefn(name, size, align, baseSize) {
        _super.call(this, name, size, align, PrimKind.Synchronic);
        this.baseSize = baseSize;
    }
    // The byte offset within the structure for the payload
    SynchronicDefn.bias = 8;
    return SynchronicDefn;
})(PrimitiveDefn);
var SIMDDefn = (function (_super) {
    __extends(SIMDDefn, _super);
    function SIMDDefn(name, size, align, baseSize) {
        _super.call(this, name, size, align, PrimKind.SIMD);
        this.baseSize = baseSize;
    }
    return SIMDDefn;
})(PrimitiveDefn);
var UserDefn = (function (_super) {
    __extends(UserDefn, _super);
    function UserDefn(file, line, name, kind, props, methods, origin) {
        _super.call(this, name, kind);
        this.file = file;
        this.line = line;
        this.props = props;
        this.methods = methods;
        this.origin = origin;
        this.typeRef = null;
        this.map = null;
        this.live = false;
        this.checked = false;
    }
    UserDefn.prototype.findAccessibleFieldFor = function (operation, prop) {
        var d = this.map.get(prop);
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
                var prim = d.type;
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
                var prim = d.type;
                if (prim.primKind != PrimKind.Synchronic)
                    return null;
                return d;
            }
            default:
                return null;
        }
    };
    return UserDefn;
})(Defn);
var ClassDefn = (function (_super) {
    __extends(ClassDefn, _super);
    function ClassDefn(file, line, name, baseName, props, methods, origin) {
        _super.call(this, file, line, name, DefnKind.Class, props, methods, origin);
        this.baseName = baseName;
        this.baseTypeRef = null;
        this.className = ""; // Base1>Base2>name
        this.classId = 0;
        this.subclasses = []; // direct proper subclasses
        this.vtable = null;
    }
    Object.defineProperty(ClassDefn.prototype, "elementSize", {
        get: function () { return Defn.pointerSize; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ClassDefn.prototype, "elementAlign", {
        get: function () { return Defn.pointerAlign; },
        enumerable: true,
        configurable: true
    });
    ClassDefn.prototype.hasMethod = function (name) {
        for (var _i = 0, _a = this.methods; _i < _a.length; _i++) {
            var m = _a[_i];
            if (m.name == name)
                return true;
        }
        return false;
    };
    ClassDefn.prototype.getMethod = function (name) {
        for (var _i = 0, _a = this.methods; _i < _a.length; _i++) {
            var m = _a[_i];
            if (m.name == name)
                return m;
        }
        return null;
    };
    return ClassDefn;
})(UserDefn);
var Virtual = (function () {
    function Virtual(name, sign, reverseCases, default_) {
        this.name = name;
        this.sign = sign;
        this.reverseCases = reverseCases;
        this.default_ = default_;
    }
    Virtual.prototype.signature = function () {
        if (this.sign == null)
            return ", ...args";
        if (this.sign.length == 0)
            return "";
        return ", " + this.sign.join(",");
    };
    return Virtual;
})();
var VirtualMethodIterator = (function () {
    function VirtualMethodIterator(cls) {
        this.cls = cls;
        this.i = 0;
        this.inherited = false;
        this.filter = new SSet();
    }
    VirtualMethodIterator.prototype.next = function () {
        for (;;) {
            if (this.i == this.cls.methods.length) {
                if (!this.cls.baseTypeRef)
                    return ["", null, false];
                this.i = 0;
                this.cls = this.cls.baseTypeRef;
                this.inherited = true;
                continue;
            }
            var m = this.cls.methods[this.i++];
            if (m.kind != MethodKind.Virtual)
                continue;
            if (this.filter.test(m.name))
                continue;
            this.filter.put(m.name);
            return [m.name, m.signature, this.inherited];
        }
    };
    return VirtualMethodIterator;
})();
var InclusiveSubclassIterator = (function () {
    function InclusiveSubclassIterator(cls) {
        this.stack = [];
        this.stack.push(cls);
    }
    InclusiveSubclassIterator.prototype.next = function () {
        if (this.stack.length == 0)
            return null;
        var top = this.stack.pop();
        if (typeof top == "number") {
            var x = top;
            var xs = this.stack.pop();
            var cls = xs[x++];
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
            var x = top;
            if (x.subclasses.length > 0) {
                this.stack.push(x.subclasses);
                this.stack.push(0);
            }
            return x;
        }
    };
    return InclusiveSubclassIterator;
})();
var StructDefn = (function (_super) {
    __extends(StructDefn, _super);
    function StructDefn(file, line, name, props, methods, origin) {
        _super.call(this, file, line, name, DefnKind.Struct, props, methods, origin);
        this.hasGetMethod = false;
        this.hasSetMethod = false;
        for (var _i = 0; _i < methods.length; _i++) {
            var m = methods[_i];
            if (m.kind == MethodKind.Get)
                this.hasGetMethod = true;
            else if (m.kind == MethodKind.Set)
                this.hasSetMethod = true;
        }
    }
    return StructDefn;
})(UserDefn);
var PropQual;
(function (PropQual) {
    PropQual[PropQual["None"] = 0] = "None";
    PropQual[PropQual["Atomic"] = 1] = "Atomic";
    PropQual[PropQual["Synchronic"] = 2] = "Synchronic";
})(PropQual || (PropQual = {}));
var Prop = (function () {
    function Prop(line, name, qual, isArray, typeName) {
        this.line = line;
        this.name = name;
        this.qual = qual;
        this.isArray = isArray;
        this.typeName = typeName;
        this.typeRef = null;
    }
    return Prop;
})();
var MethodKind;
(function (MethodKind) {
    MethodKind[MethodKind["Virtual"] = 0] = "Virtual";
    MethodKind[MethodKind["NonVirtual"] = 1] = "NonVirtual";
    MethodKind[MethodKind["Get"] = 2] = "Get";
    MethodKind[MethodKind["Set"] = 3] = "Set";
})(MethodKind || (MethodKind = {}));
var Method = (function () {
    function Method(line, kind, name, signature, body) {
        this.line = line;
        this.kind = kind;
        this.name = name;
        this.signature = signature;
        this.body = body;
    }
    return Method;
})();
var MapEntry = (function () {
    function MapEntry(name, expand, offset, type) {
        this.name = name;
        this.expand = expand;
        this.offset = offset;
        this.type = type;
    }
    Object.defineProperty(MapEntry.prototype, "memory", {
        get: function () {
            if (this.type.kind != DefnKind.Primitive)
                throw new InternalError("No memory type available for non-primitive type " + this.type.name);
            return this.type.memory;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(MapEntry.prototype, "size", {
        get: function () {
            return this.type.size;
        },
        enumerable: true,
        configurable: true
    });
    MapEntry.prototype.toString = function () {
        return "(" + this.name + " " + this.expand + " " + this.offset + " " + this.type.name + ")";
    };
    return MapEntry;
})();
// Simple map from string to T.  Allows properties to be added and
// updated, but not to be removed.
var SMap = (function () {
    function SMap() {
        this.props = [];
        this.mapping = {}; // Map from name to index
        this.generation = 0; // Incremented on update (but not on add)
    }
    SMap.prototype.test = function (n) {
        return typeof this.mapping[n] == "number";
    };
    SMap.prototype.get = function (n) {
        var probe = this.mapping[n];
        if (typeof probe == "number")
            return this.props[probe].value;
        return null;
    };
    SMap.prototype.put = function (n, v) {
        var probe = this.mapping[n];
        if (typeof probe == "number") {
            this.props[probe].value = v;
            this.generation++;
        }
        else {
            this.mapping[n] = this.props.length;
            this.props.push({ name: n, value: v });
        }
    };
    SMap.prototype.copy = function () {
        var newMap = new SMap();
        newMap.props = this.props.slice(0);
        for (var n in this.mapping)
            if (this.mapping.hasOwnProperty(n))
                newMap.mapping[n] = this.mapping[n];
        return newMap;
    };
    SMap.prototype.values = function () {
        var theMap = this;
        var generation = this.generation;
        var props = this.props;
        var i = 0;
        return { next: function () {
                if (theMap.generation != generation)
                    throw new InternalError("Generator invalidated by assignment");
                if (i == props.length)
                    return null;
                return props[i++].value;
            } };
    };
    SMap.prototype.keysValues = function () {
        var theMap = this;
        var generation = this.generation;
        var props = this.props;
        var i = 0;
        return { next: function () {
                if (theMap.generation != generation)
                    throw new InternalError("Generator invalidated by assignment");
                if (i == props.length)
                    return [null, null];
                var x = props[i++];
                return [x.name, x.value];
            } };
    };
    return SMap;
})();
// String set
var SSet = (function () {
    function SSet() {
        this.mapping = {}; // Map from name to true
    }
    SSet.prototype.test = function (n) {
        return typeof this.mapping[n] == "boolean";
    };
    SSet.prototype.put = function (n) {
        this.mapping[n] = true;
    };
    return SSet;
})();
// Temporary hack
var SourceLine = (function () {
    function SourceLine(file, line, text) {
        this.file = file;
        this.line = line;
        this.text = text;
    }
    return SourceLine;
})();
var Source = (function () {
    function Source(input_file, output_file, defs, tokens) {
        this.input_file = input_file;
        this.output_file = output_file;
        this.defs = defs;
        this.tokens = tokens;
        this.lines = null; // A hack
    }
    Source.prototype.allText = function () {
        if (this.lines)
            return this.lines.map(function (x) { return x.text; }).join("\n");
        return this.tokens.map(function (x) { return x[1]; }).join("");
    };
    return Source;
})();
var CapturedError = (function () {
    function CapturedError(name, message) {
        this.name = name;
        this.message = message;
    }
    return CapturedError;
})();
var InternalError = (function (_super) {
    __extends(InternalError, _super);
    function InternalError(msg) {
        _super.call(this, "InternalError", "Internal error: " + msg);
    }
    return InternalError;
})(CapturedError);
var UsageError = (function (_super) {
    __extends(UsageError, _super);
    function UsageError(msg) {
        _super.call(this, "UsageError", "Usage error: " + msg);
    }
    return UsageError;
})(CapturedError);
var ProgramError = (function (_super) {
    __extends(ProgramError, _super);
    function ProgramError(file, line, msg) {
        _super.call(this, "ProgramError", file + ":" + line + ": " + msg);
    }
    return ProgramError;
})(CapturedError);
var allSources = [];
function main(args) {
    try {
        for (var _i = 0; _i < args.length; _i++) {
            var input_file = args[_i];
            if (!(/.\.flat_[a-zA-Z0-9]+$/.test(input_file)))
                throw new UsageError("Bad file name (must be *.flat_<extension>): " + input_file);
            var text = fs.readFileSync(input_file, "utf8");
            //let lines = text.split("\n");
            var _a = collectDefinitions(input_file, text), defs = _a[0], residual = _a[1];
            var output_file = input_file.replace(/\.flat_([a-zA-Z0-9]+)$/, ".$1");
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
        for (var _b = 0; _b < allSources.length; _b++) {
            var s = allSources[_b];
            fs.writeFileSync(s.output_file, "// Generated from " + s.input_file + " by fjsc " + VERSION + "; github.com/lars-t-hansen/flatjs\n" + s.allText(), "utf8");
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
function log2(x) {
    if (x <= 0)
        throw new InternalError("log2: " + x);
    var i = 0;
    while (x > 1) {
        i++;
        x >>= 1;
    }
    return i;
}
function warning(file, line, msg) {
    console.log(file + ":" + line + ": Warning: " + msg);
}
//////////////////////////////////////////////////////////////////////////////////////////
//
// Parsing
var TokenScanner = (function () {
    function TokenScanner(ts, reportError, line) {
        if (line === void 0) { line = 1; }
        this.ts = ts;
        this.reportError = reportError;
        // The current line number.  Do not set this directly.
        this.line = 0;
        this.current = ts.next();
        this.line = line;
    }
    // Advance to next token, return current token.  Update line
    // numbers.  This is used for all token advance, even internally,
    // and can be overridden to add functionality such as a
    // transducer.
    TokenScanner.prototype.advance = function () {
        switch (this.current[0]) {
            case Token.Linebreak:
                this.line++;
                break;
            case Token.SetLine:
                this.line = extractLine(this.current[1]);
                break;
        }
        var result = this.current;
        this.current = this.ts.next();
        return result;
    };
    // Shorthand for matching an Id with the given ID name.
    TokenScanner.prototype.matchName = function (name) {
        var s = this.matchId();
        if (s != name)
            this.reportError(this.line, "Expected '" + name + "' but encountered '" + s + "'");
    };
    // Shorthand for matching an Id; return the ID name.
    TokenScanner.prototype.matchId = function () {
        return this.match(Token.Id)[1];
    };
    // Skip spaces.  If the leading token then matches t then return it and advance.
    // Otherwise signal an error.
    TokenScanner.prototype.match = function (t) {
        if (!this.lookingAt(t))
            this.reportError(this.line, "Expected " + Token[t] + " but encountered " + Token[this.current[0]]);
        return this.advance();
    };
    // Skip spaces.  Return true iff the leading token then matches t.
    TokenScanner.prototype.lookingAt = function (t) {
        this.skipSpace();
        return this.current[0] == t;
    };
    // Skip across whitespace and comments, maintaining line number.
    TokenScanner.prototype.skipSpace = function () {
        loop: for (;;) {
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
    };
    return TokenScanner;
})();
// Given a string of the form "/*n*/", return n as a number.
function extractLine(tk) {
    return parseInt(tk.substring(2, tk.length - 2));
}
var ParenCounter = (function () {
    function ParenCounter(ts) {
        this.ts = ts;
        this.pstack = [];
        this.level = 0;
        this.isUnbalanced = false;
    }
    ParenCounter.prototype.lookingAt = function (t) {
        return this.ts.lookingAt(t);
    };
    ParenCounter.prototype.advance = function () {
        var t = this.ts.advance();
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
    };
    return ParenCounter;
})();
var TokenTransducer = (function (_super) {
    __extends(TokenTransducer, _super);
    function TokenTransducer(ts, reportError, line) {
        if (line === void 0) { line = 1; }
        _super.call(this, ts, reportError, line);
        this.output = [];
        this.loc = 0;
    }
    Object.defineProperty(TokenTransducer.prototype, "tokens", {
        get: function () {
            var result = this.output;
            this.output = [];
            return result;
        },
        enumerable: true,
        configurable: true
    });
    TokenTransducer.prototype.advance = function () {
        var t = _super.prototype.advance.call(this);
        this.output.push(t);
        return t;
    };
    TokenTransducer.prototype.inject = function (t) {
        this.output.push(t);
    };
    TokenTransducer.prototype.mark = function () {
        return this.output.length;
    };
    TokenTransducer.prototype.release = function (mark) {
        this.output.length = mark;
    };
    return TokenTransducer;
})(TokenScanner);
var TokenSet = (function () {
    function TokenSet() {
        var tokens = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            tokens[_i - 0] = arguments[_i];
        }
        this.ts = [];
        for (var i = 0; i <= Token.EOI; i++)
            this.ts[i] = false;
        for (var _a = 0; _a < tokens.length; _a++) {
            var t = tokens[_a];
            this.ts[t] = true;
        }
    }
    TokenSet.prototype.contains = function (t) {
        return this.ts[t];
    };
    return TokenSet;
})();
function collectDefinitions(file, input) {
    var defs = [];
    var ntokens = [];
    var residualLines = 1;
    var lineAfter = 1;
    var ts = new TokenScanner(new Tokenizer(input, standardErrHandler(file)), standardErrHandler(file));
    loop: for (;;) {
        var t = ts.advance();
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
function parseDefn(file, ts, origin) {
    var kind = ts.matchId();
    if (kind != "struct" && kind != "class")
        throw new ProgramError(file, ts.line, "Syntax error: Expected 'class' or 'struct'");
    var defLine = ts.line;
    var defName = ts.matchId();
    var inherit = "";
    if (kind == "class") {
        if (ts.lookingAt(Token.Id)) {
            ts.matchName("extends");
            inherit = ts.matchId();
        }
    }
    var properties = [];
    var methods = [];
    ts.match(Token.LBrace);
    while (!ts.lookingAt(Token.RBrace)) {
        var memberName = ts.matchId();
        var memberLine = ts.line;
        if (ts.lookingAt(Token.Colon)) {
            ts.advance();
            var basename = ts.matchId();
            var lineOfDefn = ts.line;
            var qual = PropQual.None;
            var isArray = false;
            // Currently only [.atomic|.synchronic][.Array]
            if (ts.lookingAt(Token.Dot)) {
                ts.advance();
                var mustHaveArray = false;
                var q1 = ts.matchId();
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
            var method_type = MethodKind.NonVirtual;
            if (memberName == "virtual") {
                if (kind == "struct")
                    throw new ProgramError(file, ts.line, "virtual methods are not allowed in structs");
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
            var mbody = [];
            var pstack = [];
            var pc = new ParenCounter(ts);
            for (;;) {
                var t = pc.advance();
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
function parseSignature(file, line, mbody) {
    var ts2 = new TokenScanner(new Retokenizer(mbody), standardErrHandler(file), line);
    var method_signature = [];
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
            var pc = new ParenCounter(ts2);
            while (pc.level > 0 || !pc.lookingAt(Token.Comma) && !pc.lookingAt(Token.RParen)) {
                var t = pc.advance();
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
function parseArgument(file, line, tokens) {
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
function parseExpression(file, line, tokens) {
    return parseExpr(file, line, tokens, new TokenSet(Token.Comma, Token.RParen, Token.RBrace, Token.RBracket, Token.Linebreak, Token.Comment, Token.Semicolon, Token.EOI));
}
function parseExpr(file, line, ts2, stopset) {
    var pc = new ParenCounter(ts2);
    var expr = [];
    while (pc.level > 0 || !stopset.contains(ts2.current[0])) {
        var t = pc.advance();
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
var ParamParser = (function () {
    function ParamParser(file, line, input, pos, requireRightParen, stopAtSemi) {
        if (requireRightParen === void 0) { requireRightParen = true; }
        if (stopAtSemi === void 0) { stopAtSemi = false; }
        this.file = file;
        this.line = line;
        this.input = input;
        this.pos = pos;
        this.requireRightParen = requireRightParen;
        this.stopAtSemi = stopAtSemi;
        this.lim = 0;
        this.done = false;
        this.sawSemi = false;
        this.lim = input.length;
    }
    // Returns null on failure to find a next argument
    ParamParser.prototype.nextArg = function () {
        if (this.done)
            return null;
        var depth = 0;
        var start = this.pos;
        var sawRightParen = false;
        var sawComma = false;
        var fellOff = false;
        // Issue #8: Really should handle regular expressions, but much harder, and somewhat marginal
        loop: for (;;) {
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
                    var c = this.input.charAt(this.pos - 1);
                    for (;;) {
                        if (this.pos == this.lim)
                            throw new ProgramError(this.file, this.line, "Line ended unexpectedly - within a string.");
                        var d = this.input.charAt(this.pos++);
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
        var result = this.cleanupArg(this.input.substring(start, fellOff ? this.pos : this.pos - 1));
        // Don't consume it if we don't know if we're going to find it.
        if (sawRightParen && !this.requireRightParen)
            this.pos--;
        if (this.done && depth > 0)
            throw new ProgramError(this.file, this.line, "Line ended unexpectedly - still nested within parentheses.");
        if (this.done && this.requireRightParen && !sawRightParen)
            throw new ProgramError(this.file, this.line, "Line ended unexpectedly - expected ')'.  " + this.input);
        return result;
    };
    ParamParser.prototype.allArgs = function () {
        var as = [];
        var a;
        while (a = this.nextArg())
            as.push(a);
        return as;
    };
    Object.defineProperty(ParamParser.prototype, "where", {
        get: function () {
            return this.pos;
        },
        enumerable: true,
        configurable: true
    });
    ParamParser.prototype.cleanupArg = function (s) {
        s = s.replace(/^\s*|\s*$/g, "");
        if (s == "")
            return null;
        return s;
    };
    return ParamParser;
})();
function isInitial(c) {
    return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c == '_';
}
function isSubsequent(c) {
    return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_';
}
//////////////////////////////////////////////////////////////////////////////////////////
//
// Type checking
var knownTypes = new SMap();
var knownIds = new SMap();
var userTypes = [];
function buildTypeMap() {
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
    for (var _i = 0; _i < allSources.length; _i++) {
        var s = allSources[_i];
        for (var _a = 0, _b = s.defs; _a < _b.length; _a++) {
            var d = _b[_a];
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
function resolveTypeRefs() {
    for (var _i = 0; _i < userTypes.length; _i++) {
        var d = userTypes[_i];
        if (d.kind == DefnKind.Class) {
            var cls = d;
            if (cls.baseName != "") {
                var probe = knownTypes.get(cls.baseName);
                if (!probe)
                    throw new ProgramError(cls.file, cls.line, "Missing base type: " + cls.baseName);
                if (probe.kind != DefnKind.Class)
                    throw new ProgramError(cls.file, cls.line, "Base type is not class: " + cls.baseName);
                cls.baseTypeRef = probe;
                cls.baseTypeRef.subclasses.push(cls);
            }
        }
        for (var _a = 0, _b = d.props; _a < _b.length; _a++) {
            var p = _b[_a];
            if (!knownTypes.test(p.typeName))
                throw new ProgramError(d.file, p.line, "Undefined type: " + p.typeName);
            var ty = null;
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
function checkRecursion() {
    for (var _i = 0; _i < userTypes.length; _i++) {
        var d = userTypes[_i];
        if (d.kind == DefnKind.Struct)
            checkRecursionForStruct(d);
        else if (d.kind == DefnKind.Class)
            checkRecursionForClass(d);
    }
    // For a struct type, check that it does not include itself.
    function checkRecursionForStruct(d) {
        if (d.checked)
            return;
        d.live = true;
        for (var _i = 0, _a = d.props; _i < _a.length; _i++) {
            var p = _a[_i];
            if (p.isArray)
                continue;
            var probe = knownTypes.get(p.typeName);
            if (!probe || probe.kind != DefnKind.Struct)
                continue;
            var s = probe;
            if (s.live)
                throw new ProgramError(d.file, p.line, "Recursive type reference to struct " + p.typeName + " from " + d.name);
            p.typeRef = s;
            checkRecursionForStruct(s);
        }
        d.live = false;
        d.checked = true;
    }
    // For a class type, check that it does not inherit from itself.
    function checkRecursionForClass(d) {
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
function checkMethods() {
    for (var _i = 0; _i < userTypes.length; _i++) {
        var d = userTypes[_i];
        if (d.kind != DefnKind.Class)
            continue;
        var cls = d;
        for (var _a = 0, _b = d.methods; _a < _b.length; _a++) {
            var m = _b[_a];
            for (var b = cls.baseTypeRef; b; b = b.baseTypeRef) {
                var bm = b.getMethod(m.name);
                if (!bm)
                    continue;
                if (m.kind == MethodKind.NonVirtual && bm.kind == MethodKind.Virtual)
                    throw new ProgramError(cls.file, m.line, "Non-virtual method " + m.name + " is defined virtual in a base class " + b.name + " (" + b.file + ":" + b.line + ")");
                if (m.kind == MethodKind.Virtual && bm.kind != MethodKind.Virtual)
                    throw new ProgramError(cls.file, m.line, "Virtual method " + m.name + " is defined non-virtual in a base class " + b.name + " (" + b.file + ":" + b.line + ")");
                if (m.kind == MethodKind.Virtual) {
                }
            }
        }
    }
}
function layoutTypes() {
    for (var _i = 0; _i < userTypes.length; _i++) {
        var d = userTypes[_i];
        if (d.kind == DefnKind.Class)
            layoutClass(d);
        else
            layoutStruct(d);
    }
}
function layoutClass(d) {
    var map = new SMap();
    var size = 4;
    var align = 4;
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
    var idAsString = String(d.classId);
    if (knownIds.test(idAsString))
        throw new ProgramError(d.file, d.line, "Duplicate class ID for " + d.className + ": previous=" + knownIds.get(idAsString).className);
    knownIds.put(idAsString, d);
}
function layoutStruct(d) {
    layoutDefn(d, new SMap(), 0, 0);
}
function layoutDefn(d, map, size, align) {
    for (var _i = 0, _a = d.props; _i < _a.length; _i++) {
        var p = _a[_i];
        var k = p.typeRef.kind;
        if (p.isArray)
            k = DefnKind.Class;
        switch (k) {
            case DefnKind.Primitive: {
                var pt = p.typeRef;
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
                var st = p.typeRef;
                if (st.map == null)
                    layoutStruct(st);
                size = (size + st.align - 1) & ~(st.align - 1);
                align = Math.max(align, st.align);
                map.put(p.name, new MapEntry(p.name, false, size, st));
                var root = p.name;
                var mIter = st.map.values();
                for (var fld = mIter.next(); fld; fld = mIter.next()) {
                    var fldname = root + "." + fld.name;
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
function computeClassId(name) {
    var n = name.length;
    for (var i = 0; i < name.length; i++) {
        var c = name.charAt(i);
        var v = 0;
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
function createVirtuals() {
    for (var _i = 0; _i < userTypes.length; _i++) {
        var t = userTypes[_i];
        if (t.kind == DefnKind.Class)
            createVirtualsFor(t);
    }
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
function createVirtualsFor(cls) {
    var vtable = [];
    var virts = new VirtualMethodIterator(cls);
    for (var _a = virts.next(), mname = _a[0], sign = _a[1], isInherited = _a[2]; mname != ""; (_b = virts.next(), mname = _b[0], sign = _b[1], isInherited = _b[2], _b)) {
        var reverseCases = new SMap();
        var subs = new InclusiveSubclassIterator(cls);
        for (var subcls = subs.next(); subcls; subcls = subs.next()) {
            var impl = findMethodImplFor(subcls, cls.baseTypeRef, mname);
            if (!impl)
                continue;
            if (!reverseCases.test(impl))
                reverseCases.put(impl, []);
            reverseCases.get(impl).push(subcls.classId);
        }
        var def = null;
        if (isInherited && cls.baseTypeRef)
            def = findMethodImplFor(cls.baseTypeRef, null, mname);
        vtable.push(new Virtual(mname, sign, reverseCases, def));
    }
    cls.vtable = vtable;
    var _b;
}
function findMethodImplFor(cls, stopAt, name) {
    if (cls == stopAt)
        return null;
    if (cls.hasMethod(name))
        return cls.name + "." + name + "_impl";
    if (cls.baseTypeRef)
        return findMethodImplFor(cls.baseTypeRef, stopAt, name);
    throw new InternalError("Method not found: " + name);
}
function findType(name) {
    if (!knownTypes.test(name))
        throw new InternalError("Unknown type in sizeofType: " + name);
    return knownTypes.get(name);
}
//////////////////////////////////////////////////////////////////////////////////////////
//
// Macro expansion and pasteup
// Arity for SELF expansion is one less than this
var OpAttr = {
    "get": { withSelf: true, selfArg: false, arity: 1, atomic: "load", synchronic: "" },
    "ref": { withSelf: true, selfArg: false, arity: 1, atomic: "", synchronic: "" },
    "notify": { withSelf: true, selfArg: false, arity: 1, atomic: "", synchronic: "_synchronicNotify" },
    "set": { withSelf: true, selfArg: true, arity: 2, atomic: "store", synchronic: "_synchronicStore", vanilla: "=" },
    "add": { withSelf: true, selfArg: true, arity: 2, atomic: "add", synchronic: "_synchronicAdd", vanilla: "+=" },
    "sub": { withSelf: true, selfArg: true, arity: 2, atomic: "sub", synchronic: "_synchronicSub", vanilla: "-=" },
    "and": { withSelf: true, selfArg: true, arity: 2, atomic: "and", synchronic: "_synchronicAnd", vanilla: "&=" },
    "or": { withSelf: true, selfArg: true, arity: 2, atomic: "or", synchronic: "_synchronicOr", vanilla: "|=" },
    "xor": { withSelf: true, selfArg: true, arity: 2, atomic: "xor", synchronic: "_synchronicXor", vanilla: "^=" },
    "loadWhenEqual": { withSelf: true, selfArg: true, arity: 2, atomic: "", synchronic: "_synchronicLoadWhenEqual" },
    "loadWhenNotEqual": { withSelf: true, selfArg: true, arity: 2, atomic: "", synchronic: "_synchronicLoadWhenNotEqual" },
    "expectUpdate": { withSelf: true, selfArg: true, arity: 3, atomic: "", synchronic: "_synchronicExpectUpdate" },
    "compareExchange": { withSelf: true, selfArg: true, arity: 3, atomic: "compareExchange", synchronic: "_synchronicCompareExchange" },
    "at": { withSelf: false, selfArg: false, arity: 1, atomic: "", synchronic: "" },
    "setAt": { withSelf: false, selfArg: false, arity: 2, atomic: "", synchronic: "" },
};
var AssignmentOps = { "=": "set",
    "+=": "add",
    "-=": "sub",
    "&=": "and",
    "|=": "or",
    "^=": "xor"
};
function expandSelfAccessors() {
    for (var _i = 0; _i < userTypes.length; _i++) {
        var t = userTypes[_i];
        for (var _a = 0, _b = t.methods; _a < _b.length; _a++) {
            var m = _b[_a];
            m.body = doExpandSelfAccessors(t, m.body, m.line);
        }
    }
}
function doExpandSelfAccessors(t, tokens, line) {
    var ts2 = new TokenTransducer(new Retokenizer(tokens), standardErrHandler(t.file), line);
    var env = { SELF: t };
    for (;;) {
        var _a = findQualifiedName(env, ts2), primaryName = _a[0], primaryType = _a[1], path = _a[2], mark = _a[3];
        if (primaryType == null)
            break;
        var operator = path[path.length - 1];
        var needArguments = false;
        var requireArityCheck = false;
        var args = [];
        if (operator in OpAttr) {
            if (!OpAttr[operator].withSelf)
                throw new ProgramError(t.file, ts2.line, "Operator cannot be used with " + primaryName + " reference: " + operator);
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
            if (!primaryType.findAccessibleFieldFor(operator, pathname))
                throw new ProgramError(t.file, ts2.line, "Inappropriate operation for " + pathname);
        }
        else if (ts2.lookingAt(Token.Assign)) {
            // FIXME: += etc should only be allowed for atomic and synchronic fields, but
            // that limitation is commented out currently.
            var tok = ts2.advance();
            var pathname = path.join(".");
            if (!(tok[1] in AssignmentOps) || !primaryType.findAccessibleFieldFor((operator = AssignmentOps[tok[1]]), pathname))
                throw new ProgramError(t.file, ts2.line, "Inappropriate operation for " + pathname);
            args.push(parseExpression(t.file, ts2.line, ts2));
        }
        else if (ts2.lookingAt(Token.LParen)) {
            // Invocation.  Leave operator blank.
            operator = "";
            needArguments = true;
        }
        else {
            // Get.  Leave operator blank.
            operator = "";
            var pathname = path.join(".");
            if (!primaryType.findAccessibleFieldFor("get", pathname))
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
                if (args.length != OpAttr[operator].arity - 1)
                    throw new ProgramError(t.file, ts2.line, "Wrong number of arguments for operator: " + operator);
            }
        }
        ts2.release(mark);
        ts2.inject([Token.Id, primaryType.name]);
        for (var _i = 0; _i < path.length; _i++) {
            var name_1 = path[_i];
            ts2.inject([Token.Dot, "."]);
            ts2.inject([Token.Id, name_1]);
        }
        if (operator != "") {
            ts2.inject([Token.Dot, "."]);
            ts2.inject([Token.Id, operator]);
        }
        ts2.inject([Token.LParen, "("]);
        ts2.inject([Token.Id, primaryName]);
        for (var _b = 0; _b < args.length; _b++) {
            var arg = args[_b];
            ts2.inject([Token.Comma, ","]);
            // TODO: Not quite right line number, should keep the line number with argument expression
            for (var _c = 0, _d = doExpandSelfAccessors(t, arg, ts2.line); _c < _d.length; _c++) {
                var x = _d[_c];
                ts2.inject(x);
            }
        }
        ts2.inject([Token.RParen, ")"]);
    }
    return ts2.tokens;
}
// FIXME: "names" should have a better type
function findQualifiedName(names, ts2) {
    var hasDot = false;
    for (;;) {
        if (ts2.lookingAt(Token.EOI))
            return ["", null, [], 0];
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
        if (!(ts2.current[1] in names)) {
            // Filter by names that are in scope
            ts2.advance();
            continue;
        }
        var primaryName = ts2.current[1];
        var primaryType = names[primaryName]; // FIXME: Safe by construction, but too restrictive
        var mark = ts2.mark();
        ts2.advance();
        var path = [];
        while (ts2.lookingAt(Token.Dot)) {
            ts2.advance();
            path.push(ts2.matchId());
        }
        if (path.length == 0) {
            // If the name is not part of a path then leave it alone
            continue;
        }
        return [primaryName, primaryType, path, mark];
    }
}
function pasteupTypes() {
    // ES5 hacks
    function otherPusher(ntokens) {
        return function (text) {
            ntokens.push([Token.Other, text]);
        };
    }
    function linebreakPusher(ntokens) {
        return function () {
            ntokens.push([Token.Linebreak, "\n"]);
        };
    }
    function manyPusher(ntokens) {
        return function () {
            var xs = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                xs[_i - 0] = arguments[_i];
            }
            for (var _a = 0; _a < xs.length; _a++) {
                var x = xs[_a];
                ntokens.push(x);
            }
        };
    }
    for (var _i = 0; _i < allSources.length; _i++) {
        var source = allSources[_i];
        var defs = source.defs;
        var tokens = source.tokens;
        var ntokens = [];
        var k = 0;
        var lineno = 1;
        var push = otherPusher(ntokens);
        var pushLinebreak = linebreakPusher(ntokens);
        var pushMany = manyPusher(ntokens);
        for (var _a = 0; _a < defs.length; _a++) {
            var d = defs[_a];
            while (lineno < d.origin && k < tokens.length) {
                var t = void 0;
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
                var cls = d;
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
                var cls = d;
                push(d.name + ".CLSID = " + cls.classId + ";");
                pushLinebreak();
                push("Object.defineProperty(" + d.name + ", 'BASE', {get: function () { return " + (cls.baseName ? cls.baseName : "null") + "; }});");
                pushLinebreak();
            }
            // Now do methods.
            //
            // Implementation methods are emitted directly in the defining type, with a name suffix _impl.
            // For struct methods, the name is "_get_impl" or "_set_impl"
            var haveSetter = false;
            var haveGetter = false;
            for (var _b = 0, _c = d.methods; _b < _c.length; _b++) {
                var m = _c[_b];
                var name_2 = m.name;
                if (name_2 == "") {
                    switch (m.kind) {
                        case MethodKind.Get:
                            if (haveGetter)
                                throw new ProgramError(d.file, m.line, "Duplicate struct getter");
                            name_2 = "_get_impl";
                            haveGetter = true;
                            break;
                        case MethodKind.Set:
                            if (haveSetter)
                                throw new ProgramError(d.file, m.line, "Duplicate struct setter");
                            name_2 = "_set_impl";
                            haveSetter = true;
                            break;
                    }
                }
                else if (m.kind == MethodKind.NonVirtual)
                    ;
                else
                    name_2 += "_impl";
                pushMany([Token.SetFile, "/*" + d.file + "[method " + name_2 + "]*/"], [Token.SetLine, "/*" + m.line + "*/"]);
                pushLinebreak();
                pushMany([Token.Id, d.name], [Token.Dot, "."], [Token.Id, name_2], [Token.Assign, "="], [Token.Id, "function"]);
                for (var _d = 0, _e = m.body; _d < _e.length; _d++) {
                    var token = _e[_d];
                    ntokens.push(token);
                }
                pushLinebreak();
            }
            // Now default methods, if appropriate.
            if (d.kind == DefnKind.Struct) {
                var struct = d;
                if (!haveGetter) {
                    var local = gensym();
                    pushMany([Token.Id, d.name], [Token.Dot, "."], [Token.Id, "_get_impl"], [Token.Assign, "="], [Token.Id, "function"], [Token.LParen, "("], [Token.Id, "SELF"], [Token.RParen, ")"], [Token.LBrace, "{"]);
                    pushLinebreak();
                    pushMany([Token.Id, "var"], [Token.Spaces, " "], [Token.Id, local], [Token.Assign, "="], [Token.Id, "new"], [Token.Spaces, " "], [Token.Id, d.name], [Token.Semicolon, ";"]);
                    pushLinebreak();
                    // Use longhand for access, since self accessors are expanded before pasteup.
                    // TODO: Would be useful to fix that.
                    for (var _f = 0, _g = d.props; _f < _g.length; _f++) {
                        var p = _g[_f];
                        pushMany([Token.Id, local], [Token.Dot, "."], [Token.Id, p.name], [Token.Assign, "="], [Token.Id, d.name], [Token.Dot, "."], [Token.Id, p.name], [Token.LParen, "("], [Token.Id, "SELF"], [Token.RParen, ")"], [Token.Semicolon, ";"]);
                        pushLinebreak();
                    }
                    pushMany([Token.Id, "return"], [Token.Spaces, " "], [Token.Id, local], [Token.Semicolon, ";"]);
                    pushLinebreak();
                    ntokens.push([Token.RBrace, "}"]);
                    pushLinebreak();
                    struct.hasGetMethod = true;
                }
                if (!haveSetter) {
                    var local = gensym();
                    pushMany([Token.Id, d.name], [Token.Dot, "."], [Token.Id, "_set_impl"], [Token.Assign, "="], [Token.Id, "function"], [Token.LParen, "("], [Token.Id, "SELF"], [Token.Comma, ","], [Token.Id, local], [Token.RParen, ")"], [Token.LBrace, "{"]);
                    pushLinebreak();
                    // TODO: as above, useful to be able to use shorthand?
                    for (var _h = 0, _j = d.props; _h < _j.length; _h++) {
                        var p = _j[_h];
                        pushMany([Token.Id, d.name], [Token.Dot, "."], [Token.Id, p.name], [Token.Dot, "."], [Token.Id, "set"], [Token.LParen, "("], [Token.Id, "SELF"], [Token.Comma, ","], [Token.Id, local], [Token.Dot, "."], [Token.Id, p.name], [Token.RParen, ")"], [Token.Semicolon, ";"]);
                        pushLinebreak();
                    }
                    ntokens.push([Token.RBrace, "}"]);
                    pushLinebreak();
                    struct.hasSetMethod = true;
                }
            }
            // Now do vtable, if appropriate.
            if (d.kind == DefnKind.Class) {
                var cls = d;
                for (var _k = 0, _l = cls.vtable; _k < _l.length; _k++) {
                    var virtual = _l[_k];
                    // Shouldn't matter much
                    ntokens.push([Token.SetFile, "/*" + d.file + "[vtable " + virtual.name + "]*/"]);
                    ntokens.push([Token.SetLine, "/*" + d.line + "*/"]);
                    pushLinebreak();
                    var signature = virtual.signature();
                    push(d.name + "." + virtual.name + " = function (SELF " + signature + ") {");
                    pushLinebreak();
                    push("  switch (_mem_int32[SELF>>2]) {");
                    pushLinebreak();
                    var kv = virtual.reverseCases.keysValues();
                    for (var _m = kv.next(), name_3 = _m[0], cases = _m[1]; name_3; (_o = kv.next(), name_3 = _o[0], cases = _o[1], _o)) {
                        for (var _p = 0; _p < cases.length; _p++) {
                            var c = cases[_p];
                            push("    case " + c + ":");
                            pushLinebreak();
                        }
                        push("      return " + name_3 + "(SELF " + signature + ");");
                        pushLinebreak();
                    }
                    push("    default:");
                    pushLinebreak();
                    push("      " + (virtual.default_ ?
                        "return " + virtual.default_ + "(SELF " + signature + ")" :
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
                var cls = d;
                push(d.name + ".initInstance = function(SELF) { _mem_int32[SELF>>2]=" + cls.classId + "; return SELF; }");
                pushLinebreak();
            }
            if (d.kind == DefnKind.Class) {
                push("FlatJS._idToType[" + d.classId + "] = " + d.name + ";");
                pushLinebreak();
            }
        }
        while (k < tokens.length)
            ntokens.push(tokens[k++]);
        source.tokens = ntokens;
    }
    var _o;
}
var gensym_counter = 1000;
function gensym() {
    return "__l" + gensym_counter++;
}
function reFormLines(ts) {
    return ts.map(function (x) { return x[1]; }).join("").split("\n").map(function (l) { return new SourceLine("", 0, l); });
}
function expandGlobalAccessorsAndMacros() {
    for (var _i = 0; _i < allSources.length; _i++) {
        var source = allSources[_i];
        var lines = reFormLines(source.tokens);
        var nlines = [];
        for (var _a = 0; _a < lines.length; _a++) {
            var l = lines[_a];
            nlines.push(new SourceLine(l.file, l.line, expandMacrosIn(l.file, l.line, l.text)));
        }
        source.lines = nlines;
    }
}
var Ws = "\\s+";
var Os = "\\s*";
var Id = "[A-Za-z][A-Za-z0-9]*"; // Note, no underscores are allowed yet
var Lbrace = Os + "\\{";
var Rbrace = Os + "\\}";
var LParen = Os + "\\(";
var CommentOpt = Os + "(?:\\/\\/.*)?";
var QualifierOpt = "(?:\\.(atomic|synchronic))?";
var OpNames = "at|get|setAt|set|ref|add|sub|and|or|xor|compareExchange|loadWhenEqual|loadWhenNotEqual|expectUpdate|notify";
var Operation = "(?:\\.(" + OpNames + "))";
var OperationOpt = Operation + "?";
var OperationLParen = "(?:\\.(" + OpNames + ")" + LParen + ")";
var NullaryOperation = "(?:\\.(ref|notify))";
var Path = "((?:\\." + Id + ")+)";
var PathLazy = "((?:\\." + Id + ")+?)";
var PathOpt = "((?:\\." + Id + ")*)";
var PathOptLazy = "((?:\\." + Id + ")*?)";
var AssignOp = "(=|\\+=|-=|&=|\\|=|\\^=)(?!=)";
// TODO: it's likely that the expandMacrosIn is really better
// represented as a class, with a ton of methods and locals (eg for
// file and line), performing expansion on one line.
var new_re = new RegExp("@new\\s+(" + Id + ")" + QualifierOpt + "(?:\\.(Array)" + LParen + ")?", "g");
var acc_re = new RegExp("(" + Id + ")" + PathOptLazy + "(?:" + Operation + "|)" + LParen, "g");
// It would sure be nice to avoid the explicit ".Array" here, but I don't yet know how.
var arr_re = new RegExp("(" + Id + ")" + QualifierOpt + "\\.Array" + PathOpt + Operation + LParen, "g");
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
function expandMacrosIn(file, line, text) {
    return myExec(file, line, new_re, newMacro, myExec(file, line, arr_re, arrMacro, myExec(file, line, acc_re, accMacro, text)));
}
function myExec(file, line, re, macro, text) {
    var old = re.lastIndex;
    re.lastIndex = 0;
    for (;;) {
        var m = re.exec(text);
        if (!m)
            break;
        // The trick here is that we may replace more than the match:
        // the macro may eat additional input.  So the macro should
        // be returning a new string, as well as the index at which
        // to continue the search.
        var _a = macro(file, line, text, re.lastIndex - m[0].length, m), newText = _a[0], newStart = _a[1];
        text = newText;
        re.lastIndex = newStart;
    }
    re.lastIndex = old;
    return text;
}
// Here, arity includes the self argument
function accMacro(file, line, s, p, ms) {
    var m = ms[0];
    var className = ms[1];
    var propName = "";
    var operation = "";
    var nomatch = [s, p + m.length];
    var left = s.substring(0, p);
    if (!ms[2] && !ms[3])
        return nomatch; // We're looking at something else
    propName = ms[2] ? ms[2].substring(1) : ""; // Strip the leading "."
    operation = ms[3] ? ms[3] : "get";
    var ty = knownTypes.get(className);
    if (!ty)
        return nomatch;
    var offset = 0;
    var targetType = null;
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
        var cls = ty;
        // findAccessibleFieldFor will vet the operation against the field type,
        // so atomic/synchronic ops will only be allowed on appropriate types
        var fld = cls.findAccessibleFieldFor(operation, propName);
        if (!fld) {
            var fld2 = cls.findAccessibleFieldFor("get", propName);
            if (fld2)
                warning(file, line, "No match for " + className + "  " + operation + "  " + propName);
            return nomatch;
        }
        offset = fld.offset;
        targetType = fld.type;
    }
    var pp = new ParamParser(file, line, s, p + m.length);
    var as = (pp).allArgs();
    if (OpAttr[operation].arity != as.length) {
        warning(file, line, ("Bad accessor arity " + propName + " / " + as.length + ": ") + s);
        return nomatch;
    }
    ;
    // Issue #16: Watch it: Parens interact with semicolon insertion.
    var ref = "(" + expandMacrosIn(file, line, endstrip(as[0])) + " + " + offset + ")";
    if (operation == "ref") {
        return [left + ref + s.substring(pp.where),
            left.length + ref.length];
    }
    return loadFromRef(file, line, ref, targetType, s, left, operation, pp, as[1], as[2], nomatch);
}
function loadFromRef(file, line, ref, type, s, left, operation, pp, rhs, rhs2, nomatch) {
    var mem = "", size = 0, synchronic = false, atomic = false, simd = false, shift = -1, simdType = "";
    if (type.kind == DefnKind.Primitive) {
        var prim = type;
        mem = prim.memory;
        synchronic = prim.primKind == PrimKind.Synchronic;
        atomic = prim.primKind == PrimKind.Atomic;
        simd = prim.primKind == PrimKind.SIMD;
        if (synchronic)
            shift = log2(prim.baseSize);
        else if (simd)
            shift = log2(prim.baseSize);
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
        var expr = "";
        var op = "";
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
        var fieldIndex = "";
        if (synchronic)
            fieldIndex = "(" + ref + " + " + SynchronicDefn.bias + ") >> " + shift;
        else
            fieldIndex = ref + " >> " + shift;
        switch (operation) {
            case "get":
                if (atomic || synchronic)
                    expr = "Atomics.load(" + mem + ", " + fieldIndex + ")";
                else if (simd)
                    expr = "SIMD." + simdType + ".load(" + mem + ", " + fieldIndex + ")";
                else
                    expr = mem + "[" + fieldIndex + "]";
                break;
            case "notify":
                expr = "FlatJS." + OpAttr[operation].synchronic + "(" + ref + ")";
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
                    expr = "Atomics." + OpAttr[operation].atomic + "(" + mem + ", " + fieldIndex + ", " + rhs + ")";
                else if (synchronic)
                    expr = "FlatJS." + OpAttr[operation].synchronic + "(" + ref + ", " + mem + ", " + fieldIndex + ", " + rhs + ")";
                else if (simd)
                    expr = "SIMD." + simdType + ".store(" + mem + ", " + fieldIndex + ", " + rhs + ")";
                else
                    expr = mem + "[" + ref + " >> " + shift + "] " + OpAttr[operation].vanilla + " " + rhs;
                break;
            case "compareExchange":
            case "expectUpdate":
                if (atomic)
                    expr = "Atomics." + OpAttr[operation].atomic + "(" + mem + ", " + fieldIndex + ", " + rhs + ", " + rhs2 + ")";
                else
                    expr = "FlatJS." + OpAttr[operation].synchronic + "(" + ref + ", " + mem + ", " + fieldIndex + ", " + rhs + ", " + rhs2 + ")";
                break;
            default:
                throw new InternalError("No operator: " + operation + " line: " + s);
        }
        // Issue #16: Parens interact with semicolon insertion.
        //expr = `(${expr})`;
        return [left + expr + s.substring(pp.where), left.length + expr.length];
    }
    else {
        var t = type;
        var expr = "";
        // Field type is a structure.  If the structure type has a getter then getting is allowed
        // and should be rewritten as a call to the getter, passing the field reference.
        // Ditto setter, which will also pass secondArg.
        switch (operation) {
            case "get":
                if (t.hasGetMethod)
                    expr = t.name + "._get_impl(" + ref + ")";
                break;
            case "set":
                if (t.hasSetMethod)
                    expr = t.name + "._set_impl(" + ref + ", " + expandMacrosIn(file, line, endstrip(rhs)) + ")";
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
function arrMacro(file, line, s, p, ms) {
    var m = ms[0];
    var typeName = ms[1];
    var qualifier = ms[2];
    var field = ms[3] ? ms[3].substring(1) : "";
    var operation = ms[4];
    var nomatch = [s, p + m.length];
    if (operation == "get" || operation == "set")
        throw new ProgramError(file, line, "Use 'at' and 'setAt' on Arrays");
    if (operation == "at")
        operation = "get";
    if (operation == "setAt")
        operation = "set";
    var type = findType(typeName);
    if (!type)
        return nomatch;
    var pp = new ParamParser(file, line, s, p + m.length);
    var as = (pp).allArgs();
    if (as.length != OpAttr[operation].arity + 1) {
        warning(file, line, "Wrong arity for accessor " + operation + " / " + as.length);
        return nomatch;
    }
    ;
    var multiplier = type.elementSize;
    if (type.kind == DefnKind.Primitive) {
        if (field)
            return nomatch;
    }
    else if (type.kind == DefnKind.Class) {
        if (field)
            return nomatch;
    }
    var ref = "(" + expandMacrosIn(file, line, endstrip(as[0])) + "+" + multiplier + "*" + expandMacrosIn(file, line, endstrip(as[1])) + ")";
    if (field) {
        var fld = type.findAccessibleFieldFor(operation, field);
        if (!fld)
            return nomatch;
        // Issue #16: Watch it: Parens interact with semicolon insertion.
        ref = "(" + ref + "+" + fld.offset + ")";
        type = fld.type;
    }
    if (operation == "ref") {
        var left = s.substring(0, p);
        return [left + ref + s.substring(pp.where),
            left.length + ref.length];
    }
    return loadFromRef(file, line, ref, type, s, s.substring(0, p), operation, pp, as[2], as[3], nomatch);
}
// Since @new is new syntax, we throw errors for all misuse.
function newMacro(file, line, s, p, ms) {
    var m = ms[0];
    var baseType = ms[1];
    var qualifier = ms[2];
    var isArray = ms[3] == "Array";
    var left = s.substring(0, p);
    // Issue #27 - implement this.
    if (qualifier)
        throw new InternalError("Qualifiers on array @new not yet implemented");
    var t = knownTypes.get(baseType);
    if (!t)
        throw new ProgramError(file, line, "Unknown type argument to @new: " + baseType);
    if (!isArray) {
        var expr_1 = "FlatJS.allocOrThrow(" + t.size + "," + t.align + ")";
        if (t.kind == DefnKind.Class) {
            // NOTE, parens removed here
            // Issue #16: Watch it: Parens interact with semicolon insertion.
            expr_1 = baseType + ".initInstance(" + expr_1 + ")";
        }
        return [left + expr_1 + s.substring(p + m.length),
            left.length + expr_1.length];
    }
    var pp = new ParamParser(file, line, s, p + m.length);
    var as = pp.allArgs();
    if (as.length != 1)
        throw new ProgramError(file, line, "Wrong number of arguments to @new " + baseType + ".Array");
    // NOTE, parens removed here
    // Issue #16: Watch it: Parens interact with semicolon insertion.
    var expr = "FlatJS.allocOrThrow(" + t.elementSize + " * " + expandMacrosIn(file, line, endstrip(as[0])) + ", " + t.elementAlign + ")";
    return [left + expr + s.substring(pp.where),
        left.length + expr.length];
}
// This can also check if x is already properly parenthesized, though that
// involves counting parens, at least trivially (and then does it matter?).
// Consider (a).(b), which should be parenthesized as ((a).(b)).
//
// Issue #16: Parentheses are not actually reliable.
function endstrip(x) {
    if (/^[a-zA-Z0-9]+$/.test(x))
        return x;
    return "(" + x + ")";
}
function standardErrHandler(file) {
    return function (line, msg) {
        throw new ProgramError(file, line, msg);
    };
}
function printToks(ts) {
    var s = "";
    for (var _i = 0; _i < ts.length; _i++) {
        var t = ts[_i];
        s += "[" + t.join(" ") + "]";
    }
    console.log(s);
}
main(process.argv.slice(2));
