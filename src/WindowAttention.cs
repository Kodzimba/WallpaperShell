using System;
using System.Drawing;

namespace PaperGreen {
 internal enum WindowYield { None, DemoteOnly, BelowWindow }
 internal static class WindowAttentionRules {
  internal const uint Shown=0x8002, Restored=0x0017;
  internal static bool ExplicitPanel(string kind){return kind=="settings"||kind=="themes";}
  internal static bool RelevantEvent(uint type,int objectId,int childId){
   return (type==Shown||type==Restored)&&objectId==0&&childId==0;
  }
  internal static bool Superseded(long captured,long current,uint eventTime,bool marked,uint ownTime){
   // Generation covers a click after delivery even within one clock tick;
   // timestamp covers a delayed callback for an event predating that click.
   return captured!=current||marked&&unchecked((int)(ownTime-eventTime))>0;
  }
  internal static bool Ordinary(uint style,uint extended,string kind,bool visible,bool minimized,bool cloaked,bool root,bool own,Rectangle bounds){
   if(!visible||minimized||cloaked||!root||own||bounds.Width<=0||bounds.Height<=0)return false;
   if((style&0x40000000)!=0||(extended&(0x80|0x08000000))!=0)return false; // child, tool, noactivate
   if(String.IsNullOrEmpty(kind))return false;
   foreach(string shell in new[]{"WorkerW","Progman","SHELLDLL_DefView","SysListView32","Shell_TrayWnd","Shell_SecondaryTrayWnd","#32768","tooltips_class32","Xaml_WindowedPopupClass"})
    if(String.Equals(kind,shell,StringComparison.OrdinalIgnoreCase))return false;
   return kind.IndexOf("tooltip",StringComparison.OrdinalIgnoreCase)<0;
  }
  internal static WindowYield Plan(bool desktop,bool visible,bool minimized,bool ownTopmost,bool above,bool externalTopmost,Rectangle surface,Rectangle external){
   if(desktop||!visible||minimized||!surface.IntersectsWith(external))return WindowYield.None;
   // Never insert after a topmost HWND: that would promote our own window.
   if(externalTopmost)return ownTopmost?WindowYield.DemoteOnly:WindowYield.None;
   // An already lower surface must never be raised toward a newly shown window.
   return above||ownTopmost?WindowYield.BelowWindow:WindowYield.None;
  }
 }
 internal sealed class WindowAttention {
  internal readonly IntPtr Handle;internal readonly uint ProcessId;internal readonly Rectangle Bounds;internal readonly bool Topmost;
  internal WindowAttention(IntPtr handle,uint processId,Rectangle bounds,bool topmost){Handle=handle;ProcessId=processId;Bounds=bounds;Topmost=topmost;}
 }
}
