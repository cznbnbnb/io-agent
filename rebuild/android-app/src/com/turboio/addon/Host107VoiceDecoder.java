package com.turboio.addon;

/** Per-capture instance of the official Opus decoder. No global decoder or microphone calls. */
final class Host107VoiceDecoder implements AutoCloseable {
 private final Object decoder;private boolean closed;
 Host107VoiceDecoder()throws ReflectiveOperationException{
  decoder=Class.forName("com.rayneo.airuntime.utils.OpusDecoder").getConstructor().newInstance();
  try{if(!Boolean.TRUE.equals(decoder.getClass().getMethod("init-uN6NtqM",int.class,int.class).invoke(decoder,16000,1)))throw new IllegalStateException("VOICE_DECODER_INIT_FAILED");}
  catch(ReflectiveOperationException|RuntimeException failure){try{close();}catch(Exception ignored){}throw failure;}
 }
 synchronized byte[] decode(byte[] opus)throws ReflectiveOperationException{
  if(closed||opus==null||opus.length==0||opus.length>8192)throw new IllegalArgumentException("VOICE_OPUS_INVALID");
  Object value=decoder.getClass().getMethod("decode2Bytes",byte[].class).invoke(decoder,(Object)opus.clone());
  if(!(value instanceof byte[])||((byte[])value).length==0||((byte[])value).length>8192||((byte[])value).length%2!=0)throw new IllegalStateException("VOICE_PCM_INVALID");
  return ((byte[])value).clone();
 }
 public synchronized void close()throws ReflectiveOperationException{if(!closed){decoder.getClass().getMethod("release").invoke(decoder);closed=true;}}
}
