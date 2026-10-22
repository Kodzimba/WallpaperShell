using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;

namespace PaperGreen {
 // Observes native activation/presentation and only lowers our own surfaces.
 // No foreign window is activated, moved, or kept above other applications.
 internal sealed class WindowEnvironment : IDisposable {
  readonly int processId=System.Diagnostics.Process.GetCurrentProcess().Id;
  readonly Dictionary<IntPtr,int> popups=new Dictionary<IntPtr,int>();
  readonly HashSet<IntPtr> surfaces=new HashSet<IntPtr>();readonly WindowForegroundState foreground=new WindowForegroundState();
  sealed class AttentionEvent {
   internal WindowAttention Window;internal uint Time;internal long OwnGeneration;
  }
  readonly Queue<AttentionEvent> shown=new Queue<AttentionEvent>();long ownGeneration;uint ownTime;bool ownMarked;
  delegate void EventProc(IntPtr hook,uint type,IntPtr hwnd,int objectId,int childId,uint thread,uint time);
  EventProc eventProc;GCHandle eventRoot;IntPtr showHook,restoreHook;bool disposed;
  internal bool AttentionHooksActive {get{return showHook!=IntPtr.Zero&&restoreHook!=IntPtr.Zero;}}
  [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  [DllImport("user32.dll")]static extern IntPtr GetWindow(IntPtr window,uint command);
  [DllImport("user32.dll")]static extern IntPtr GetAncestor(IntPtr window,uint flags);
  [DllImport("user32.dll")]static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")]static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr window,out NativeRect rect);
  [DllImport("user32.dll",EntryPoint="GetWindowLongW")]static extern int GetWindowLong(IntPtr window,int index);
  [DllImport("user32.dll")]static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")]static extern IntPtr SetWinEventHook(uint first,uint last,IntPtr module,EventProc callback,uint process,uint thread,uint flags);
  [DllImport("user32.dll")]static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")]static extern bool IsChild(IntPtr parent,IntPtr child);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr window,StringBuilder text,int count);
  [DllImport("user32.dll")]static extern bool GetGUIThreadInfo(uint thread,ref GuiThreadInfo info);
  [StructLayout(LayoutKind.Sequential)]struct NativeRect{internal int Left,Top,Right,Bottom;}
  [StructLayout(LayoutKind.Sequential)]struct GuiThreadInfo{internal int Size;internal uint Flags;internal IntPtr Active,Focus,Capture,MenuOwner,MoveSize,Caret;internal NativeRect CaretRect;}
  [DllImport("dwmapi.dll")]static extern int DwmGetWindowAttribute(IntPtr window,int attribute,out int value,int size);
  internal bool Register(string handle,int pid,bool add){
   long number;if(pid<=0||!Int64.TryParse(handle,out number)||number==0)return false;
   var hwnd=new IntPtr(number);if(!add){int expected;if(popups.TryGetValue(hwnd,out expected)&&expected==pid)popups.Remove(hwnd);return true;}
   uint actual;if(!IsWindow(hwnd)||GetWindowThreadProcessId(hwnd,out actual)==0||actual!=(uint)pid)return false;
   popups[hwnd]=pid;return true;
  }
  bool OwnHandle(IntPtr hwnd){uint actual;GetWindowThreadProcessId(hwnd,out actual);if(actual==(uint)processId)return true;int expected;return popups.TryGetValue(hwnd,out expected)&&actual==(uint)expected;}
  internal bool OwnGroup(IntPtr hwnd){
   if(OwnDesktopFocus(hwnd))return true;
   var visited=new HashSet<IntPtr>();for(int depth=0;hwnd!=IntPtr.Zero&&depth<16&&visited.Add(hwnd);depth++){
    if(OwnHandle(hwnd))return true;var root=GetAncestor(hwnd,2);if(root!=IntPtr.Zero&&root!=hwnd&&OwnHandle(root))return true;
    hwnd=GetWindow(hwnd,4); // GW_OWNER; the native chooser/menus remain in their chain.
   }return false;
  }
  internal void Surface(IntPtr handle,bool add){if(handle==IntPtr.Zero)return;if(add)surfaces.Add(handle);else surfaces.Remove(handle);}
  bool OwnDesktopFocus(IntPtr hwnd){
   // WorkerW belongs to Explorer even while one of our child WebViews owns input.
   // Qualify its actual focused descendant instead of treating the desktop as ours.
   var name=new StringBuilder(128);GetClassName(hwnd,name,name.Capacity);string kind=name.ToString();if(kind!="WorkerW"&&kind!="Progman"&&kind!="SHELLDLL_DefView"&&kind!="SysListView32")return false;
   uint ignored;uint thread=GetWindowThreadProcessId(hwnd,out ignored);var info=new GuiThreadInfo{Size=Marshal.SizeOf(typeof(GuiThreadInfo))};
   if(thread==0||!GetGUIThreadInfo(thread,ref info)||info.Focus==IntPtr.Zero)return false;
   foreach(var surface in surfaces)if(IsWindow(surface)&&(surface==info.Focus||IsChild(surface,info.Focus)))return true;return false;
  }
  internal bool ChangedToExternal(){
   var hwnd=GetForegroundWindow();return foreground.Observe(hwnd.ToInt64(),OwnGroup(hwnd));
  }
  internal void Baseline(){var hwnd=GetForegroundWindow();foreground.Observe(hwnd.ToInt64(),OwnGroup(hwnd));}
  internal void StartNotifications(){
   if(disposed||eventProc!=null)return;
   eventProc=OnWindowEvent;eventRoot=GCHandle.Alloc(eventProc);
   // Out-of-context notifications on our UI message loop; no injected DLL,
   // mouse/keyboard hook, window text, URL or history collection.
   showHook=SetWinEventHook(WindowAttentionRules.Shown,WindowAttentionRules.Shown,IntPtr.Zero,eventProc,0,0,2);
   restoreHook=SetWinEventHook(WindowAttentionRules.Restored,WindowAttentionRules.Restored,IntPtr.Zero,eventProc,0,0,2);
  }
  void OnWindowEvent(IntPtr hook,uint type,IntPtr hwnd,int objectId,int childId,uint thread,uint time){
   try{
    if(disposed||!WindowAttentionRules.RelevantEvent(type,objectId,childId))return;
    var candidate=InspectAttention(hwnd,0);if(candidate==null)return;
    if(shown.Count>=64)shown.Dequeue();shown.Enqueue(new AttentionEvent{Window=candidate,Time=time,OwnGeneration=ownGeneration});
   }catch{/* A window can disappear during this notification. */}
  }
  WindowAttention InspectAttention(IntPtr hwnd,uint expectedPid){
   if(hwnd==IntPtr.Zero||!IsWindow(hwnd))return null;
   uint pid;GetWindowThreadProcessId(hwnd,out pid);if(pid==0||expectedPid!=0&&pid!=expectedPid)return null;
   NativeRect rect;if(!GetWindowRect(hwnd,out rect))return null;
   var bounds=Rectangle.FromLTRB(rect.Left,rect.Top,rect.Right,rect.Bottom);
   var name=new StringBuilder(128);GetClassName(hwnd,name,name.Capacity);
   uint style=unchecked((uint)GetWindowLong(hwnd,-16)),extended=unchecked((uint)GetWindowLong(hwnd,-20));
   if(!WindowAttentionRules.Ordinary(style,extended,name.ToString(),IsWindowVisible(hwnd),IsIconic(hwnd),Cloaked(hwnd),GetAncestor(hwnd,2)==hwnd,OwnGroup(hwnd),bounds))return null;
   return new WindowAttention(hwnd,pid,bounds,(extended&8)!=0);
  }
  internal WindowAttention ForegroundAttention(){return InspectAttention(GetForegroundWindow(),0);}
  internal void OwnInteraction(){ownGeneration++;ownTime=unchecked((uint)Environment.TickCount);ownMarked=true;}
  internal WindowAttention[] DrainAttention(){
   var result=new List<WindowAttention>();var seen=new HashSet<IntPtr>();
   int pending=shown.Count;
   while(pending-->0&&shown.Count>0){var item=shown.Dequeue();var old=item.Window;if(WindowAttentionRules.Superseded(item.OwnGeneration,ownGeneration,item.Time,ownMarked,ownTime)||!seen.Add(old.Handle))continue;var current=InspectAttention(old.Handle,old.ProcessId);if(current!=null)result.Add(current);}
   return result.ToArray();
  }
  static bool Above(IntPtr ours,IntPtr other){
   var visited=new HashSet<IntPtr>();for(var at=GetWindow(other,3);at!=IntPtr.Zero&&visited.Count<4096&&visited.Add(at);at=GetWindow(at,3))if(at==ours)return true;
   return false;
  }
  internal bool YieldSurface(IntPtr handle,Rectangle bounds,bool desktop,bool visible,bool minimized,WindowAttention original){
   if(handle==IntPtr.Zero||!IsWindow(handle)||original==null)return false;
   var external=InspectAttention(original.Handle,original.ProcessId);if(external==null)return false;
   bool topmost=(GetWindowLong(handle,-20)&8)!=0;
   var plan=WindowAttentionRules.Plan(desktop,visible,minimized,topmost,Above(handle,external.Handle),external.Topmost,bounds,external.Bounds);
   if(plan==WindowYield.None)return false;
   const uint flags=0x1|0x2|0x10|0x200; // keep size/location/activation/owner order
   if(topmost&&!SetWindowPos(handle,new IntPtr(-2),0,0,0,0,flags))return false;
   if(plan==WindowYield.DemoteOnly)return true;
   // Only our HWND is moved. The external application retains its own activation
   // and normal z-order; we do not change unrelated windows or a desktop child.
   return SetWindowPos(handle,external.Handle,0,0,0,0,flags);
  }
  public void Dispose(){
   if(disposed)return;disposed=true;
   if(showHook!=IntPtr.Zero)UnhookWinEvent(showHook);if(restoreHook!=IntPtr.Zero)UnhookWinEvent(restoreHook);
   showHook=restoreHook=IntPtr.Zero;shown.Clear();if(eventRoot.IsAllocated)eventRoot.Free();eventProc=null;
  }
  internal static bool Cloaked(IntPtr handle){try{int value;return DwmGetWindowAttribute(handle,14,out value,4)==0&&value!=0;}catch{return false;}}
 }
}
