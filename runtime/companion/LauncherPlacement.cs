using System;

// A hover popup stays in the ordinary window band. Windows may accept a normal
// NOACTIVATE placement while leaving a background process below the foreground.
// Repair that case with one synchronous boost/restore pair, never a persistent
// topmost state or an activation/focus request. Delegates keep failure cleanup testable.
public enum LauncherPlacementResult { Ready, Blocked, Failed }
public static class LauncherPlacement {
 public static LauncherPlacementResult Raise(Func<bool> allowed,Func<bool> normal,Func<bool> above,Func<bool> boost,Func<bool> restore,Action hide){
  if(!allowed())return LauncherPlacementResult.Blocked;
  if(!normal())return LauncherPlacementResult.Failed;
  if(above())return allowed()?LauncherPlacementResult.Ready:LauncherPlacementResult.Blocked;
  if(!allowed())return LauncherPlacementResult.Blocked;
  bool boosted=false,restored=false;
  try{boosted=boost();}
  finally{
   // Demotion is attempted even when the temporary boost failed or threw.
   // If Windows rejects restoration, remove the popup instead of leaving it pinned.
   try{restored=restore();}finally{if(!restored)hide();}
  }
  if(!restored)return LauncherPlacementResult.Failed;
  if(!allowed())return LauncherPlacementResult.Blocked;
  if(!boosted||!above())return LauncherPlacementResult.Failed;
  return allowed()?LauncherPlacementResult.Ready:LauncherPlacementResult.Blocked;
 }
}
