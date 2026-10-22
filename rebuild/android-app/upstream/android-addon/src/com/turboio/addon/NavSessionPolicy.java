package com.turboio.addon;

/** A ready display owned by us can be updated; uncertain exits need a visible decision. */
public final class NavSessionPolicy {
    public enum Action { START, REUSE, CONFIRM_EXIT, WAIT }
    public enum Position { WAIT_FIX, REPLAN, FOLLOW }
    public static boolean canOpen(boolean hasRoute,boolean modeMatches){return hasRoute&&modeMatches;}
    public static Position position(boolean fresh,boolean validated,double drift){
        if(!fresh)return Position.WAIT_FIX;
        if(!validated&&(!Double.isFinite(drift)||drift>80))return Position.REPLAN;
        return Position.FOLLOW;
    }
    public static Action action(String phase) {
        if("idle".equals(phase))return Action.START;
        if("ready".equals(phase))return Action.REUSE;
        if("stopping".equals(phase)||"uncertain".equals(phase))return Action.CONFIRM_EXIT;
        return Action.WAIT;
    }
}
