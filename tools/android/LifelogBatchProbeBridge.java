package com.turboio.androidtests.voice;
import java.io.*;import java.util.concurrent.Callable;

/** Test-only access to the relocated production batch; returns counts only. */
public final class LifelogBatchProbeBridge {
 public static String audit(File flutter,Callable<byte[]> account)throws Exception{
  OfficialLifelogBatch batch=OfficialLifelogBatch.read(flutter,()->OfficialAccountBinding.read(account.call()));
  return new String(WireJson.bytes(WireJson.object("accepted_sources",batch.sources.size(),"conflicting_sources",batch.conflicts,"unowned_sources",batch.unowned,"invalid_responses",batch.invalid,"pages",batch.pages,"bytes",batch.bytes,"selected_inventory_complete",batch.selectedInventoryComplete,"scan_consistent",batch.scanConsistent,"persisted_or_uploaded",false)),java.nio.charset.StandardCharsets.UTF_8);
 }
}
