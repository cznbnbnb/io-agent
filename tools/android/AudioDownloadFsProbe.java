package com.turboio.tools;
import java.nio.file.*;import java.nio.charset.StandardCharsets;import java.util.Arrays;

/** Platform NIO shape only, shell-owned synthetic files; never App/user data. */
public final class AudioDownloadFsProbe {
 public static void main(String[] args)throws Exception{
  if(args.length!=1||!args[0].matches("/data/local/tmp/codex-audio-fs-[a-zA-Z0-9-]{1,48}"))throw new IllegalArgumentException("PROBE_SCOPE");
  Path root=Paths.get(args[0]),file=root.resolve("synthetic-marker"),link=root.resolve("synthetic-hardlink");Files.createDirectory(root);long single=0,paired=0;boolean denied=false;
  try{byte[] bytes="synthetic download filesystem shape".getBytes(StandardCharsets.UTF_8);Files.write(file,bytes,StandardOpenOption.CREATE_NEW);Object first=Files.getAttribute(file,"unix:nlink",LinkOption.NOFOLLOW_LINKS);if(!(first instanceof Number))throw new Exception("LINK_ATTRIBUTE_TYPE");single=((Number)first).longValue();try{Files.createLink(link,file);paired=((Number)Files.getAttribute(file,"unix:nlink",LinkOption.NOFOLLOW_LINKS)).longValue();}catch(AccessDeniedException policy){denied=true;}if(single!=1||!denied&&paired!=2||!Arrays.equals(Files.readAllBytes(file),bytes))throw new Exception("LINK_ATTRIBUTE_VALUE");}
  finally{Files.deleteIfExists(link);Files.deleteIfExists(file);Files.delete(root);}
  System.out.println("{\"unix_nlink_supported\":true,\"single_link_count\":"+single+",\"paired_link_count\":"+(denied?"null":String.valueOf(paired))+",\"hardlink_creation_denied\":"+denied+",\"synthetic_files_removed\":true,\"app_or_user_files_accessed\":false}");
 }
}
