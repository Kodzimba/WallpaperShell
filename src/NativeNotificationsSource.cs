using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.Foundation.Metadata;
using Windows.Storage.Streams;
using Windows.UI.Notifications;
using Windows.UI.Notifications.Management;

namespace PaperGreen {
 // Official Windows APIs and the exact local Telegram userpic named by a toast.
 // No notification database, network, subprocess or private-content logging.
 // RemoveNotification is used only
 // for an explicit close button, never reply/mark/clear-all or activation.
 internal sealed class NativeNotificationsSource : INotificationSource {
  readonly UserNotificationListener listener;
  readonly Dictionary<string,string> logos=new Dictionary<string,string>(StringComparer.Ordinal);
  readonly Dictionary<string,string> portraits=new Dictionary<string,string>(StringComparer.Ordinal);
  readonly Dictionary<string,NotificationPreparedActivation> targets=new Dictionary<string,NotificationPreparedActivation>(StringComparer.Ordinal);
  readonly Dictionary<string,string> textKeys=new Dictionary<string,string>(StringComparer.Ordinal);
  readonly Dictionary<string,NotificationRecord> observed=new Dictionary<string,NotificationRecord>(StringComparer.Ordinal);
  Task<Dictionary<string,NotificationHistoryEntry[]>> historyTask;
  long generation;
  bool disposed;
  [MethodImpl(MethodImplOptions.NoInlining)]
  internal static bool Supported() {return ApiInformation.IsTypePresent("Windows.UI.Notifications.Management.UserNotificationListener");}
  internal NativeNotificationsSource() {listener=UserNotificationListener.Current;}
  public string Access {get {return AccessName(listener.GetAccessStatus());}}
  static string AccessName(UserNotificationListenerAccessStatus status) {
   return status==UserNotificationListenerAccessStatus.Allowed?"allowed":status==UserNotificationListenerAccessStatus.Denied?"denied":"unknown";
  }
  public async Task<string> RequestAccessAsync(CancellationToken token) {
   if(disposed)throw new ObjectDisposedException("NativeNotificationsSource");
   // Notifications.RequestAccessAsync is called on WinForms' UI thread. This
   // expression must stay before any await or Task.Run.
   return AccessName(await Complete(listener.RequestAccessAsync(),TimeSpan.FromMinutes(2),token));
  }
  public async Task<NotificationRecord[]> ReadAsync(CancellationToken token) {
   long captured=generation;
   if(disposed||Access!="allowed")return new NotificationRecord[0];
   var notifications=await Complete(listener.GetNotificationsAsync(NotificationKinds.Toast),TimeSpan.FromSeconds(5),token);
   var now=DateTimeOffset.UtcNow;
   var result=new List<NotificationRecord>();
   var candidates=new List<Tuple<UserNotification,DateTimeOffset>>();
   foreach(var toast in notifications){try {var at=toast.CreationTime;if(at>=now-NotificationFeedRules.MaximumAge&&at<=now.AddMinutes(5))candidates.Add(Tuple.Create(toast,at));}catch {}}
   foreach(var candidate in candidates.OrderByDescending(n=>n.Item2).Take(100)) {
    var toast=candidate.Item1;var created=candidate.Item2;
    token.ThrowIfCancellationRequested();if(disposed)break;
    try {
     var binding=toast.Notification.Visual.GetBinding(KnownNotificationBindings.ToastGeneric);
     if(binding==null)continue;
     var elements=binding.GetTextElements();
     string title=elements.Count>0?elements[0].Text:"";
     string body=String.Join(" ",elements.Skip(1).Select(element=>element.Text));
     if(String.IsNullOrWhiteSpace(title)&&String.IsNullOrWhiteSpace(body))continue;
     string app=toast.AppInfo.DisplayInfo.DisplayName;
     string appId=toast.AppInfo.AppUserModelId;
     result.Add(new NotificationRecord {Id=toast.Id.ToString()+":"+created.UtcTicks.ToString(),App=app,AppId=appId,TextKey=NotificationActionRules.TextKey(elements.Select(element=>element.Text)),Sender=title,Text=body,At=created,Icon=await Logo(toast.AppInfo.DisplayInfo,appId,token)});
     if(result.Count>=NotificationFeedRules.MaximumItems)break;
    } catch(OperationCanceledException){throw;} catch { /* A malformed toast cannot hide the rest. */ }
   }
   var histories=await HistoryAsync(result.Select(item=>item.AppId),result.Select(item=>item.TextKey),token,true);
   if(disposed||captured!=generation||Access!="allowed"){ClearPrivateCache();return new NotificationRecord[0];}
   targets.Clear();textKeys.Clear();observed.Clear();portraits.Clear();
   foreach(var record in result){
    observed[record.Id]=record;NotificationHistoryEntry[] entries;if(!histories.TryGetValue(record.AppId,out entries))continue;
    var entry=NotificationActionRules.MatchEntry(entries,record.TextKey);if(entry==null)continue;
    if(NotificationActionRules.Telegram(record.AppId)&&!String.IsNullOrEmpty(entry.Portrait)){
     record.Icon=entry.Portrait;record.Portrait=true;portraits[entry.PortraitSource]=entry.Portrait;
    }
    var target=entry.Target;if(!NotificationActivationPlatform.Available(target,record.At))continue;
    record.CanActivate=true;targets[record.Id]=new NotificationPreparedActivation{Target=target,Created=record.At};textKeys[record.Id]=record.TextKey;
   }
   return result.ToArray();
  }
  async Task<Dictionary<string,NotificationHistoryEntry[]>> HistoryAsync(IEnumerable<string> apps,IEnumerable<string> keys,CancellationToken token,bool includePortraits=false) {
   var empty=new Dictionary<string,NotificationHistoryEntry[]>(StringComparer.Ordinal);
   if(historyTask!=null&&!historyTask.IsCompleted)return empty;
   var ids=apps.Where(NotificationActionRules.AppId).Distinct().Take(20).ToArray();var wanted=new HashSet<string>(keys.Where(key=>key!=null),StringComparer.Ordinal);
   var cachedPortraits=new Dictionary<string,string>(portraits,StringComparer.Ordinal);
   var portraitRoots=includePortraits&&ids.Any(NotificationActionRules.Telegram)?NotificationPortrait.TelegramTempRoots():new string[0];
   var read=Task.Run(()=>{
    var result=new Dictionary<string,NotificationHistoryEntry[]>(StringComparer.Ordinal);
    var deadline=DateTime.UtcNow.AddMilliseconds(500);
    foreach(string id in ids){if(token.IsCancellationRequested||DateTime.UtcNow>deadline)break;try{
     var history=ToastNotificationManager.History.GetHistory(id);if(history.Count>256)continue;
     var entries=new List<NotificationHistoryEntry>();Guid activator=NotificationActivationPlatform.Activator(id);bool complete=true;
     foreach(var toast in history){if(token.IsCancellationRequested||DateTime.UtcNow>deadline){complete=false;break;}try{if(toast.ExpirationTime.HasValue&&toast.ExpirationTime.Value<DateTimeOffset.UtcNow)continue;var entry=NotificationActionRules.Parse(id,toast.Content.GetXml(),activator);if(entry==null){complete=false;break;}if(wanted.Contains(entry.TextKey)&&entries.Count(existing=>existing.TextKey==entry.TextKey)<2)entries.Add(entry);}catch{complete=false;break;}}
     if(complete){
      if(includePortraits&&NotificationActionRules.Telegram(id))foreach(var group in entries.GroupBy(entry=>entry.TextKey)){
       if(token.IsCancellationRequested||DateTime.UtcNow>deadline)break;
       if(group.Count()!=1)continue;var entry=group.Single();if(String.IsNullOrEmpty(entry.PortraitSource))continue;
       string cached;entry.Portrait=cachedPortraits.TryGetValue(entry.PortraitSource,out cached)?cached:NotificationPortrait.Load(entry.PortraitSource,portraitRoots);
      }
      result[id]=entries.ToArray();
     }
    }catch{}}
    return result;
   });historyTask=read;
   return await Task.WhenAny(read,Task.Delay(2000,token))==read?await read:empty;
  }
  public async Task<NotificationPreparedActivation> PrepareActivationAsync(string id,CancellationToken token) {
   NotificationPreparedActivation expected;string key;long captured=generation;
   if(disposed||Access!="allowed"||!targets.TryGetValue(id,out expected)||!textKeys.TryGetValue(id,out key))return null;
   uint osId;int at=id.IndexOf(':');if(at<=0||!UInt32.TryParse(id.Substring(0,at),out osId))return null;
   try{
    var toast=listener.GetNotification(osId);if(toast==null||toast.CreationTime!=expected.Created||toast.AppInfo.AppUserModelId!=expected.Target.AppId)return null;
    var visual=toast.Notification.Visual.GetBinding(KnownNotificationBindings.ToastGeneric);if(visual==null||NotificationActionRules.TextKey(visual.GetTextElements().Select(element=>element.Text))!=key)return null;
    var histories=await HistoryAsync(new[]{expected.Target.AppId},new[]{key},token);NotificationHistoryEntry[] entries;
    if(disposed||captured!=generation||Access!="allowed"||!histories.TryGetValue(expected.Target.AppId,out entries))return null;
    var fresh=NotificationActionRules.Match(entries,key);if(!NotificationActionRules.Same(expected.Target,fresh)||!NotificationActivationPlatform.Available(fresh,expected.Created))return null;
    return new NotificationPreparedActivation{Target=fresh,Created=expected.Created};
   }catch{return null;}
  }
  public bool Dismiss(string id) {
   NotificationRecord expected;
   if(disposed||Access!="allowed"||id==null||!observed.TryGetValue(id,out expected))return false;
   uint osId;int separator=id.IndexOf(':');if(separator<=0||!UInt32.TryParse(id.Substring(0,separator),out osId))return false;
   try {
    var toast=listener.GetNotification(osId);
    if(toast!=null){
     var visual=toast.Notification.Visual.GetBinding(KnownNotificationBindings.ToastGeneric);
     if(visual==null||!NotificationFeedRules.SameToast(expected,toast.Id,toast.CreationTime,toast.AppInfo.AppUserModelId,NotificationActionRules.TextKey(visual.GetTextElements().Select(element=>element.Text))))return false;
     if(Access!="allowed"||!NotificationsPlatform.InteractiveDesktop())return false;
     listener.RemoveNotification(osId);
    }
    observed.Remove(id);targets.Remove(id);textKeys.Remove(id);return true;
   }catch{return false;}
  }
  async Task<string> Logo(Windows.ApplicationModel.AppDisplayInfo display,string id,CancellationToken token) {
   string cached;if(logos.TryGetValue(id??"",out cached))return cached;
   string encoded="";
   try {
    using(var stream=await Complete(display.GetLogo(new Windows.Foundation.Size(64,64)).OpenReadAsync(),TimeSpan.FromSeconds(2),token)) {
     if(stream.Size>0&&stream.Size<=131072) {
      using(var reader=new DataReader(stream)) {
       uint length=(uint)stream.Size;uint loaded=await Complete(reader.LoadAsync(length),TimeSpan.FromSeconds(2),token);
       if(loaded==length){var bytes=new byte[length];reader.ReadBytes(bytes);
        // Normalize to a bounded PNG; no resource file or remote URL escapes.
        using(var input=new MemoryStream(bytes))using(var image=Image.FromStream(input)) {
         encoded=NotificationFeedRules.LogoPng(image);
        }
       }
      }
     }
    }
   } catch(OperationCanceledException){throw;} catch { }
   if(!disposed&&logos.Count<64)logos[id??""]=encoded;
   return encoded;
  }
  // OS WinMetadata is available without Windows SDK. Avoid the framework's
  // GetAwaiter/AsTask facade which requires SDK Windows.winmd; use the official
  // operation directly. The asynchronous delay yields the UI message loop.
  static async Task<T> Complete<T>(IAsyncOperation<T> operation,TimeSpan timeout,CancellationToken token) {
   DateTime until=DateTime.UtcNow+timeout;
   try {
    while(operation.Status==AsyncStatus.Started) {
     token.ThrowIfCancellationRequested();if(DateTime.UtcNow>=until)throw new TimeoutException("Windows notification operation timed out.");
     await Task.Delay(30,token);
    }
    token.ThrowIfCancellationRequested();
    if(operation.Status!=AsyncStatus.Completed)throw new InvalidOperationException("Windows notification operation unavailable.");
    return operation.GetResults();
   } finally {try {if(operation.Status==AsyncStatus.Started)operation.Cancel();operation.Close();}catch {}}
  }
  public void ClearPrivateCache(){generation++;logos.Clear();portraits.Clear();targets.Clear();textKeys.Clear();observed.Clear();}
  public void Dispose(){disposed=true;ClearPrivateCache();}
 }
}
