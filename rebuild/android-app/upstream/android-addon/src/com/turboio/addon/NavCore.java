package com.turboio.addon;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Original, platform-free navigation helpers. Coordinates must all be GCJ-02. */
public final class NavCore {
    public static final class Point {
        public final double lat, lon;
        public Point(double lat,double lon) {
            if(!Double.isFinite(lat)||!Double.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) throw new IllegalArgumentException("coordinate");
            this.lat=lat;this.lon=lon;
        }
    }
    public static final class Step {
        public final String instruction;
        public final List<Point> points;
        public Step(String instruction,List<Point> points){this.instruction=instruction;this.points=Collections.unmodifiableList(new ArrayList<>(points));}
    }
    public static double distance(Point a,Point b) {
        double x=Math.toRadians(b.lon-a.lon)*Math.cos(Math.toRadians((a.lat+b.lat)/2));
        double y=Math.toRadians(b.lat-a.lat);return Math.hypot(x,y)*6371000;
    }
    public static final class Match {
        public final int step;public final double offRoute,remainingStep;
        Match(int s,double d,double r){step=s;offRoute=d;remainingStep=r;}
    }
    public static Match match(List<Step> steps,Point p,int current) {
        double best=Double.POSITIVE_INFINITY,remaining=0;int selected=-1;
        // Do not jump across parallel roads or to distant later route sections.
        for(int s=Math.max(0,current);s<Math.min(steps.size(),current+2);s++){
            List<Point> line=steps.get(s).points;
            for(int i=1;i<line.size();i++){
                Point a=line.get(i-1),b=line.get(i);
                double scale=Math.cos(Math.toRadians(p.lat));
                double ax=(a.lon-p.lon)*scale,ay=a.lat-p.lat,bx=(b.lon-p.lon)*scale,by=b.lat-p.lat;
                double dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
                double t=den==0?0:Math.max(0,Math.min(1,-(ax*dx+ay*dy)/den));
                double d=Math.hypot(ax+t*dx,ay+t*dy)*111195;
                if(d<best){best=d;selected=s;remaining=distance(a,b)*(1-t);for(int k=i+1;k<line.size();k++)remaining+=distance(line.get(k-1),line.get(k));}
            }
        }
        return new Match(selected,best,remaining);
    }
    public static String meters(double n){if(!Double.isFinite(n)||n<0)return "—";return n>=1000?String.format(Locale.ROOT,"%.1f 公里",n/1000):Math.round(n)+" 米";}
    public static String clip(String text,int bytes){StringBuilder b=new StringBuilder();int n=0;for(int i=0;i<text.length();){int cp=text.codePointAt(i);String c=new String(Character.toChars(cp));int size=c.getBytes(StandardCharsets.UTF_8).length;if(n+size>bytes)break;b.append(c);n+=size;i+=Character.charCount(cp);}return b.toString();}
    public static byte[] packet(int type,String json) {
        if(type!=3&&type!=5&&type!=7)throw new IllegalArgumentException("type");
        byte[] data=json.getBytes(StandardCharsets.UTF_8);if(data.length>4096)throw new IllegalArgumentException("size");
        ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(8);out.write(1);out.write(16);out.write(type);out.write(26);
        int n=data.length;do{int v=n&127;n>>>=7;out.write(n==0?v:v|128);}while(n!=0);out.write(data,0,data.length);return out.toByteArray();
    }
    public static final class Envelope {public final int type;public final String json;Envelope(int t,String j){type=t;json=j;}}
    private static long var(byte[] b,int[] p){long v=0;for(int i=0;i<10;i++){if(p[0]>=b.length)throw new IllegalArgumentException();int c=b[p[0]++]&255;if(i==9&&(c&254)!=0)throw new IllegalArgumentException();v|=(long)(c&127)<<(7*i);if((c&128)==0)return v;}throw new IllegalArgumentException();}
    public static Envelope decode(byte[] b){
        if(b==null||b.length>262144) return null;
        try{int[] p={0};int seen=0,type=-1;long version=0;String json="{}";
            while(p[0]<b.length){long k=var(b,p);int tag=(int)(k>>3),wire=(int)(k&7);if(tag<1||tag>4||(seen&(1<<tag))!=0)return null;seen|=1<<tag;
                if(tag<=2){if(wire!=0)return null;long v=var(b,p);if(tag==1)version=v;else {if(v>255||v<0)return null;type=(int)v;}}
                else{if(wire!=2)return null;long n=var(b,p);if(n<0||n>b.length-p[0])return null;if(tag==3)json=new String(b,p[0],(int)n,StandardCharsets.UTF_8);p[0]+=(int)n;}}
            return version==1&&type>=0?new Envelope(type,json):null;
        }catch(RuntimeException e){return null;}
    }
}
