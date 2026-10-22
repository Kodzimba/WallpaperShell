using System;
public static class LauncherSessionTests {
 static int checks;
 static void Check(bool value,string message){checks++;if(!value)throw new Exception(message);}
 public static void Main(){
  var s=new LauncherSession();
  s.Begin(1);Check(!s.Pointer(false,1),"held elsewhere is not a new click");Check(!s.KeepOpen(false),"held elsewhere cannot pin flyout");
  s.Pointer(true,1);Check(!s.DragOwned,"entering with held button does not own drag");
  s.Pointer(true,0);s.Pointer(true,1);Check(s.DragOwned&&s.KeepOpen(false),"drag starts inside and owns continuation outside");
  Check(!s.Pointer(false,1),"owned drag may leave popup");s.Pointer(false,0);Check(!s.KeepOpen(false),"release ends drag hold");
  Check(s.Pointer(false,2),"new outside click dismisses without stealing target input");
  s.Begin(0);s.PointerDownInside();Check(s.KeepOpen(false),"message filter owns quick inside press before timer");s.Pointer(false,0);Check(!s.KeepOpen(false),"observed release clears fast press");
  s.Begin(0);s.Pointer(true,1);s.End();Check(!s.Active&&!s.DragOwned&&!s.KeepOpen(true),"lifecycle end clears pointer ownership");
  s.Begin(0);Check(!s.Pointer(true,0)&&s.KeepOpen(true),"visible hover needs no activation or button");
  s.BeginForeground(10,false);Check(s.ForegroundAllows(10,false),"existing external foreground permits a visible hover without activation");
  Check(!s.ForegroundAllows(20,false),"new browser foreground during layout preparation prevents final raise");
  s.Begin(0);s.BeginForeground(10,false);Check(s.ForegroundAllows(30,true),"the popup and its own dialog remain in their input chain");
  Check(!s.ForegroundAllows(10,false),"clicking the previous external app releases the popup priority");
  s.Begin(0);s.BeginForeground(30,true);Check(!s.ForegroundAllows(30,false),"leaving own desktop focus invalidates even an unchanged foreground HWND");
  s.End();Check(!s.ForegroundAllows(30,true),"a cancelled layout session cannot raise after a late completion");
  Placement();
  Console.WriteLine("Launcher session: "+checks+" assertions passed.");
 }
 static void Placement(){
  string calls="";bool elevated=false,above=false,valid=true;
  Func<bool> normal=()=>{calls+="N";return true;};
  Func<bool> boost=()=>{calls+="B";elevated=true;above=true;return true;};
  Func<bool> restore=()=>{calls+="R";elevated=false;return true;};
  Action hide=()=>{calls+="H";};
  var result=LauncherPlacement.Raise(()=>valid,normal,()=>above&&!elevated,boost,restore,hide);
  Check(result==LauncherPlacementResult.Ready&&calls=="NBR"&&!elevated,"background foreground restriction is repaired above the app with no persistent topmost");
  calls="";result=LauncherPlacement.Raise(()=>true,normal,()=>true,boost,restore,hide);
  Check(result==LauncherPlacementResult.Ready&&calls=="N","already raised popup never uses the boost");
  calls="";result=LauncherPlacement.Raise(()=>false,normal,()=>false,boost,restore,hide);
  Check(result==LauncherPlacementResult.Blocked&&calls=="","covered category cannot start placement");
  calls="";result=LauncherPlacement.Raise(()=>true,()=>false,()=>false,boost,restore,hide);
  Check(result==LauncherPlacementResult.Failed&&calls=="","normal placement failure cannot start priority repair");
  calls="";valid=true;result=LauncherPlacement.Raise(()=>valid,()=>{valid=false;return true;},()=>false,boost,restore,hide);
  Check(result==LauncherPlacementResult.Blocked&&calls=="","external activation during normal preparation cancels the boost");
  calls="";valid=true;result=LauncherPlacement.Raise(()=>valid,()=>{valid=false;return true;},()=>true,boost,restore,hide);
  Check(result==LauncherPlacementResult.Blocked&&calls=="","even successful normal placement cannot outlive its originating hover");
  calls="";result=LauncherPlacement.Raise(()=>true,normal,()=>false,()=>{calls+="B";return false;},restore,hide);
  Check(result==LauncherPlacementResult.Failed&&calls=="NBR"&&!elevated,"failed boost still restores the normal band");
  calls="";bool threw=false;try{LauncherPlacement.Raise(()=>true,normal,()=>false,()=>{calls+="B";elevated=true;throw new Exception();},restore,hide);}catch{threw=true;}
  Check(threw&&calls=="NBR"&&!elevated,"exception in boost still restores the normal band");
  calls="";result=LauncherPlacement.Raise(()=>true,normal,()=>false,boost,()=>{calls+="R";return false;},hide);
  Check(result==LauncherPlacementResult.Failed&&calls=="NBRH","failed demotion hides instead of leaving the popup pinned");
  calls="";threw=false;try{LauncherPlacement.Raise(()=>true,normal,()=>false,boost,()=>{calls+="R";throw new Exception();},hide);}catch{threw=true;}
  Check(threw&&calls=="NBRH","demotion exception also hides before propagating failure");
  calls="";valid=true;elevated=false;result=LauncherPlacement.Raise(()=>valid,normal,()=>false,()=>{valid=false;return boost();},restore,hide);
  Check(result==LauncherPlacementResult.Blocked&&calls=="NBR"&&!elevated,"external input during repair cancels after guaranteed restoration");
  calls="";result=LauncherPlacement.Raise(()=>true,normal,()=>false,boost,restore,hide);
  Check(result==LauncherPlacementResult.Failed&&calls=="NBR"&&!elevated,"native success without confirmed final ordering is not reported as shown");
 }
}
