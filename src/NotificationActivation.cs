using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Xml;
using Microsoft.Win32;

namespace PaperGreen {
 // Private OS-owned activation metadata. None of these fields cross WebView,
 // HTTP, diagnostics, storage, or layout export.
 internal sealed class NotificationTarget {
  internal string AppId,Arguments,Kind;
  internal Guid Activator;
  internal uint TelegramPid;
 }
 internal sealed class NotificationHistoryEntry {
  internal string TextKey,PortraitSource,Portrait;
  internal NotificationTarget Target;
 }
 internal static class NotificationActionRules {
  internal static bool AppId(string value){return !String.IsNullOrWhiteSpace(value)&&value.Length<=256&&!value.Any(c=>Char.IsControl(c)||c=='\\'||c=='/');}
  internal static bool Telegram(string id){return id=="Telegram.TelegramDesktop"||id!=null&&id.StartsWith("Telegram.TelegramDesktop.",StringComparison.Ordinal);}
  internal static string TextKey(IEnumerable<string> texts){
   if(texts==null)return null;var values=texts.ToArray();if(values.Length==0||values.Length>8||values.Any(v=>v==null)||values.Sum(v=>v.Length)>16384)return null;
   return String.Concat(values.Select(value=>value.Length.ToString(System.Globalization.CultureInfo.InvariantCulture)+":"+value));
  }
  internal static bool WebLink(string value){Uri uri;return Uri.TryCreate(value,UriKind.Absolute,out uri)&&(uri.Scheme=="https"||uri.Scheme=="http")&&!String.IsNullOrWhiteSpace(uri.Host)&&String.IsNullOrEmpty(uri.UserInfo)&&!value.Any(Char.IsControl);}
  static Dictionary<string,string> Query(string text){
   var result=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
   foreach(var pair in text.Split('&')){int at=pair.IndexOf('=');if(at<=0)return null;string key=Uri.UnescapeDataString(pair.Substring(0,at)),value=Uri.UnescapeDataString(pair.Substring(at+1));if(result.ContainsKey(key)||key.Any(Char.IsControl)||value.Any(Char.IsControl))return null;result.Add(key,value);}return result;
  }
  internal static bool Navigation(string appId,string arguments,out uint pid){
   pid=0;if(String.IsNullOrWhiteSpace(arguments)||arguments.Length>4096||arguments.Any(Char.IsControl))return false;
   if(!Telegram(appId)&&WebLink(arguments))return true;
   Dictionary<string,string> query;try{query=Query(arguments);}catch{return false;}
   string action;if(query==null||!query.TryGetValue("action",out action))return false;
   if(!Telegram(appId))return query.Count>1&&new[]{"open","view","show","openconversation","viewconversation","openmessage","viewmessage"}.Contains(action,StringComparer.OrdinalIgnoreCase);
   if(action!="open"||query.Keys.Any(key=>!new[]{"action","pid","session","peer","topic","monoforumpeer","msg"}.Contains(key)))return false;
   string raw;ulong session,peer;long message;
   if(!query.TryGetValue("pid",out raw)||!UInt32.TryParse(raw,out pid)||pid==0||!query.TryGetValue("session",out raw)||!UInt64.TryParse(raw,out session)||session==0||!query.TryGetValue("peer",out raw)||!UInt64.TryParse(raw,out peer)||peer==0||!query.TryGetValue("msg",out raw)||!Int64.TryParse(raw,out message)||message==0)return false;
   foreach(string key in new[]{"topic","monoforumpeer"})if(query.TryGetValue(key,out raw)){ulong optional;if(!UInt64.TryParse(raw,out optional))return false;}return true;
  }
  internal static NotificationHistoryEntry Parse(string appId,string xml,Guid activator){
   if(!AppId(appId)||String.IsNullOrWhiteSpace(xml)||xml.Length>65536)return null;
   try {
    var document=new XmlDocument{XmlResolver=null};using(var reader=XmlReader.Create(new StringReader(xml),new XmlReaderSettings{DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=65536}))document.Load(reader);
    var root=document.DocumentElement;if(root==null||root.Name!="toast")return null;
    string key=TextKey(document.SelectNodes("/toast/visual/binding[@template='ToastGeneric']/text").Cast<XmlNode>().Select(node=>node.InnerText));if(key==null)return null;
    var entry=new NotificationHistoryEntry{TextKey=key};
    if(Telegram(appId)){
     var images=document.SelectNodes("/toast/visual/binding[@template='ToastGeneric']/image[@placement='appLogoOverride']");
     if(images.Count==1)entry.PortraitSource=((XmlElement)images[0]).GetAttribute("src");
    }
    string arguments=root.GetAttribute("launch"),kind=root.GetAttribute("activationType");uint pid;
    if(kind=="protocol"&&WebLink(arguments))entry.Target=new NotificationTarget{AppId=appId,Arguments=arguments,Kind="protocol"};
    else if((kind==""||kind=="foreground")&&activator!=Guid.Empty&&Navigation(appId,arguments,out pid))entry.Target=new NotificationTarget{AppId=appId,Arguments=arguments,Kind="com",Activator=activator,TelegramPid=pid};
    return entry;
   }catch{return null;}
  }
  internal static NotificationTarget Match(IEnumerable<NotificationHistoryEntry> history,string key){
   var entry=MatchEntry(history,key);return entry!=null?entry.Target:null;
  }
  internal static NotificationHistoryEntry MatchEntry(IEnumerable<NotificationHistoryEntry> history,string key){
   if(history==null||key==null)return null;var matches=history.Where(entry=>entry!=null&&entry.TextKey==key).Take(2).ToArray();return matches.Length==1?matches[0]:null;
  }
  internal static bool Same(NotificationTarget a,NotificationTarget b){return a!=null&&b!=null&&a.Kind==b.Kind&&a.AppId==b.AppId&&a.Arguments==b.Arguments&&a.Activator==b.Activator&&a.TelegramPid==b.TelegramPid;}
 }
 internal static class NotificationActivationPlatform {
  static readonly Guid TelegramActivator=new Guid("F11932D3-6110-4BBC-9B02-B2EC07A1BD19");
  internal static Guid Activator(string appId){
   if(!NotificationActionRules.AppId(appId))return Guid.Empty;
   try {using(var key=Registry.ClassesRoot.OpenSubKey("AppUserModelId\\"+appId)){Guid id;if(key!=null&&Guid.TryParse(key.GetValue("CustomActivator") as string,out id)&&id!=Guid.Empty)return id;}}catch{}
   // Telegram publishes this fixed callback CLSID in its official source and
   // shortcut. It is usable only for a currently running, original process.
   return NotificationActionRules.Telegram(appId)?TelegramActivator:Guid.Empty;
  }
  internal static bool Available(NotificationTarget target,DateTimeOffset created){
   if(target==null)return false;if(target.TelegramPid==0)return true;
   try {using(var process=Process.GetProcessById(checked((int)target.TelegramPid))){if(process.HasExited||!String.Equals(process.ProcessName,"Telegram",StringComparison.OrdinalIgnoreCase)||process.StartTime.ToUniversalTime()>created.UtcDateTime)return false;}
    var instances=Process.GetProcessesByName("Telegram");try{return instances.Length==1;}finally{foreach(var instance in instances)instance.Dispose();}
   }catch{return false;}
  }
  [ComImport,Guid("53E31837-6600-4A81-9395-75CFFE746F94"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface INotificationActivationCallback {[PreserveSig]int Activate([MarshalAs(UnmanagedType.LPWStr)]string appId,[MarshalAs(UnmanagedType.LPWStr)]string arguments,IntPtr input,uint count);}
  [DllImport("ole32.dll")]static extern int CoInitializeEx(IntPtr reserved,uint flags);
  [DllImport("ole32.dll")]static extern void CoUninitialize();
  [DllImport("ole32.dll")]static extern int CoCreateInstance(ref Guid clsid,IntPtr outer,uint context,ref Guid iid,out IntPtr result);
  [DllImport("ole32.dll")]static extern int CoAllowSetForegroundWindow([MarshalAs(UnmanagedType.IUnknown)]object value,IntPtr reserved);
  [DllImport("user32.dll")]static extern bool AllowSetForegroundWindow(uint pid);
  internal static Task<bool> OpenAsync(NotificationTarget target,DateTimeOffset created,CancellationToken token){
   // Called only after the native service revalidates a real user click.
   if(target.TelegramPid!=0)AllowSetForegroundWindow(target.TelegramPid);
   return Task.Run(()=>{
    if(token.IsCancellationRequested||!NotificationsPlatform.InteractiveDesktop()||!Available(target,created))return false;
    if(target.Kind=="protocol"){
     if(!NotificationActionRules.WebLink(target.Arguments))return false;
     try{Process.Start(new ProcessStartInfo(target.Arguments){UseShellExecute=true});return true;}catch{return false;}
    }
    int initialized=CoInitializeEx(IntPtr.Zero,0);object callback=null;IntPtr pointer=IntPtr.Zero;
    try {if(initialized<0)return false;Guid clsid=target.Activator,iid=typeof(INotificationActivationCallback).GUID;
     if(CoCreateInstance(ref clsid,IntPtr.Zero,4,ref iid,out pointer)<0||pointer==IntPtr.Zero)return false;
     callback=Marshal.GetObjectForIUnknown(pointer);CoAllowSetForegroundWindow(callback,IntPtr.Zero);
     if(token.IsCancellationRequested||!NotificationsPlatform.InteractiveDesktop()||!Available(target,created))return false;
     return ((INotificationActivationCallback)callback).Activate(target.AppId,target.Arguments,IntPtr.Zero,0)>=0;
    }catch{return false;}finally{if(callback!=null&&Marshal.IsComObject(callback))Marshal.ReleaseComObject(callback);if(pointer!=IntPtr.Zero)Marshal.Release(pointer);if(initialized>=0)CoUninitialize();}
   });
  }
 }
}
