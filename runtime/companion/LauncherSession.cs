using System;

// Pure lifecycle logic. A button held elsewhere cannot pin a hover flyout.
public sealed class LauncherSession {
 public bool Active {get;private set;}
 public bool DragOwned {get;private set;}
 int previousButtons;
 long foregroundBaseline;bool foregroundWasOwn;
 public void Begin(int buttons){Active=true;DragOwned=false;previousButtons=buttons;}
 public void End(){Active=false;DragOwned=false;previousButtons=0;foregroundBaseline=0;foregroundWasOwn=false;}
 public void BeginForeground(long handle,bool own){foregroundBaseline=handle;foregroundWasOwn=own;}
 // Used both during the watch tick and immediately before showing a prepared
 // window, so a delayed layout cannot raise over a newly activated browser.
 public bool ForegroundAllows(long handle,bool own){
  if(!Active||handle!=0&&(handle!=foregroundBaseline||foregroundWasOwn&&!own)&&!own)return false;
  if(own)foregroundBaseline=handle;foregroundWasOwn=own;return true;
 }
 public void PointerDownInside(){if(Active)DragOwned=true;}
 public bool Pointer(bool inside,int buttons){
  if(!Active)return false;
  int pressed=buttons&~previousButtons;previousButtons=buttons;
  if(pressed!=0){if(!inside&&!DragOwned)return true;if(inside)DragOwned=true;}
  if(buttons==0)DragOwned=false;
  return false;
 }
 public bool KeepOpen(bool inside){return Active&&(inside||DragOwned);}
}
