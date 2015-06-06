// Ray tracer, largely out of Shirley & Marschner 3rd Ed.
// Traces a scene and writes to a canvas.
//
// lth@acm.org / lhansen@mozilla.com, winter 2012 and later.
//
// The language is straight Javascript and runs properly in Firefox,
// Safari, and Chrome.

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

function Material(diffuse, specular, shininess, ambient, mirror) {
    this.diffuse = diffuse;
    this.specular = specular;
    this.shininess = shininess;
    this.ambient = ambient;
    this.mirror = mirror;
}

const zzz = DL3(0,0,0);
const m0 = new Material(zzz, zzz, 0, zzz, 0);

function Scene() {
    this.material = m0;
    this.objects = [];
}

Scene.prototype.add =
    function(obj) {
	this.objects.push(obj);
    };

Scene.prototype.intersect =
    function (eye, ray, min, max) {
	var min_obj = null;
	var min_dist = SENTINEL;

	var objs = this.objects;
	for ( var idx=0, limit=objs.length ; idx < limit ; idx++ ) {
	    var surf = objs[idx];
	    var tmp = surf.intersect(eye, ray, min, max);
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
    };

Scene.prototype.normal =
    function (p) {
	fail("normal() not defined on Scene");
	return zzz;
    };

function Sphere(material, center, radius) {
    this.material = material;
    this.center = center;
    this.radius = radius;
}

Sphere.prototype.intersect =
    function (eye, ray, min, max) {
	var DdotD = dot(ray, ray);
	var EminusC = sub(eye, this.center);
	var B = dot(ray, EminusC);
	var disc = B*B - DdotD*(dot(EminusC,EminusC) - this.radius*this.radius);
	if (disc < 0.0)
	    return {obj:null, dist:0};
	var s1 = (-B + Math.sqrt(disc))/DdotD;
	var s2 = (-B - Math.sqrt(disc))/DdotD;
	// Here return the smallest of s1 and s2 after filtering for _min and _max
	if (s1 < min || s1 > max)
	    s1 = SENTINEL;
	if (s2 < min || s2 > max)
	    s2 = SENTINEL;
	var _dist = Math.min(s1,s2);
	if (_dist == SENTINEL)
	    return {obj:null, dist:0};
	return {obj:this, dist:_dist};
    };

Sphere.prototype.normal =
    function (p) {
	return divi(sub(p, this.center), this.radius);
    };

function Triangle(material, v1, v2, v3) {
    this.material = material;
    this.v1 = v1;
    this.v2 = v2;
    this.v3 = v3;
}

Triangle.prototype.intersect =
    function (eye, ray, min, max) {
	// TODO: observe that values that do not depend on g, h, and i can be precomputed
	// and stored with the triangle (for a given eye position), at some (possibly significant)
	// space cost.  Notably the numerator of "t" is invariant, as are many factors of the
	// numerator of "gamma".
	var v1 = this.v1;
	var v2 = this.v2;
	var v3 = this.v3;
	var a = v1.x - v2.x;
	var b = v1.y - v2.y;
	var c = v1.z - v2.z;
	var d = v1.x - v3.x;
	var e = v1.y - v3.y;
	var f = v1.z - v3.z;
	var g = ray.x;
	var h = ray.y;
	var i = ray.z;
	var j = v1.x - eye.x;
	var k = v1.y - eye.y;
	var l = v1.z - eye.z;
	var M = a*(e*i - h*f) + b*(g*f - d*i) + c*(d*h - e*g);
	var t = -((f*(a*k - j*b) + e*(j*c - a*l) + d*(b*l - k*c))/M);
	if (t < min || t > max)
	    return {obj:null,dist:0};
	var gamma = (i*(a*k - j*b) + h*(j*c - a*l) + g*(b*l - k*c))/M;
	if (gamma < 0 || gamma > 1.0)
	    return {obj:null,dist:0};
	var beta = (j*(e*i - h*f) + k*(g*f - d*i) + l*(d*h - e*g))/M;
	if (beta < 0.0 || beta > 1.0 - gamma)
	    return {obj:null,dist:0};
	return {obj:this, dist:t};
    };

Triangle.prototype.normal =
    function (p) {
	// TODO: Observe that the normal is invariant and can be stored with the triangle
	return normalize(cross(sub(this.v2, this.v1), sub(this.v3, this.v1)));
    };

function Bitmap(height, width, color) {
    this.height = height;
    this.width = width;
    var c = (255<<24)|((255*color.z)<<16)|((255*color.y)<<8)|(255*color.x)
    var b = new Int32Array(width*height);
    this.data = b;
    for ( var i=0, l=width*height ; i < l ; i++ )
	b[i] = c;
}

// For debugging only
Bitmap.prototype.ref =
    function (y, x) {
	return this.data[(this.height-y)*this.width+x];
    };

// Not a hot function
Bitmap.prototype.setColor =
    function (y, x, v) {
	this.data[(this.height-y-1)*this.width+x] = (255<<24)|((255*v.z)<<16)|((255*v.y)<<8)|(255*v.x);
    };

const height = 600;
const width = 800;

const g_left = -2;
const g_right = 2;
const g_top = 1.5;
const g_bottom = -1.5;

const bits = new Bitmap(height, width, DL3(152.0/256.0, 251.0/256.0, 152.0/256.0));

function main() {
    setStage();
    var then = Date.now();
    trace(0, height);
    var now = Date.now();

    var mycanvas = document.getElementById("mycanvas");
    var cx = mycanvas.getContext('2d');
    var id  = cx.createImageData(width, height);
    id.data.set(new Uint8Array(bits.data.buffer));
    cx.putImageData( id, 0, 0 );
    document.getElementById("mycaption").innerHTML = "Time=" + (now - then) + "ms";

    return 0;
}

var eye = zzz;      // Eye coordinates
var light = zzz;    // Light source coordinates
var background = zzz; // Background color
var world = new Scene();

// Colors: http://kb.iu.edu/data/aetf.html

const paleGreen = DL3(152.0/256.0, 251.0/256.0, 152.0/256.0);
const darkGray = DL3(169.0/256.0, 169.0/256.0, 169.0/256.0);
const yellow = DL3(1.0, 1.0, 0.0);
const red = DL3(1.0, 0.0, 0.0);
const blue = DL3(0.0, 0.0, 1.0);

// Not restricted to a rectangle, actually
function rectangle(m, v1, v2, v3, v4) {
    world.add(new Triangle(m, v1, v2, v3));
    world.add(new Triangle(m, v1, v3, v4));
}

// Vertices are for front and back faces, both counterclockwise as seen
// from the outside.
// Not restricted to a cube, actually.
function cube(m, v1, v2, v3, v4, v5, v6, v7, v8) {
    rectangle(m, v1, v2, v3, v4);  // front
    rectangle(m, v2, v5, v8, v3);  // right
    rectangle(m, v6, v1, v4, v7);  // left
    rectangle(m, v5, v5, v7, v8);  // back
    rectangle(m, v4, v3, v8, v7);  // top
    rectangle(m, v6, v5, v2, v1);  // bottom
}

function setStage() {
    if (debug)
	PRINT("Setstage start");
    const m1 = new Material(DL3(0.1, 0.2, 0.2), DL3(0.3, 0.6, 0.6), 10, DL3(0.05, 0.1, 0.1), 0);
    const m2 = new Material(DL3(0.3, 0.3, 0.2), DL3(0.6, 0.6, 0.4), 10, DL3(0.1,0.1,0.05),   0);
    const m3 = new Material(DL3(0.1,  0,  0), DL3(0.8,0,0),     10, DL3(0.1,0,0),     0);
    const m4 = new Material(muli(darkGray,0.4), muli(darkGray,0.3), 100, muli(darkGray,0.3), 0.5);
    const m5 = new Material(muli(paleGreen,0.4), muli(paleGreen,0.4), 10, muli(paleGreen,0.2), 1.0);
    const m6 = new Material(muli(yellow,0.6), zzz, 0, muli(yellow,0.4), 0);
    const m7 = new Material(muli(red,0.6), zzz, 0, muli(red,0.4), 0);
    const m8 = new Material(muli(blue,0.6), zzz, 0, muli(blue,0.4), 0);

    world.add(new Sphere(m1, DL3(-1, 1, -9), 1));
    world.add(new Sphere(m2, DL3(1.5, 1, 0), 0.75));
    world.add(new Triangle(m1, DL3(-1,0,0.75), DL3(-0.75,0,0), DL3(-0.75,1.5,0)));
    world.add(new Triangle(m3, DL3(-2,0,0), DL3(-0.5,0,0), DL3(-0.5,2,0)));
    rectangle(m4, DL3(-5,0,5), DL3(5,0,5), DL3(5,0,-40), DL3(-5,0,-40));
    cube(m5, DL3(1, 1.5, 1.5), DL3(1.5, 1.5, 1.25), DL3(1.5, 1.75, 1.25), DL3(1, 1.75, 1.5),
	 DL3(1.5, 1.5, 0.5), DL3(1, 1.5, 0.75), DL3(1, 1.75, 0.75), DL3(1.5, 1.75, 0.5));
    for ( var i=0 ; i < 30 ; i++ )
	world.add(new Sphere(m6, DL3((-0.6+(i*0.2)), (0.075+(i*0.05)), (1.5-(i*Math.cos(i/30.0)*0.5))), 0.075));
    for ( var i=0 ; i < 60 ; i++ )
	world.add(new Sphere(m7, DL3((1+0.3*Math.sin(i*(3.14/16))), (0.075+(i*0.025)), (1+0.3*Math.cos(i*(3.14/16)))), 0.025));
    for ( var i=0 ; i < 60 ; i++ )
	world.add(new Sphere(m8, DL3((1+0.3*Math.sin(i*(3.14/16))), (0.075+((i+8)*0.025)), (1+0.3*Math.cos(i*(3.14/16)))), 0.025));

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
	    bits.setColor(h, w, col);
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
	    bits.setColor(h,w,divi(c,n*n));
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
    var tmp = world.intersect(eye, ray, t0, t1);
    var obj = tmp.obj;
    var dist = tmp.dist;

    if (obj) {
	const m = obj.material;
	const p = add(eye, muli(ray, dist));
	const n1 = obj.normal(p);
	const l1 = normalize(sub(light, p));
	var c = m.ambient;
	var min_obj = null;

	// Passing NULL here and testing for it in intersect() was intended as an optimization,
	// since any hit will do, but does not seem to have much of an effect in scenes tested
	// so far - maybe not enough scene detail (too few shadows).
	if (shadows) {
	    var tmp = world.intersect(add(p, muli(l1, EPS)), l1, EPS, SENTINEL);
	    min_obj = tmp.obj;
	}
	if (!min_obj) {
	    const diffuse = Math.max(0.0, dot(n1,l1));
	    const v1 = normalize(neg(ray));
	    const h1 = normalize(add(v1, l1));
	    const specular = Math.pow(Math.max(0.0, dot(n1, h1)), m.shininess);
	    c = add(c, add(muli(m.diffuse,diffuse), muli(m.specular,specular)));
	    if (reflection)
		if (depth > 0.0 && m.mirror != 0.0) {
		    const r = sub(ray, muli(n1, 2.0*dot(ray, n1)));
		    c = add(c, muli(raycolor(add(p, muli(r,EPS)), r, EPS, SENTINEL, depth-1), m.mirror));
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
