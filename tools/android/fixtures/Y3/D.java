package Y3;
/** JVM-only stand-in for the pinned host's pure identity mapper; never packaged. */
public final class D {
 public static final String FIRST="0123456789abcdef0123456789abcdef",SECOND="fedcba9876543210fedcba9876543210";
 public static int calls;
 public static String a(String address){calls++;String s=address.replace(":","").toUpperCase(java.util.Locale.ROOT);if(s.equals("020000000001"))return FIRST;if(s.equals("020000000002"))return SECOND;if(s.equals("020000000003"))throw new IllegalArgumentException("synthetic mapper unavailable");return null;}
}
