package com.turboio.addon;

import java.util.*;

public final class OfficialSdkReceiptTest {
 public interface Callback {Object invoke(Object message,Object error);}
 private static int checks;
 private static void yes(boolean ok){checks++;if(!ok)throw new AssertionError("receipt check "+checks);}
 public static void main(String[] args){
  Object message=new Object(),result=new Object(),failure=new Object();List<Object[]> delivered=new ArrayList<>();List<Boolean> outcomes=new ArrayList<>(),firsts=new ArrayList<>();
  Callback original=(m,e)->{delivered.add(new Object[]{m,e});return result;};
  Callback wrapped=(Callback)OfficialSdkReceipt.wrap(Callback.class,original,message,(ok,first)->{outcomes.add(ok);firsts.add(first);});
  yes(wrapped!=original&&wrapped.equals(wrapped)&&!wrapped.equals(original));yes(wrapped.invoke(message,null)==result);yes(delivered.size()==1&&delivered.get(0)[0]==message&&delivered.get(0)[1]==null);yes(outcomes.equals(Arrays.asList(true))&&firsts.equals(Arrays.asList(true)));
  yes(wrapped.invoke(message,failure)==result);yes(delivered.size()==2&&delivered.get(1)[1]==failure);yes(outcomes.equals(Arrays.asList(true,false))&&firsts.equals(Arrays.asList(true,false)));
  Object other=new Object();wrapped.invoke(other,null);yes(!outcomes.get(2)&&delivered.get(2)[0]==other);
  Callback observerThrows=(Callback)OfficialSdkReceipt.wrap(Callback.class,original,message,(ok,first)->{throw new IllegalStateException("observer");});yes(observerThrows.invoke(message,null)==result&&delivered.size()==4);
  IllegalStateException expected=new IllegalStateException("vendor");Callback vendorThrows=(m,e)->{throw expected;};Callback exception=(Callback)OfficialSdkReceipt.wrap(Callback.class,vendorThrows,message,(ok,first)->{});boolean same=false;try{exception.invoke(message,null);}catch(IllegalStateException actual){same=actual==expected;}yes(same);
  boolean invalid=false;try{OfficialSdkReceipt.wrap(Callback.class,new Object(),message,(ok,first)->{});}catch(IllegalArgumentException bad){invalid=true;}yes(invalid);
  System.out.println("Official SDK receipt forwarding: "+checks+" assertions passed.");
 }
}
