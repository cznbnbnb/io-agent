import com.turboio.addon.NavSessionPolicy;
public class NavSessionPolicyTest {
    public static void main(String[] args){
        String[] states={"idle","ready","starting","stopping","uncertain","unknown",null};
        NavSessionPolicy.Action[] expected={NavSessionPolicy.Action.START,NavSessionPolicy.Action.REUSE,NavSessionPolicy.Action.WAIT,NavSessionPolicy.Action.CONFIRM_EXIT,NavSessionPolicy.Action.CONFIRM_EXIT,NavSessionPolicy.Action.WAIT,NavSessionPolicy.Action.WAIT};
        for(int i=0;i<states.length;i++)if(NavSessionPolicy.action(states[i])!=expected[i])throw new AssertionError("state "+states[i]);
        if(!NavSessionPolicy.canOpen(true,true)||NavSessionPolicy.canOpen(false,true)||NavSessionPolicy.canOpen(true,false))throw new AssertionError("route gate");
        if(NavSessionPolicy.position(false,false,0)!=NavSessionPolicy.Position.WAIT_FIX)throw new AssertionError("coarse still shows overview");
        if(NavSessionPolicy.position(true,false,12)!=NavSessionPolicy.Position.FOLLOW)throw new AssertionError("fresh follows");
        if(NavSessionPolicy.position(true,false,81)!=NavSessionPolicy.Position.REPLAN)throw new AssertionError("changed start");
        if(NavSessionPolicy.position(true,true,800)!=NavSessionPolicy.Position.FOLLOW)throw new AssertionError("walking away is expected");
        if(NavSessionPolicy.position(true,false,Double.NaN)!=NavSessionPolicy.Position.REPLAN)throw new AssertionError("unknown start");
        System.out.println("NavSessionPolicy: 15 checks PASS (display independent of fix, guarded real guidance)");
    }
}
