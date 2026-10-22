package com.turboio.addon;

import java.util.*;

/** Platform-neutral connection facts. SDK objects, accounts and callbacks stay outside. */
interface GlassesConnection {
 final class Peer {
  final String id,name,ble,spp,bond;final boolean connected;
  Peer(String id,String name,String ble,String spp,String bond,boolean connected){this.id=id;this.name=name;this.ble=ble;this.spp=spp;this.bond=bond;this.connected=connected;}
  boolean authenticated(){return connected&&("authSuccess".equals(ble)||"authSuccess".equals(spp));}
  String suffix(){return id.length()>8?"…"+id.substring(id.length()-8):id;}
 }
 final class Snapshot {
  final boolean enabled,owned,scanning,shared;final String note;final List<Peer> peers;
  Snapshot(boolean enabled,boolean owned,boolean scanning,String note,List<Peer> peers){this(enabled,owned,scanning,false,note,peers);}
  Snapshot(boolean enabled,boolean owned,boolean scanning,boolean shared,String note,List<Peer> peers){this.enabled=enabled;this.owned=owned;this.scanning=scanning;this.shared=shared;this.note=note;this.peers=Collections.unmodifiableList(new ArrayList<>(peers));}
 }
 Snapshot snapshot();
 void enable()throws Exception;
 void scan()throws Exception;
 void stopScan()throws Exception;
 void connect(String id,boolean pair)throws Exception;
 void disconnect(String id)throws Exception;
 void disable()throws Exception;
}
