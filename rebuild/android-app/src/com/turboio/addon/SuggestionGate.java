package com.turboio.addon;

import java.util.*;
import java.lang.ref.WeakReference;
import java.util.function.BooleanSupplier;

/** A delayed SDK submission must not revive a retired task card. Stock suggestions pass unchanged. */
final class SuggestionGate {
 private static final WeakHashMap<Object,Owned> owned=new WeakHashMap<>();
 private static final class Owned {
  final WeakReference<Object> identity;final String peer;final byte[] bytes;volatile BooleanSupplier valid;
  Owned(Object message,String peer,byte[] bytes,BooleanSupplier valid){identity=new WeakReference<>(message);this.peer=peer;this.bytes=bytes.clone();this.valid=valid;}
 }
 static synchronized boolean register(Object message,String peer,byte[] bytes,BooleanSupplier valid){if(owned.size()>=128||owned.containsKey(message))return false;owned.put(message,new Owned(message,peer,bytes,valid));return true;}
 static synchronized void retire(Object message){Owned value=owned.get(message);if(value!=null&&value.identity.get()==message)value.valid=()->false;}
 static boolean allow(Object message,String peer,byte[] bytes){Owned value;synchronized(SuggestionGate.class){value=owned.get(message);}return value==null||value.identity.get()==message&&Objects.equals(value.peer,peer)&&Arrays.equals(value.bytes,bytes)&&value.valid.getAsBoolean();}
 private SuggestionGate(){}
}
