using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace PaperGreen {
 // These objects are for the trusted local WebView only. Never add them to the
 // backend status, diagnostic log, layout model or an exported layout.
 internal sealed class NotificationItem {
  public string id {get;set;}
  public string app {get;set;}
  public string sender {get;set;}
  public string text {get;set;}
  public string icon {get;set;}
  public string at {get;set;}
  public bool canActivate {get;set;}
  public bool portrait {get;set;}
 }
 internal sealed class NotificationFeedState {
  public string status {get;set;}
  public string access {get;set;}
  public string detail {get;set;}
  public NotificationItem[] items {get;set;}
 }
 internal sealed class NotificationRecord {
  internal string Id,App,Sender,Text,Icon,AppId,TextKey;
  internal bool CanActivate,Portrait;
  internal DateTimeOffset At;
 }
 internal static class NotificationFeedRules {
  internal const int MaximumItems=20;
  internal static readonly TimeSpan MaximumAge=TimeSpan.FromHours(24);
  internal static string Clean(string value,int maximum) {
   if(String.IsNullOrEmpty(value))return "";
   var result=new StringBuilder(Math.Min(value.Length,maximum));
   foreach(char c in value){
    if(result.Length>=maximum)break;
    if(c=='\n'||c=='\t')result.Append(' ');
    else if(!Char.IsControl(c)&&c!='\u202a'&&c!='\u202b'&&c!='\u202d'&&c!='\u202e'&&c!='\u202c'&&c!='\u2066'&&c!='\u2067'&&c!='\u2068'&&c!='\u2069')result.Append(c);
   }
   if(result.Length>0&&Char.IsHighSurrogate(result[result.Length-1]))result.Length--;
   return result.ToString().Trim();
  }
  internal static NotificationItem[] Select(IEnumerable<NotificationRecord> records,DateTimeOffset now,ISet<string> dismissed=null) {
   if(records==null)return new NotificationItem[0];
   return records.Where(r=>r!=null&&r.At>=now-MaximumAge&&r.At<=now.AddMinutes(5)&&(dismissed==null||!dismissed.Contains(r.Id)))
    .OrderByDescending(r=>r.At).GroupBy(r=>r.Id??"").Select(g=>g.First()).Take(MaximumItems)
    .Select(r=>new NotificationItem{id=Clean(r.Id,160),app=Clean(r.App,160),sender=Clean(r.Sender,256),text=Clean(r.Text,4000),icon=SafeIcon(r.Icon),at=r.At.ToUniversalTime().ToString("o"),canActivate=r.CanActivate,portrait=r.Portrait&&!String.IsNullOrEmpty(SafeIcon(r.Icon))}).ToArray();
  }
  internal static string SafeIcon(string value) {
   // Logos and normalized local Telegram portraits, never remote image URLs.
   return value!=null&&value.Length<=200000&&value.StartsWith("data:image/png;base64,",StringComparison.Ordinal)?value:"";
  }
  internal static string LogoPng(Image source) {
   if(source==null||source.Width>512||source.Height>512)return "";
   using(var pixels=new Bitmap(source)) {
    int left=pixels.Width,top=pixels.Height,right=-1,bottom=-1;
    // AppInfo tile assets often include wide transparent margins. Fit their
    // visible pixels, preserving aspect ratio and a little antialiasing space.
    for(int y=0;y<pixels.Height;y++)for(int x=0;x<pixels.Width;x++)if(pixels.GetPixel(x,y).A>8){left=Math.Min(left,x);top=Math.Min(top,y);right=Math.Max(right,x);bottom=Math.Max(bottom,y);}
    if(right<left)return "";
    var bounds=Rectangle.FromLTRB(Math.Max(0,left-1),Math.Max(0,top-1),Math.Min(pixels.Width,right+2),Math.Min(pixels.Height,bottom+2));
    foreach(int size in new[]{64,32})using(var bitmap=new Bitmap(size,size))using(var graphics=Graphics.FromImage(bitmap))using(var output=new MemoryStream()) {
     float scale=(size-4f)/Math.Max(bounds.Width,bounds.Height),width=bounds.Width*scale,height=bounds.Height*scale;
     graphics.InterpolationMode=InterpolationMode.HighQualityBicubic;graphics.PixelOffsetMode=PixelOffsetMode.HighQuality;
     graphics.DrawImage(pixels,new RectangleF((size-width)/2,(size-height)/2,width,height),bounds,GraphicsUnit.Pixel);
     bitmap.Save(output,ImageFormat.Png);if(output.Length<=8192)return "data:image/png;base64,"+Convert.ToBase64String(output.ToArray());
    }
   }
   return "";
  }
  internal static bool CanPublish(long captured,long current,bool suspended,bool allowed) {return captured==current&&!suspended&&allowed;}
  internal static bool SameToast(NotificationRecord expected,uint nativeId,DateTimeOffset created,string appId,string textKey) {
   return expected!=null&&expected.Id==nativeId.ToString()+":"+created.UtcTicks.ToString()&&expected.At==created&&
    !String.IsNullOrEmpty(expected.AppId)&&expected.AppId==appId&&!String.IsNullOrEmpty(expected.TextKey)&&expected.TextKey==textKey;
  }
 }
 internal interface INotificationSource : IDisposable {
  string Access {get;}
  Task<string> RequestAccessAsync(CancellationToken token);
  Task<NotificationRecord[]> ReadAsync(CancellationToken token);
  Task<NotificationPreparedActivation> PrepareActivationAsync(string id,CancellationToken token);
  bool Dismiss(string id);
  void ClearPrivateCache();
 }
 internal sealed class NotificationPreparedActivation {internal NotificationTarget Target;internal DateTimeOffset Created;}
 internal sealed class Notifications : IDisposable {
  readonly Control dispatcher;
  readonly Func<INotificationSource> sourceFactory;
  readonly Func<bool> interactiveDesktop;
  readonly System.Windows.Forms.Timer timer;
  readonly CancellationTokenSource lifetime=new CancellationTokenSource();
  CancellationTokenSource activation;
  bool dispatching;
  INotificationSource source;
  NotificationItem[] current=new NotificationItem[0];
  readonly HashSet<string> dismissed=new HashSet<string>(StringComparer.Ordinal);
  string status="unknown",access="unknown",detail="not-requested";
  bool disposed,busy,suspended,started,refreshPending;
  long generation;
  internal event Action Changed;
  internal int DiagnosticActionableCount {get{return current.Count(item=>item.canActivate);}}
  internal Notifications(Control uiDispatcher):this(uiDispatcher,null,null) {}
  // In-memory source/desktop doubles keep lifecycle tests away from real toasts
  // and Windows consent. Production always uses the native defaults.
  internal Notifications(Control uiDispatcher,Func<INotificationSource> testSource,Func<bool> testDesktop) {
   if(uiDispatcher==null)throw new ArgumentNullException("uiDispatcher");
   dispatcher=uiDispatcher;sourceFactory=testSource;interactiveDesktop=testDesktop??new Func<bool>(NotificationsPlatform.InteractiveDesktop);
   timer=new System.Windows.Forms.Timer{Interval=5000};
   timer.Tick+=delegate {Refresh();};
  }
  internal void Start() {
   RequireUiThread();if(disposed||started)return;started=true;
   SystemEvents.SessionSwitch+=SessionChanged;timer.Start();Refresh();
  }
  // Public diagnostic fields are fixed state codes, never notification content.
  internal string DiagnosticStatus {get {RequireUiThread();return status;}}
  internal string DiagnosticDetail {get {RequireUiThread();return detail;}}
  internal NotificationFeedState Snapshot() {
   RequireUiThread();
   if(!interactiveDesktop())Clear("unknown","unknown","session-locked");
   // Read a fresh permission status before disclosing a cached message. Revoking
   // access must hide messages even between periodic refreshes.
   if(source!=null&&!suspended&&status=="enabled") {
    try {var fresh=source.Access;if(fresh!="allowed")Clear(fresh=="denied"?"denied":"unknown",fresh,"permission-required");}
    catch {Clear("unknown","unknown","read-unavailable");}
   }
   var now=DateTimeOffset.UtcNow;
   current=current.Where(item=>{DateTimeOffset at;return DateTimeOffset.TryParse(item.at,out at)&&at>=now-NotificationFeedRules.MaximumAge;}).ToArray();
   return new NotificationFeedState{status=status,access=access,detail=detail,items=(NotificationItem[])current.Clone()};
  }
  internal void SetPrivacySuspended(bool value) {
   RequireUiThread();if(disposed||suspended==value)return;suspended=value;generation++;
   Clear("unknown","unknown",value?"session-locked":"checking");
   RaiseChanged();if(!value)Refresh();
  }
  internal async Task<NotificationFeedState> RequestAccessAsync() {
   RequireUiThread();
   if(disposed)return Snapshot();
   if(suspended||!interactiveDesktop()){Clear("unknown","unknown","session-locked");RaiseChanged();return Snapshot();}
   if(!EnsureSource()){RaiseChanged();return Snapshot();}
   // The only consent call in this service. Caller must be an explicit trusted
   // WebView button and must hold the shared native-modal lease until completion.
   if(busy){detail="request-in-progress";RaiseChanged();return Snapshot();}
   busy=true;long captured=++generation;
   try {
    var granted=await source.RequestAccessAsync(lifetime.Token);
    if(NotificationFeedRules.CanPublish(captured,generation,suspended,interactiveDesktop()))SetAccess(granted);
   } catch(OperationCanceledException){} catch {if(!disposed&&NotificationFeedRules.CanPublish(captured,generation,suspended,interactiveDesktop()))Clear("unknown","unknown","request-unavailable");}
   finally {busy=false;}
   if(!disposed){RaiseChanged();await RefreshAsync();}
   return Snapshot();
  }
  internal void OpenSettings() {
   RequireUiThread();if(disposed||suspended||!interactiveDesktop())return;
   // Fixed Windows URI, never a URI supplied by a notification or page message.
   try {Process.Start(new ProcessStartInfo("ms-settings:privacy-notifications"){UseShellExecute=true});} catch {detail="settings-unavailable";RaiseChanged();}
  }
  internal async Task<bool> ActivateAsync(string id,Func<bool> allowed) {
   RequireUiThread();
   for(int attempt=0;busy&&!disposed&&attempt<120;attempt++)await Task.Delay(25);
   if(disposed||busy||suspended||!allowed()||!interactiveDesktop()||source==null)return false;
   var item=Snapshot().items.FirstOrDefault(value=>value.id==id&&value.canActivate);if(item==null)return false;
   busy=true;long captured=generation;activation=CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
   try {
    var prepared=await source.PrepareActivationAsync(id,activation.Token);
    if(prepared==null||activation.IsCancellationRequested||!NotificationFeedRules.CanPublish(captured,generation,suspended,interactiveDesktop())||source.Access!="allowed"||!allowed())return false;
    dispatching=true;return await NotificationActivationPlatform.OpenAsync(prepared.Target,prepared.Created,activation.Token);
   }catch{return false;}finally{dispatching=false;activation.Dispose();activation=null;busy=false;if(!disposed)Refresh();}
  }
  internal void CancelActivation(bool force){if(activation!=null&&(force||!dispatching))activation.Cancel();}
  internal bool Dismiss(string id) {
   RequireUiThread();
   if(disposed||suspended||activation!=null||source==null||String.IsNullOrWhiteSpace(id)||id.Length>160)return false;
   if(!Snapshot().items.Any(item=>item.id==id))return false;
   try {
    if(source.Access!="allowed"||!source.Dismiss(id))return false;
    // Suppress an older asynchronous read that was captured before removal.
    // These IDs stay in memory only until the next read no longer contains them.
    dismissed.Add(id);current=current.Where(item=>item.id!=id).ToArray();
    RaiseChanged();Refresh();return true;
   }catch{return false;}
  }
  async void Refresh() {await RefreshAsync();}
  internal async Task RefreshAsync() {
   RequireUiThread();if(disposed)return;
   if(busy){refreshPending=true;return;}
   refreshPending=false;
   if(suspended||!interactiveDesktop()){Clear("unknown","unknown","session-locked");RaiseChanged();return;}
   if(!EnsureSource()){RaiseChanged();return;}
   busy=true;long captured=generation;
   try {
    var permission=source.Access;
    if(permission!="allowed"){SetAccess(permission);return;}
    SetAccess(permission);
    var records=await source.ReadAsync(lifetime.Token);
    // A lock/resume invalidates the old read, not the current permission. The
    // resume refresh is queued while busy and must run as soon as this finishes.
    if(disposed||captured!=generation)return;
    // Permission and lock state are checked again after asynchronous logo reads.
    if(suspended||!interactiveDesktop()){Clear("unknown","unknown","session-locked");}
    else if(source.Access=="allowed"){
     dismissed.IntersectWith(records.Where(item=>item!=null).Select(item=>item.Id));
     current=NotificationFeedRules.Select(records,DateTimeOffset.UtcNow,dismissed);status="enabled";access="allowed";detail="";
    } else {SetAccess(source.Access);}
   } catch(OperationCanceledException){} catch {if(!disposed&&captured==generation)Clear("unknown","unknown","read-unavailable");}
   finally {busy=false;if(!disposed){RaiseChanged();if(refreshPending)Refresh();}}
  }
  bool EnsureSource() {
   if(source!=null)return true;
   try {
    if(sourceFactory!=null){source=sourceFactory();return source!=null;}
    if(!NativeNotificationsSource.Supported()){Clear("not-supported","unknown","windows-api-unavailable");return false;}
    if(!NotificationsPlatform.HasIdentity()){Clear("identity-required","unknown","identity-required");return false;}
    source=new NativeNotificationsSource();return true;
   } catch(TypeLoadException){Clear("not-supported","unknown","windows-api-unavailable");}
   catch {Clear("unknown","unknown","listener-unavailable");}
   return false;
  }
  void SetAccess(string value) {
   if(value=="allowed"){status="enabled";access="allowed";detail="";}
   else Clear(value=="denied"?"denied":"unknown",value,"permission-required");
  }
  void Clear(string nextStatus,string nextAccess,string nextDetail) {
   CancelActivation(true);
   current=new NotificationItem[0];status=nextStatus;access=nextAccess;detail=nextDetail;
   dismissed.Clear();
   if(source!=null)source.ClearPrivateCache();
  }
  void SessionChanged(object sender,SessionSwitchEventArgs args) {
   if(args.Reason!=SessionSwitchReason.SessionLock&&args.Reason!=SessionSwitchReason.SessionUnlock&&args.Reason!=SessionSwitchReason.SessionLogoff&&args.Reason!=SessionSwitchReason.RemoteDisconnect&&args.Reason!=SessionSwitchReason.RemoteConnect)return;
   try {dispatcher.BeginInvoke((Action)delegate {if(!disposed)SetPrivacySuspended(args.Reason!=SessionSwitchReason.SessionUnlock&&args.Reason!=SessionSwitchReason.RemoteConnect);});} catch(InvalidOperationException){}
  }
  void RequireUiThread() {if(dispatcher.InvokeRequired)throw new InvalidOperationException("Notification service requires the application UI thread.");}
  void RaiseChanged() {var handler=Changed;if(handler!=null)handler();}
  public void Dispose() {
   if(disposed)return;disposed=true;generation++;timer.Stop();timer.Dispose();
   if(started)SystemEvents.SessionSwitch-=SessionChanged;
   lifetime.Cancel();current=new NotificationItem[0];dismissed.Clear();if(source!=null){source.Dispose();source=null;}lifetime.Dispose();
  }
 }
 internal static class NotificationsPlatform {
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern int GetCurrentPackageFullName(ref uint length,StringBuilder fullName);
  [DllImport("user32.dll",SetLastError=true)]static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool GetUserObjectInformation(IntPtr handle,int index,StringBuilder value,int length,out int needed);
  [DllImport("user32.dll")]static extern bool CloseDesktop(IntPtr desktop);
  internal static bool HasIdentity() {
   try {uint length=0;int result=GetCurrentPackageFullName(ref length,null);return result==122&&length>0;} catch(EntryPointNotFoundException){return false;}
  }
  internal static bool InteractiveDesktop() {
   IntPtr desktop=IntPtr.Zero;
   try {desktop=OpenInputDesktop(0,false,1);if(desktop==IntPtr.Zero)return false;int needed;var name=new StringBuilder(256);return GetUserObjectInformation(desktop,2,name,name.Capacity*2,out needed)&&String.Equals(name.ToString(),"Default",StringComparison.OrdinalIgnoreCase);}
   catch {return false;} finally {if(desktop!=IntPtr.Zero)CloseDesktop(desktop);}
  }
 }
}
