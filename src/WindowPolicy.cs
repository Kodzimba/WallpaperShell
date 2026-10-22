using System;
using System.Collections.Generic;
using System.Drawing;

namespace PaperGreen {
 // Pure application-wide state. HWND observation and presentation live in the host;
 // coverage/animation pause deliberately cannot grant a lease or change this state.
 internal sealed class WindowPolicyState {
  readonly HashSet<string> surfaces=new HashSet<string>(StringComparer.Ordinal);
  internal string ModalOwner {get;private set;}
  internal string ModalKind {get;private set;}
  internal string ModalToken {get;private set;}
  internal string PanelOwner {get;private set;}
  internal string PanelKind {get;private set;}
  internal int Generation {get;private set;}
  internal bool Blocked {get{return ModalToken!=null;}}
  internal void Register(string surface){if(!String.IsNullOrEmpty(surface))surfaces.Add(surface);}
  internal bool Contains(string surface){return surface!=null&&surfaces.Contains(surface);}
  internal bool Unregister(string surface){return Unregister(surface,false);}
  internal bool Unregister(string surface,bool awaitNativeShell){surfaces.Remove(surface);if(PanelOwner==surface){PanelOwner=null;PanelKind=null;}if(ModalOwner!=surface||awaitNativeShell&&(ModalKind=="shell"||ModalKind=="notifications"))return false;ClearModal();return true;}
  internal bool Acquire(string owner,string kind,out string token){
   token=null;if(!Contains(owner)||Blocked||(kind!="import"&&kind!="export"&&kind!="power"&&kind!="shell"&&kind!="notifications"&&kind!="update"))return false;
   ModalOwner=owner;ModalKind=kind;ModalToken=Guid.NewGuid().ToString("D");PanelOwner=null;PanelKind=null;token=ModalToken;return true;
  }
  internal bool Release(string owner,string token){if(!Blocked||ModalOwner!=owner||ModalToken!=token)return false;ClearModal();return true;}
  internal bool Owns(string owner,string kind){return Blocked&&ModalOwner==owner&&ModalKind==kind;}
  internal bool Panel(string owner,string kind){
   if(!Contains(owner)||Blocked||(kind!="settings"&&kind!="themes"&&kind!="launcher"))return false;
   PanelOwner=owner;PanelKind=kind;return true;
  }
  internal bool ClosePanel(string owner,string kind){if(PanelOwner!=owner||PanelKind!=kind)return false;PanelOwner=null;PanelKind=null;return true;}
  // External focus changes retain reversible import/export, but revoke power.
  internal bool External(){PanelOwner=null;PanelKind=null;if(ModalKind!="power")return false;ClearModal();return true;}
  internal bool SuspendSurface(string owner){if(PanelOwner==owner){PanelOwner=null;PanelKind=null;}if(ModalOwner!=owner||ModalKind!="power")return false;ClearModal();return true;}
  internal void Reset(){Reset(false);}
  internal void Reset(bool awaitNativeShell){Generation++;PanelOwner=null;PanelKind=null;if(!awaitNativeShell||(ModalKind!="shell"&&ModalKind!="notifications"))ClearModal();}
  void ClearModal(){ModalOwner=null;ModalKind=null;ModalToken=null;}
 }
 internal sealed class WindowPolicyScope : IDisposable {
  Action release;internal WindowPolicyScope(Action release){this.release=release;}
  public void Dispose(){var callback=release;release=null;if(callback!=null)callback();}
 }
 internal static class WindowPlacement {
  internal static Rectangle Clamp(Rectangle bounds,Rectangle work){
   int width=Math.Min(Math.Max(1,bounds.Width),Math.Max(1,work.Width)),height=Math.Min(Math.Max(1,bounds.Height),Math.Max(1,work.Height));
   int left=Math.Max(work.Left,Math.Min(bounds.Left,work.Right-width)),top=Math.Max(work.Top,Math.Min(bounds.Top,work.Bottom-height));
   return new Rectangle(left,top,width,height);
  }
 }
 internal sealed class WindowForegroundState {
  long previous;bool observed,previousOwn;
  internal bool Observe(long handle,bool own){bool external=observed&&handle!=0&&!own&&(handle!=previous||previousOwn);previous=handle;previousOwn=own;observed=true;return external;}
 }
}
