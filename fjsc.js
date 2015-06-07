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
var fs = require("fs");
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
var SourceLine = (function () {
    function SourceLine(file, line, text) {
        this.file = file;
        this.line = line;
        this.text = text;
    }
    return SourceLine;
})();
var Source = (function () {
    function Source(input_file, output_file, defs, lines) {
        this.input_file = input_file;
        this.output_file = output_file;
        this.defs = defs;
        this.lines = lines;
    }
    Source.prototype.allText = function () {
        return this.lines.map(function (x) { return x.text; }).join("\n");
    };
    return Source;
})();
function CapturedError(name) { this.name = name; }
CapturedError.prototype = new Error("CapturedError");
function InternalError(msg) { this.message = "Internal error: " + msg; }
InternalError.prototype = new CapturedError("InternalError");
function UsageError(msg) { this.message = "Usage error: " + msg; }
UsageError.prototype = new CapturedError("UsageError");
function ProgramError(file, line, msg) { this.message = file + ":" + line + ": " + msg; }
;
ProgramError.prototype = new CapturedError("ProgramError");
var allSources = [];
function main(args) {
    try {
        for (var _i = 0; _i < args.length; _i++) {
            var input_file = args[_i];
            if (!(/.\.[a-zA-Z0-9]+\.flatjs$/.test(input_file)))
                throw new UsageError("Bad file name (must be .some-extension.flatjs): " + input_file);
            var text = fs.readFileSync(input_file, "utf8");
            var lines = text.split("\n");
            var _a = collectDefinitions(input_file, lines), defs = _a[0], residual = _a[1];
            var output_file = input_file.replace(/\.flatjs$/, "");
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
            fs.writeFileSync(s.output_file, s.allText(), "utf8");
        }
    }
    catch (e) {
        console.log(e.message);
        //console.log(e);
        process.exit(1);
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
var start_re = new RegExp("^" + Os + "@flatjs" + Ws + "(?:struct|class)" + Ws + "(?:" + Id + ")");
var end_re = new RegExp("^" + Rbrace + Os + "@end" + CommentOpt + "$");
var struct_re = new RegExp("^" + Os + "@flatjs" + Ws + "struct" + Ws + "(" + Id + ")" + Lbrace + CommentOpt + "$");
var class_re = new RegExp("^" + Os + "@flatjs" + Ws + "class" + Ws + "(" + Id + ")" + Os + "(?:extends" + Ws + "(" + Id + "))?" + Lbrace + CommentOpt + "$");
var special_re = new RegExp("^" + Os + "@(get|set)" + "(" + LParen + Os + "SELF.*)$");
var method_re = new RegExp("^" + Os + "@(method|virtual)" + Ws + "(" + Id + ")" + "(" + LParen + Os + "SELF.*)$");
var blank_re = new RegExp("^" + Os + CommentOpt + "$");
var space_re = new RegExp("^" + Os + "$");
var prop_re = new RegExp("^" + Os + "(" + Id + ")" + Os + ":" + Os + "(" + Id + ")" + QualifierOpt + "(?:\.(Array))?" + Os + ";?" + CommentOpt + "$");
function collectDefinitions(filename, lines) {
    var defs = [];
    var nlines = [];
    var i = 0, lim = lines.length;
    while (i < lim) {
        var l = lines[i++];
        if (!start_re.test(l)) {
            nlines.push(new SourceLine(filename, i, l));
            continue;
        }
        var kind = "";
        var name_1 = "";
        var inherit = "";
        var lineno = i;
        var m = null;
        if (m = struct_re.exec(l)) {
            kind = "struct";
            name_1 = m[1];
        }
        else if (m = class_re.exec(l)) {
            kind = "class";
            name_1 = m[1];
            inherit = m[2] ? m[2] : "";
        }
        else
            throw new ProgramError(filename, i, "Syntax error: Malformed definition line");
        var properties = [];
        var methods = [];
        var in_method = false;
        var mbody = null;
        var method_type = MethodKind.Virtual;
        var method_name = "";
        var method_line = 0;
        var method_signature = null;
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
                var pp = new ParamParser(filename, i, m[3], 1);
                var args = pp.allArgs();
                args.shift(); // Discard SELF
                // Issue #15: In principle there are two signatures here: there is the
                // parameter signature, which we should keep intact in the
                // virtual, and there is the set of arguments extracted from that,
                // including any splat.
                method_signature = args.map(function (x) { return parameterToArgument(filename, i, x); });
                mbody = [m[3]];
            }
            else if (m = special_re.exec(l)) {
                if (kind != "struct")
                    throw new ProgramError(filename, i, "@" + m[1] + " is only allowed in structs");
                if (in_method)
                    methods.push(new Method(method_line, method_type, method_name, method_signature, mbody));
                method_line = i;
                in_method = true;
                switch (m[1]) {
                    case "get":
                        method_type = MethodKind.Get;
                        break;
                    case "set":
                        method_type = MethodKind.Set;
                        break;
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
                var qual = PropQual.None;
                switch (m[3]) {
                    case "synchronic":
                        qual = PropQual.Synchronic;
                        break;
                    case "atomic":
                        qual = PropQual.Atomic;
                        break;
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
            defs.push(new ClassDefn(filename, lineno, name_1, inherit, properties, methods, nlines.length));
        else
            defs.push(new StructDefn(filename, lineno, name_1, properties, methods, nlines.length));
    }
    return [defs, nlines];
}
// The input is Id, Id:Blah, or ...Id.  Strip any :Blah annotations.
function parameterToArgument(file, line, s) {
    if (/^\s*(?:\.\.\.)[A-Za-z_$][A-Za-z0-9_$]*\s*$/.test(s))
        return s;
    var m = /^\s*([A-Za-z_\$][A-Za-z0-9_\$]*)\s*:?/.exec(s);
    if (!m)
        throw new ProgramError(file, line, "Unable to understand argument to virtual function: " + s);
    return m[1];
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
// Issue #17: This will also match bogus things like XSELF, because
// there's no reliable left-context handling.  Need to add
// programmatic guards for that.
var self_getter1_re = new RegExp("SELF" + Path + NullaryOperation, "g");
var self_getter2_re = new RegExp("SELF" + Path, "g");
var self_accessor_re = new RegExp("SELF" + Path + OperationLParen, "g");
var self_setter_re = new RegExp("SELF" + Path + Os + AssignOp + Os, "g");
var self_invoke_re = new RegExp("SELF\\.(" + Id + ")" + LParen, "g");
// Name validity will be checked on the next expansion pass.
function expandSelfAccessors() {
    for (var _i = 0; _i < userTypes.length; _i++) {
        var t = userTypes[_i];
        for (var _a = 0, _b = t.methods; _a < _b.length; _a++) {
            var m = _b[_a];
            var body = m.body;
            for (var k = 0; k < body.length; k++) {
                body[k] = myExec(t.file, t.line, self_setter_re, function (file, line, s, p, m) {
                    return replaceSetterShorthand(file, line, s, p, m, t);
                }, body[k]);
                body[k] = body[k].replace(self_accessor_re, function (m, path, operation, p, s) {
                    return t.name + path + "." + operation + "(SELF, ";
                });
                body[k] = body[k].replace(self_invoke_re, function (m, id, p, s) {
                    var pp = new ParamParser(t.file, t.line, s, p + m.length);
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
var AssignmentOps = { "=": "set",
    "+=": "add",
    "-=": "sub",
    "&=": "and",
    "|=": "or",
    "^=": "xor"
};
function replaceSetterShorthand(file, line, s, p, ms, t) {
    //return [s, p+m.length];
    var m = ms[0];
    var path = ms[1];
    var operation = ms[2];
    var left = s.substring(0, p);
    var pp = new ParamParser(file, line, s, p + m.length, false, true);
    var rhs = pp.nextArg();
    if (!rhs)
        throw new ProgramError(file, line, "Missing right-hand-side expression in assignment");
    // Be sure to re-expand the RHS.
    var substitution_left = left + " " + t.name + path + "." + AssignmentOps[operation] + "(SELF, ";
    return [(substitution_left + " " + rhs + ")" + (pp.sawSemi ? ';' : '') + " " + s.substring(pp.where)),
        substitution_left.length];
}
function linePusher(info, nlines) {
    return function (text) {
        var _a = info(), file = _a[0], line = _a[1];
        nlines.push(new SourceLine(file, line, text));
    };
}
function pasteupTypes() {
    var emitFn = ""; // ES5 workaround - would otherwise be local to inner "for" loop
    var emitLine = 0; // ditto
    for (var _i = 0; _i < allSources.length; _i++) {
        var source = allSources[_i];
        var defs = source.defs;
        var lines = source.lines;
        var nlines = [];
        var k = 0;
        for (var _a = 0; _a < defs.length; _a++) {
            var d = defs[_a];
            while (k < d.origin && k < lines.length)
                nlines.push(lines[k++]);
            var push = linePusher(function () { return [emitFn, emitLine++]; }, nlines);
            emitFn = d.file + "[class definition]";
            emitLine = d.line;
            if (d.kind == DefnKind.Class)
                push("function " + d.name + "(p) { this._pointer = (p|0); }");
            else
                push("function " + d.name + "() {}");
            if (d.kind == DefnKind.Class) {
                var cls = d;
                if (cls.baseName)
                    push(d.name + ".prototype = new " + cls.baseName + ";");
                else
                    push("Object.defineProperty(" + d.name + ".prototype, 'pointer', { get: function () { return this._pointer } });");
            }
            push(d.name + ".NAME = \"" + d.name + "\";");
            push(d.name + ".SIZE = " + d.size + ";");
            push(d.name + ".ALIGN = " + d.align + ";");
            if (d.kind == DefnKind.Class) {
                var cls = d;
                push(d.name + ".CLSID = " + cls.classId + ";");
                push("Object.defineProperty(" + d.name + ", 'BASE', {get: function () { return " + (cls.baseName ? cls.baseName : "null") + "; }});");
            }
            // Now do methods.
            //
            // Implementation methods are emitted directly in the defining type, with a name suffix _impl.
            // For struct methods, the name is "_get_impl", "_set_impl", or "_copy_impl".
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
                emitFn = d.file + "[method " + name_2 + "]";
                emitLine = m.line;
                var body = m.body;
                // Formatting: useful to strip all trailing blank lines from
                // the body first.
                var last = body.length - 1;
                while (last > 0 && /^\s*$/.test(body[last]))
                    last--;
                if (last == 0)
                    push(d.name + "." + name_2 + " = function " + body[0]);
                else {
                    push(d.name + "." + name_2 + " = function " + body[0]);
                    for (var x = 1; x < last; x++)
                        push(body[x]);
                    push(body[last]);
                }
            }
            // Now default methods, if appropriate.
            if (d.kind == DefnKind.Struct) {
                var struct = d;
                if (!haveGetter) {
                    push(d.name + "._get_impl = function (SELF) {");
                    push("  var v = new " + d.name + ";");
                    // Use longhand for access, since self accessors are expanded before pasteup.
                    // TODO: Would be useful to fix that.
                    for (var _d = 0, _e = d.props; _d < _e.length; _d++) {
                        var p = _e[_d];
                        push("  v." + p.name + " = " + d.name + "." + p.name + "(SELF);");
                    }
                    push("  return v;");
                    push("}");
                    struct.hasGetMethod = true;
                }
                if (!haveSetter) {
                    push(d.name + "._set_impl = function (SELF, v) {");
                    // TODO: as above.
                    for (var _f = 0, _g = d.props; _f < _g.length; _f++) {
                        var p = _g[_f];
                        push("  " + d.name + "." + p.name + ".set(SELF, v." + p.name + ");");
                    }
                    push("}");
                    struct.hasSetMethod = true;
                }
            }
            // Now do vtable, if appropriate.
            if (d.kind == DefnKind.Class) {
                var cls = d;
                for (var _h = 0, _j = cls.vtable; _h < _j.length; _h++) {
                    var virtual = _j[_h];
                    // Shouldn't matter much
                    emitFn = d.file + "[vtable " + virtual.name + "]";
                    emitLine = d.line;
                    var signature = virtual.signature();
                    push(d.name + "." + virtual.name + " = function (SELF " + signature + ") {");
                    push("  switch (_mem_int32[SELF>>2]) {");
                    var kv = virtual.reverseCases.keysValues();
                    for (var _k = kv.next(), name_3 = _k[0], cases = _k[1]; name_3; (_l = kv.next(), name_3 = _l[0], cases = _l[1], _l)) {
                        for (var _m = 0; _m < cases.length; _m++) {
                            var c = cases[_m];
                            push("    case " + c + ":");
                        }
                        push("      return " + name_3 + "(SELF " + signature + ");");
                    }
                    push("    default:");
                    push("      " + (virtual.default_ ?
                        "return " + virtual.default_ + "(SELF " + signature + ")" :
                        "throw FlatJS._badType(SELF)") + ";");
                    push("  }");
                    push("}");
                }
            }
            // Now do other methods: initInstance.
            if (d.kind == DefnKind.Class) {
                var cls = d;
                push(d.name + ".initInstance = function(SELF) { _mem_int32[SELF>>2]=" + cls.classId + "; return SELF; }");
            }
            if (d.kind == DefnKind.Class)
                push("FlatJS._idToType[" + d.classId + "] = " + d.name + ";");
        }
        while (k < lines.length)
            nlines.push(lines[k++]);
        source.lines = nlines;
    }
    var _l;
}
function expandGlobalAccessorsAndMacros() {
    for (var _i = 0; _i < allSources.length; _i++) {
        var source = allSources[_i];
        var lines = source.lines;
        var nlines = [];
        for (var _a = 0; _a < lines.length; _a++) {
            var l = lines[_a];
            nlines.push(new SourceLine(l.file, l.line, expandMacrosIn(l.file, l.line, l.text)));
        }
        source.lines = nlines;
    }
}
// TODO: it's likely that the expandMacrosIn is really better
// represented as a class, with a ton of methods and locals (eg for
// file and line), performing expansion on one line.
var new_re = new RegExp("@new\\s+(" + Id + ")" + QualifierOpt + "(?:\\.(Array)" + LParen + ")?", "g");
var acc_re = new RegExp("(" + Id + ")" + PathOptLazy + "(?:" + Operation + "|)" + LParen, "g");
// It would sure be nice to avoid the explicit ".Array" here, but I don't yet know how.
var arr_re = new RegExp("(" + Id + ")" + QualifierOpt + "\\.Array" + PathOpt + Operation + LParen, "g");
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
var OpAttr = {
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
function findType(name) {
    if (!knownTypes.test(name))
        throw new InternalError("Unknown type in sizeofType: " + name);
    return knownTypes.get(name);
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
main(process.argv.slice(2));
