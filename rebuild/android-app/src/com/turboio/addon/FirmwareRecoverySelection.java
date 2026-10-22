package com.turboio.addon;

import java.util.*;

/** Current SDK ID plus fresh existing bond; no name matching, alias guess, scan or pairing. */
final class FirmwareRecoverySelection {
 private static final Set<String> BLE_TERMINAL=new HashSet<>(Arrays.asList("disconnected","connectTimeout","connectFail","authFailed","authInterrupt"));
 static GlassesConnection.Peer select(List<GlassesConnection.Peer> peers,Fixed60Session.ReconnectPermit permit,long now){
  if(peers==null||peers.size()>64||permit==null)throw new IllegalStateException("RECOVERY_SELECTION_INVALID");
  GlassesConnection.Peer found=null;
  for(GlassesConnection.Peer peer:peers){
   if(peer.connected)throw new IllegalStateException("RECOVERY_CONNECTION_PRESENT");
   if(!permit.matches(peer.id,now))continue;
   if(found!=null)throw new IllegalStateException("RECOVERY_AMBIGUOUS_TARGET");found=peer;
  }
  if(found==null)throw new IllegalStateException("RECOVERY_ORIGINAL_NOT_FOUND");
  if(!"bonded".equals(found.bond))throw new IllegalStateException("RECOVERY_BOND_REQUIRED");
  if(!BLE_TERMINAL.contains(found.ble)||!"disconnected".equals(found.spp))throw new IllegalStateException("RECOVERY_CONNECTION_IN_PROGRESS");
  return found;
 }
}
