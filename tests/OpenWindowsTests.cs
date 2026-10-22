using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;

namespace PaperGreen {
 internal static class OpenWindowsTests {
  static int count;
  static void Check(bool condition,string name){count++;if(!condition)throw new Exception(name);}
  static OpenWindowRecord Window(long handle,uint pid,long start,string title){return new OpenWindowRecord{Handle=new IntPtr(handle),ProcessId=pid,Started=start,Title=title,App="browser",Icon="",Minimized=false};}
  static bool Eligible(bool visible=true,bool root=true,bool own=false,bool cloaked=false,uint style=0,uint extended=0,bool owned=false,string kind="Chrome_WidgetWin_1",string title="Example"){
   return OpenWindowRules.Eligible(visible,root,own,cloaked,style,extended,owned,kind,title);
  }
  static void Main(){
   Check(Eligible(),"normal browser window included");
   var closeTarget=Window(321,45,100,"Synthetic unsaved document");int posted=0;
   Func<IntPtr,bool> close=handle=>{posted++;return handle==closeTarget.Handle;};
   Check(OpenWindowRules.RequestClose(closeTarget,Window(321,45,100,"Renamed document"),true,close)&&posted==1,"Close posts once only to the still-matching window");
   Check(!OpenWindowRules.RequestClose(closeTarget,Window(321,46,100,"Recycled"),true,close)&&posted==1,"A reused HWND from another process is never closed");
   Check(!OpenWindowRules.RequestClose(closeTarget,Window(321,45,101,"New process instance"),true,close)&&posted==1,"Process start identity protects close requests");
   Check(!OpenWindowRules.RequestClose(closeTarget,Window(322,45,100,"Other window"),true,close)&&posted==1,"Close never targets another window in the same process");
   Check(!OpenWindowRules.RequestClose(closeTarget,closeTarget,false,close)&&posted==1,"A window disabled by its own modal/save dialog is not closed again");
   Check(!OpenWindowRules.RequestClose(null,closeTarget,true,close)&&posted==1,"Unknown targets cannot be closed");
   Check(!OpenWindowRules.RequestClose(closeTarget,closeTarget,true,handle=>false),"A denied close message is reported instead of hiding or killing the window");
   Check(Eligible(kind:"CabinetWClass",title:"Documents"),"Explorer window included");
   Check(Eligible(kind:"ApplicationFrameWindow",title:"Settings"),"UWP app included");
   Check(!Eligible(visible:false)&&!Eligible(root:false)&&!Eligible(own:true)&&!Eligible(cloaked:true),"hidden child own and cloaked windows excluded");
   Check(!Eligible(style:0x40000000)&&!Eligible(extended:0x80)&&!Eligible(extended:0x08000000),"child tool and noactivate windows excluded");
   Check(!Eligible(owned:true)&&Eligible(owned:true,extended:0x40000),"only explicit taskbar owned app included");
   foreach(var shell in new[]{"WorkerW","Progman","SHELLDLL_DefView","SysListView32","Shell_TrayWnd","Shell_SecondaryTrayWnd","#32768","tooltips_class32","Xaml_WindowedPopupClass"})Check(!Eligible(kind:shell),"shell popup filtered: "+shell);
   Check(!Eligible(title:"  ")&&!Eligible(kind:"")&&!Eligible(kind:"CustomTooltip"),"untitled and tooltip windows excluded");

   var catalog=new OpenWindowCatalog();Check(catalog.Update(new[]{Window(123,40,1000,"First"),Window(456,41,1001,"Second")}),"initial snapshot changed");
   var first=catalog.Entries.First();string firstId=first.Id,secondId=catalog.Entries.Last().Id;
   Check(OpenWindowRules.ValidId(firstId)&&firstId!=secondId&&firstId!="123", "opaque unique IDs");
   Check(!catalog.Update(new[]{Window(123,40,1000,"First"),Window(456,41,1001,"Second")}),"unchanged snapshot suppressed");
   Check(catalog.Update(new[]{Window(456,41,1001,"Second"),Window(123,40,1000,"First")})&&catalog.Entries.First().Id==secondId,"window order change is published without regenerating IDs");
   Check(catalog.Update(new[]{Window(123,40,1000,"First"),Window(456,41,1001,"Second")}),"return to original ordering is published");
   var artwork=Window(123,40,1000,"First");artwork.Icon="data:image/png;base64,synthetic";artwork.App="editor";
   Check(catalog.Update(new[]{artwork,Window(456,41,1001,"Second")}),"icon and application changes publish without a concatenated signature");
   var identical=Window(123,40,1000,"First");identical.Icon=artwork.Icon;identical.App=artwork.App;
   Check(!catalog.Update(new[]{identical,Window(456,41,1001,"Second")}),"equal icon and app fields suppress repeat publication");
   var renamed=Window(123,40,1000,"Renamed");renamed.Minimized=true;Check(catalog.Update(new[]{renamed,Window(456,41,1001,"Second")}),"title and minimized change published");
   Check(catalog.Entries.First().Id==firstId&&catalog.Find(firstId).Window.Minimized,"same live window retains opaque ID");
   Check(catalog.Update(new[]{Window(123,99,1000,"Replacement")})&&catalog.Find(firstId)==null&&catalog.Find(secondId)==null,"PID reuse and disappeared windows invalidate IDs");
   string reused=catalog.Entries.First().Id;Check(catalog.Update(new[]{Window(123,99,2000,"New process")})&&catalog.Find(reused)==null,"process start generation invalidates stale ID");
   string destroyed=catalog.Entries.First().Id;Check(catalog.Remove(new IntPtr(123))&&catalog.Find(destroyed)==null&&catalog.Count==0,"native destroy event invalidates ID immediately");
   catalog.Update(new[]{Window(123,99,2000,"New same-process window")});Check(catalog.Entries.First().Id!=destroyed,"destroyed HWND recycled in same process gets new ID");
   Check(!catalog.Remove(new IntPtr(9999)),"unknown destroy is ignored");
   Check(!OpenWindowRules.Identity(Window(1,1,5,"X"),Window(1,2,5,"X"))&&!OpenWindowRules.Identity(Window(1,1,5,"X"),Window(1,1,6,"X"))&&!OpenWindowRules.Identity(Window(1,1,5,"X"),Window(2,1,5,"X")),"identity requires HWND PID and process generation");
   Check(OpenWindowRules.Identity(Window(1,1,5,"X"),Window(1,1,5,"Y")),"caption is not an identity token");
   Check(catalog.Find("123")==null&&catalog.Find(new String('A',32))==null&&catalog.Find(new String('g',32))==null&&catalog.Find(null)==null,"arbitrary handles and malformed IDs rejected");
   catalog.Update(Enumerable.Range(1,200).Select(n=>Window(n,1,1,"Window "+n)));Check(catalog.Count==128,"snapshot bounded at128");
   catalog.Update(new[]{Window(1,1,1,"First"),Window(1,1,1,"Duplicate"),null,Window(0,1,1,"Zero"),Window(2,0,1,"No PID"),Window(3,1,0,"No generation")});Check(catalog.Count==1,"invalid and duplicate records excluded");
   catalog.Clear();Check(catalog.Count==0&&catalog.Find(firstId)==null,"clear revokes all tokens");

   var request=new Dictionary<string,object>{{"type","desktop-hub-request"},{"requestId",Guid.NewGuid().ToString()}};
   Check(OpenWindowRules.Envelope(request),"valid native bridge envelope");request["type"]="other";Check(!OpenWindowRules.Envelope(request),"wrong envelope type rejected");request["type"]="desktop-hub-request";request["requestId"]="window:123";Check(!OpenWindowRules.Envelope(request)&&!OpenWindowRules.Envelope(null),"request needs UUID and envelope");
   var client=new Rectangle(-2560,-200,2560,1440);var trigger=OpenWindowRules.Trigger(client,new[]{.1,.2,.2,.3});Check(trigger==Rectangle.FromLTRB(-2304,88,-2048,232),"normalized trigger uses physical negative monitor coordinates");
   var work=new Rectangle(-2560,0,2560,1400);var placed=OpenWindowRules.Place(new Rectangle(-2550,10,40,40),work,new Size(460,300));Check(work.Contains(placed)&&placed.Top==60&&placed.Left==-2560,"popup fits workarea and falls below top edge");
   var above=OpenWindowRules.Place(new Rectangle(-1400,800,60,60),work,new Size(460,300));Check(above.Bottom==790&&work.Contains(above),"popup stays above hovered trigger with gap");
   var tiny=OpenWindowRules.Place(Rectangle.Empty,new Rectangle(100,100,200,100),new Size(460,300));Check(tiny==new Rectangle(100,100,200,100),"oversize preview clamps to workarea");
   foreach(var invalid in new[]{new double[]{0,0,0,1},new double[]{0,1,1,0},new double[]{-1,0,1,1},new double[]{0,0,1.01,1},new double[]{0,0,Double.NaN,1},new double[]{0,0,1,Double.PositiveInfinity},new double[]{0,1,1}}){bool thrown=false;try{OpenWindowRules.Trigger(client,invalid);}catch(ArgumentException){thrown=true;}Check(thrown,"malformed trigger rejected");}
   Check(OpenWindowRules.Fit(new Size(1920,1080),new Rectangle(0,0,400,240))==new Rectangle(0,7,400,225),"wide preview retains aspect ratio");
   Check(OpenWindowRules.Fit(new Size(1080,1920),new Rectangle(0,0,400,240))==new Rectangle(132,0,135,240),"portrait preview centered without crop");
   Check(OpenWindowRules.Fit(Size.Empty,new Rectangle(0,0,400,240)).IsEmpty,"unknown DWM source size has no fabricated image");
   Check(OpenWindowRules.Clean(" A\r\n\tB\0C ",4)=="A B","title strips controls and bounds text");
   Check(OpenWindowRules.Clean("A\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069B",100)=="AB","bidi overrides isolates and directional marks removed");
   Check(OpenWindowRules.Clean("A\u2028B\u2029C",100)=="ABC","Unicode line and paragraph separators removed");
   Check(OpenWindowRules.Clean("A\ud83d\ude80B",3)=="A\ud83d\ude80"&&OpenWindowRules.Clean("A\ud83d\ude80B",2)=="AB","Unicode pairs preserved and never split at limit");
   Check(OpenWindowRules.Clean("A\ud83dB\ude80C",100)=="ABC"&&OpenWindowRules.Clean("A",0)=="","unpaired surrogates removed and zero limit safe");
   using(var solid=new Bitmap(64,64)){
    using(var graphics=Graphics.FromImage(solid))graphics.Clear(Color.CornflowerBlue);
    var data=Convert.FromBase64String(OpenWindowRules.IconPng(solid).Split(',')[1]);using(var stream=new System.IO.MemoryStream(data))using(var image=Image.FromStream(stream))Check(image.Width==64&&image.Height==64,"normal application icon retains large raster");
   }
   using(var noise=new Bitmap(64,64)){
    var random=new Random(12345);for(int y=0;y<64;y++)for(int x=0;x<64;x++)noise.SetPixel(x,y,Color.FromArgb(random.Next(256),random.Next(256),random.Next(256),random.Next(256)));
    var data=Convert.FromBase64String(OpenWindowRules.IconPng(noise).Split(',')[1]);Check(data.Length<=8192,"large snapshots have a bounded per-icon PNG payload");using(var stream=new System.IO.MemoryStream(data))using(var image=Image.FromStream(stream))Check(image.Width==32,"high entropy artwork uses bounded fallback rather than breaking WebView JSON");
   }
   Check(OpenWindowRules.IconPng(null)=="","missing icon is represented by the normal UI fallback");
   Console.WriteLine("Open windows rules passed: "+count+" checks; no native window enumeration or activation.");
  }
 }
}
