/* -*- mode: javascript -*- */

load("../libflatjs.js");
var ab = new ArrayBuffer(1024);
FlatJS.init(ab, true);

const TSTest = {
  NAME: "TSTest",
  SIZE: 4,
  ALIGN: 4,
  CLSID: 1081549,
  get BASE() { return null; },
  testMethod_impl : function (SELF, x:number, y:string, ...z): void {
	return x + y + z.join(",");
    }
,
testMethod : function (SELF , x,y,...z) {
  switch (_mem_int32[SELF>>2]) {
    case 1081549:
      return TSTest.testMethod_impl(SELF , x,y,...z);
    case 178720338:
      return TSTest2.testMethod_impl(SELF , x,y,...z);
    default:
      throw FlatJS._badType(SELF);
  }
},
initInstance:function(SELF) { _mem_int32[SELF>>2]=1081549; return SELF; },
}
FlatJS._idToType[1081549] = TSTest;

const TSTest2 = {
  NAME: "TSTest2",
  SIZE: 4,
  ALIGN: 4,
  CLSID: 178720338,
  get BASE() { return TSTest; },
  testMethod_impl : function (SELF, x:number, y:string, ...z): void {
	return x + y + z.join(",");
    }
,
testMethod : function (SELF , x,y,...z) {
  switch (_mem_int32[SELF>>2]) {
    case 178720338:
      return TSTest2.testMethod_impl(SELF , x,y,...z);
    default:
      throw FlatJS._badType(SELF);
  }
},
initInstance:function(SELF) { _mem_int32[SELF>>2]=178720338; return SELF; },
}
FlatJS._idToType[178720338] = TSTest2;
