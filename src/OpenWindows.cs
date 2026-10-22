using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace PaperGreen {
 // Titles and thumbnails remain local and in memory. Opaque IDs, not HWNDs,
 // cross the trusted WebView bridge. The registry is rebuilt from live windows.
 internal sealed class OpenWindowRecord {
  internal IntPtr Handle;internal uint ProcessId;internal long Started;
  internal string Title,App,Icon;internal bool Minimized;
 }
 internal static class OpenWindowRules {
  internal static string IconPng(Bitmap source){
   if(source==null||source.Width>512||source.Height>512)return "";
   // Keep a full 128-window snapshot below the WebView JSON budget even for
   // unusually detailed icons. Ordinary application logos retain the 64px size.
   foreach(int size in new[]{64,32})using(var resized=new Bitmap(source,new Size(size,size)))using(var stream=new MemoryStream()){
    resized.Save(stream,ImageFormat.Png);if(stream.Length<=8192)return "data:image/png;base64,"+Convert.ToBase64String(stream.ToArray());
   }
   return "";
  }
  internal static bool Eligible(bool visible,bool root,bool own,bool cloaked,uint style,uint extended,bool owned,string kind,string title){
   if(!visible||!root||own||cloaked||String.IsNullOrWhiteSpace(title)||(style&0x40000000)!=0||(extended&(0x80|0x08000000))!=0)return false;
   if(owned&&(extended&0x40000)==0)return false;
   foreach(string shell in new[]{"WorkerW","Progman","SHELLDLL_DefView","SysListView32","Shell_TrayWnd","Shell_SecondaryTrayWnd","#32768","tooltips_class32","Xaml_WindowedPopupClass"})
    if(String.Equals(kind,shell,StringComparison.OrdinalIgnoreCase))return false;
   return !String.IsNullOrEmpty(kind)&&kind.IndexOf("tooltip",StringComparison.OrdinalIgnoreCase)<0;
  }
  internal static bool Identity(OpenWindowRecord expected,OpenWindowRecord actual){return expected!=null&&actual!=null&&expected.Handle==actual.Handle&&expected.ProcessId==actual.ProcessId&&expected.Started==actual.Started;}
  internal static bool RequestClose(OpenWindowRecord expected,OpenWindowRecord actual,bool enabled,Func<IntPtr,bool> post){
   return enabled&&post!=null&&Identity(expected,actual)&&actual.Handle!=IntPtr.Zero&&actual.Handle!=new IntPtr(0xffff)&&actual.ProcessId>0&&actual.Started>0&&post(actual.Handle);
  }
  internal static bool ValidId(string id){return id!=null&&id.Length==32&&id.All(c=>c>='0'&&c<='9'||c>='a'&&c<='f');}
  internal static bool Envelope(Dictionary<string,object> request){object type,id;Guid parsed;return request!=null&&request.TryGetValue("type",out type)&&type as string=="desktop-hub-request"&&request.TryGetValue("requestId",out id)&&id is string&&((string)id).Length<=64&&Guid.TryParse((string)id,out parsed);}
  internal static Rectangle Trigger(Rectangle client,double[] rect){
   if(rect==null||rect.Length!=4||rect.Any(n=>Double.IsNaN(n)||Double.IsInfinity(n)||n<0||n>1)||rect[2]<=rect[0]||rect[3]<=rect[1])throw new ArgumentException("Invalid trigger");
   return Rectangle.FromLTRB(client.Left+(int)Math.Floor(client.Width*rect[0]),client.Top+(int)Math.Floor(client.Height*rect[1]),client.Left+(int)Math.Ceiling(client.Width*rect[2]),client.Top+(int)Math.Ceiling(client.Height*rect[3]));
  }
  internal static Rectangle Place(Rectangle trigger,Rectangle work,Size preferred){
   int width=Math.Min(Math.Max(1,preferred.Width),Math.Max(1,work.Width)),height=Math.Min(Math.Max(1,preferred.Height),Math.Max(1,work.Height));
   int x=Math.Max(work.Left,Math.Min(work.Right-width,trigger.Left+trigger.Width/2-width/2));
   int y=trigger.Top-height-10;if(y<work.Top)y=trigger.Bottom+10;
   y=Math.Max(work.Top,Math.Min(work.Bottom-height,y));return new Rectangle(x,y,width,height);
  }
  internal static Rectangle Fit(Size source,Rectangle area){
   if(source.Width<=0||source.Height<=0||area.Width<=0||area.Height<=0)return Rectangle.Empty;
   double ratio=Math.Min(area.Width/(double)source.Width,area.Height/(double)source.Height);int width=Math.Max(1,(int)Math.Round(source.Width*ratio)),height=Math.Max(1,(int)Math.Round(source.Height*ratio));
   return new Rectangle(area.Left+(area.Width-width)/2,area.Top+(area.Height-height)/2,width,height);
  }
  internal static string Clean(string value,int limit){
   if(String.IsNullOrEmpty(value)||limit<=0)return "";var text=new StringBuilder(Math.Min(limit,value.Length));
   for(int i=0;i<value.Length&&text.Length<limit;i++){char c=value[i];
    if(Char.IsControl(c)&&c!='\t'||c=='\u061c'||c=='\u200e'||c=='\u200f'||c>='\u2028'&&c<='\u202e'||c>='\u2066'&&c<='\u2069')continue;
    if(Char.IsHighSurrogate(c)){if(i+1<value.Length&&Char.IsLowSurrogate(value[i+1])&&text.Length+2<=limit){text.Append(c);text.Append(value[++i]);}continue;}
    if(!Char.IsLowSurrogate(c))text.Append(c=='\t'?' ':c);
   }return text.ToString().Trim();
  }
 }
 internal sealed class OpenWindowCatalog {
  internal sealed class Entry {internal string Id;internal OpenWindowRecord Window;}
  readonly Dictionary<IntPtr,Entry> handles=new Dictionary<IntPtr,Entry>();readonly Dictionary<string,Entry> ids=new Dictionary<string,Entry>(StringComparer.Ordinal);
  List<Entry> ordered=new List<Entry>();bool invalidated;
  internal int Count{get{return ordered.Count;}}
  internal IEnumerable<Entry> Entries{get{return ordered;}}
  internal bool Update(IEnumerable<OpenWindowRecord> windows){
   var seen=new HashSet<IntPtr>();var next=new List<Entry>();bool changed=invalidated;
   foreach(var window in windows){if(next.Count>=128)break;if(window==null||window.Handle==IntPtr.Zero||window.ProcessId==0||window.Started<=0||!seen.Add(window.Handle))continue;
    Entry entry;if(!handles.TryGetValue(window.Handle,out entry)||!OpenWindowRules.Identity(entry.Window,window)){
     if(entry!=null)ids.Remove(entry.Id);entry=new Entry{Id=Guid.NewGuid().ToString("N"),Window=window};handles[window.Handle]=entry;ids[entry.Id]=entry;changed=true;
    }else{
     var previous=entry.Window;if(previous.Title!=window.Title||previous.App!=window.App||previous.Minimized!=window.Minimized||previous.Icon!=window.Icon)changed=true;
     entry.Window=window;
    }
    if(next.Count>=ordered.Count||ordered[next.Count]!=entry)changed=true;next.Add(entry);
   }
   foreach(var key in handles.Keys.Where(key=>!seen.Contains(key)).ToArray()){ids.Remove(handles[key].Id);handles.Remove(key);}
   // Compare fields directly: concatenating every base64 icon into a signature
   // retained a second private snapshot and allocated it again on every poll.
   if(ordered.Count!=next.Count)changed=true;ordered=next;invalidated=false;return changed;
  }
  internal Entry Find(string id){Entry entry;return OpenWindowRules.ValidId(id)&&ids.TryGetValue(id,out entry)?entry:null;}
  internal bool Remove(IntPtr handle){Entry entry;if(!handles.TryGetValue(handle,out entry))return false;handles.Remove(handle);ids.Remove(entry.Id);ordered.Remove(entry);invalidated=true;return true;}
  internal void Clear(){handles.Clear();ids.Clear();ordered.Clear();invalidated=false;}
 }
 internal sealed class OpenWindows : IDisposable {
  readonly Func<bool> active;readonly Func<IntPtr,bool> ownWindow;readonly Action changed;
  readonly Timer poll=new Timer(),watch=new Timer();readonly OpenWindowCatalog catalog=new OpenWindowCatalog();
  readonly Dictionary<string,string> icons=new Dictionary<string,string>(StringComparer.Ordinal);
  bool disposed,started;string status="unavailable";OpenWindowPreview preview;Form previewOwner;Rectangle previewTrigger,previewClient;Point previewAnchor;string previewId;DateTime outside=DateTime.MinValue;
  readonly WinEventProc destroyProc;IntPtr destroyHook;
  readonly int ownPid=Process.GetCurrentProcess().Id;
  internal OpenWindows(Func<bool> active,Func<IntPtr,bool> ownWindow,Action changed){
   this.active=active??(()=>true);this.ownWindow=ownWindow??(handle=>false);this.changed=changed??(()=>{});
   destroyProc=OnWindowDestroyed;
   poll.Interval=2000;poll.Tick+=(s,e)=>{if(this.active())Refresh();else ClosePreview("inactive");};
   watch.Interval=100;watch.Tick+=(s,e)=>WatchPreview();
  }
  internal int SnapshotCount{get{return catalog.Count;}}
  internal bool PreviewOpen{get{return preview!=null&&!preview.IsDisposed&&preview.Visible;}}
  internal object Snapshot{get{return new{status=status,items=catalog.Entries.Select(e=>new{id=e.Id,title=e.Window.Title,app=e.Window.App,icon=e.Window.Icon,minimized=e.Window.Minimized}).ToArray()};}}
  internal void Start(){if(disposed||started)return;started=true;destroyHook=SetWinEventHook(0x8001,0x8001,IntPtr.Zero,destroyProc,0,0,2);poll.Start();if(active())Refresh();}
  internal void Stop(){started=false;poll.Stop();watch.Stop();ClosePreview("stop");if(destroyHook!=IntPtr.Zero){UnhookWinEvent(destroyHook);destroyHook=IntPtr.Zero;}}
  internal void Refresh(){
   if(disposed)return;
   try{var records=Scan();bool updated=catalog.Update(records);bool state=status!="ok";status="ok";if(updated||state)changed();
    if(previewId!=null&&catalog.Find(previewId)==null)ClosePreview("closed");
   }catch{if(status!="unavailable"){status="unavailable";catalog.Clear();ClosePreview("unavailable");changed();}}
  }
  internal object Handle(Form owner,bool desktop,Dictionary<string,object> request){
   if(!OpenWindowRules.Envelope(request))return Result("error",null,"Некорректный запрос.");
   if(disposed||owner==null||owner.IsDisposed||!owner.IsHandleCreated||!owner.Visible||owner.WindowState==FormWindowState.Minimized)return Result("unavailable",null,"Окно WallpaperShell недоступно.");
   string action=Text(request,"action");if(action=="window-preview-close"){
    if(!Fields(request,new[]{"type","requestId","action"},new[]{"id"}))return Result("error",action,"Некорректный запрос.");
    var id=Text(request,"id");if(id!=null&&!OpenWindowRules.ValidId(id))return Result("error",action,"Некорректный запрос.");
    if(previewOwner==owner&&(id==null||id==previewId))ClosePreview("leave");return Result("ok",action,null);
   }
   if(!active())return Result("blocked",action,null);
   if(action!="window-preview"&&action!="window-activate"&&action!="window-close")return Result("error",action,"Неизвестное действие.");
   if(!Fields(request,action=="window-preview"?new[]{"type","requestId","action","id","rect"}:new[]{"type","requestId","action","id"},action=="window-preview"?new[]{"appearance"}:new string[0]))return Result("error",action,"Некорректный запрос.");
   string identifier=Text(request,"id");var entry=catalog.Find(identifier);OpenWindowRecord current;
   if(entry==null||(current=Inspect(entry.Window.Handle,false))==null||!OpenWindowRules.Identity(entry.Window,current))return Result("stale",action,"Окно уже закрыто или изменилось.");
   if(action=="window-close"){
    ClosePreview("close");
    if(!IsWindowEnabled(current.Handle))return Result("blocked",action,"Сначала завершите диалог в этом приложении.");
    bool queued=OpenWindowRules.RequestClose(entry.Window,current,true,handle=>{
     // Let the target show its own save/cancel prompt. Never force termination,
     // hide the catalog entry, or assume that accepting WM_CLOSE destroyed it.
     AllowSetForegroundWindow(current.ProcessId);
     return PostMessage(handle,0x0010,IntPtr.Zero,IntPtr.Zero);
    });
    return Result(queued?"ok":"denied",action,queued?null:"Не удалось закрыть окно. Закройте его в самом приложении.");
   }
   if(action=="window-activate"){
    ClosePreview("activate");if(current.Minimized)ShowWindowAsync(current.Handle,9);
    bool activated=SetForegroundWindow(current.Handle);return Result(activated?"ok":"denied",action,activated?null:"Windows не передала фокус. Выбери окно на панели задач.");
   }
   double[] rect=ReadRect(request);if(rect==null)return Result("error",action,"Некорректная область наведения.");
   var physical=new Rectangle(owner.PointToScreen(Point.Empty),owner.ClientSize);Rectangle trigger;
   try{trigger=OpenWindowRules.Trigger(physical,rect);}catch{return Result("error",action,"Некорректная область наведения.");}
   if(!VisibleTrigger(owner.Handle,trigger))return Result("blocked",action,null);
   Color background=Color.FromArgb(17,18,16),foreground=Color.FromArgb(241,241,237),accent=Color.FromArgb(202,255,0);
   if(!Appearance(request,ref background,ref foreground,ref accent))return Result("error",action,"Некорректное оформление.");
   ClosePreview("replace");var target=Screen.FromPoint(new Point(trigger.Left+trigger.Width/2,trigger.Top+trigger.Height/2));
   float density=Math.Max(.75f,Math.Min(2.5f,owner.DeviceDpi/96f));var placement=OpenWindowRules.Place(trigger,target.WorkingArea,new Size((int)(460*density),(int)(300*density)));
   preview=new OpenWindowPreview();previewOwner=owner;previewTrigger=trigger;previewClient=physical;previewAnchor=Cursor.Position;previewId=identifier;outside=DateTime.MinValue;
   string state;try{state=preview.Present(current,placement,density,background,foreground,accent,desktop?null:owner);}catch{ClosePreview("failed");return Result("unavailable",action,"Предпросмотр недоступен.");}
   if(state=="blocked"||!VisibleTrigger(owner.Handle,trigger)){ClosePreview("occluded");return Result("blocked",action,null);}
   watch.Start();
   return new{status="ok",action=action,id=identifier,preview=state};
  }
  static object Result(string state,string action,string message){return new{status=state,action=action,message=message};}
  internal void ClosePreview(string reason){watch.Stop();if(preview!=null){var old=preview;preview=null;old.Close();old.Dispose();}previewOwner=null;previewId=null;outside=DateTime.MinValue;}
  void OnWindowDestroyed(IntPtr hook,uint kind,IntPtr handle,int objectId,int childId,uint thread,uint time){
   if(disposed||!started||handle==IntPtr.Zero||objectId!=0||childId!=0)return;
   if(catalog.Remove(handle)){if(previewId!=null&&catalog.Find(previewId)==null)ClosePreview("destroyed");changed();}
  }
  void WatchPreview(){
   if(!PreviewOpen)return;
   var entry=catalog.Find(previewId);uint pid;if(!active()||previewOwner==null||previewOwner.IsDisposed||!previewOwner.Visible||previewOwner.WindowState==FormWindowState.Minimized||entry==null||!IsWindow(entry.Window.Handle)||GetWindowThreadProcessId(entry.Window.Handle,out pid)==0||pid!=entry.Window.ProcessId){ClosePreview("closed");return;}
   var hitAnchor=WindowFromPoint(previewAnchor);if(new Rectangle(previewOwner.PointToScreen(Point.Empty),previewOwner.ClientSize)!=previewClient||!(hitAnchor==previewOwner.Handle||IsChild(previewOwner.Handle,hitAnchor))){ClosePreview("occluded");return;}
   Point point=Cursor.Position;IntPtr hit=WindowFromPoint(point);
   bool inside=preview.Bounds.Contains(point)&&(hit==preview.Handle||IsChild(preview.Handle,hit))||previewTrigger.Contains(point)&&(hit==previewOwner.Handle||IsChild(previewOwner.Handle,hit));
   if(inside)outside=DateTime.MinValue;else if(outside==DateTime.MinValue)outside=DateTime.UtcNow;else if((DateTime.UtcNow-outside).TotalMilliseconds>350)ClosePreview("leave");
  }
  List<OpenWindowRecord> Scan(){
   var result=new List<OpenWindowRecord>();var budget=Stopwatch.StartNew();EnumWindows(delegate(IntPtr hwnd,IntPtr unused){if(result.Count>=128)return false;var window=Inspect(hwnd,budget.ElapsedMilliseconds<100);if(window!=null)result.Add(window);return true;},IntPtr.Zero);
   if(icons.Count>160)icons.Clear();return result;
  }
  OpenWindowRecord Inspect(IntPtr hwnd,bool icon){
   if(hwnd==IntPtr.Zero||!IsWindow(hwnd))return null;uint pid;if(GetWindowThreadProcessId(hwnd,out pid)==0||pid==0||pid==(uint)ownPid)return null;
   uint style=unchecked((uint)GetWindowLong(hwnd,-16)),extended=unchecked((uint)GetWindowLong(hwnd,-20));
   var kind=new StringBuilder(128);GetClassName(hwnd,kind,kind.Capacity);var caption=new StringBuilder(768);GetWindowText(hwnd,caption,caption.Capacity);
   if(!OpenWindowRules.Eligible(IsWindowVisible(hwnd),GetAncestor(hwnd,2)==hwnd,ownWindow(hwnd),Cloaked(hwnd),style,extended,GetWindow(hwnd,4)!=IntPtr.Zero,kind.ToString(),caption.ToString()))return null;
   string app;long began;try{using(var process=Process.GetProcessById((int)pid)){began=process.StartTime.ToUniversalTime().Ticks;app=OpenWindowRules.Clean(process.ProcessName,80);}}catch{return null;}
   if(began<=0)return null;string data,cache=pid.ToString()+":"+began.ToString();if(!icons.TryGetValue(cache,out data)){data=icon?WindowIcon(hwnd):"";if(icon)icons[cache]=data;}
   return new OpenWindowRecord{Handle=hwnd,ProcessId=pid,Started=began,Title=OpenWindowRules.Clean(caption.ToString(),320),App=app,Icon=data,Minimized=IsIconic(hwnd)};
  }
  static string WindowIcon(IntPtr hwnd){
   try{IntPtr value=IntPtr.Zero,answer;SendMessageTimeout(hwnd,0x7f,new IntPtr(1),new IntPtr(192),2,12,out answer);value=answer;if(value==IntPtr.Zero)value=GetClassLongPtr(hwnd,-14);
    if(value==IntPtr.Zero){SendMessageTimeout(hwnd,0x7f,new IntPtr(2),IntPtr.Zero,2,12,out answer);value=answer;}if(value==IntPtr.Zero)value=GetClassLongPtr(hwnd,-34);if(value==IntPtr.Zero)return "";
    using(var image=(Icon)Icon.FromHandle(value).Clone()){if(image.Width>512||image.Height>512)return "";using(var bitmap=image.ToBitmap())return OpenWindowRules.IconPng(bitmap);}
   }catch{return "";}
  }
  static bool VisibleTrigger(IntPtr owner,Rectangle trigger){Point point=Cursor.Position;if(!trigger.Contains(point))return false;var hit=WindowFromPoint(point);return hit==owner||IsChild(owner,hit);}
  static bool Cloaked(IntPtr handle){try{int value;return DwmGetWindowAttribute(handle,14,out value,4)==0&&value!=0;}catch{return false;}}
  static bool Fields(Dictionary<string,object> value,string[] required,string[] optional){if(value==null||required.Any(key=>!value.ContainsKey(key)))return false;return value.Keys.All(key=>required.Contains(key)||optional.Contains(key));}
  static string Text(Dictionary<string,object> value,string key){object result;return value!=null&&value.TryGetValue(key,out result)?result as string:null;}
  static double[] ReadRect(Dictionary<string,object> request){object raw;if(!request.TryGetValue("rect",out raw))return null;var values=raw as System.Collections.IList;if(values==null||values.Count!=4)return null;var rect=new double[4];for(int i=0;i<4;i++){if(!(values[i] is double||values[i] is float||values[i] is int||values[i] is long||values[i] is decimal))return null;rect[i]=Convert.ToDouble(values[i]);}return rect;}
  static bool Appearance(Dictionary<string,object> request,ref Color background,ref Color foreground,ref Color accent){
   object raw;if(!request.TryGetValue("appearance",out raw))return true;var fields=raw as Dictionary<string,object>;if(fields==null||fields.Count!=2||!fields.ContainsKey("mode")||!fields.ContainsKey("accent"))return false;
   string mode=Text(fields,"mode"),color=Text(fields,"accent");if(mode!="light"&&mode!="dark"||color==null||color.Length!=7||color[0]!='#'||color.Skip(1).Any(c=>!Uri.IsHexDigit(c)))return false;
   accent=ColorTranslator.FromHtml(color);if(mode=="light"){background=Color.FromArgb(241,241,237);foreground=Color.FromArgb(8,9,9);}return true;
  }
  public void Dispose(){if(disposed)return;disposed=true;Stop();poll.Dispose();watch.Dispose();catalog.Clear();icons.Clear();}
  delegate bool EnumProc(IntPtr hwnd,IntPtr state);
  delegate void WinEventProc(IntPtr hook,uint kind,IntPtr handle,int objectId,int childId,uint thread,uint time);
  [DllImport("user32.dll")]static extern IntPtr SetWinEventHook(uint minimum,uint maximum,IntPtr module,WinEventProc proc,uint pid,uint thread,uint flags);
  [DllImport("user32.dll")]static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc callback,IntPtr state);
  [DllImport("user32.dll")]static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")]static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll")]static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")]static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
  [DllImport("user32.dll")]static extern IntPtr GetWindow(IntPtr hwnd,uint command);
  [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll",EntryPoint="GetWindowLongW")]static extern int GetWindowLong(IntPtr hwnd,int index);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr hwnd,StringBuilder text,int size);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int size);
  [DllImport("user32.dll")]static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")]static extern bool IsChild(IntPtr parent,IntPtr child);
  [DllImport("user32.dll")]static extern bool ShowWindowAsync(IntPtr hwnd,int command);
  [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")]static extern bool AllowSetForegroundWindow(uint pid);
  [DllImport("user32.dll",EntryPoint="PostMessageW",SetLastError=true)]static extern bool PostMessage(IntPtr hwnd,uint message,IntPtr wp,IntPtr lp);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint message,IntPtr wp,IntPtr lp,uint flags,uint timeout,out IntPtr result);
  [DllImport("user32.dll",EntryPoint="GetClassLongPtrW")]static extern IntPtr GetClassLongPtr(IntPtr hwnd,int index);
  [DllImport("dwmapi.dll")]static extern int DwmGetWindowAttribute(IntPtr hwnd,int attribute,out int value,int size);
 }
 internal sealed class OpenWindowPreview : Form {
  IntPtr thumbnail;string caption="",note="";Color accent=Color.FromArgb(202,255,0);Rectangle image;float density=1;
  internal OpenWindowPreview(){FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;StartPosition=FormStartPosition.Manual;AutoScaleMode=AutoScaleMode.None;DoubleBuffered=true;}
  protected override bool ShowWithoutActivation{get{return true;}}
  protected override CreateParams CreateParams{get{var value=base.CreateParams;value.ExStyle|=0x80|0x08000000;return value;}}
  internal string Present(OpenWindowRecord window,Rectangle placement,float density,Color background,Color foreground,Color accent,Form owner){
   this.density=density;this.accent=accent;caption=window.Title;BackColor=background;ForeColor=foreground;Bounds=placement;if(owner!=null)Owner=owner;
   string state="unavailable";note="Предпросмотр недоступен";
   try{if(DwmRegisterThumbnail(Handle,window.Handle,out thumbnail)==0){NativeSize source;if(DwmQueryThumbnailSourceSize(thumbnail,out source)==0){image=OpenWindowRules.Fit(new Size(source.Width,source.Height),new Rectangle((int)(12*density),(int)(46*density),Math.Max(1,ClientSize.Width-(int)(24*density)),Math.Max(1,ClientSize.Height-(int)(76*density))));
      if(!image.IsEmpty){var props=new ThumbnailProperties{Flags=1|4|8|16,Destination=new NativeRect(image),Opacity=255,Visible=true,ClientOnly=false};if(DwmUpdateThumbnailProperties(thumbnail,ref props)==0){state=window.Minimized?"cached":"live";note=window.Minimized?"Окно свёрнуто · последнее изображение":"Нажми значок, чтобы перейти к окну";}}
     }}
   }catch{}
   Show();if(!SetWindowPos(Handle,IntPtr.Zero,placement.X,placement.Y,placement.Width,placement.Height,0x10|0x40)||!Visible)return "blocked";Invalidate();return state;
  }
  protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);using(var pen=new Pen(accent,Math.Max(1,2*density)))e.Graphics.DrawRectangle(pen,1,1,Width-3,Height-3);
   using(var font=new Font("Segoe UI",Math.Max(9,12*density),FontStyle.Bold,GraphicsUnit.Pixel))using(var body=new Font("Segoe UI",Math.Max(9,11*density),FontStyle.Regular,GraphicsUnit.Pixel)){
    TextRenderer.DrawText(e.Graphics,caption,font,new Rectangle((int)(12*density),(int)(12*density),Width-(int)(24*density),(int)(26*density)),ForeColor,TextFormatFlags.EndEllipsis|TextFormatFlags.SingleLine|TextFormatFlags.NoPrefix);
    TextRenderer.DrawText(e.Graphics,note,body,new Rectangle((int)(12*density),Height-(int)(26*density),Width-(int)(24*density),(int)(20*density)),ForeColor,TextFormatFlags.EndEllipsis|TextFormatFlags.SingleLine|TextFormatFlags.NoPrefix);
   }
  }
  protected override void Dispose(bool disposing){if(thumbnail!=IntPtr.Zero){try{DwmUnregisterThumbnail(thumbnail);}catch{}thumbnail=IntPtr.Zero;}base.Dispose(disposing);}
  [StructLayout(LayoutKind.Sequential)]struct NativeSize{internal int Width,Height;}
  [StructLayout(LayoutKind.Sequential)]struct NativeRect{internal int Left,Top,Right,Bottom;internal NativeRect(Rectangle value){Left=value.Left;Top=value.Top;Right=value.Right;Bottom=value.Bottom;}}
  [StructLayout(LayoutKind.Sequential)]struct ThumbnailProperties{internal uint Flags;internal NativeRect Destination,Source;internal byte Opacity;[MarshalAs(UnmanagedType.Bool)]internal bool Visible;[MarshalAs(UnmanagedType.Bool)]internal bool ClientOnly;}
  [DllImport("dwmapi.dll")]static extern int DwmRegisterThumbnail(IntPtr destination,IntPtr source,out IntPtr thumbnail);
  [DllImport("dwmapi.dll")]static extern int DwmUnregisterThumbnail(IntPtr thumbnail);
  [DllImport("dwmapi.dll")]static extern int DwmQueryThumbnailSourceSize(IntPtr thumbnail,out NativeSize size);
  [DllImport("dwmapi.dll")]static extern int DwmUpdateThumbnailProperties(IntPtr thumbnail,ref ThumbnailProperties properties);
  [DllImport("user32.dll")]static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int width,int height,uint flags);
 }
}
