package com.turboio.addon;
/** Host policy tests run with no recording owner; the real recording gate is covered by test-voice.mjs. */
final class Host107Recording {
 static boolean allowQueue(Object message,String business,String peer,byte[] bytes){return true;}
}
