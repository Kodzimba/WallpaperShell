using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using PaperGreen;

internal static class NotificationsTests {
 static int passed;
 static void Check(bool condition,string label){if(!condition)throw new Exception(label);passed++;}
 static NotificationRecord Record(string id,DateTimeOffset at){return new NotificationRecord{Id=id,At=at,App="Example",Sender="Synthetic sender",Text="Synthetic message"};}
 [STAThread] static void Main(){
  var now=new DateTimeOffset(2026,10,20,12,0,0,TimeSpan.Zero);
  var records=new List<NotificationRecord>();
  for(int i=0;i<30;i++)records.Add(Record(i.ToString(),now.AddMinutes(-i)));
  records.Reverse();
  var feed=NotificationFeedRules.Select(records,now);
  Check(feed.Length==20,"Only the newest 20 current notifications are shown");
  Check(feed[0].id=="0"&&feed[19].id=="19","Newest notifications lead independent of OS order");
  Check(NotificationFeedRules.Select(new[]{Record("expired",now.AddHours(-25)),Record("future",now.AddMinutes(6)),Record("today",now.AddHours(-2))},now).Single().id=="today","Expired and invalid future notifications are hidden");
  Check(NotificationFeedRules.Select(new[]{Record("same",now.AddMinutes(-2)),Record("same",now)},now).Length==1,"Duplicate Windows IDs produce one row");
  var duplicate=NotificationFeedRules.Select(new[]{Record("same",now.AddMinutes(-2)),Record("same",now)},now)[0];
  Check(duplicate.at==now.ToString("o"),"A replaced toast uses the newest version");
  Check(NotificationFeedRules.Select(null,now).Length==0,"An empty center has an empty feed");
  var dismissed=new HashSet<string>(StringComparer.Ordinal){"0","1"};
  var afterClose=NotificationFeedRules.Select(records,now,dismissed);
  Check(afterClose.Length==20&&afterClose[0].id=="2"&&afterClose[19].id=="21","Closing a row moves later notifications up before the twenty-item limit");
  Check(!NotificationFeedRules.Select(records,now,dismissed).Any(item=>item.id=="0"),"An in-flight read captured before closing cannot resurrect the closed toast");
  dismissed.IntersectWith(records.Where(record=>record.Id!="0").Select(record=>record.Id));
  Check(!dismissed.Contains("0")&&dismissed.Contains("1"),"Dismissal race IDs expire once Windows stops returning the closed toast");
  var expected=Record("42:"+now.UtcTicks.ToString(),now);expected.AppId="Example.App";expected.TextKey="Original visual signature";
  Check(!expected.CanActivate&&NotificationFeedRules.SameToast(expected,42,now,expected.AppId,expected.TextKey),"Informational notifications may close without an activation target");
  Check(!NotificationFeedRules.SameToast(expected,43,now,expected.AppId,expected.TextKey),"Closing cannot affect a different Windows ID");
  Check(!NotificationFeedRules.SameToast(expected,42,now.AddTicks(1),expected.AppId,expected.TextKey),"A recycled Windows ID with a new creation time is not closed");
  Check(!NotificationFeedRules.SameToast(expected,42,now,"Other.App",expected.TextKey),"Closing cannot affect another application's replacement toast");
  Check(!NotificationFeedRules.SameToast(expected,42,now,expected.AppId,"Updated visual signature"),"A changed toast requires a fresh visible row before closing");
  Check(!NotificationFeedRules.SameToast(null,42,now,expected.AppId,expected.TextKey),"Unobserved notifications cannot be closed");
  Check(NotificationFeedRules.Clean("\u202eA\0B\nC\tD\u2069",100)=="AB C D","Toast controls cannot spoof the surrounding UI");
  Check(NotificationFeedRules.Clean(new string('x',5000),4000).Length==4000,"Message size remains bounded");
  Check(NotificationFeedRules.Clean("a\ud83d\ude00",2)=="a","Truncation does not leave an isolated high surrogate");
  Check(NotificationFeedRules.SafeIcon("https://example.test/tracker.png")=="","Remote images cannot leave Windows/AppInfo");
  Check(NotificationFeedRules.SafeIcon("javascript:alert(1)")=="","Non-image schemes are discarded");
  var shaped=Record("id",now);shaped.App=new string('a',500);shaped.Sender=new string('b',500);shaped.Text=new string('c',5000);
  var bounded=NotificationFeedRules.Select(new[]{shaped},now).Single();
  Check(bounded.app.Length==160&&bounded.sender.Length==256&&bounded.text.Length==4000,"App/title/message limits apply to the outgoing bridge");
  Check(NotificationFeedRules.CanPublish(1,1,false,true),"A current authorized read may publish");
  Check(!NotificationFeedRules.CanPublish(1,2,false,true),"An in-flight read before a privacy transition cannot repopulate the feed");
  Check(!NotificationFeedRules.CanPublish(1,1,true,true),"A locked session cannot disclose notifications");
  Check(!NotificationFeedRules.CanPublish(1,1,false,false),"A revoked permission cannot disclose notifications");
  using(var padded=new Bitmap(64,64)) {
   using(var g=Graphics.FromImage(padded))g.FillRectangle(Brushes.CornflowerBlue,26,22,12,20);
   var bytes=Convert.FromBase64String(NotificationFeedRules.LogoPng(padded).Split(',')[1]);
   using(var stream=new MemoryStream(bytes))using(var normalized=new Bitmap(stream)) {
    Check(normalized.Width==64&&normalized.Height==64,"Notification logos retain a sharp 64px raster");
    Check(normalized.GetPixel(32,8).A>128&&normalized.GetPixel(32,55).A>128,"Transparent tile margins do not shrink the application logo");
    Check(normalized.GetPixel(5,32).A==0&&normalized.GetPixel(32,0).A==0,"Logo aspect ratio and a transparent safety inset are preserved");
   }
  }
  using(var empty=new Bitmap(64,64))Check(NotificationFeedRules.LogoPng(empty)=="","An invisible app logo uses the normal text fallback");
  Check(NotificationFeedRules.LogoPng(null)=="","A missing app logo uses the normal text fallback");
  var clsid=new Guid("00000000-0000-0000-0000-000000000001");
  var telegram="<toast launch=\"action=open&amp;pid=123&amp;session=456&amp;peer=789&amp;topic=0&amp;msg=10\"><visual><binding template=\"ToastGeneric\"><text>Test sender</text><text>Test message</text></binding></visual></toast>";
  var entry=NotificationActionRules.Parse("Telegram.TelegramDesktop",telegram,clsid);var textKey=NotificationActionRules.TextKey(new[]{"Test sender","Test message"});
  Check(entry!=null&&entry.Target!=null&&entry.Target.TelegramPid==123&&entry.Target.Arguments.Contains("peer=789"),"Telegram body activation retains original account, chat and message arguments");
  Check(NotificationActionRules.Match(new[]{entry},textKey)==entry.Target,"Only an exact visual match may expose activation");
  Check(NotificationActionRules.Match(new[]{entry,entry},textKey)==null,"Identical visible notifications never guess between different original toasts");
  Check(NotificationActionRules.Match(new[]{entry},NotificationActionRules.TextKey(new[]{"Other sender","Test message"}))==null,"A matching message from another sender is not enough");
  Check(NotificationActionRules.TextKey(new[]{"a","bc"})!=NotificationActionRules.TextKey(new[]{"ab","c"}),"Length-prefixed keys cannot collide through text separators");
  Check(NotificationActionRules.Parse("Telegram.TelegramDesktop",telegram.Replace("action=open","action=reply"),clsid).Target==null,"Reply actions cannot send messages through navigation");
  Check(NotificationActionRules.Parse("Telegram.TelegramDesktop",telegram.Replace("action=open","action=mark"),clsid).Target==null,"Mark-as-read actions are not navigation");
  Check(NotificationActionRules.Parse("Telegram.TelegramDesktop",telegram.Replace("peer=789","peer=789&amp;action=reply"),clsid).Target==null,"Duplicate action parameters are rejected");
  Check(NotificationActionRules.Parse("Telegram.TelegramDesktop",telegram.Replace("session=456","session=0"),clsid).Target==null,"Hidden account identifiers do not open a guessed chat");
  Check(NotificationActionRules.Parse("Telegram.TelegramDesktop",telegram,Guid.Empty).Target==null,"A foreground toast needs an actual native callback");
  var informational=telegram.Replace(" launch=\"action=open&amp;pid=123&amp;session=456&amp;peer=789&amp;topic=0&amp;msg=10\"","");
  Check(NotificationActionRules.Parse("SnippingTool",informational,clsid).Target==null,"Informational toasts remain noninteractive");
  var link=informational.Replace("<toast>","<toast activationType=\"protocol\" launch=\"https://example.test/conversation/123\">");
  Check(NotificationActionRules.Parse("Example.App",link,Guid.Empty).Target.Kind=="protocol","An OS-owned protocol navigation preserves the supplied target");
  Check(NotificationActionRules.Parse("Example.App",link.Replace("https://example.test/conversation/123","file:///C:/Windows/notepad.exe"),clsid).Target==null,"Notification payloads cannot launch files or commands");
  Check(NotificationActionRules.Parse("Example.App",link.Replace("https://example.test/conversation/123","powershell:execute"),clsid).Target==null,"Shell-like URI schemes are never executed");
  Check(!NotificationActionRules.WebLink("https://user:secret@example.test/chat"),"Embedded credentials cannot be forwarded to a browser");
  Check(NotificationActionRules.Parse("../Other.App",link,clsid)==null,"Registry lookup cannot escape the native app identity");
  Check(NotificationActionRules.Parse("Example.App","<!DOCTYPE toast [<!ENTITY x SYSTEM 'file:///private'>]><toast/>",clsid)==null,"Toast parsing does not read external entities");
  Check(NotificationActionRules.Parse("Example.App",new string('x',65537),clsid)==null,"History payload parsing is bounded");
  var activated=Record("id",now);activated.CanActivate=true;activated.AppId="Private.AppId";activated.TextKey="Private key";
  Check(NotificationFeedRules.Select(new[]{activated},now)[0].canActivate,"Trusted WebView receives only the activation capability flag");
  Check(typeof(NotificationItem).GetProperties().All(property=>property.Name!="Arguments"&&property.Name!="AppId"&&property.Name!="Target"&&property.Name!="TextKey"),"Activation arguments and raw native identities never cross the WebView contract");
  Check(NotificationActionRules.Match(new[]{entry,new NotificationHistoryEntry{TextKey=textKey}},textKey)==null,"An inert duplicate still makes target matching ambiguous");
  Check(NotificationActionRules.Parse("Telegram.TelegramDesktop",telegram.Replace("<toast ","<toast activationType=\"background\" "),clsid).Target==null,"Background actions cannot run from notification clicks");
  Portraits(now);
  // No UserNotificationListener call: native privacy/identity can be checked
  // independently and prints only booleans in an optional manual probe.
  using(var dispatcher=new Control()) {
   var handle=dispatcher.Handle;
   SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
   var lifecycle=Lifecycle(dispatcher);var deadline=DateTime.UtcNow.AddSeconds(10);
   while(!lifecycle.IsCompleted){if(DateTime.UtcNow>deadline)throw new Exception("Notification lifecycle test timed out");Application.DoEvents();Thread.Sleep(1);}
   lifecycle.GetAwaiter().GetResult();
  }
  Console.WriteLine("Notification rules/lifecycle: "+passed+" checks passed; no live notification access or consent.");
 }
 static void Portraits(DateTimeOffset now) {
  var root=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"portrait-fixtures",Guid.NewGuid().ToString("N"));
  var temp=Path.Combine(root,"tdata","temp");Directory.CreateDirectory(temp);
  try {
   var path=Path.Combine(temp,"a12f.png");string source=new Uri(path).AbsoluteUri,parsed;
   string xml="<toast><visual><binding template=\"ToastGeneric\"><image placement=\"appLogoOverride\" hint-crop=\"circle\" src=\""+source+"\"/><text>Synthetic person</text><text>Synthetic text</text></binding></visual></toast>";
   var portrait=NotificationActionRules.Parse("Telegram.TelegramDesktop",xml,Guid.Empty);
   Check(portrait!=null&&portrait.Target==null&&portrait.PortraitSource==source,"A portrait does not depend on an activation capability");
   Check(NotificationActionRules.Parse("Other.App",xml,Guid.Empty).PortraitSource==null,"Another app cannot opt into Telegram file access");
   var hero=xml.Replace("appLogoOverride","hero");
   Check(String.IsNullOrEmpty(NotificationActionRules.Parse("Telegram.TelegramDesktop",hero,Guid.Empty).PortraitSource),"Message attachments/hero images are not sender portraits");
   var doubled=xml.Replace("<text>Synthetic person", "<image placement=\"appLogoOverride\" src=\"file:///C:/elsewhere.png\"/><text>Synthetic person");
   Check(String.IsNullOrEmpty(NotificationActionRules.Parse("Telegram.TelegramDesktop",doubled,Guid.Empty).PortraitSource),"Ambiguous portrait elements are not guessed");
   Check(NotificationActionRules.MatchEntry(new[]{portrait,portrait},portrait.TextKey)==null,"Identical visible messages never borrow another sender's portrait");
   Check(NotificationPortrait.TryPath(source,new[]{temp},out parsed)&&parsed==path,"Only the exact generated local PNG in an approved Telegram temp directory is eligible");
   foreach(string invalid in new[]{"https://example.test/avatar.png","data:image/png;base64,abc","file://server/share/a12f.png","file://localhost/C:/a12f.png",new Uri(Path.Combine(root,"a12f.png")).AbsoluteUri,new Uri(Path.Combine(temp,"fast_reply.png")).AbsoluteUri,source+"?track=1",source+"#avatar",source+":hidden"})
    Check(!NotificationPortrait.TryPath(invalid,new[]{temp},out parsed),"Remote, unrelated or decorated portrait sources are rejected");
   byte[] png;
   using(var bitmap=new Bitmap(128,64))using(var graphics=Graphics.FromImage(bitmap))using(var output=new MemoryStream()) {
    graphics.Clear(Color.CornflowerBlue);graphics.FillRectangle(Brushes.Lime,32,0,64,64);bitmap.Save(output,System.Drawing.Imaging.ImageFormat.Png);png=output.ToArray();
   }
   File.WriteAllBytes(path,png);string loaded=NotificationPortrait.Load(source,new[]{temp});
   Check(loaded.StartsWith("data:image/png;base64,"),"The real loader reads its own synthetic toast PNG into a bounded data URL");
   using(var input=new MemoryStream(Convert.FromBase64String(loaded.Split(',')[1])))using(var image=new Bitmap(input)) {
    Check(image.Width==64&&image.Height==64&&image.GetPixel(32,32).G>240,"A portrait is a sharp square centered on the source image");
    Check(image.GetPixel(2,32).A>240&&image.GetPixel(2,32).G>240,"Portraits fill the frame without application-logo padding");
   }
   var oversized=(byte[])png.Clone();oversized[16]=1;
   Check(NotificationPortrait.Normalize(oversized)=="","Oversized dimensions are rejected before image decoding");
   Check(NotificationPortrait.Normalize(new byte[131073])==""&&NotificationPortrait.Normalize(new byte[24])=="","Corrupt/non-PNG and oversized file payloads use the fallback");
   File.Delete(path);Check(NotificationPortrait.Load(source,new[]{temp})=="","An expired Telegram temp image fails without breaking the feed");
   var record=Record("portrait",now);record.Icon=loaded;record.Portrait=true;
   var item=NotificationFeedRules.Select(new[]{record},now).Single();
   Check(item.portrait&&item.icon==loaded,"The private WebView receives pixels and a shape flag");
   record.Icon="file:///C:/private/a12f.png";
   Check(!NotificationFeedRules.Select(new[]{record},now).Single().portrait,"A native path never crosses the WebView as a portrait");
   Check(typeof(NotificationItem).GetProperties().All(property=>property.Name!="PortraitSource"&&property.Name!="Path"),"Portrait paths never enter the public bridge contract");
  }finally{Directory.Delete(root,true);}
 }
 sealed class FakeSource:INotificationSource {
  internal string Permission="allowed";
  internal TaskCompletionSource<string> Consent;
  internal readonly List<TaskCompletionSource<NotificationRecord[]>> Reads=new List<TaskCompletionSource<NotificationRecord[]>>();
  public string Access {get{return Permission;}}
  public Task<string> RequestAccessAsync(CancellationToken token){return Consent==null?Task.FromResult(Permission):Consent.Task;}
  public Task<NotificationRecord[]> ReadAsync(CancellationToken token){var read=new TaskCompletionSource<NotificationRecord[]>();Reads.Add(read);return read.Task;}
  public Task<NotificationPreparedActivation> PrepareActivationAsync(string id,CancellationToken token){return Task.FromResult<NotificationPreparedActivation>(null);}
  public bool Dismiss(string id){return false;}
  public void ClearPrivateCache(){}
  public void Dispose(){}
 }
 static async Task Lifecycle(Control dispatcher) {
  var now=DateTimeOffset.UtcNow;
  var source=new FakeSource();
  source.Consent=new TaskCompletionSource<string>();
  using(var notifications=new Notifications(dispatcher,()=>source,()=>true)) {
   bool obsoleteFailure=false;notifications.Changed+=delegate {if(notifications.DiagnosticDetail=="request-unavailable")obsoleteFailure=true;};
   var pending=notifications.RequestAccessAsync();notifications.SetPrivacySuspended(true);
   source.Consent.SetException(new Exception("Synthetic obsolete consent failure"));await pending;
   Check(!obsoleteFailure&&notifications.DiagnosticDetail=="session-locked","A consent failure from before the lock cannot overwrite privacy state even transiently");
   Check(source.Reads.Count==0,"A locked consent completion does not start a source read");
  }
  source=new FakeSource();
  using(var notifications=new Notifications(dispatcher,()=>source,()=>true)) {
   bool falsePermission=false;notifications.Changed+=delegate {if(notifications.DiagnosticDetail=="permission-required")falsePermission=true;};
   var oldRead=notifications.RefreshAsync();
   Check(source.Reads.Count==1,"The initial source read starts once");
   notifications.SetPrivacySuspended(true);notifications.SetPrivacySuspended(false);
   Check(source.Reads.Count==1,"Resume coalesces behind an in-flight read");
   source.Reads[0].SetResult(new[]{Record("old-private-read",now)});await oldRead;
   Check(source.Reads.Count==2,"Resume immediately starts a fresh read without waiting for the poll timer");
   Check(!notifications.Snapshot().items.Any(item=>item.id=="old-private-read"),"A pre-lock read never repopulates the resumed feed");
   Check(!falsePermission,"A stale read cannot fabricate a permission request");
   source.Reads[1].SetResult(new[]{Record("after-resume",now)});await Task.Yield();
   Check(notifications.Snapshot().items.Single().id=="after-resume","The fresh resumed notification appears");
  }
  source=new FakeSource();
  using(var notifications=new Notifications(dispatcher,()=>source,()=>true)) {
   var pending=notifications.RefreshAsync();
   for(int i=0;i<20;i++)await notifications.RefreshAsync();
   source.Reads[0].SetResult(new NotificationRecord[0]);await pending;
   Check(source.Reads.Count==2,"Many refresh requests during a read coalesce into one next read");
   source.Reads[1].SetResult(new[]{Record("latest",now)});await Task.Yield();
   Check(source.Reads.Count==2&&notifications.Snapshot().items.Single().id=="latest","A drained refresh queue does not create an endless polling loop");
  }
  source=new FakeSource();
  using(var notifications=new Notifications(dispatcher,()=>source,()=>true)) {
   var pending=notifications.RefreshAsync();notifications.SetPrivacySuspended(true);
   source.Reads[0].SetException(new Exception("Synthetic obsolete read failure"));await pending;
   Check(notifications.DiagnosticDetail=="session-locked"&&notifications.Snapshot().items.Length==0,"An obsolete failure cannot overwrite a privacy lock");
   Check(source.Reads.Count==1,"Remaining locked does not start another source read");
  }
  source=new FakeSource();
  using(var notifications=new Notifications(dispatcher,()=>source,()=>true)) {
   var pending=notifications.RefreshAsync();source.Permission="denied";
   source.Reads[0].SetResult(new[]{Record("revoked-private-read",now)});await pending;
   var denied=notifications.Snapshot();
   Check(denied.status=="denied"&&denied.access=="denied"&&denied.items.Length==0,"Actual revocation during a read stays denied and discloses no content");
  }
  bool interactive=true;source=new FakeSource();
  using(var notifications=new Notifications(dispatcher,()=>source,()=>interactive)) {
   var pending=notifications.RefreshAsync();interactive=false;
   source.Reads[0].SetResult(new[]{Record("secure-desktop-private-read",now)});await pending;
   Check(notifications.DiagnosticDetail=="session-locked"&&notifications.Snapshot().items.Length==0,"An input desktop change still blocks an in-flight read");
  }
 }
}
