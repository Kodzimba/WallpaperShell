using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PaperGreen {
 internal static class Program {
  [DllImport("user32.dll")]static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [STAThread]static void Main(string[] args){
   if(AppUpdates.InstallationActive(Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"..")))){MessageBox.Show("Обновление WallpaperShell ещё выполняется. Подожди завершения.","WallpaperShell");return;}bool created;using(var mutex=new Mutex(true,"Local\\PaperGreen.App.v1",out created)){
    if(!created){MessageBox.Show("WallpaperShell уже запущен. Его меню находится рядом с часами Windows.","WallpaperShell");return;}
    try{SetThreadDpiAwarenessContext(new IntPtr(-4));Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);using(var context=new AppContext(args))Application.Run(context);}
    catch(Exception e){MessageBox.Show("Не удалось запустить WallpaperShell.\n"+e.GetType().Name,"WallpaperShell",MessageBoxButtons.OK,MessageBoxIcon.Error);}
   }
  }
 }
 internal sealed partial class AppContext : ApplicationContext,IDisposable {
  internal readonly string Root;internal readonly JavaScriptSerializer Json=new JavaScriptSerializer();internal readonly bool NoActivate;internal bool Exiting,Switching,Paused;internal string Theme="paper-green",Mode="window";
  readonly Control dispatcher=new Control();readonly List<Surface> windows=new List<Surface>();readonly NotifyIcon tray;readonly System.Windows.Forms.Timer startTimer,frameTimer;readonly bool forceLocal,startDesktop,startAll;
  readonly TaskCompletionSource<bool> ready=new TaskCompletionSource<bool>();readonly ChildJob job=new ChildJob();readonly NativeDiagnosticsGate diagnosticsGate=new NativeDiagnosticsGate(Stopwatch.Frequency);readonly bool noSpeedtest;AudioLoopback audio;Process backend;long ticks;
  readonly WindowPolicyState policy=new WindowPolicyState();readonly WindowEnvironment environment=new WindowEnvironment();readonly System.Windows.Forms.Timer policyTimer;int nativeFiles;bool sessionSuspended;string pendingTheme,pendingMode;long windowYields;
  OpenWindows openWindows;Notifications notifications;bool hubActive;long notificationIntent;
  internal AppContext(string[] args){
   Root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));PrivateBootstrap.EnsurePrivate(Root);var handle=dispatcher.Handle;
   forceLocal=args.Contains("--local-sensors");startDesktop=args.Contains("--desktop");startAll=args.Contains("--all-monitors");NoActivate=args.Contains("--no-activate");noSpeedtest=args.Contains("--no-speedtest");
   var menu=new ContextMenuStrip();menu.Items.Add("Открыть в окне",null,(s,e)=>ChangeMode("window"));menu.Items.Add("На рабочем столе: основной монитор",null,(s,e)=>ChangeMode("desktop"));menu.Items.Add("На рабочем столе: все мониторы",null,(s,e)=>ChangeMode("all"));menu.Items.Add(new ToolStripSeparator());
   var pause=new ToolStripMenuItem("Приостановить анимацию");pause.CheckOnClick=true;pause.CheckedChanged+=(s,e)=>{Paused=pause.Checked;};menu.Items.Add(pause);menu.Items.Add("Закрыть приложение",null,(s,e)=>Quit());
   tray=new NotifyIcon{Text="WallpaperShell",Icon=SystemIcons.Application,ContextMenuStrip=menu,Visible=true};tray.DoubleClick+=(s,e)=>ChangeMode("window");
   startTimer=new System.Windows.Forms.Timer{Interval=40};startTimer.Tick+=async(s,e)=>{startTimer.Stop();await Start();};startTimer.Start();
   frameTimer=new System.Windows.Forms.Timer{Interval=42};frameTimer.Tick+=(s,e)=>Frame();
   environment.StartNotifications();policyTimer=new System.Windows.Forms.Timer{Interval=125};policyTimer.Tick+=(s,e)=>ObserveWindows();policyTimer.Start();
   Microsoft.Win32.SystemEvents.DisplaySettingsChanged+=DisplaysChanged;
   Microsoft.Win32.SystemEvents.SessionSwitch+=SessionChanged;Microsoft.Win32.SystemEvents.PowerModeChanged+=PowerChanged;
  }
  internal void Log(string message){try{File.AppendAllText(Path.Combine(Root,"data/app.log"),DateTime.UtcNow.ToString("o")+" "+message+Environment.NewLine);}catch{}}
  void Ui(Action action){if(!Exiting&&!dispatcher.IsDisposed)try{dispatcher.BeginInvoke(action);}catch{}}
  async Task Start(){
   try{
    string node=Path.Combine(Root,"bin/node.exe");if(!File.Exists(node))throw new FileNotFoundException("Run tools/build.ps1 first.");
    var info=new ProcessStartInfo(node,"\""+Path.Combine(Root,"runtime/companion/server.cjs")+"\""){WorkingDirectory=Path.Combine(Root,"runtime"),UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=new UTF8Encoding(false),StandardErrorEncoding=new UTF8Encoding(false)};
    if(forceLocal)info.EnvironmentVariables["PG_FORCE_LOCAL"]="1";
    if(noSpeedtest)info.EnvironmentVariables["PG_NO_AUTOSPEED"]="1";
    info.EnvironmentVariables["PSModulePath"]=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),"System32/WindowsPowerShell/v1.0/Modules");
    backend=new Process{StartInfo=info,EnableRaisingEvents=true};backend.OutputDataReceived+=(s,e)=>{if(e.Data!=null)BackendMessage(e.Data);};backend.ErrorDataReceived+=(s,e)=>{if(!String.IsNullOrWhiteSpace(e.Data))Log("Backend reported an error");};backend.Exited+=(s,e)=>{if(!Exiting)Ui(()=>{Log("Backend exited");MessageBox.Show("Сборщик WallpaperShell завершился. Закрой приложение и запусти его снова.","WallpaperShell");Quit();});};
    backend.Start();job.Add(backend);backend.BeginOutputReadLine();backend.BeginErrorReadLine();
    if(await Task.WhenAny(ready.Task,Task.Delay(20000))!=ready.Task)throw new TimeoutException("App backend did not become ready.");
    audio=new AudioLoopback();openWindows=new OpenWindows(HubActive,environment.OwnGroup,PublishHub);notifications=new Notifications(dispatcher);notifications.Changed+=PublishHub;ChangeMode(startAll?"all":startDesktop?"desktop":"window");openWindows.Start();notifications.SetPrivacySuspended(!HubActive());notifications.Start();frameTimer.Start();Log("Application ready");
   }catch(Exception e){Log("Startup: "+e.GetType().Name);MessageBox.Show("Не удалось открыть приложение. Проверь data\\app.log. Текущие обои не изменены.","WallpaperShell",MessageBoxButtons.OK,MessageBoxIcon.Error);Quit();}
  }
  void BackendMessage(string line){
   if(!line.StartsWith("{"))return;
   try{var m=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(line);object type;if(!m.TryGetValue("type",out type))return;
    if((string)type=="app-ready"){object value;if(m.TryGetValue("theme",out value)&&ThemeSupport.Known((string)value))Theme=(string)value;ready.TrySetResult(true);}
    if((string)type=="app-theme")Ui(()=>{string value=Convert.ToString(m["value"]);if(!ThemeSupport.Known(value))return;if(policy.Blocked){pendingTheme=value;return;}ApplyTheme(value);});
    if((string)type=="app-window")Ui(()=>{object handle,pid,action;int number;if(m.TryGetValue("handle",out handle)&&m.TryGetValue("pid",out pid)&&m.TryGetValue("action",out action)&&Int32.TryParse(Convert.ToString(pid),out number))environment.Register(Convert.ToString(handle),number,Convert.ToString(action)=="register");});
    if((string)type=="app-shell-request")Ui(()=>ShellRequest(m));
    if((string)type=="app-exit")Ui(Quit);
   }catch{Log("Rejected backend message");}
  }
  void ApplyTheme(string value){if(Theme==value)return;ResetPolicy("theme");Theme=value;foreach(var w in windows)w.Navigate();}
  internal void HostCommand(string value){if(value=="quit")Quit();else if((value=="window"||value=="desktop"||value=="all")&&!policy.Blocked)ChangeMode(value);}
  internal void ChangeMode(string mode){ChangeMode(mode,false);}
  internal void RecoverDesktop(){ChangeMode(Mode,true);}
  void ChangeMode(string mode,bool forced){
   if(Exiting||policy.Blocked&&!forced)return;
   if(nativeFiles>0){ResetPolicy("display");pendingMode=mode;return;}
   ResetPolicy("mode");Switching=true;
   try{
    foreach(var w in windows.ToArray()){w.Close();w.Dispose();}windows.Clear();Mode=mode;
    Screen[] screens=mode=="all"?Screen.AllScreens:new[]{Screen.PrimaryScreen};
    foreach(var screen in screens){var w=new Surface(this,screen,mode!="window");windows.Add(w);w.Show();}
   }catch(Exception e){Log("Display mode: "+e.GetType().Name);if(mode!="window"){Switching=false;MessageBox.Show("Не удалось разместить приложение на рабочем столе. Открою его в обычном окне.","WallpaperShell");ChangeMode("window");return;}throw;}
   finally{Switching=false;}
  }
  void DisplaysChanged(object sender,EventArgs e){Ui(()=>{if(Mode!="window")ChangeMode(Mode,true);else{ResetPolicy("display");foreach(var w in windows)w.DisplayChanged();}});}
  void SessionChanged(object sender,Microsoft.Win32.SessionSwitchEventArgs e){if(e.Reason==Microsoft.Win32.SessionSwitchReason.SessionLock||e.Reason==Microsoft.Win32.SessionSwitchReason.SessionLogoff)Ui(()=>SuspendPolicy("session"));else if(e.Reason==Microsoft.Win32.SessionSwitchReason.SessionUnlock)Ui(()=>ResumePolicy("session"));}
  void PowerChanged(object sender,Microsoft.Win32.PowerModeChangedEventArgs e){if(e.Mode==Microsoft.Win32.PowerModes.Suspend)Ui(()=>SuspendPolicy("sleep"));else if(e.Mode==Microsoft.Win32.PowerModes.Resume)Ui(()=>ResumePolicy("sleep"));}
  void SuspendPolicy(string reason){CancelUpdate();sessionSuspended=true;hubActive=false;ClosePreview(reason);if(notifications!=null)notifications.SetPrivacySuspended(true);policy.External();BroadcastPolicy("suspend",reason);BroadcastModal();}
  void ResumePolicy(string reason){sessionSuspended=false;hubActive=false;if(notifications!=null)notifications.SetPrivacySuspended(!HubActive());environment.Baseline();BroadcastPolicy("resume",reason);FlushDeferred();}
  void ObserveWindows(){
   if(Exiting||Switching)return;
   foreach(var candidate in environment.DrainAttention()){
    if(sessionSuspended||!windows.Any(w=>w.IntersectsAttention(candidate)))continue;
    ExternalWindow("window-shown",candidate);
   }
   if(environment.ChangedToExternal())ExternalWindow("foreground",environment.ForegroundAttention());
   foreach(var w in windows.ToArray())w.ObserveLifecycle();
  }
  void ExternalWindow(string reason,WindowAttention candidate){
   ClosePreview(reason);
   bool released=policy.External();BroadcastPolicy("external",reason);
   if(candidate!=null)foreach(var w in windows.ToArray())if(w.YieldTo(candidate))windowYields++;
   if(released){BroadcastModal();FlushDeferred();}
  }
  internal bool YieldSurface(Surface surface,bool desktop,WindowAttention candidate){
   return environment.YieldSurface(surface.Handle,surface.Bounds,desktop,surface.Visible,surface.WindowState==FormWindowState.Minimized,candidate);
  }
  internal void OwnInteraction(){environment.OwnInteraction();}
  void BackendPolicy(object message){try{if(backend!=null&&!backend.HasExited){backend.StandardInput.WriteLine(Json.Serialize(message));backend.StandardInput.Flush();}}catch{}}
  void BroadcastPolicy(string kind,string reason){if(kind=="external"||kind=="suspend"||kind=="reset"){notificationIntent++;if(notifications!=null)notifications.CancelActivation(kind!="external");}var message=new{type="window-policy",@event=kind,reason=reason};foreach(var w in windows.ToArray())w.SendPolicy(message);BackendPolicy(message);}
  void BroadcastPanel(Surface source,string kind){ClosePreview(kind);var message=new{type="window-policy",@event="panel-close",sourceSurfaceId=source.SurfaceId,kind=kind,reason="replacement"};foreach(var w in windows.ToArray())w.SendPolicy(message);BackendPolicy(message);}
  void BroadcastModal(){foreach(var w in windows.ToArray())w.SendPolicy(new{type="window-policy",@event="modal-state",blocked=policy.Blocked,owned=policy.ModalKind!="shell"&&policy.ModalOwner==w.SurfaceId,ownerSurfaceId=policy.ModalOwner,kind=policy.ModalKind});BackendPolicy(new{type="window-policy",@event="modal-state",blocked=policy.Blocked,ownerSurfaceId=policy.ModalOwner,kind=policy.ModalKind});}
  internal void RegisterSurface(Surface surface){policy.Register(surface.SurfaceId);}
  internal void RemoveSurface(Surface surface){if(updateOwner==surface.SurfaceId)CancelUpdate();ClosePreview("surface-removed");if(surface.IsHandleCreated)environment.Surface(surface.Handle,false);if(policy.Unregister(surface.SurfaceId,true))BroadcastModal();}
  internal void SurfaceReady(Surface surface){surface.RefreshSurface();MaintenanceInfo(surface);surface.SendPolicy(new{type="window-policy",@event="modal-state",blocked=policy.Blocked,owned=policy.ModalKind!="shell"&&policy.ModalOwner==surface.SurfaceId,ownerSurfaceId=policy.ModalOwner,kind=policy.ModalKind});if(sessionSuspended)surface.SendPolicy(new{type="window-policy",@event="suspend",reason="session"});if(ThemeSupport.DesktopHub(Theme))surface.SendPolicy(HubFrame());}
  internal void SurfaceMetadata(object metadata){BackendPolicy(metadata);}
  internal void SurfaceHandle(Surface surface){environment.Surface(surface.Handle,true);}
  internal void SurfaceLifecycle(Surface surface,bool suspended){
   if(suspended){ClosePreview("surface-suspended");bool released=policy.SuspendSurface(surface.SurfaceId);surface.SendPolicy(new{type="window-policy",@event="suspend",surfaceId=surface.SurfaceId,reason="surface"});BackendPolicy(new{type="window-policy",@event="suspend",surfaceId=surface.SurfaceId,reason="surface"});if(released){BroadcastModal();Ui(FlushDeferred);}}
   else{surface.SendPolicy(new{type="window-policy",@event="resume",surfaceId=surface.SurfaceId,reason="surface"});BackendPolicy(new{type="window-policy",@event="resume",surfaceId=surface.SurfaceId,reason="surface"});surface.RefreshSurface();}
  }
  internal void ResetSurface(Surface surface,string reason){ClosePreview(reason);surface.CancelFiles();policy.Unregister(surface.SurfaceId,true);policy.Register(surface.SurfaceId);surface.SendPolicy(new{type="window-policy",@event="reset",surfaceId=surface.SurfaceId,reason=reason});BackendPolicy(new{type="window-policy",@event="reset",surfaceId=surface.SurfaceId,reason=reason});BroadcastModal();}
  void ResetPolicy(string reason){ClosePreview(reason);foreach(var w in windows.ToArray())w.CancelFiles();policy.Reset(true);BroadcastPolicy("reset",reason);BroadcastModal();}
  void FlushDeferred(){if(policy.Blocked||nativeFiles>0||Exiting)return;if(pendingMode!=null){var mode=pendingMode;pendingMode=null;ChangeMode(mode,true);}if(pendingTheme!=null){var theme=pendingTheme;pendingTheme=null;ApplyTheme(theme);}}
  bool HubActive(){return !Exiting&&ThemeSupport.DesktopHub(Theme)&&!sessionSuspended&&windows.Any(w=>w.CanInteract&&!w.IsPaused(Paused));}
  void ClosePreview(string reason){if(openWindows!=null)openWindows.ClosePreview(reason);}
  object HubFrame(){return new{type="desktop-hub",windows=openWindows!=null?openWindows.Snapshot:(object)new{status="loading",items=new object[0]},notifications=notifications!=null?(object)notifications.Snapshot():new{status="unknown",access="unknown",detail="checking",items=new object[0]}};}
  void PublishHub(){if(Exiting||!ThemeSupport.DesktopHub(Theme))return;var frame=HubFrame();foreach(var w in windows.ToArray())w.SendPolicy(frame);}
  internal bool HubRequest(Surface source,bool desktop,Dictionary<string,object> request){
   if(DesktopHubPolicy.Text(request,"type")!="desktop-hub-request")return false;
   string id=DesktopHubPolicy.Text(request,"requestId"),action=DesktopHubPolicy.Text(request,"action");Guid parsed;if(!Guid.TryParseExact(id,"D",out parsed))return true;
   if(!DesktopHubPolicy.Request(request)){HubResult(source,id,false,"invalid","Некорректный запрос.");return true;}
   if(!DesktopHubPolicy.Allowed(action,ThemeSupport.DesktopHub(Theme),source.CanInteract,sessionSuspended,policy.Blocked,policy.PanelOwner!=null)||nativeFiles>0&&action!="window-preview-close"){
    HubResult(source,id,false,"blocked","Сначала завершите открытый диалог.");return true;
   }
   if(action=="start-menu"){
    ClosePreview("start-menu");environment.OwnInteraction();
    bool ok=source.OpenStartMenu();HubResult(source,id,ok,ok?"ok":"unavailable",null);return true;
   }
   if(action.StartsWith("window-",StringComparison.Ordinal)){
    if(openWindows==null){HubResult(source,id,false,"unavailable",null);return true;}
    var result=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(openWindows.Handle(source,desktop,request)));result["type"]="desktop-hub-result";result["requestId"]=id;result["ok"]=DesktopHubPolicy.Text(result,"status")=="ok";source.SendPolicy(result);return true;
   }
   if(action=="notification-activate"){OpenNotification(source,id,DesktopHubPolicy.Text(request,"id"));return true;}
   if(action=="notification-dismiss"){
    ClosePreview("notification-dismiss");
    bool ok=notifications!=null&&notifications.Dismiss(DesktopHubPolicy.Text(request,"id"));
    HubResult(source,id,ok,ok?"ok":"unavailable",null);return true;
   }
   RequestNotifications(source,id,action);return true;
  }
  async void OpenNotification(Surface source,string requestId,string id){
   if(notifications==null||String.IsNullOrWhiteSpace(id)||id.Length>160){HubResult(source,requestId,false,"unavailable",null);return;}
   ClosePreview("notification");environment.OwnInteraction();
   long intent=notificationIntent;bool ok=await notifications.ActivateAsync(id,()=>!Exiting&&intent==notificationIntent&&DesktopHubPolicy.Allowed("notification-activate",ThemeSupport.DesktopHub(Theme),source.CanInteract,sessionSuspended,policy.Blocked,policy.PanelOwner!=null)&&nativeFiles==0);
   HubResult(source,requestId,ok,ok?"ok":"unavailable",null);
  }
  void HubResult(Surface source,string id,bool ok,string status,string message){source.SendPolicy(new{type="desktop-hub-result",requestId=id,ok=ok,status=status,message=message});}
  async void RequestNotifications(Surface source,string id,string action){
   string token;if(notifications==null||!policy.Acquire(source.SurfaceId,"notifications",out token)){HubResult(source,id,false,"blocked","Сначала завершите открытый диалог.");return;}
   nativeFiles++;environment.OwnInteraction();BroadcastPanel(source,"modal");BroadcastModal();
   try{
    if(action=="notifications-access"){var state=await notifications.RequestAccessAsync();HubResult(source,id,state.status=="enabled",state.status,null);}
    else{notifications.OpenSettings();HubResult(source,id,true,"settings",null);}
   }catch{HubResult(source,id,false,"unavailable","Доступ к уведомлениям сейчас недоступен.");}
   finally{nativeFiles--;if(policy.Release(source.SurfaceId,token))BroadcastModal();PublishHub();Ui(FlushDeferred);}
  }
  internal bool PolicyRequest(Surface source,Dictionary<string,object> request){
   object raw;if(!request.TryGetValue("type",out raw)||Convert.ToString(raw)!="window-policy-request")return false;
   object value;string id=request.TryGetValue("requestId",out value)?value as string:null,action=request.TryGetValue("action",out value)?value as string:null,kind=request.TryGetValue("kind",out value)?value as string:null,token=request.TryGetValue("token",out value)?value as string:null;Guid parsed;
   if(id==null||!Guid.TryParseExact(id,"D",out parsed))return true;
   bool ok=false;string issued=null;bool valid=true;foreach(string key in request.Keys)if(key!="type"&&key!="requestId"&&key!="action"&&key!="kind"&&key!="token")valid=false;
   if(valid){
    if(action=="acquire"&&token==null&&(kind=="import"||kind=="export"||kind=="power"||kind=="update")&&!sessionSuspended&&nativeFiles==0&&source.CanInteract){ok=policy.Acquire(source.SurfaceId,kind,out issued);if(ok){environment.OwnInteraction();BroadcastPanel(source,"modal");BroadcastModal();}}
    else if(action=="release"&&token!=null){ok=policy.Release(source.SurfaceId,token);if(ok)BroadcastModal();}
    else if(action=="panel-close"&&token==null&&(kind=="settings"||kind=="themes"||kind=="launcher")){ok=policy.ClosePanel(source.SurfaceId,kind);}
    else if(action=="panel"&&token==null&&!sessionSuspended&&nativeFiles==0&&source.CanInteract){ok=policy.Panel(source.SurfaceId,kind);if(ok){if(WindowAttentionRules.ExplicitPanel(kind))environment.OwnInteraction();BroadcastPanel(source,kind);}}
   }
   source.SendPolicy(new{type="window-policy-result",requestId=id,ok=ok,token=issued,message=ok?null:"Сначала завершите открытый диалог."});if(action=="release"&&ok)FlushDeferred();return true;
  }
  void ShellRequest(Dictionary<string,object> request){
   // This entry point is only read from our private backend stdout, not from a
   // WebView. A native Shell menu borrows its launcher's surface but is a separate
   // modal owner; page scripts cannot fabricate this kind of reservation.
   object value;string id=request.TryGetValue("requestId",out value)?value as string:null,owner=request.TryGetValue("surfaceId",out value)?value as string:null,action=request.TryGetValue("action",out value)?value as string:null,token=request.TryGetValue("token",out value)?value as string:null;Guid parsed;
   if(id==null||!Guid.TryParseExact(id,"D",out parsed))return;
   bool valid=true;foreach(string key in request.Keys)if(key!="type"&&key!="requestId"&&key!="surfaceId"&&key!="action"&&key!="token")valid=false;
   bool ok=false;string issued=null;
   if(valid&&action=="acquire"&&token==null&&!sessionSuspended&&nativeFiles==0){
    var source=windows.FirstOrDefault(window=>window.SurfaceId==owner);
    if(source!=null&&source.CanInteract&&policy.Acquire(owner,"shell",out issued)){
     ok=true;environment.OwnInteraction();BroadcastPanel(source,"launcher");BroadcastModal();
    }
   }else if(valid&&action=="release"&&token!=null&&policy.Owns(owner,"shell")){
    ok=policy.Release(owner,token);if(ok)BroadcastModal();
   }
   BackendPolicy(new{type="window-policy",@event="shell-result",requestId=id,ok=ok,token=issued});if(ok&&action=="release")Ui(FlushDeferred);
  }
  internal IDisposable BeginNativeFile(Surface owner,string action){
   string kind=action=="open"?"import":"export",token=null;bool acquired=false;
   if(sessionSuspended||nativeFiles>0||!owner.CanInteract)return null;
   if(policy.Blocked){if(!policy.Owns(owner.SurfaceId,kind))return null;}
   else{if(!policy.Acquire(owner.SurfaceId,kind,out token))return null;acquired=true;BroadcastPanel(owner,"modal");BroadcastModal();}
   nativeFiles++;return new WindowPolicyScope(()=>{nativeFiles--;if(acquired&&policy.Release(owner.SurfaceId,token))BroadcastModal();Ui(FlushDeferred);});
  }
  void Frame(){
   if(Exiting||audio==null)return;ticks++;bool any=false;foreach(var w in windows)if(!w.IsPaused(Paused||sessionSuspended))any=true;audio.SetEnabled(any);
   bool active=HubActive()||policy.ModalKind=="notifications"&&!sessionSuspended&&ThemeSupport.DesktopHub(Theme);if(active!=hubActive){hubActive=active;if(notifications!=null)notifications.SetPrivacySuspended(!active);if(active&&openWindows!=null)openWindows.Refresh();if(!active)ClosePreview("inactive");PublishHub();}
   string state;long count;double age;var bins=audio.Read(out state,out count,out age);
   foreach(var w in windows){bool pause=w.IsPaused(Paused||sessionSuspended);w.SendAudio(bins,pause);}
   if(ticks%72==0){try{File.WriteAllText(Path.Combine(Root,"data/native-diagnostics.json"),Json.Serialize(new{at=DateTime.UtcNow.ToString("o"),mode=Mode,windows=windows.Count,audioState=state,audioFrames=count,audioAge=age,audioPeak=bins.Length==0?0:bins.Max(),backendAlive=backend!=null&&!backend.HasExited,wallpaperEngineRequired=false,desktopHub=new{mounted=openWindows!=null&&notifications!=null,active=hubActive,openWindowCount=openWindows!=null?openWindows.SnapshotCount:0,previewOpen=openWindows!=null&&openWindows.PreviewOpen,startMenuSupported=true,windowCloseSupported=true,notificationActivationSupported=true,notificationDismissalSupported=true,actionableNotificationCount=notifications!=null?notifications.DiagnosticActionableCount:0,notificationIdentity=NotificationsPlatform.HasIdentity(),notificationStatus=notifications!=null?notifications.DiagnosticStatus:null,notificationDetail=notifications!=null?notifications.DiagnosticDetail:null},windowPolicy=new{mounted=true,modalKind=policy.ModalKind,modalOwner=policy.ModalOwner,surfaces=windows.Count,generation=policy.Generation,nativeDialogs=nativeFiles,sessionSuspended=sessionSuspended,attentionHooks=environment.AttentionHooksActive,windowYields=windowYields}}));}catch{}}
  }
  internal void Diagnostics(Surface sender,object data){try{string profile=sender.Profile;var safe=NativeDiagnostics.Project(data);if(safe==null||!diagnosticsGate.Allow(profile,Stopwatch.GetTimestamp()))return;File.WriteAllText(Path.Combine(Root,"data/ui-"+profile+".json"),Json.Serialize(new{at=DateTime.UtcNow.ToString("o"),data=safe}));}catch{}}
  internal void Quit(){if(Exiting)return;Exiting=true;ExitThread();}
  protected override void ExitThreadCore(){
   Exiting=true;CancelUpdate();ResetPolicy("exit");frameTimer.Stop();startTimer.Stop();policyTimer.Stop();policyTimer.Dispose();environment.Dispose();Microsoft.Win32.SystemEvents.DisplaySettingsChanged-=DisplaysChanged;Microsoft.Win32.SystemEvents.SessionSwitch-=SessionChanged;Microsoft.Win32.SystemEvents.PowerModeChanged-=PowerChanged;
   if(openWindows!=null){openWindows.Dispose();openWindows=null;}if(notifications!=null){notifications.Changed-=PublishHub;notifications.Dispose();notifications=null;}
   foreach(var w in windows.ToArray()){w.Close();w.Dispose();}windows.Clear();tray.Visible=false;tray.Dispose();if(audio!=null)audio.Dispose();
   try{if(backend!=null&&!backend.HasExited){backend.StandardInput.WriteLine("stop");if(!backend.WaitForExit(2500))backend.Kill();}}catch{}job.Dispose();dispatcher.Dispose();base.ExitThreadCore();
  }
 }
 internal sealed class Surface : Form {
  readonly AppContext app;readonly Screen screen;readonly bool desktop;readonly WebViewRecovery recovery=new WebViewRecovery();WebView2 view;LayoutFiles layoutFiles;ShellOwnerWindow shellOwner;bool loaded,lastPause=true,pauseSent,covered,reattachQueued,lifecycleSuspended,initialShown;IntPtr desktopParent;DateTime coverageChecked=DateTime.MinValue;internal readonly string Profile;internal readonly string SurfaceId=Guid.NewGuid().ToString("D");Rectangle sentBounds;string sentMonitor;
  protected override bool ShowWithoutActivation{get{return desktop||app.NoActivate;}}
  internal Surface(AppContext context,Screen target,bool attach){app=context;screen=target;desktop=attach;Profile=target.Bounds.Width>=3000?"display-2":"display-1";app.RegisterSurface(this);Text="WallpaperShell";AutoScaleMode=AutoScaleMode.None;BackColor=Color.Black;MinimumSize=new Size(960,560);
   StartPosition=FormStartPosition.Manual;var area=target.WorkingArea;ClientSize=new Size(Math.Min(1600,area.Width-80),Math.Min(900,area.Height-100));Location=new Point(area.Left+(area.Width-Width)/2,area.Top+(area.Height-Height)/2);
   // Set styles before the first handle is shown. Changing them in Attach can
   // recreate a visible Form and queue Shown again while WebView is starting.
   if(desktop){FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;}
   Activated+=(s,e)=>app.OwnInteraction();
   Shown+=async(s,e)=>{if(initialShown)return;initialShown=true;if(desktop)try{desktopParent=DesktopHost.Attach(this,screen);}catch{app.ChangeMode("window");return;}long token;if(recovery.BeginInitial(out token))await CreateView(token);};
   FormClosing+=(s,e)=>{CancelFiles();if(!app.Exiting&&!app.Switching){e.Cancel=true;app.Quit();}};
  }
  bool CurrentView(long token,WebView2 candidate){return recovery.Current(token)&&!IsDisposed&&!Disposing&&candidate!=null&&view==candidate&&!candidate.IsDisposed;}
  void ViewFailed(long token,WebView2 candidate,CoreWebView2ProcessFailedKind kind){
   if(!CurrentView(token,candidate)||app.Exiting||app.Switching)return;
   var decision=recovery.Request(token,DateTime.UtcNow);if(decision==WebViewRecoveryDecision.Ignored)return;
   app.Log("WebView process failure: "+kind+" generation="+token+" recovery="+decision);loaded=false;
   if(decision==WebViewRecoveryDecision.Exhausted){MessageBox.Show("Не удалось восстановить интерфейс. Перезапусти WallpaperShell.","WallpaperShell");return;}
   try{BeginInvoke((Action)(async()=>{if(!CurrentView(token,candidate)||app.Exiting||app.Switching){recovery.CancelQueued(token);return;}long next;if(recovery.BeginQueued(token,out next))await CreateView(next);}));}
   catch(InvalidOperationException){recovery.CancelQueued(token);}
  }
  async Task CreateView(long token){
   string stage="environment";WebView2 created=null;
   try{
    if(!recovery.Current(token)||IsDisposed||app.Exiting)return;
    app.ResetSurface(this,"webview");loaded=false;if(layoutFiles!=null){layoutFiles.CancelPending();layoutFiles=null;}if(view!=null){Controls.Remove(view);view.Dispose();}
    created=new WebView2{Dock=DockStyle.Fill,DefaultBackgroundColor=Color.Black,CreationProperties=new CoreWebView2CreationProperties{UserDataFolder=Path.Combine(app.Root,"data/webview")}};view=created;Controls.Add(created);await created.EnsureCoreWebView2Async();if(!CurrentView(token,created))return;
    stage="settings";var core=created.CoreWebView2;core.Settings.AreDefaultContextMenusEnabled=false;core.Settings.AreDevToolsEnabled=false;core.Settings.IsStatusBarEnabled=false;
    core.PermissionRequested+=(s,e)=>e.State=CoreWebView2PermissionState.Deny;core.DownloadStarting+=(s,e)=>e.Cancel=true;
    core.NewWindowRequested+=(s,e)=>{e.Handled=true;if(CurrentView(token,created)&&e.IsUserInitiated&&NativeWebMessages.WeatherLink(e.Uri))Process.Start(new ProcessStartInfo("https://open-meteo.com/"){UseShellExecute=true});};
    layoutFiles=new LayoutFiles(this,desktop,response=>{if(CurrentView(token,created)&&created.CoreWebView2==core)core.PostWebMessageAsJson(app.Json.Serialize(response));},null,action=>app.BeginNativeFile(this,action));
    core.NavigationStarting+=(s,e)=>{if(!CurrentView(token,created)||!LayoutFiles.IsTrustedPage(e.Uri)){e.Cancel=true;return;}pauseSent=false;app.ResetSurface(this,"navigation");};
    core.AddWebResourceRequestedFilter("*",CoreWebView2WebResourceContext.All);core.WebResourceRequested+=(s,e)=>{Uri u;if(!Uri.TryCreate(e.Request.Uri,UriKind.Absolute,out u))return;if(!(u.Scheme=="http"&&u.Host=="127.0.0.1"&&u.Port==8767)&&u.Scheme!="data"&&u.Scheme!="blob")e.Response=core.Environment.CreateWebResourceResponse(null,403,"Blocked","");};
    core.WebMessageReceived+=(s,e)=>{if(!loaded||!CurrentView(token,created)||!LayoutFiles.IsTrustedPage(e.Source)||created.CoreWebView2!=core)return;try{string raw=e.WebMessageAsJson;if(!NativeWebMessages.Bounded(raw))return;var m=app.Json.Deserialize<Dictionary<string,object>>(raw);if(m==null)return;if(app.MaintenanceRequest(this,m))return;if(app.PolicyRequest(this,m))return;if(app.HubRequest(this,desktop,m))return;if(layoutFiles!=null&&layoutFiles.Handle(m))return;if(Convert.ToString(m["type"])=="host-command")app.HostCommand(Convert.ToString(m["value"]));else if(Convert.ToString(m["type"])=="app-diagnostics")app.Diagnostics(this,m["data"]);}catch{}};
    core.NavigationCompleted+=(s,e)=>{if(!CurrentView(token,created))return;loaded=e.IsSuccess;if(!e.IsSuccess)app.Log("Navigation failed: "+e.WebErrorStatus);else app.SurfaceReady(this);};
    core.ProcessFailed+=(s,e)=>ViewFailed(token,created,e.ProcessFailedKind);
    stage="private-bootstrap";foreach(var page in new[]{"index.html","classic/index.html","luna-blue/index.html"}){await core.AddScriptToExecuteOnDocumentCreatedAsync(PrivateBootstrap.InjectionScript(app.Root,"http://127.0.0.1:8767/"+page));if(!CurrentView(token,created))return;}
    stage="navigation";Navigate();
   }catch(Exception e){if(!recovery.Current(token)||app.Exiting||app.Switching||IsDisposed||Disposing)return;app.Log("WebView initialization: "+stage+" "+e.GetType().Name+" 0x"+e.HResult.ToString("X8")+" generation="+token);if(desktop){app.ChangeMode("window");return;}MessageBox.Show("Не удалось загрузить WebView2. Проверь установленный Microsoft Edge WebView2 Runtime.","WallpaperShell");}
   finally{recovery.Complete(token);}
  }
  internal void Navigate(){if(view!=null&&view.CoreWebView2!=null){loaded=false;view.CoreWebView2.Navigate("http://127.0.0.1:8767/"+ThemeSupport.PagePrefix(app.Theme)+"index.html?profile="+Profile+"&desktop="+(desktop?"1":"0")+"&surfaceId="+SurfaceId+"&monitorId="+Uri.EscapeDataString(Screen.FromControl(this).DeviceName)+"&ownerHandle="+Handle.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture));}}
  internal void CancelFiles(){if(layoutFiles!=null)layoutFiles.CancelPending();}
  internal bool CanInteract{get{return loaded&&!IsDisposed&&IsHandleCreated&&Visible&&WindowState!=FormWindowState.Minimized&&!lifecycleSuspended&&!WindowEnvironment.Cloaked(Handle);}}
  internal bool OpenStartMenu(){return CanInteract&&PostSystemMessage(Handle,0x0112,new IntPtr(0xf130),IntPtr.Zero);}
  internal bool IntersectsAttention(WindowAttention candidate){
   if(candidate==null||IsDisposed||!IsHandleCreated||!Visible||WindowState==FormWindowState.Minimized)return false;
   // WorkerW children expose parent-relative Bounds; notifications use screen coordinates.
   var physical=desktop?new Rectangle(PointToScreen(Point.Empty),ClientSize):Bounds;return physical.IntersectsWith(candidate.Bounds);
  }
  internal bool YieldTo(WindowAttention candidate){return !IsDisposed&&IsHandleCreated&&app.YieldSurface(this,desktop,candidate);}
  protected override void Dispose(bool disposing){if(disposing){recovery.Close();loaded=false;CancelFiles();app.RemoveSurface(this);if(shellOwner!=null){shellOwner.Close();shellOwner.Dispose();shellOwner=null;}}base.Dispose(disposing);}
  internal void SendPolicy(object message){if(!loaded||IsDisposed||view==null||view.CoreWebView2==null)return;try{view.CoreWebView2.PostWebMessageAsJson(app.Json.Serialize(message));}catch{}}
  internal void RefreshSurface(){
   if(IsDisposed||!IsHandleCreated)return;var target=Screen.FromControl(this);var point=PointToScreen(Point.Empty);var area=new Rectangle(point,ClientSize);
   app.SurfaceHandle(this);if(shellOwner==null){shellOwner=new ShellOwnerWindow{Location=new Point(target.WorkingArea.Left+target.WorkingArea.Width/2,target.WorkingArea.Top+target.WorkingArea.Height/2)};if(!desktop)shellOwner.Owner=this;shellOwner.Show();}
   SetWindowPos(shellOwner.Handle,IntPtr.Zero,target.WorkingArea.Left+target.WorkingArea.Width/2,target.WorkingArea.Top+target.WorkingArea.Height/2,1,1,0x10|0x4);
   sentBounds=area;sentMonitor=target.DeviceName;var message=new{type="window-policy",@event="surface",surfaceId=SurfaceId,monitorId=target.DeviceName,ownerHandle=Handle.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture),shellOwnerHandle=shellOwner.Handle.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture),bounds=new{x=area.X,y=area.Y,width=area.Width,height=area.Height},profile=Profile};SendPolicy(message);app.SurfaceMetadata(message);
  }
  internal void DisplayChanged(){
   if(IsDisposed)return;var area=Screen.FromRectangle(Bounds).WorkingArea;MinimumSize=new Size(Math.Min(960,area.Width),Math.Min(560,area.Height));
   if(WindowState==FormWindowState.Normal){var next=WindowPlacement.Clamp(Bounds,area);if(next!=Bounds){
    // SWP_NOACTIVATE | SWP_NOZORDER: recover an off-screen window without stealing
    // focus from the user's foreground application after an unplug/DPI change.
    SetWindowPos(Handle,IntPtr.Zero,next.X,next.Y,next.Width,next.Height,0x10|0x4);
   }}RefreshSurface();SendPolicy(new{type="window-policy",@event="resume",surfaceId=SurfaceId,reason="display"});
  }
  [DllImport("user32.dll")]static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll",EntryPoint="PostMessageW",SetLastError=true)]static extern bool PostSystemMessage(IntPtr hwnd,uint message,IntPtr wp,IntPtr lp);
  sealed class ShellOwnerWindow:Form{
   internal ShellOwnerWindow(){ShowInTaskbar=false;FormBorderStyle=FormBorderStyle.None;StartPosition=FormStartPosition.Manual;Opacity=0;Size=new Size(1,1);Text="WallpaperShell Shell owner";}
   protected override bool ShowWithoutActivation{get{return true;}}
   protected override CreateParams CreateParams{get{var value=base.CreateParams;value.ExStyle|=0x08000000|0x80|0x20;return value;}}
  }
  internal void ObserveLifecycle(){
   if(IsDisposed||!IsHandleCreated)return;bool suspended=!Visible||WindowState==FormWindowState.Minimized||WindowEnvironment.Cloaked(Handle);
   if(suspended!=lifecycleSuspended){lifecycleSuspended=suspended;app.SurfaceLifecycle(this,suspended);}
   if(!suspended){var point=PointToScreen(Point.Empty);var area=new Rectangle(point,ClientSize);if(area!=sentBounds||Screen.FromControl(this).DeviceName!=sentMonitor)RefreshSurface();}
  }
  internal bool IsPaused(bool manual){
   if(!loaded||manual||!Visible||WindowState==FormWindowState.Minimized||lifecycleSuspended)return true;
   if(desktop&&!DesktopHost.IsWindow(desktopParent)){if(!reattachQueued){reattachQueued=true;BeginInvoke((Action)(()=>{if(!app.Exiting&&app.Mode!="window")app.RecoverDesktop();}));}return true;}
   if((DateTime.UtcNow-coverageChecked).TotalMilliseconds>=500){coverageChecked=DateTime.UtcNow;covered=DesktopHost.Covered(desktop?screen.WorkingArea:Bounds);}return covered;
  }
  internal void SendAudio(double[] bins,bool paused){if(!loaded||view==null||view.CoreWebView2==null)return;try{if(!pauseSent||lastPause!=paused){view.CoreWebView2.PostWebMessageAsJson(app.Json.Serialize(new{type="pause",value=paused}));lastPause=paused;pauseSent=true;}if(!paused)view.CoreWebView2.PostWebMessageAsJson(app.Json.Serialize(new{type="audio",samples=bins}));}catch{}}
 }
}
