using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using PaperGreen;

class NativeSecurityTests {
 static int checks;static bool junctionTested,fileLinkTested;
 static void Check(bool value,string name){checks++;if(!value)throw new Exception(name);}
 static void Reject(Action action,string name){bool rejected=false;try{action();}catch{rejected=true;}Check(rejected,name);}
 static Dictionary<string,object> Object(string json){return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(json);}
 static void Projection(){
  const string privateValue="SYNTHETIC_PRIVATE_SENTINEL";
  var input=Object("{\"profile\":\"display-1\",\"frames\":42,\"viewport\":[1920,1080],\"contextLost\":false,\"scene\":\"luna-water\",\"audioPeak\":0.2,\"surface\":{\"monitorId\":\"SYNTHETIC_PRIVATE_SENTINEL\"},\"windows\":[{\"title\":\"SYNTHETIC_PRIVATE_SENTINEL\"}],\"notifications\":[{\"text\":\"SYNTHETIC_PRIVATE_SENTINEL\"}],\"sources\":{\"weather\":\"ok\",\"unknownProvider\":\"SYNTHETIC_PRIVATE_SENTINEL\"},\"windowPolicy\":{\"mounted\":true,\"modal\":\"update\",\"surface\":{\"ownerHandle\":\"SYNTHETIC_PRIVATE_SENTINEL\"}},\"layout\":{\"theme\":\"luna-blue\",\"revision\":4,\"widgetCount\":15,\"status\":\"saved\",\"profile\":\"display-1\",\"customWidgets\":[{\"text\":\"SYNTHETIC_PRIVATE_SENTINEL\"}],\"builder\":{\"mounted\":true,\"customWidgets\":3,\"messages\":[\"SYNTHETIC_PRIVATE_SENTINEL\"],\"status\":\"saved\"},\"desktopHub\":{\"windowCount\":4,\"notificationCount\":2,\"notificationStatus\":\"enabled\",\"items\":[\"SYNTHETIC_PRIVATE_SENTINEL\"],\"title\":\"SYNTHETIC_PRIVATE_SENTINEL\"},\"editor\":{\"editing\":true,\"selected\":\"clock\",\"history\":{\"canUndo\":true,\"undoCount\":2,\"document\":\"SYNTHETIC_PRIVATE_SENTINEL\"}},\"transfer\":{\"mounted\":true,\"filename\":\"SYNTHETIC_PRIVATE_SENTINEL\"}}}");
  var safe=NativeDiagnostics.Project(input);string text=new JavaScriptSerializer().Serialize(safe);
  Check(safe!=null&&Convert.ToDouble(safe["frames"])==42,"Safe renderer counters survive native telemetry projection");
  Check(!text.Contains(privateValue),"Private titles, notifications, device IDs, custom content, history documents and filenames never reach native persisted output");
  Check(!safe.ContainsKey("surface")&&!safe.ContainsKey("windows")&&!safe.ContainsKey("notifications"),"Unapproved top-level private structures are dropped");
  var layout=(Dictionary<string,object>)safe["layout"];var hub=(Dictionary<string,object>)layout["desktopHub"];
  Check(Convert.ToDouble(hub["windowCount"])==4&&Convert.ToDouble(hub["notificationCount"])==2,"Aggregate private-feed counts remain useful");
  Check(!hub.ContainsKey("items")&&!hub.ContainsKey("title"),"Private feed payloads are never copied through nested dictionaries");
  Check((string)layout["theme"]=="luna-blue"&&(string)layout["status"]=="saved","Known theme and state enums survive");
  Check(!((Dictionary<string,object>)safe["windowPolicy"]).ContainsKey("surface"),"Native window handles and monitor identifiers are excluded");
  Check(NativeDiagnostics.Project(new[]{"private"})==null&&NativeDiagnostics.Project(null)==null,"Non-object diagnostics fail closed");
  Check(NativeDiagnostics.Project(Object("{\"privateOnly\":\"value\"}"))==null,"An unknown-only diagnostic envelope is not persisted");
  var invalid=Object("{\"scene\":\"SYNTHETIC_PRIVATE_SENTINEL\",\"frames\":\"42\",\"contextLost\":1,\"audioPeak\":200,\"viewport\":[1920,\"SYNTHETIC_PRIVATE_SENTINEL\"],\"sources\":{\"weather\":\"SYNTHETIC_PRIVATE_SENTINEL\"},\"layout\":{\"status\":\"SYNTHETIC_PRIVATE_SENTINEL\",\"editor\":{\"selected\":\"SYNTHETIC_PRIVATE_SENTINEL\"}}}");
  Check(NativeDiagnostics.Project(invalid)==null,"Free-form strings, numeric strings, wrong booleans, invalid arrays and unknown nested state fields are rejected");
  invalid=new Dictionary<string,object>{{"frames",Double.NaN},{"audioPeak",Double.PositiveInfinity},{"waterFps",-1},{"barHeight",Double.MaxValue}};
  Check(NativeDiagnostics.Project(invalid)==null,"Non-finite, negative and unbounded numeric diagnostics are discarded");
  var nullable=NativeDiagnostics.Project(Object("{\"glError\":null,\"audioAge\":null,\"windowPolicy\":{\"modal\":null}}"));
  Check(nullable.ContainsKey("glError")&&nullable["glError"]==null,"Unknown diagnostic measurements stay null");
 }
 static void Boundaries(){
  var gate=new NativeDiagnosticsGate(1000);
  Check(gate.Allow("display-1",0),"First own Surface telemetry packet may be written");
  Check(!gate.Allow("display-1",1)&&!gate.Allow("display-1",999),"WebView cannot flood disk with diagnostic packets");
  Check(gate.Allow("display-1",1000)&&gate.Allow("display-2",0),"Each own Surface gets an independent bounded telemetry interval");
  Check(!gate.Allow("unknown-profile",9000)&&!gate.Allow("../escape",9000)&&!gate.Allow("display-1",-1),"Unrecognized profiles and invalid timestamps never create diagnostic files");
  Check(NativeWebMessages.Bounded(new string(' ',NativeWebMessages.MaxJsonCharacters)),"Bounded native envelope still accommodates a portable layout export");
  Check(!NativeWebMessages.Bounded(new string(' ',NativeWebMessages.MaxJsonCharacters+1))&&!NativeWebMessages.Bounded(null),"Oversized WebView messages are rejected before native JSON parsing");
  Check(NativeWebMessages.WeatherLink("https://open-meteo.com/"),"Explicit fixed attribution link remains available");
  foreach(string url in new[]{"http://open-meteo.com/","https://open-meteo.com/?private=synthetic","https://open-meteo.com/#synthetic","https://open-meteo.com:8443/","https://user@open-meteo.com/","https://open-meteo.com.evil.test/"})Check(!NativeWebMessages.WeatherLink(url),"Attribution cannot launch a credential-bearing, alternate-port or data-bearing external URL");
  foreach(string url in new[]{"http://127.0.0.1:8767/index.html?profile=display-1","http://127.0.0.1:8767/classic/index.html","http://127.0.0.1:8767/luna-blue/index.html"})Check(LayoutFiles.IsTrustedPage(url),"Only known own main pages can issue native requests");
  foreach(string url in new[]{"http://127.0.0.1:8767/controls","http://127.0.0.1:8767/index.html/extra","http://127.0.0.1:8767/%69ndex.html","http://127.0.0.1:8767/index.html.evil","http://127.0.0.1.evil.test:8767/index.html","http://user:pass@127.0.0.1:8767/index.html","http://127.0.0.1:8767/luna-blue/launcher-overlay.html","file:///index.html","data:text/html,synthetic"})Check(!LayoutFiles.IsTrustedPage(url),"Foreign origins, credentials, encoded aliases, popups and unrecognized paths cannot issue native requests");
  foreach(string text in new[]{"0.2.0\n","0.2.0\r\n","0.2.0 ","0.2.0\0"})Check(UpdateFiles.Version(text)==null,"Stable versions reject trailing control and whitespace suffixes");
  Check(UpdateFiles.Digest(new string('a',64))&&!UpdateFiles.Digest(new string('a',64)+"\n"),"SHA256 validator consumes the complete string");
  Check(UpdateFiles.Token(new string('a',32))&&!UpdateFiles.Token(new string('a',32)+"\n"),"Installer nonce validator consumes the complete string");
  string config="{\"schemaVersion\":1,\"version\":\"0.2.0\",\"repository\":\"owner/repo\\n\",\"assetName\":\"WallpaperShell-win-x64.zip\"}";
  Reject(()=>AppUpdateConfig.Parse(config),"Repository configuration rejects newline suffixes");
 }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool DeviceIoControl(IntPtr file,uint code,byte[] input,int inputLength,IntPtr output,int outputLength,out int returned,IntPtr overlapped);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.I1)]static extern bool CreateSymbolicLink(string link,string target,uint flags);
 static bool Junction(string link,string target){
  Directory.CreateDirectory(link);byte[] substitute=Encoding.Unicode.GetBytes(@"\??\"+target),print=Encoding.Unicode.GetBytes(target),buffer=new byte[16+substitute.Length+2+print.Length+2];
  Buffer.BlockCopy(BitConverter.GetBytes(unchecked((int)0xa0000003)),0,buffer,0,4);Buffer.BlockCopy(BitConverter.GetBytes((ushort)(buffer.Length-8)),0,buffer,4,2);Buffer.BlockCopy(BitConverter.GetBytes((ushort)substitute.Length),0,buffer,10,2);Buffer.BlockCopy(BitConverter.GetBytes((ushort)(substitute.Length+2)),0,buffer,12,2);Buffer.BlockCopy(BitConverter.GetBytes((ushort)print.Length),0,buffer,14,2);Buffer.BlockCopy(substitute,0,buffer,16,substitute.Length);Buffer.BlockCopy(print,0,buffer,16+substitute.Length+2,print.Length);
  IntPtr handle=CreateFile(link,0x40000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero);if(handle==new IntPtr(-1))return false;try{int returned;return DeviceIoControl(handle,0x000900a4,buffer,buffer.Length,IntPtr.Zero,0,out returned,IntPtr.Zero);}finally{CloseHandle(handle);}
 }
 static void ReparsePaths(){
  string root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"security-fixture-"+Guid.NewGuid().ToString("N")));Directory.CreateDirectory(root);
  string junction=Path.Combine(root,"junction"),fileLink=Path.Combine(root,"file-link");
  try{
   UpdateFiles.NoReparse(Path.Combine(root,"ordinary-missing","file"));Check(true,"A missing ordinary stage path remains creatable");
   if(Junction(junction,Path.Combine(root,"missing-target"))){junctionTested=true;Reject(()=>UpdateFiles.NoReparse(junction),"Dangling directory reparse entry is rejected directly");Reject(()=>UpdateFiles.Under(root,"junction/child.exe"),"Missing target through a reparse ancestor cannot escape stage validation");Reject(()=>PrivateBootstrap.EnsurePrivate(junction),"Private storage rejects dangling reparse root before creating directories or changing ACLs");}
   if(CreateSymbolicLink(fileLink,Path.Combine(root,"missing-file"),2)){fileLinkTested=true;Reject(()=>UpdateFiles.NoReparse(fileLink),"Dangling file symbolic link is rejected directly");}
  }finally{
   string expected=Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;if(!root.StartsWith(expected,StringComparison.OrdinalIgnoreCase))throw new Exception("Unsafe security fixture cleanup");
   if(junctionTested)Directory.Delete(junction,false);if(fileLinkTested)File.Delete(fileLink);if(Directory.Exists(root))Directory.Delete(root,true);
  }
 }
 [STAThread]static void Main(){Projection();Boundaries();ReparsePaths();Console.WriteLine("Native security: "+checks+" checks passed; dangling-junction fixture="+junctionTested+", dangling-file-link fixture="+fileLinkTested+"; no installed app, UI, notification, update helper or downloaded code executed.");}
}
