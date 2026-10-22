using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

public sealed class LauncherOverlay : Form, IMessageFilter {
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
 [DllImport("user32.dll",SetLastError=true)] static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int w,int h,uint flags);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd,int command);
 [DllImport("user32.dll",EntryPoint="GetWindowLongW")] static extern int GetWindowLong(IntPtr hwnd,int index);
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd,uint command);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent,IntPtr child);
 [StructLayout(LayoutKind.Sequential)] struct GuiThreadInfo {public int Size,Flags;public IntPtr Active,Focus,Capture,MenuOwner,MoveSize,Caret;public NativeRect CaretRect;}
 [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GuiThreadInfo info);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder name,int length);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [StructLayout(LayoutKind.Sequential)] struct NativeRect {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd,out NativeRect rect);
 [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd,ref Point point);
 readonly WebView2 view=new WebView2();
 readonly JavaScriptSerializer json=new JavaScriptSerializer();
 readonly Timer watch=new Timer();
 readonly LauncherSession session=new LauncherSession();
 readonly string root,defaultSource,daylightSource,lunaSource;
 string source,resourceRoot;
 object pending;
 DateTime outside=DateTime.MinValue,lastHidden=DateTime.UtcNow;
 bool loaded=false,initializing=false;
 int showSerial=0;
 string layoutId;
 TaskCompletionSource<bool> layoutReady;
 Screen currentScreen;
 Rectangle viewport;
 IntPtr surfaceOwner=IntPtr.Zero;
 uint surfacePid=0;
 readonly System.Diagnostics.Process parent;
 readonly DateTime parentStarted;
 VGLauncherContext contextMenu;string contextId;bool contextActive=false,hideAfterContext=false;
 sealed class WindowOwner : IWin32Window { readonly IntPtr handle;public WindowOwner(IntPtr value){handle=value;}public IntPtr Handle {get{return handle;}} }
 public LauncherOverlay(string project,int parentPid){
  root=project;resourceRoot=Path.Combine(root,"themes","classic");source=new Uri(Path.Combine(resourceRoot,"launcher-overlay.html")).AbsoluteUri;defaultSource=source;daylightSource=new Uri(Path.Combine(root,"wallpaper","launcher-overlay.html")).AbsoluteUri;lunaSource=new Uri(Path.Combine(root,"themes","luna-blue","launcher-overlay.html")).AbsoluteUri;
  parent=System.Diagnostics.Process.GetProcessById(parentPid);parentStarted=parent.StartTime;
  Text="WallpaperShell Programs";FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=false;AutoScaleMode=AutoScaleMode.None;
  BackColor=Color.FromArgb(16,13,24);StartPosition=FormStartPosition.Manual;Bounds=new Rectangle(-32000,-32000,800,600);Opacity=0;
  view.Dock=DockStyle.Fill;view.DefaultBackgroundColor=BackColor;
  view.CreationProperties=new CoreWebView2CreationProperties { UserDataFolder=Path.Combine(root,"companion/.launcher-webview") };
  Controls.Add(view);Shown+=async(s,e)=>{if(initializing)return;initializing=true;Hide();Opacity=1;await Initialize();};
  Application.AddMessageFilter(this);
  watch.Interval=100;watch.Tick+=(s,e)=>{
   try{if(parent.HasExited||parent.StartTime!=parentStarted){Close();return;}}catch{Close();return;}
   if(contextActive)return;
   if(Visible){
    if(!ForegroundAllowsSession()){HideMenu();return;}
    if((source==daylightSource||source==lunaSource)&&layoutReady!=null&&!layoutReady.Task.IsCompleted){outside=DateTime.MinValue;return;}
    // Hit-test only our own popup. No input hook, event collection or coordinate logs.
    bool inside=(Region==null?Bounds.Contains(Cursor.Position):Region.IsVisible(PointToClient(Cursor.Position)))&&RootUnderCursor()==Handle;
    if(session.Pointer(inside,(int)Control.MouseButtons)){HideMenu();return;}
    if(session.KeepOpen(inside))outside=DateTime.MinValue;
    else if(outside==DateTime.MinValue)outside=DateTime.UtcNow;
    else if((DateTime.UtcNow-outside).TotalMilliseconds>550)HideMenu();
   }else if((DateTime.UtcNow-lastHidden).TotalMinutes>2)Close();
  };watch.Start();
  FormClosed+=(s,e)=>{Application.RemoveMessageFilter(this);watch.Stop();view.Dispose();};
 }
 protected override bool ShowWithoutActivation {get{return true;}}
 protected override void WndProc(ref Message message){if(contextMenu!=null){if(message.Msg==0x1f||message.Msg==0x6&&((long)message.WParam&0xffff)==0||message.Msg==0x1c&&message.WParam==IntPtr.Zero)contextMenu.Cancel();if(contextMenu.Handle(ref message))return;}base.WndProc(ref message);}
 protected override CreateParams CreateParams {get{var p=base.CreateParams;p.ExStyle|=0x80;return p;}}
 static void Emit(string value){try{Console.WriteLine(value);Console.Out.Flush();}catch{}}
 public bool PreFilterMessage(ref Message message){if(message.Msg==0x201||message.Msg==0x204||message.Msg==0x207||message.Msg==0x20b){if(Visible&&(message.HWnd==Handle||IsChild(Handle,message.HWnd)))session.PointerDownInside();}return false;}
 bool OwnForeground(IntPtr hwnd){
  var original=hwnd;for(int i=0;i<16&&hwnd!=IntPtr.Zero;i++,hwnd=GetWindow(hwnd,4)){uint pid;GetWindowThreadProcessId(hwnd,out pid);if(hwnd==Handle||hwnd==surfaceOwner||pid==(uint)System.Diagnostics.Process.GetCurrentProcess().Id||surfacePid!=0&&pid==surfacePid)return true;}
  if(surfaceOwner==IntPtr.Zero||original==IntPtr.Zero)return false;var name=new StringBuilder(64);GetClassName(original,name,name.Capacity);if(name.ToString()!="WorkerW"&&name.ToString()!="Progman")return false;
  uint ignored;uint thread=GetWindowThreadProcessId(original,out ignored);var info=new GuiThreadInfo{Size=Marshal.SizeOf(typeof(GuiThreadInfo))};return GetGUIThreadInfo(thread,ref info)&&info.Focus!=IntPtr.Zero&&(info.Focus==surfaceOwner||IsChild(surfaceOwner,info.Focus));
 }
 bool ForegroundAllowsSession(){
  var foreground=GetForegroundWindow();return session.ForegroundAllows(foreground.ToInt64(),OwnForeground(foreground));
 }
 IntPtr RootUnderCursor(){var hit=WindowFromPoint(Cursor.Position);return hit==IntPtr.Zero?IntPtr.Zero:GetAncestor(hit,2);}
 bool AboveForeground(){
  if(!Visible||!IsWindowVisible(Handle)||(GetWindowLong(Handle,-20)&8)!=0)return false;
  var foreground=GetForegroundWindow();if(foreground==IntPtr.Zero||foreground==Handle||IsChild(Handle,foreground))return true;
  // Read only native ordering. No titles, content, foreign window movement or activation.
  var seen=new HashSet<IntPtr>();for(var at=GetWindow(foreground,3);at!=IntPtr.Zero&&seen.Count<4096&&seen.Add(at);at=GetWindow(at,3))if(at==Handle)return true;
  return false;
 }
 bool CanOpen(Screen screen,Dictionary<string,object> request){
  // Request-scoped hit-test only: no hook, movement stream, window titles or logs.
  var point=Cursor.Position;var bounds=viewport;if(!bounds.Contains(point))return false;
  var top=RootUnderCursor();if(top==IntPtr.Zero)return false;
  var name=new StringBuilder(256);GetClassName(top,name,name.Capacity);var hit=WindowFromPoint(point);bool allowed=top==Handle||surfaceOwner!=IntPtr.Zero&&(hit==surfaceOwner||IsChild(surfaceOwner,hit))||surfaceOwner==IntPtr.Zero&&(name.ToString()=="WorkerW"||name.ToString()=="Progman");
  if(!allowed){
   // A visible Engine preview must match the requesting viewport. Map its
   // category to its actual client area, rather than the monitor background.
   try{uint pid;GetWindowThreadProcessId(top,out pid);using(var process=System.Diagnostics.Process.GetProcessById((int)pid)){
    var file=Path.GetFullPath(process.MainModule.FileName);var application=Path.GetFullPath(Path.Combine(root,"..","bin","WallpaperShell.exe"));NativeRect client;var origin=new Point(0,0);
     if(surfaceOwner==IntPtr.Zero&&file.Equals(application,StringComparison.OrdinalIgnoreCase)&&GetClientRect(top,out client)&&ClientToScreen(top,ref origin)&&client.Right-client.Left==Convert.ToInt32(request["width"])&&client.Bottom-client.Top==Convert.ToInt32(request["height"])){
     bounds=new Rectangle(origin.X,origin.Y,client.Right-client.Left,client.Bottom-client.Top);allowed=true;
    }
   }}catch{return false;}
  }
  if(!allowed)return false;
  if(request.ContainsKey("trigger")){
   var r=(System.Collections.IList)request["trigger"];double x=(point.X-bounds.Left)/(double)bounds.Width,y=(point.Y-bounds.Top)/(double)bounds.Height;
   if(x<Convert.ToDouble(r[0])||x>=Convert.ToDouble(r[2])||y<Convert.ToDouble(r[1])||y>=Convert.ToDouble(r[3]))return false;
  }
  return true;
 }
 void BlockOpen(Dictionary<string,object> request){HideMenu();pending=null;Emit("{\"type\":\"blocked\",\"id\":"+json.Serialize(request["id"])+"}");}
 async Task Initialize(){
  try{
   await view.EnsureCoreWebView2Async();
   view.CoreWebView2.Settings.AreDefaultContextMenusEnabled=false;
   view.CoreWebView2.Settings.AreDevToolsEnabled=false;
   view.CoreWebView2.Settings.IsStatusBarEnabled=false;
   view.CoreWebView2.NewWindowRequested+=(s,e)=>e.Handled=true;
   view.CoreWebView2.PermissionRequested+=(s,e)=>e.State=CoreWebView2PermissionState.Deny;
   view.CoreWebView2.DownloadStarting+=(s,e)=>e.Cancel=true;
   view.CoreWebView2.NavigationStarting+=(s,e)=>{if(!e.Uri.Equals(source,StringComparison.OrdinalIgnoreCase))e.Cancel=true;};
   view.CoreWebView2.AddWebResourceRequestedFilter("*",CoreWebView2WebResourceContext.All);
   view.CoreWebView2.WebResourceRequested+=(s,e)=>{
    Uri uri;if(!Uri.TryCreate(e.Request.Uri,UriKind.Absolute,out uri))return;
    bool localFile=uri.IsFile&&Path.GetFullPath(uri.LocalPath).StartsWith(Path.GetFullPath(resourceRoot)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase);
    bool bridge=uri.Scheme=="http"&&uri.Host=="127.0.0.1"&&uri.Port==8767&&(uri.AbsolutePath=="/launcher"||uri.AbsolutePath=="/status"||((source==daylightSource||source==lunaSource)&&uri.AbsolutePath=="/controls"&&(e.Request.Method=="POST"||e.Request.Method=="OPTIONS")));
    if(!localFile&&!bridge&&uri.Scheme!="data")e.Response=view.CoreWebView2.Environment.CreateWebResourceResponse(null,403,"Blocked","");
   };
   view.CoreWebView2.WebMessageReceived+=(s,e)=>{
    if(!e.Source.Equals(source,StringComparison.OrdinalIgnoreCase))return;
    try{var message=json.Deserialize<Dictionary<string,object>>(e.WebMessageAsJson);var type=Convert.ToString(message["type"]);
     if(type=="ready"){loaded=true;Emit("{\"type\":\"ready\",\"handle\":"+json.Serialize(Handle.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture))+"}");if(pending!=null)Push(pending);}
     if(type=="layout"&&(source==daylightSource||source==lunaSource))ApplyLayout(message);
     if(type=="size"&&Visible&&currentScreen!=null){double cw=Convert.ToDouble(message["width"]),ch=Convert.ToDouble(message["height"]);if(cw>=300&&cw<=1920&&ch>=100&&ch<=1080){var area=currentScreen.WorkingArea;int h=Math.Min(area.Height,(int)Math.Ceiling(Width*ch/cw));int y=Math.Max(area.Top,Math.Min(area.Bottom-h,Top));SetWindowPos(Handle,IntPtr.Zero,Left,y,Width,h,0x10|0x4);}}
     if(type=="hide")HideMenu();
    }catch{}
   };
   foreach(var page in new[]{defaultSource,daylightSource,lunaSource})await view.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(PrivateBootstrap.InjectionScript(Path.GetFullPath(Path.Combine(root,"..")),page));
   view.CoreWebView2.Navigate(source);
  }catch{Emit("{\"type\":\"error\"}");Close();}
 }
 void HideMenu(bool failedOpen=false){if(contextActive){hideAfterContext=true;return;}showSerial++;pending=null;session.End();Demote();if(!Visible)return;Hide();outside=DateTime.MinValue;lastHidden=DateTime.UtcNow;if(!failedOpen)Emit("{\"type\":\"hidden\",\"id\":"+json.Serialize(layoutId)+"}");if(loaded)view.CoreWebView2.PostWebMessageAsJson("{\"type\":\"hidden\"}");}
 void Demote(){TopMost=false;if(IsHandleCreated&&(GetWindowLong(Handle,-20)&8)!=0)SetWindowPos(Handle,new IntPtr(-2),0,0,0,0,0x13);}
 void Dismiss(){showSerial++;pending=null;session.End();hideAfterContext=true;Demote();if(contextMenu!=null)contextMenu.Cancel();if(!contextActive)HideMenu();}
 bool CanContextHere(){
  var top=RootUnderCursor();if(top==Handle)return true;var name=new StringBuilder(256);GetClassName(top,name,name.Capacity);if(name.ToString()=="WorkerW"||name.ToString()=="Progman")return true;
  try{uint pid;GetWindowThreadProcessId(top,out pid);using(var process=System.Diagnostics.Process.GetProcessById((int)pid)){var file=Path.GetFullPath(process.MainModule.FileName);return file.Equals(Path.GetFullPath(Path.Combine(root,"..","bin","WallpaperShell.exe")),StringComparison.OrdinalIgnoreCase);}}catch{return false;}
 }
 void ShowContext(Dictionary<string,object> request){
  string id=Convert.ToString(request["id"]);bool ok=false,wasVisible=Visible;string stage="surface";
  if(contextActive){Emit("{\"type\":\"context-result\",\"ok\":false,\"id\":"+json.Serialize(id)+"}");return;}
  try{
   if(!CanContextHere())throw new InvalidOperationException();stage="validation";
   var values=(System.Collections.IList)request["paths"];if(values.Count>100)throw new InvalidOperationException();var paths=new string[values.Count];for(int i=0;i<paths.Length;i++)paths[i]=Convert.ToString(values[i]);var directory=Convert.ToString(request["folder"]);bool background=Convert.ToBoolean(request["background"]);VGLauncherContext.Validate(paths,directory,background);
   IWin32Window invokeOwner=this;if(request.ContainsKey("invokeOwnerHandle")){long value;if(!Int64.TryParse(Convert.ToString(request["invokeOwnerHandle"]),out value)||value<=0)throw new InvalidOperationException();var handle=new IntPtr(value);uint ownerPid;if(!IsWindow(handle)||(GetWindowLong(handle,-20)&8)!=0)throw new InvalidOperationException();GetWindowThreadProcessId(handle,out ownerPid);using(var process=System.Diagnostics.Process.GetProcessById((int)ownerPid)){if(!Path.GetFullPath(process.MainModule.FileName).Equals(Path.GetFullPath(Path.Combine(root,"..","bin","WallpaperShell.exe")),StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException();}invokeOwner=new WindowOwner(handle);}
   string menuMode=request.ContainsKey("menuMode")?Convert.ToString(request["menuMode"]):"dark";if(menuMode!="dark"&&menuMode!="light")throw new InvalidOperationException();
   contextActive=true;contextId=id;hideAfterContext=false;
   if(!Visible){var empty=new Region();empty.MakeEmpty();Clip(empty);var point=Cursor.Position;Bounds=new Rectangle(point.X,point.Y,1,1);Show();ShowWindow(Handle,4);}
   stage="shell";using(var shell=new VGLauncherContext()){contextMenu=shell;shell.Show(this,paths,directory,background,count=>Emit("{\"type\":\"context-shown\",\"items\":"+count+",\"id\":"+json.Serialize(id)+"}"),()=>{Emit("{\"type\":\"context-invoking\",\"id\":"+json.Serialize(id)+"}");Demote();hideAfterContext=true;},invokeOwner,menuMode);}ok=true;
  }catch(Exception error){ok=false;Emit("{\"type\":\"context-error\",\"stage\":"+json.Serialize(stage)+",\"code\":"+Marshal.GetHRForException(error)+"}");}
  finally{contextMenu=null;contextActive=false;contextId=null;outside=DateTime.MinValue;lastHidden=DateTime.UtcNow;if(!wasVisible||hideAfterContext)HideMenu();Emit("{\"type\":\"context-result\",\"ok\":"+(ok?"true":"false")+",\"id\":"+json.Serialize(id)+"}");}
 }
 void Push(object value){view.CoreWebView2.PostWebMessageAsJson(json.Serialize(value));}
 Screen ResolveSurface(Dictionary<string,object> request){
  surfaceOwner=IntPtr.Zero;surfacePid=0;int width=Convert.ToInt32(request["width"]),height=Convert.ToInt32(request["height"]);Screen found=null;
  if(request.ContainsKey("surface")){
   var s=request["surface"] as Dictionary<string,object>;if(s==null)throw new InvalidOperationException();long handle;if(!Int64.TryParse(Convert.ToString(s["ownerHandle"]),out handle)||handle<=0)throw new InvalidOperationException();var owner=new IntPtr(handle);
   if(!IsWindow(owner))throw new InvalidOperationException();uint pid;GetWindowThreadProcessId(owner,out pid);
   using(var process=System.Diagnostics.Process.GetProcessById((int)pid)){if(!Path.GetFullPath(process.MainModule.FileName).Equals(Path.GetFullPath(Path.Combine(root,"..","bin","WallpaperShell.exe")),StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException();}
   var b=s["bounds"] as Dictionary<string,object>;NativeRect client;var origin=new Point(0,0);if(b==null||!GetClientRect(owner,out client)||!ClientToScreen(owner,ref origin))throw new InvalidOperationException();
   viewport=new Rectangle(origin.X,origin.Y,client.Right-client.Left,client.Bottom-client.Top);
   if(viewport.X!=Convert.ToInt32(b["x"])||viewport.Y!=Convert.ToInt32(b["y"])||viewport.Width!=Convert.ToInt32(b["width"])||viewport.Height!=Convert.ToInt32(b["height"])||viewport.Width!=width||viewport.Height!=height)throw new InvalidOperationException();
   foreach(var screen in Screen.AllScreens)if(screen.DeviceName.Equals(Convert.ToString(s["monitorId"]),StringComparison.OrdinalIgnoreCase)){found=screen;break;}
   if(found==null||!found.Bounds.IntersectsWith(viewport))throw new InvalidOperationException();surfaceOwner=owner;surfacePid=pid;return found;
  }
  // Compatibility is deliberately unambiguous: profile is not a Primary flag.
  foreach(var screen in Screen.AllScreens)if(screen.Bounds.Width==width&&screen.Bounds.Height==height){if(found!=null)throw new InvalidOperationException();found=screen;}
  if(found==null)throw new InvalidOperationException();viewport=found.Bounds;return found;
 }
 void Clip(Region next){var previous=Region;Region=next;if(previous!=null)previous.Dispose();}
 void ApplyLayout(Dictionary<string,object> message){
  if(Convert.ToString(message["id"])!=layoutId)return;
  var rectangles=message["rects"] as System.Collections.IList;if(rectangles==null||rectangles.Count<1||rectangles.Count>6)return;
  var clip=new Region();clip.MakeEmpty();
  try{
   foreach(var value in rectangles){var r=value as System.Collections.IList;if(r==null||r.Count!=4)throw new Exception();var n=new double[4];for(int i=0;i<4;i++){n[i]=Convert.ToDouble(r[i]);if(double.IsNaN(n[i])||double.IsInfinity(n[i])||n[i]<0||n[i]>1)throw new Exception();}if(n[2]<=n[0]||n[3]<=n[1])throw new Exception();
    int x=(int)Math.Floor(n[0]*ClientSize.Width),y=(int)Math.Floor(n[1]*ClientSize.Height),right=(int)Math.Ceiling(n[2]*ClientSize.Width),bottom=(int)Math.Ceiling(n[3]*ClientSize.Height);clip.Union(Rectangle.FromLTRB(x,y,right,bottom));
   }
   Clip(clip);clip=null;layoutReady.TrySetResult(true);
  }finally{if(clip!=null)clip.Dispose();}
 }
 public async void Command(string line){
  try{
   var a=json.Deserialize<Dictionary<string,object>>(line);string action=Convert.ToString(a["action"]);
   if(action=="stop"){if(contextMenu!=null)contextMenu.Cancel();Close();return;}if(action=="dismiss"){Dismiss();return;}if(action=="close"){HideMenu();return;}if(action=="context-cancel"){if(contextId==Convert.ToString(a["id"])&&contextMenu!=null)contextMenu.Cancel();return;}if(action=="context"){ShowContext(a);return;}if(action!="open"||contextActive)return;
   string wanted=a.ContainsKey("theme")&&Convert.ToString(a["theme"])=="luna-blue"?lunaSource:a.ContainsKey("theme")&&Convert.ToString(a["theme"])=="daylight"?daylightSource:defaultSource;
   var screen=ResolveSurface(a);currentScreen=screen;
   if(!CanOpen(screen,a)){BlockOpen(a);return;}
   if(source!=wanted){HideMenu();loaded=false;source=wanted;resourceRoot=Path.GetDirectoryName(new Uri(source).LocalPath);view.CoreWebView2.Navigate(source);}
   var r=(System.Collections.IList)a["rect"];var area=screen.WorkingArea;
   int w=Math.Min(area.Width,(int)Math.Round((Convert.ToDouble(r[2])-Convert.ToDouble(r[0]))*viewport.Width));
   int h=Math.Min(area.Height,(int)Math.Round((Convert.ToDouble(r[3])-Convert.ToDouble(r[1]))*viewport.Height));
   int x=Math.Max(area.Left,Math.Min(area.Right-w,viewport.Left+(int)Math.Round(Convert.ToDouble(r[0])*viewport.Width)));
   int y=Math.Max(area.Top,Math.Min(area.Bottom-h,viewport.Top+(int)Math.Round(Convert.ToDouble(r[1])*viewport.Height)));
   bool paper=(source==daylightSource||source==lunaSource),wasVisible=Visible;
   int serial=++showSerial;layoutId=Convert.ToString(a["id"]);layoutReady=new TaskCompletionSource<bool>();
   var initialForeground=GetForegroundWindow();session.Begin((int)Control.MouseButtons);session.BeginForeground(initialForeground.ToInt64(),OwnForeground(initialForeground));
   if(paper&&!wasVisible){var empty=new Region();empty.MakeEmpty();Clip(empty);}else if(!paper&&Region!=null)Clip(null);
   var bounds=new Rectangle(x,y,w,h);if(Bounds!=bounds)Bounds=bounds;pending=a;outside=DateTime.MinValue;lastHidden=DateTime.UtcNow;
   if(loaded)Push(a);Show();ShowWindow(Handle,4);bool positioned=SetWindowPos(Handle,IntPtr.Zero,x,y,w,h,0x10|0x40|0x4);
   if(paper){var prepared=layoutReady;await Task.WhenAny(prepared.Task,Task.Delay(3500));if(serial!=showSerial||IsDisposed)return;if(!prepared.Task.IsCompleted)throw new TimeoutException();}
   else{await Task.Delay(100);if(serial!=showSerial||IsDisposed)return;}
   if(!ForegroundAllowsSession()||RootUnderCursor()!=Handle&&!CanOpen(screen,a)){BlockOpen(a);return;}
   // Verify real ordering: SetWindowPos success alone does not prove that a
   // background process was raised above the active application. A synchronous
   // boost/restore repairs that case; the finished popup is always non-topmost.
   var placement=LauncherPlacement.Raise(
    ()=>serial==showSerial&&!IsDisposed&&ForegroundAllowsSession()&&(RootUnderCursor()==Handle||CanOpen(screen,a)),
    ()=>SetWindowPos(Handle,IntPtr.Zero,x,y,w,h,0x10|0x40|0x200),AboveForeground,
    ()=>SetWindowPos(Handle,new IntPtr(-1),0,0,0,0,0x253),
    ()=>SetWindowPos(Handle,new IntPtr(-2),0,0,0,0,0x213),()=>HideMenu(true));
   if(placement==LauncherPlacementResult.Blocked){BlockOpen(a);return;}
   positioned=placement==LauncherPlacementResult.Ready;
   int positionError=positioned?0:Marshal.GetLastWin32Error(),extendedStyle=GetWindowLong(Handle,-20);bool topmost=positioned&&(extendedStyle&8)!=0;
   if(!positioned||topmost)throw new InvalidOperationException();
   Emit("{\"type\":\"shown\",\"topmost\":"+(topmost?"true":"false")+",\"positioned\":"+(positioned?"true":"false")+",\"positionError\":"+positionError+",\"extendedStyle\":"+extendedStyle+",\"visible\":"+((Visible&&IsWindowVisible(Handle))?"true":"false")+",\"clipped\":"+(Region!=null?"true":"false")+",\"lowerLeftHit\":"+((Region==null||Region.IsVisible(new Point(Width/10,Height*9/10)))?"true":"false")+",\"width\":"+Width+",\"height\":"+Height+",\"id\":"+json.Serialize(a["id"])+"}");
  }catch(Exception error){HideMenu(true);try{var a=json.Deserialize<Dictionary<string,object>>(line);Emit("{\"type\":\"show-error\",\"errorType\":"+json.Serialize(error.GetType().Name)+",\"id\":"+json.Serialize(a["id"])+"}");}catch{}}
 }
 [STAThread] public static void Main(string[] args){
  if(args.Length!=2)return;
  // Node's private JSON pipe is UTF-8, independent of the Windows OEM code page.
  Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
  try{SetThreadDpiAwarenessContext(new IntPtr(-4));Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
   var form=new LauncherOverlay(Path.GetFullPath(args[0]),int.Parse(args[1]));
   Task.Run(()=>{try{string line;while((line=Console.ReadLine())!=null){var captured=line;form.BeginInvoke((Action)(()=>form.Command(captured)));}}catch{}try{form.BeginInvoke((Action)(()=>form.Close()));}catch{}});
   Application.Run(form);
  }catch{Emit("{\"type\":\"error\"}");}
 }
}
