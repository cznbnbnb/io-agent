package com.turboio.addon;

import java.io.*;import java.net.*;import java.nio.*;import java.nio.channels.*;import java.nio.file.*;import java.nio.file.attribute.*;import java.math.BigDecimal;import java.util.*;import java.util.zip.CRC32;

/** Read-only Hive 2 primitive-frame adapter. Frame format independently
 * implemented against Hive v2.2.3 binary_reader_impl.dart / frame.dart.
 * Checks CRC before inspecting a value, honors replacement/removal by key,
 * and never treats cache eviction as a source-material deletion. */
public final class OfficialHiveCache {
 private static final int MAX_FILE=16777216,MAX_FRAME=2097152,MAX_NODES=100000;
 private OfficialHiveCache(){}
 private static void require(boolean ok,String code){MaterialWire.require(ok,code);}
 private static boolean selected(Object key){if(!(key instanceof String))return false;try{URI u=new URI((String)key);return "https".equals(u.getScheme())&&"xr-api-p.rayneo.cn".equals(u.getHost())&&u.getRawUserInfo()==null&&(u.getPort()==-1||u.getPort()==443)&&"/lifelog/api/v1/events".equals(u.getRawPath())&&u.getRawFragment()==null;}catch(URISyntaxException invalid){return false;}}
 public static Map<String,Object> read(File file)throws IOException {
  require(file!=null&&!Files.isSymbolicLink(file.toPath()),"OFFICIAL_CACHE_PATH");BasicFileAttributes before=Files.readAttributes(file.toPath(),BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);require(before.isRegularFile()&&before.size()<=MAX_FILE,"OFFICIAL_CACHE_BUDGET");ByteBuffer data=ByteBuffer.allocate((int)before.size());
  try(SeekableByteChannel in=Files.newByteChannel(file.toPath(),StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)){while(data.hasRemaining()){int n=in.read(data);if(n<0)throw new IOException("OFFICIAL_CACHE_CHANGED");if(n==0)throw new IOException("OFFICIAL_CACHE_STALLED");}}
  BasicFileAttributes after=Files.readAttributes(file.toPath(),BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);require(before.size()==after.size()&&before.lastModifiedTime().equals(after.lastModifiedTime())&&Objects.equals(before.fileKey(),after.fileKey()),"OFFICIAL_CACHE_CHANGED");return decode(data.array());
 }
 static Map<String,Object> decode(byte[] data){require(data!=null&&data.length<=MAX_FILE,"OFFICIAL_CACHE_BUDGET");Map<String,Object> live=new LinkedHashMap<>();int offset=0,frames=0;
  while(offset<data.length){require(++frames<=100000&&data.length-offset>=4,"OFFICIAL_CACHE_INCOMPLETE");long length=Integer.toUnsignedLong(ByteBuffer.wrap(data,offset,4).order(ByteOrder.LITTLE_ENDIAN).getInt());require(length>=8&&length<=MAX_FRAME&&length<=data.length-offset,"OFFICIAL_CACHE_INCOMPLETE");int size=(int)length;CRC32 crc=new CRC32();crc.update(data,offset,size-4);long expected=Integer.toUnsignedLong(ByteBuffer.wrap(data,offset+size-4,4).order(ByteOrder.LITTLE_ENDIAN).getInt());require(crc.getValue()==expected,"OFFICIAL_CACHE_CRC");Reader reader=new Reader(ByteBuffer.wrap(data,offset+4,size-8).slice().order(ByteOrder.LITTLE_ENDIAN));Object key=reader.key();
   if(selected(key)){if(!reader.bytes.hasRemaining())live.remove(key);else{Object value=reader.value(0);require(!reader.bytes.hasRemaining(),"OFFICIAL_CACHE_TRAILING");live.put((String)key,value);require(live.size()<=4096,"OFFICIAL_CACHE_BUDGET");}}
   offset+=size;
  }return live;
 }
 private static final class Reader {
  final ByteBuffer bytes;int nodes;Reader(ByteBuffer bytes){this.bytes=bytes;}
  void need(int size){require(size>=0&&size<=bytes.remaining(),"OFFICIAL_CACHE_INCOMPLETE");}
  int byteValue(){need(1);return bytes.get()&255;}
  int length(int max){need(4);long n=Integer.toUnsignedLong(bytes.getInt());require(n<=max,"OFFICIAL_CACHE_BUDGET");return (int)n;}
  String string(int size){need(size);byte[] raw=new byte[size];bytes.get(raw);return BoundedJson.utf8(raw);}
  Object key(){int type=byteValue();if(type==0){need(4);return Integer.toUnsignedLong(bytes.getInt());}require(type==1,"OFFICIAL_CACHE_KEY");return string(byteValue());}
  Object number(boolean integer){need(8);double v=bytes.getDouble();require(Double.isFinite(v),"OFFICIAL_CACHE_NUMBER");if(integer){require(v==Math.rint(v)&&Math.abs(v)<=9007199254740991D,"OFFICIAL_CACHE_NUMBER");return (long)v;}return BigDecimal.valueOf(v);}
  Object value(int depth){require(depth<=32&&++nodes<=MAX_NODES,"OFFICIAL_CACHE_COMPLEXITY");int type=byteValue();switch(type){case 0:return null;case 1:return number(true);case 2:return number(false);case 3:return byteValue()>0;case 4:return string(length(1048576));case 10:{int n=length(10000);List<Object> values=new ArrayList<>();for(int i=0;i<n;i++)values.add(value(depth+1));return values;}case 11:{int n=length(10000);Map<String,Object> values=new LinkedHashMap<>();for(int i=0;i<n;i++){Object key=value(depth+1);require(key instanceof String&&!values.containsKey(key),"OFFICIAL_CACHE_MAP");values.put((String)key,value(depth+1));}return values;}default:throw new IllegalArgumentException("OFFICIAL_CACHE_TYPE_UNSUPPORTED");}}
 }
 /** Cache response may itself be JSON text or a native Hive map. */
 private static Map<String,Object> object(Object value){if(value instanceof String)value=WireJson.read(((String)value).getBytes(java.nio.charset.StandardCharsets.UTF_8));return WireJson.map(value);}
 public static Set<String> sourceReferences(Map<String,Object> cache){Set<String> refs=new HashSet<>();for(Object raw:cache.values()){
   Map<String,Object> stored=object(raw),response=object(stored.get("response"));Object code=response.get("code");require(code instanceof Long&&(Long)code==0,"OFFICIAL_CACHE_RESPONSE");Map<String,Object> data=object(response.get("data"));List<Object> events=WireJson.list(data.get("events"));require(events.size()<=10000,"OFFICIAL_CACHE_BUDGET");
   for(Object event:events){Map<String,Object> row=WireJson.map(event);Object links=row.get("transcriptionInfos");if(links==null)continue;for(Object link:WireJson.list(links)){Map<String,Object> info=WireJson.map(link);String id=MaterialWire.text(info.get("sourceId"),128,false),type=MaterialWire.text(info.get("sourceType"),128,false);require(id.matches("[A-Za-z0-9_.:-]+")&&type.matches("[A-Za-z0-9_.:-]+"),"OFFICIAL_CACHE_SOURCE");refs.add(type+"/"+id);require(refs.size()<=10000,"OFFICIAL_CACHE_BUDGET");}}
  }return Collections.unmodifiableSet(refs);}
}
