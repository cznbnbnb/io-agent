package android.os;
import java.util.*;
public final class Handler {
 private static final class Job {final long due,id;final Runnable work;Job(long due,long id,Runnable work){this.due=due;this.id=id;this.work=work;}}
 private static final PriorityQueue<Job> queue=new PriorityQueue<>(Comparator.<Job>comparingLong(j->j.due).thenComparingLong(j->j.id));private static long id;
 public Handler(Looper looper){}
 public boolean post(Runnable r){return postDelayed(r,0);}
 public boolean postDelayed(Runnable r,long delay){synchronized(queue){queue.add(new Job(SystemClock.elapsedRealtime()+delay,++id,r));}return true;}
 public static void drain(){if(Looper.myLooper()!=Looper.getMainLooper())throw new IllegalStateException();for(int i=0;i<10000;i++){Job job;synchronized(queue){if(queue.isEmpty()||queue.peek().due>SystemClock.elapsedRealtime())return;job=queue.remove();}job.work.run();}throw new AssertionError("Unbounded main-loop work");}
}
