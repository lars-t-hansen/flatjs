// Generated from ray.flat_js by fjsc 0.6; github.com/lars-t-hansen/flatjs
/* -*- mode: javascript -*- */

// Ray tracer, largely out of Shirley & Marschner 3rd Ed.
// Traces a scene and writes to a canvas.
//
// lth@acm.org / lhansen@mozilla.com, winter 2012 and later.
//
// This is written in flatjs, holding the scene graph in flat memory
// and rendering into an ArrayBuffer.  The computation is straight JS.
//
// This is about 25% faster running on 1 core than the JavaScript
// version that uses native objects (3900ms vs 5300ms on my late-2013
// MacBook Pro, 2.6GHz i7).  That's before trying to optimize much,
// apart from getting rid of varargs in vcalls.

// Global parameters

const height = 600;
const width = 800;

// FlatJS setup.

const RAW_MEMORY = new ArrayBuffer(height*width*4 + 65536);
FlatJS.init(RAW_MEMORY, 0, RAW_MEMORY.byteLength, true);

// CONFIGURATION

const shadows = true;		// Compute object shadows
const reflection = true;	// Compute object reflections
const reflection_depth = 2;
const antialias = false; // true;		// Antialias the image (expensive but pretty)

// END CONFIGURATION

const debug = false;		// Progress printout, may confuse the consumer

const SENTINEL = 1e32;
const EPS = 0.00001;

function DL3(x, y, z) { return {x:x, y:y, z:z}; }

function add(a, b) { return DL3(a.x+b.x, a.y+b.y, a.z+b.z); }
function addi(a, c) { return DL3(a.x+c, a.y+c, a.z+c); }
function sub(a, b) { return DL3(a.x-b.x, a.y-b.y, a.z-b.z); }
function subi(a, c) { return DL3(a.x-c, a.y-c, a.z-c); }
function muli(a, c) { return DL3(a.x*c, a.y*c, a.z*c); }
function divi(a, c) { return DL3(a.x/c, a.y/c, a.z/c); }
function neg(a) { return DL3(-a.x, -a.y, -a.z); }
function length(a) { return Math.sqrt(a.x*a.x + a.y*a.y + a.z*a.z); }
function normalize(a) { var d = length(a); return DL3(a.x/d, a.y/d, a.z/d); }
function cross(a, b) { return DL3(a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x); }
function dot(a, b) { return a.x*b.x + a.y*b.y + a.z*b.z; }

/*ray.flat_js[class definition]*//*54*/
function Vec3() {}
Vec3.NAME = "Vec3";
Vec3.SIZE = 24;
Vec3.ALIGN = 8;
/*ray.flat_js[method _get_impl]*//*59*/
Vec3._get_impl=function(SELF) {
	return DL3(_mem_float64[(SELF + 0) >> 3], _mem_float64[(SELF + 8) >> 3], _mem_float64[(SELF + 16) >> 3]);
    }
Vec3._set_impl=function(SELF,__l1000){
_mem_float64[(SELF + 0) >> 3] = (__l1000.x);
_mem_float64[(SELF + 8) >> 3] = (__l1000.y);
_mem_float64[(SELF + 16) >> 3] = (__l1000.z);
}


// Avoid intermediate DL3 objects

function subvref(a, b) { return DL3(a.x-_mem_float64[(b + 0) >> 3], a.y-_mem_float64[(b + 8) >> 3], a.z-_mem_float64[(b + 16) >> 3]); }
function subrefref(a, b) { return DL3(_mem_float64[(a + 0) >> 3]-_mem_float64[(b + 0) >> 3], _mem_float64[(a + 8) >> 3]-_mem_float64[(b + 8) >> 3], _mem_float64[(a + 16) >> 3]-_mem_float64[(b + 16) >> 3]); }
function mulrefi(a, c) { return DL3(_mem_float64[(a + 0) >> 3]*c, _mem_float64[(a + 8) >> 3]*c, _mem_float64[(a + 16) >> 3]*c); }

/*ray.flat_js[class definition]*//*70*/
function Material() {}
Material.NAME = "Material";
Material.SIZE = 88;
Material.ALIGN = 8;
Material._get_impl=function(SELF){
var __l1001=new Material;
__l1001.diffuse=Vec3._get_impl((SELF + 0));
__l1001.specular=Vec3._get_impl((SELF + 24));
__l1001.shininess=_mem_float64[(SELF + 48) >> 3];
__l1001.ambient=Vec3._get_impl((SELF + 56));
__l1001.mirror=_mem_float64[(SELF + 80) >> 3];
return __l1001;
}
Material._set_impl=function(SELF,__l1002){
Vec3._set_impl((SELF + 0), (__l1002.diffuse));
Vec3._set_impl((SELF + 24), (__l1002.specular));
_mem_float64[(SELF + 48) >> 3] = (__l1002.shininess);
Vec3._set_impl((SELF + 56), (__l1002.ambient));
_mem_float64[(SELF + 80) >> 3] = (__l1002.mirror);
}


function makeMaterial(diffuse, specular, shininess, ambient, mirror) {
    var v = new Material;
    v.diffuse = diffuse;
    v.specular = specular;
    v.shininess = shininess;
    v.ambient = ambient;
    v.mirror = mirror;
    return v;
}

/*ray.flat_js[class definition]*//*88*/
function Surface(p) { this._pointer = (p|0); }
Object.defineProperty(Surface.prototype, 'pointer', { get: function () { return this._pointer } });
Surface.NAME = "Surface";
Surface.SIZE = 96;
Surface.ALIGN = 8;
Surface.CLSID = 12421246;
Object.defineProperty(Surface, 'BASE', {get: function () { return null; }});
/*ray.flat_js[method init]*//*91*/
Surface.init=function(SELF, material) {
	Material._set_impl((SELF + 8), material);
	return SELF;
    }
/*ray.flat_js[method intersect_impl]*//*96*/
Surface.intersect_impl=function(SELF, eye, ray, min, max) {
	throw "Pure: Surface.intersect"
    }
/*ray.flat_js[method normal_impl]*//*100*/
Surface.normal_impl=function(SELF, p) {
	throw "Pure: Surface.normal"
    }
/*ray.flat_js[vtable intersect]*//*88*/
Surface.intersect = function (SELF , eye,ray,min,max) {
  switch (_mem_int32[SELF>>2]) {
    case 12421246:
      return Surface.intersect_impl(SELF , eye,ray,min,max);
    case 31908292:
      return Scene.intersect_impl(SELF , eye,ray,min,max);
    case 255127510:
      return Sphere.intersect_impl(SELF , eye,ray,min,max);
    case 217195274:
      return Triangle.intersect_impl(SELF , eye,ray,min,max);
    default:
      throw FlatJS._badType(SELF);
  }
}
/*ray.flat_js[vtable normal]*//*88*/
Surface.normal = function (SELF , p) {
  switch (_mem_int32[SELF>>2]) {
    case 12421246:
    case 31908292:
      return Surface.normal_impl(SELF , p);
    case 255127510:
      return Sphere.normal_impl(SELF , p);
    case 217195274:
      return Triangle.normal_impl(SELF , p);
    default:
      throw FlatJS._badType(SELF);
  }
}
Surface.initInstance = function(SELF) { _mem_int32[SELF>>2]=12421246; return SELF; }
FlatJS._idToType[12421246] = Surface;


/*ray.flat_js[class definition]*//*105*/
function Scene(p) { this._pointer = (p|0); }
Scene.prototype = new Surface;
Scene.NAME = "Scene";
Scene.SIZE = 104;
Scene.ALIGN = 8;
Scene.CLSID = 31908292;
Object.defineProperty(Scene, 'BASE', {get: function () { return Surface; }});
/*ray.flat_js[method init]*//*109*/
Scene.init=function(SELF, objects) {
	var len = objects.length;
	_mem_int32[(SELF + 96) >> 2] = len;
	var objs = FlatJS.allocOrThrow(4 * len, 4);
	for ( var i=0 ; i < len ; i++ )
	    _mem_int32[(objs+4*i) >> 2] = (objects[i]);
	_mem_int32[(SELF + 100) >> 2] = objs;
	return SELF;
    }
/*ray.flat_js[method intersect_impl]*//*119*/
Scene.intersect_impl=function(SELF, eye, ray, min, max) {
	var min_obj = NULL;
	var min_dist = SENTINEL;

	var objs = _mem_int32[(SELF + 100) >> 2];
	for ( var idx=0, limit=_mem_int32[(SELF + 96) >> 2]; idx < limit ; idx++ ) {
	    var surf = _mem_int32[(objs+4*idx) >> 2];
	    var tmp = Surface.intersect(surf, eye, ray, min, max);
	    var obj = tmp.obj;
	    var dist = tmp.dist;
	    if (obj)
		if (dist >= min && dist < max)
		    if (dist < min_dist) {
			min_obj = obj;
			min_dist = dist;
		    }
	}
	return {obj:min_obj, dist:min_dist};
    }
/*ray.flat_js[vtable intersect]*//*105*/
Scene.intersect = function (SELF , eye,ray,min,max) {
  switch (_mem_int32[SELF>>2]) {
    case 31908292:
      return Scene.intersect_impl(SELF , eye,ray,min,max);
    default:
      throw FlatJS._badType(SELF);
  }
}
/*ray.flat_js[vtable normal]*//*105*/
Scene.normal = function (SELF , p) {
  switch (_mem_int32[SELF>>2]) {
    default:
      return Surface.normal_impl(SELF , p);
  }
}
Scene.initInstance = function(SELF) { _mem_int32[SELF>>2]=31908292; return SELF; }
FlatJS._idToType[31908292] = Scene;


/*ray.flat_js[class definition]*//*141*/
function Sphere(p) { this._pointer = (p|0); }
Sphere.prototype = new Surface;
Sphere.NAME = "Sphere";
Sphere.SIZE = 128;
Sphere.ALIGN = 8;
Sphere.CLSID = 255127510;
Object.defineProperty(Sphere, 'BASE', {get: function () { return Surface; }});
/*ray.flat_js[method init]*//*145*/
Sphere.init=function(SELF, material, center, radius) {
	Surface.init(SELF, material)
	Vec3._set_impl((SELF + 96), center);
	_mem_float64[(SELF + 120) >> 3] = radius
	return SELF;
    }
/*ray.flat_js[method intersect_impl]*//*152*/
Sphere.intersect_impl=function(SELF, eye, ray, min, max) {
	var DdotD = dot(ray, ray);
	var EminusC = subvref(eye, (SELF + 96));
	var B = dot(ray, EminusC);
	var disc = B*B - DdotD*(dot(EminusC,EminusC) - _mem_float64[(SELF + 120) >> 3]*_mem_float64[(SELF + 120) >> 3]);
	if (disc < 0.0)
	    return {obj:NULL, dist:0};
	var s1 = (-B + Math.sqrt(disc))/DdotD;
	var s2 = (-B - Math.sqrt(disc))/DdotD;
	// Here return the smallest of s1 and s2 after filtering for _min and _max
	if (s1 < min || s1 > max)
	    s1 = SENTINEL;
	if (s2 < min || s2 > max)
	    s2 = SENTINEL;
	var _dist = Math.min(s1,s2);
	if (_dist == SENTINEL)
	    return {obj:NULL, dist:0};
	return {obj:SELF, dist:_dist};
    }
/*ray.flat_js[method normal_impl]*//*172*/
Sphere.normal_impl=function(SELF, p) {
	return divi(subvref(p, (SELF + 96)), _mem_float64[(SELF + 120) >> 3]);
    }
/*ray.flat_js[vtable intersect]*//*141*/
Sphere.intersect = function (SELF , eye,ray,min,max) {
  switch (_mem_int32[SELF>>2]) {
    case 255127510:
      return Sphere.intersect_impl(SELF , eye,ray,min,max);
    default:
      throw FlatJS._badType(SELF);
  }
}
/*ray.flat_js[vtable normal]*//*141*/
Sphere.normal = function (SELF , p) {
  switch (_mem_int32[SELF>>2]) {
    case 255127510:
      return Sphere.normal_impl(SELF , p);
    default:
      throw FlatJS._badType(SELF);
  }
}
Sphere.initInstance = function(SELF) { _mem_int32[SELF>>2]=255127510; return SELF; }
FlatJS._idToType[255127510] = Sphere;


/*ray.flat_js[class definition]*//*177*/
function Triangle(p) { this._pointer = (p|0); }
Triangle.prototype = new Surface;
Triangle.NAME = "Triangle";
Triangle.SIZE = 168;
Triangle.ALIGN = 8;
Triangle.CLSID = 217195274;
Object.defineProperty(Triangle, 'BASE', {get: function () { return Surface; }});
/*ray.flat_js[method init]*//*182*/
Triangle.init=function(SELF, material, v1, v2, v3) {
	Surface.init(SELF, material)
	Vec3._set_impl((SELF + 96), v1);
	Vec3._set_impl((SELF + 120), v2);
	Vec3._set_impl((SELF + 144), v3);
	return SELF;
    }
/*ray.flat_js[method intersect_impl]*//*190*/
Triangle.intersect_impl=function(SELF, eye, ray, min, max) {
	// TODO: observe that values that do not depend on g, h, and i can be precomputed
	// and stored with the triangle (for a given eye position), at some (possibly significant)
	// space cost.  Notably the numerator of "t" is invariant, as are many factors of the
	// numerator of "gamma".
	var a = _mem_float64[(SELF + 96) >> 3]- _mem_float64[(SELF + 120) >> 3];
	var b = _mem_float64[(SELF + 104) >> 3]- _mem_float64[(SELF + 128) >> 3];
	var c = _mem_float64[(SELF + 112) >> 3]- _mem_float64[(SELF + 136) >> 3];
	var d = _mem_float64[(SELF + 96) >> 3]- _mem_float64[(SELF + 144) >> 3];
	var e = _mem_float64[(SELF + 104) >> 3]- _mem_float64[(SELF + 152) >> 3];
	var f = _mem_float64[(SELF + 112) >> 3]- _mem_float64[(SELF + 160) >> 3];
	var g = ray.x;
	var h = ray.y;
	var i = ray.z;
	var j = _mem_float64[(SELF + 96) >> 3]- eye.x;
	var k = _mem_float64[(SELF + 104) >> 3]- eye.y;
	var l = _mem_float64[(SELF + 112) >> 3]- eye.z;
	var M = a*(e*i - h*f) + b*(g*f - d*i) + c*(d*h - e*g);
	var t = -((f*(a*k - j*b) + e*(j*c - a*l) + d*(b*l - k*c))/M);
	if (t < min || t > max)
	    return {obj:NULL,dist:0};
	var gamma = (i*(a*k - j*b) + h*(j*c - a*l) + g*(b*l - k*c))/M;
	if (gamma < 0 || gamma > 1.0)
	    return {obj:NULL,dist:0};
	var beta = (j*(e*i - h*f) + k*(g*f - d*i) + l*(d*h - e*g))/M;
	if (beta < 0.0 || beta > 1.0 - gamma)
	    return {obj:NULL,dist:0};
	return {obj:SELF, dist:t};
    }
/*ray.flat_js[method normal_impl]*//*220*/
Triangle.normal_impl=function(SELF, p) {
	// TODO: Observe that the normal is invariant and can be stored with the triangle
	return normalize(cross(subrefref((SELF + 120), (SELF + 96)), subrefref((SELF + 144), (SELF + 96))));
    }
/*ray.flat_js[vtable intersect]*//*177*/
Triangle.intersect = function (SELF , eye,ray,min,max) {
  switch (_mem_int32[SELF>>2]) {
    case 217195274:
      return Triangle.intersect_impl(SELF , eye,ray,min,max);
    default:
      throw FlatJS._badType(SELF);
  }
}
/*ray.flat_js[vtable normal]*//*177*/
Triangle.normal = function (SELF , p) {
  switch (_mem_int32[SELF>>2]) {
    case 217195274:
      return Triangle.normal_impl(SELF , p);
    default:
      throw FlatJS._badType(SELF);
  }
}
Triangle.initInstance = function(SELF) { _mem_int32[SELF>>2]=217195274; return SELF; }
FlatJS._idToType[217195274] = Triangle;


/*ray.flat_js[class definition]*//*227*/
function Bitmap(p) { this._pointer = (p|0); }
Object.defineProperty(Bitmap.prototype, 'pointer', { get: function () { return this._pointer } });
Bitmap.NAME = "Bitmap";
Bitmap.SIZE = 16;
Bitmap.ALIGN = 4;
Bitmap.CLSID = 1766265;
Object.defineProperty(Bitmap, 'BASE', {get: function () { return null; }});
/*ray.flat_js[method init]*//*232*/
Bitmap.init=function(SELF, height, width, color) {
	_mem_int32[(SELF + 8) >> 2] = height;
	_mem_int32[(SELF + 12) >> 2] = width;
	var data = FlatJS.allocOrThrow(4 * (height*width), 4);
	var c = (255<<24)|((255*color.z)<<16)|((255*color.y)<<8)|(255*color.x)
	for ( var i=0, l=width*height ; i < l ; i++ )
	    _mem_int32[(data+4*i) >> 2] = c;
	_mem_int32[(SELF + 4) >> 2] = data;
	return SELF;
    }
/*ray.flat_js[method ref]*//*244*/
Bitmap.ref=function(SELF, y, x) {
	return _mem_int32[((_mem_int32[(SELF + 4) >> 2])+4*((_mem_int32[(SELF + 8) >> 2]-y)*_mem_int32[(SELF + 12) >> 2]+x)) >> 2];
    }
/*ray.flat_js[method setColor]*//*249*/
Bitmap.setColor=function(SELF, y, x, v) {
	_mem_int32[((_mem_int32[(SELF + 4) >> 2])+4*((_mem_int32[(SELF + 8) >> 2]-y-1)*_mem_int32[(SELF + 12) >> 2]+x)) >> 2] = ((255<<24)|((255*v.z)<<16)|((255*v.y)<<8)|(255*v.x));
    }
Bitmap.initInstance = function(SELF) { _mem_int32[SELF>>2]=1766265; return SELF; }
FlatJS._idToType[1766265] = Bitmap;


const g_left = -2;
const g_right = 2;
const g_top = 1.5;
const g_bottom = -1.5;

const bits = Bitmap.init(Bitmap.initInstance(FlatJS.allocOrThrow(16,4)), height, width, DL3(152.0/256.0, 251.0/256.0, 152.0/256.0));

function main() {
    setStage();

    // No workers, we do this all on the main thread, but the data is
    // in shared memory.  Normally we would otherwise communicate
    // [sab, width, height, bits] and maybe something coordinative.

    var then = Date.now();
    trace(0, height);
    var now = Date.now();

    var mycanvas = document.getElementById("mycanvas");
    var cx = mycanvas.getContext('2d');
    var id  = cx.createImageData(width, height);
    // FIXME: will set() work properly?
    // TODO: This operation, extracting a typed array from raw memory at an address,
    // could usefully be added to libflatjs, to avoid dealing with RAW_MEMORY.
    id.data.set(new Uint8Array(RAW_MEMORY, _mem_int32[(bits + 4) >> 2], width*height*4));
    cx.putImageData( id, 0, 0 );
    document.getElementById("mycaption").innerHTML = "Time=" + (now - then) + "ms";

    return 0;
}

const zzz = DL3(0,0,0);

var eye = zzz;      // Eye coordinates
var light = zzz;    // Light source coordinates
var background = zzz; // Background color
var world = NULL;

// Colors: http://kb.iu.edu/data/aetf.html

const paleGreen = DL3(152.0/256.0, 251.0/256.0, 152.0/256.0);
const darkGray = DL3(169.0/256.0, 169.0/256.0, 169.0/256.0);
const yellow = DL3(1.0, 1.0, 0.0);
const red = DL3(1.0, 0.0, 0.0);
const blue = DL3(0.0, 0.0, 1.0);

// Not restricted to a rectangle, actually
function rectangle(world, m, v1, v2, v3, v4) {
    world.push(Triangle.init(Triangle.initInstance(FlatJS.allocOrThrow(168,8)), m, v1, v2, v3));
    world.push(Triangle.init(Triangle.initInstance(FlatJS.allocOrThrow(168,8)), m, v1, v3, v4));
}

// Vertices are for front and back faces, both counterclockwise as seen
// from the outside.
// Not restricted to a cube, actually.
function cube(world, m, v1, v2, v3, v4, v5, v6, v7, v8) {
    rectangle(world, m, v1, v2, v3, v4);  // front
    rectangle(world, m, v2, v5, v8, v3);  // right
    rectangle(world, m, v6, v1, v4, v7);  // left
    rectangle(world, m, v5, v5, v7, v8);  // back
    rectangle(world, m, v4, v3, v8, v7);  // top
    rectangle(world, m, v6, v5, v2, v1);  // bottom
}

function setStage() {
    if (debug)
	PRINT("Setstage start");

    const m1 = makeMaterial(DL3(0.1, 0.2, 0.2), DL3(0.3, 0.6, 0.6), 10, DL3(0.05, 0.1, 0.1), 0);
    const m2 = makeMaterial(DL3(0.3, 0.3, 0.2), DL3(0.6, 0.6, 0.4), 10, DL3(0.1,0.1,0.05),   0);
    const m3 = makeMaterial(DL3(0.1,  0,  0), DL3(0.8,0,0),     10, DL3(0.1,0,0),     0);
    const m4 = makeMaterial(muli(darkGray,0.4), muli(darkGray,0.3), 100, muli(darkGray,0.3), 0.5);
    const m5 = makeMaterial(muli(paleGreen,0.4), muli(paleGreen,0.4), 10, muli(paleGreen,0.2), 1.0);
    const m6 = makeMaterial(muli(yellow,0.6), zzz, 0, muli(yellow,0.4), 0);
    const m7 = makeMaterial(muli(red,0.6), zzz, 0, muli(red,0.4), 0);
    const m8 = makeMaterial(muli(blue,0.6), zzz, 0, muli(blue,0.4), 0);

    var world = [];

    world.push(Sphere.init(Sphere.initInstance(FlatJS.allocOrThrow(128,8)), m1, DL3(-1, 1, -9), 1));
    world.push(Sphere.init(Sphere.initInstance(FlatJS.allocOrThrow(128,8)), m2, DL3(1.5, 1, 0), 0.75));
    world.push(Triangle.init(Triangle.initInstance(FlatJS.allocOrThrow(168,8)), m1, DL3(-1,0,0.75), DL3(-0.75,0,0), DL3(-0.75,1.5,0)));
    world.push(Triangle.init(Triangle.initInstance(FlatJS.allocOrThrow(168,8)), m3, DL3(-2,0,0), DL3(-0.5,0,0), DL3(-0.5,2,0)));
    rectangle(world, m4, DL3(-5,0,5), DL3(5,0,5), DL3(5,0,-40), DL3(-5,0,-40));
    cube(world, m5, DL3(1, 1.5, 1.5), DL3(1.5, 1.5, 1.25), DL3(1.5, 1.75, 1.25), DL3(1, 1.75, 1.5),
	 DL3(1.5, 1.5, 0.5), DL3(1, 1.5, 0.75), DL3(1, 1.75, 0.75), DL3(1.5, 1.75, 0.5));
    for ( var i=0 ; i < 30 ; i++ )
	world.push(Sphere.init(Sphere.initInstance(FlatJS.allocOrThrow(128,8)), m6, DL3((-0.6+(i*0.2)), (0.075+(i*0.05)), (1.5-(i*Math.cos(i/30.0)*0.5))), 0.075));
    for ( var i=0 ; i < 60 ; i++ )
	world.push(Sphere.init(Sphere.initInstance(FlatJS.allocOrThrow(128,8)), m7, DL3((1+0.3*Math.sin(i*(3.14/16))), (0.075+(i*0.025)), (1+0.3*Math.cos(i*(3.14/16)))), 0.025));
    for ( var i=0 ; i < 60 ; i++ )
	world.push(Sphere.init(Sphere.initInstance(FlatJS.allocOrThrow(128,8)), m8, DL3((1+0.3*Math.sin(i*(3.14/16))), (0.075+((i+8)*0.025)), (1+0.3*Math.cos(i*(3.14/16)))), 0.025));

    this.world = Scene.init(Scene.initInstance(FlatJS.allocOrThrow(104,8)), world);

    eye        = DL3(0.5, 0.75, 5);
    light      = DL3(g_left-1, g_top, 2);
    background = DL3(25.0/256.0,25.0/256.0,112.0/256.0);
    if (debug)
	PRINT("Setstage end");
}

function trace(hmin, hlim) {
    if (antialias)
	traceWithAntialias(hmin, hlim);
    else
	traceWithoutAntialias(hmin, hlim);
}

function traceWithoutAntialias(hmin, hlim) {
    for ( var h=hmin ; h < hlim ; h++ ) {
	if (debug)
	    PRINT("Row " + h);
	for ( var w=0 ; w < width ; w++ ) {
	    var u = g_left + (g_right - g_left)*(w + 0.5)/width;
	    var v = g_bottom + (g_top - g_bottom)*(h + 0.5)/height;
	    var ray = DL3(u, v, -eye.z);
	    var col = raycolor(eye, ray, 0, SENTINEL, reflection_depth);
	    Bitmap.setColor(bits, h, w, col);
	}
    }
}

const random_numbers = [
    0.495,0.840,0.636,0.407,0.026,0.547,0.223,0.349,0.033,0.643,0.558,0.481,0.039,
    0.175,0.169,0.606,0.638,0.364,0.709,0.814,0.206,0.346,0.812,0.603,0.969,0.888,
    0.294,0.824,0.410,0.467,0.029,0.706,0.314
];

function traceWithAntialias(hmin, hlim) {
    var k = 0;
    for ( var h=hmin ; h < hlim ; h++ ) {
	//if (debug)
	//    PRINT("Row " + h);
	for ( var w=0 ; w < width ; w++ ) {
	    // Simple stratified sampling, cf Shirley&Marschner ch 13 and a fast "random" function.
	    const n = 4;
	    //var k = h % 32;
	    var rand = k % 2;
	    var c = zzz;
	    k++;
	    for ( var p=0 ; p < n ; p++ ) {
		for ( var q=0 ; q < n ; q++ ) {
		    var jx = random_numbers[rand]; rand=rand+1;
		    var jy = random_numbers[rand]; rand=rand+1;
		    var u = g_left + (g_right - g_left)*(w + (p + jx)/n)/width;
		    var v = g_bottom + (g_top - g_bottom)*(h + (q + jy)/n)/height;
		    var ray = DL3(u, v, -eye.z);
		    c = add(c, raycolor(eye, ray, 0.0, SENTINEL, reflection_depth));
		}
	    }
	    Bitmap.setColor(bits, h,w,divi(c,n*n));
	}
    }
}

// Clamping c is not necessary provided the three color components by
// themselves never add up to more than 1, and shininess == 0 or shininess >= 1.
//
// TODO: lighting intensity is baked into the material here, but we probably want
// to factor that out and somehow attenuate light with distance from the light source,
// for diffuse and specular lighting.

function raycolor(eye, ray, t0, t1, depth) {
    var tmp = Surface.intersect(world, eye, ray, t0, t1);
    var obj = tmp.obj;
    var dist = tmp.dist;

    if (obj) {
	const m = (obj + 8);
	const p = add(eye, muli(ray, dist));
	const n1 = Surface.normal(obj, p);
	const l1 = normalize(sub(light, p));
	var c = Vec3._get_impl((m + 56));
	var min_obj = NULL;

	// Passing NULL here and testing for it in intersect() was intended as an optimization,
	// since any hit will do, but does not seem to have much of an effect in scenes tested
	// so far - maybe not enough scene detail (too few shadows).
	if (shadows) {
	    var tmp = Surface.intersect(world, add(p, muli(l1, EPS)), l1, EPS, SENTINEL);
	    min_obj = tmp.obj;
	}
	if (!min_obj) {
	    const diffuse = Math.max(0.0, dot(n1,l1));
	    const v1 = normalize(neg(ray));
	    const h1 = normalize(add(v1, l1));
	    const specular = Math.pow(Math.max(0.0, dot(n1, h1)), _mem_float64[(m + 48) >> 3]);
	    c = add(c, add(mulrefi((m + 0),diffuse), mulrefi((m + 24),specular)));
	    if (reflection)
		if (depth > 0.0 && _mem_float64[(m + 80) >> 3] != 0.0) {
		    const r = sub(ray, muli(n1, 2.0*dot(ray, n1)));
		    c = add(c, muli(raycolor(add(p, muli(r,EPS)), r, EPS, SENTINEL, depth-1), _mem_float64[(m + 80) >> 3]));
		}
	}
	return c;
    }
    return background;
}

function fail(msg) {
    PRINT("");
    PRINT(msg);
    throw new Error("EXIT");
}
