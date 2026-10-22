import brut.androlib.src.SmaliBuilder;
import com.android.tools.smali.dexlib2.Opcodes;
import com.android.tools.smali.dexlib2.writer.builder.DexBuilder;
import com.android.tools.smali.dexlib2.writer.io.FileDataStore;
import java.nio.file.*;
import java.util.stream.Stream;

/** Use the pinned apktool's own assembler, including its Windows file mapping. */
public final class AssembleDex {
 public static void main(String[] args) throws Exception {
  if(args.length!=2)throw new IllegalArgumentException("source directory and output required");
  Path root=Paths.get(args[0]);
  // Host input is DEX 039. Android 16's SDK API number is not a DEX version.
  SmaliBuilder assembler=new SmaliBuilder(root.toFile(),29);
  DexBuilder dex=new DexBuilder(new Opcodes(29,-1));
  try(Stream<Path> files=Files.walk(root)){
   for(Path file:(Iterable<Path>)files.filter(p->p.toString().endsWith(".smali")).sorted()::iterator)
    assembler.buildFile(root.relativize(file).toString(),dex);
  }
  FileDataStore output=new FileDataStore(Paths.get(args[1]).toFile());
  try{output.raf.setLength(0);dex.writeTo(output);}finally{output.raf.close();assembler.mSmaliDir.close();}
  System.out.println("Hook DEX assembled");
 }
}
