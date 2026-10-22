using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading;
using PaperGreen;

class AppUpdatesTests {
 static int count;static string home;
 static void Check(bool condition,string name){count++;if(!condition)throw new Exception(name);}
 static void Reject(Action action,string name){bool rejected=false;try{action();}catch{rejected=true;}Check(rejected,name);}
 static string Fresh(string label){string path=Path.Combine(home,label+"-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(path);return path;}
 static string Config(string version,string repository){return UpdateFiles.Json().Serialize(new{schemaVersion=1,version=version,repository=repository,assetName="WallpaperShell-win-x64.zip"});}
 static string Release(string version,string url=null,string digest=null,bool pre=false,bool draft=false,long size=4096){return UpdateFiles.Json().Serialize(new{tag_name="v"+version,prerelease=pre,draft=draft,assets=new[]{new{name="WallpaperShell-win-x64.zip",state="uploaded",size=size,browser_download_url=url??"https://github.com/Kodzimba/WallpaperShell/releases/download/v"+version+"/WallpaperShell-win-x64.zip",digest=digest??"sha256:"+new string('a',64)}}});}
 static Dictionary<string,byte[]> Payload(){return new Dictionary<string,byte[]>(StringComparer.Ordinal){
  {"bin/WallpaperShell.exe",Encoding.UTF8.GetBytes("SYNTHETIC NEW APP; NOT EXECUTABLE")},
  {"bin/WallpaperShell.Updater.exe",Encoding.UTF8.GetBytes("SYNTHETIC NEW UPDATER; NOT EXECUTABLE")},
  {"bin/node.exe",Encoding.UTF8.GetBytes("SYNTHETIC NEW NODE; NOT EXECUTABLE")},
  {"runtime/companion/fixture.cjs",Encoding.UTF8.GetBytes("synthetic code fixture")},
  {"app-release.json",Encoding.UTF8.GetBytes(Config("0.3.0","Kodzimba/WallpaperShell"))}
 };}
 static UpdateManifest Manifest(Dictionary<string,byte[]> payload){return new UpdateManifest{schemaVersion=1,version="0.3.0",platform="win-x64",files=payload.Select(p=>new UpdateManifestFile{path=p.Key,size=p.Value.Length,sha256=Digest(p.Value)}).ToArray()};}
 static string Digest(byte[] bytes){using(var sha=System.Security.Cryptography.SHA256.Create())return UpdateFiles.Hex(sha.ComputeHash(bytes));}
 static string Archive(string directory,Dictionary<string,byte[]> payload,Action<ZipArchive> extra=null,UpdateManifest manifest=null){
  string path=Path.Combine(directory,"package.zip");using(var stream=new FileStream(path,FileMode.CreateNew))using(var zip=new ZipArchive(stream,ZipArchiveMode.Create)){
   foreach(var entry in payload){var item=zip.CreateEntry(entry.Key);using(var output=item.Open())output.Write(entry.Value,0,entry.Value.Length);}
   var metadata=zip.CreateEntry("package-manifest.json");byte[] text=Encoding.UTF8.GetBytes(UpdateFiles.Json().Serialize(manifest??Manifest(payload)));using(var output=metadata.Open())output.Write(text,0,text.Length);
   if(extra!=null)extra(zip);
  }return path;
 }
 static void Initial(string root){
  Directory.CreateDirectory(Path.Combine(root,"bin"));Directory.CreateDirectory(Path.Combine(root,"data"));Directory.CreateDirectory(Path.Combine(root,"runtime","companion"));
  File.WriteAllText(Path.Combine(root,"bin","WallpaperShell.exe"),"SYNTHETIC OLD APP; NOT EXECUTABLE");File.WriteAllText(Path.Combine(root,"bin","WallpaperShell.Updater.exe"),"SYNTHETIC OLD UPDATER; NOT EXECUTABLE");
  File.WriteAllText(Path.Combine(root,"bin","node.exe"),"SYNTHETIC OLD NODE; NOT EXECUTABLE");File.WriteAllText(Path.Combine(root,"app-release.json"),Config("0.2.0","Kodzimba/WallpaperShell"));
  File.WriteAllText(Path.Combine(root,"data","settings.json"),"synthetic-local-preferences");File.WriteAllText(Path.Combine(root,"runtime","companion",".desktop-key"),"synthetic-local-key");
 }
 static void LocalPreserved(string root){Check(File.ReadAllText(Path.Combine(root,"data","settings.json"))=="synthetic-local-preferences"&&File.ReadAllText(Path.Combine(root,"runtime","companion",".desktop-key"))=="synthetic-local-key","Local settings and hidden capability keys remain unchanged");}
 static void Main(){
  home=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"update-fixtures-"+Guid.NewGuid().ToString("N")));Directory.CreateDirectory(home);
  try{
   var config=AppUpdateConfig.Parse(Config("0.2.0","Kodzimba/WallpaperShell"));Check(config.Enabled&&config.Repository=="Kodzimba/WallpaperShell","Configured public repository is parsed");
   Check(!AppUpdateConfig.Parse(Config("0.2.0",null)).Enabled,"Unconfigured distribution does not invent a repository");
   foreach(string repository in new[]{"../outside","https://github.com/Kodzimba/WallpaperShell","owner/repo/subpath","owner/repo?token=secret","-owner/repo","owner/../repo"})Reject(()=>AppUpdateConfig.Parse(Config("0.2.0",repository)),"Invalid repository rejected");
   foreach(string version in new[]{"0.3.0-beta","v0.3.0","03.0.0","0.3","-1.0.0","0.3.0.1"})Check(UpdateFiles.Version(version)==null,"Only plain stable three-part versions accepted");
   Check(AppUpdates.ParseRelease(Release("0.3.0"),config).Version=="0.3.0","Higher stable release with exact asset and digest accepted");
   Check(AppUpdates.ParseRelease(Release("0.2.0"),config)==null&&AppUpdates.ParseRelease(Release("0.1.9"),config)==null,"Same version and downgrade never staged");
   Reject(()=>AppUpdates.ParseRelease(Release("0.3.0",pre:true),config),"Prerelease rejected");Reject(()=>AppUpdates.ParseRelease(Release("0.3.0",draft:true),config),"Draft rejected");
   Reject(()=>AppUpdates.ParseRelease(Release("0.3.0",url:"https://evil.test/WallpaperShell-win-x64.zip"),config),"Untrusted browser download URL rejected");
   Reject(()=>AppUpdates.ParseRelease(Release("0.3.0",digest:"md5:"+new string('a',32)),config),"Non-SHA256 digest rejected");
   Reject(()=>AppUpdates.ParseRelease(Release("0.3.0",size:UpdateFiles.MaxArchive+1),config),"Oversize asset rejected before download");
   foreach(string url in new[]{"http://github.com/file","https://github.com.evil.test/file","https://user:pass@github.com/file","https://github.com:8443/file","file:///C:/fixture","https://api.github.com/file#fragment","https://localhost/file"})Check(!AppUpdates.AllowedUri(new Uri(url),false),"Only exact HTTPS GitHub release hosts accepted");
   Check(AppUpdates.AllowedUri(new Uri("https://release-assets.githubusercontent.com/file?signature=opaque"),false)&&AppUpdates.AllowedUri(new Uri("https://api.github.com/repos/x/y/releases/latest"),true),"Expected GitHub API and asset redirect hosts accepted");
   foreach(string path in new[]{"../outside","bin/../../outside","C:/outside","/absolute","bin\\nested.exe","bin/a:b","bin/CON.exe","bin/item. ","bin/NUL","bin/part//file","bin/./file"})Reject(()=>UpdateFiles.Under(home,path),"Traversal, ADS, ambiguous and reserved paths rejected");
   foreach(string path in new[]{"data/settings.json","runtime/companion/.desktop-key","runtime/companion/devices.json","verification/fixture.exe",".git/config","src/Program.cs","runtime/themes/data/file.js","runtime/companion/runtime-autostart.log","tools/arbitrary.ps1","identity/notifications/secret.pfx","identity/notifications/identity.msix","identity/notifications/Assets/key.pem"})Check(!UpdateFiles.PayloadPath(path),"Protected local/source paths cannot be payload files");
   foreach(string path in new[]{"bin/WallpaperShell.exe","runtime/companion/server.cjs","runtime/themes/luna-blue/scene.js","licenses/Node.txt","docs/README.md","RUN_LUNA_BLUE.cmd","app-release.json"})Check(UpdateFiles.PayloadPath(path),"Explicit application code path accepted");
   foreach(string path in new[]{"tools/launch-luna.ps1","tools/setup-notifications.ps1","identity/notifications/AppxManifest.xml","identity/notifications/app.manifest.fragment.xml","identity/notifications/Assets/Square44x44Logo.png"})Check(UpdateFiles.PayloadPath(path),"Exact portable launcher and unsigned notification templates accepted");
   Check(UpdateFiles.PayloadPath("identity/notifications/README.md"),"Exact sanitized notification instructions accepted");
   foreach(string path in new[]{"README.md","NOTICE.md","SECURITY.md","licenses/assets-provenance.json"})Check(UpdateFiles.PayloadPath(path),"Exact public release documentation and provenance metadata accepted");
   Check(!UpdateFiles.PayloadPath("OTHER.md"),"Root security policy allowlist does not permit arbitrary markdown files");
   foreach(string path in new[]{"secret.json","licenses/private-settings.json","HANDOFF.md"})Check(!UpdateFiles.PayloadPath(path),"Public metadata exceptions do not grant arbitrary root or JSON files");
   var payload=Payload();string goodDir=Fresh("good"),goodZip=Archive(goodDir,payload),goodOut=Path.Combine(goodDir,"payload");var good=UpdateFiles.Extract(goodZip,goodOut,"0.3.0",CancellationToken.None);Check(good.files.Length==5&&AppUpdateConfig.Read(goodOut).Version=="0.3.0","Verified package extracts and validates every file");
   foreach(string path in new[]{"../outside.txt","bin/../../escape","data/preferences.json","bin/CON.exe","bin\\outside.exe"}){
    string dir=Fresh("unsafe");string zip=Archive(dir,payload,z=>{using(var output=z.CreateEntry(path).Open())output.WriteByte(1);});Reject(()=>UpdateFiles.Extract(zip,Path.Combine(dir,"payload"),"0.3.0",CancellationToken.None),"Unsafe ZIP path rejected before writes outside stage");
   }
   foreach(int attributes in new[]{unchecked((int)0xa1ff0000),0x400,unchecked((int)0x21ff0000)}){
    string dir=Fresh("link");string zip=Archive(dir,payload,z=>{var entry=z.CreateEntry("bin/link.exe");entry.ExternalAttributes=attributes;using(var output=entry.Open())output.WriteByte(1);});Reject(()=>UpdateFiles.Extract(zip,Path.Combine(dir,"payload"),"0.3.0",CancellationToken.None),"Symbolic links, reparse flags and special Unix entries rejected");
   }
   {string dir=Fresh("duplicate");string zip=Archive(dir,payload,z=>{using(var output=z.CreateEntry("BIN/WallpaperShell.exe").Open())output.WriteByte(1);});Reject(()=>UpdateFiles.Extract(zip,Path.Combine(dir,"payload"),"0.3.0",CancellationToken.None),"Case-insensitive ZIP duplicates rejected");}
   {string dir=Fresh("extra");string zip=Archive(dir,payload,z=>{using(var output=z.CreateEntry("bin/undeclared.exe").Open())output.WriteByte(1);});Reject(()=>UpdateFiles.Extract(zip,Path.Combine(dir,"payload"),"0.3.0",CancellationToken.None),"Unmanifested executable rejected");}
   {string dir=Fresh("tamper");var manifest=Manifest(payload);manifest.files[0].sha256=new string('f',64);string zip=Archive(dir,payload,null,manifest);Reject(()=>UpdateFiles.Extract(zip,Path.Combine(dir,"payload"),"0.3.0",CancellationToken.None),"Per-file digest mismatch rejected");}
   {string dir=Fresh("cancel");using(var cancel=new CancellationTokenSource()){cancel.Cancel();Reject(()=>UpdateFiles.Extract(goodZip,Path.Combine(dir,"payload"),"0.3.0",cancel.Token),"Cancelled extraction does not finish staging");}}
   {string dir=Fresh("version");Reject(()=>UpdateFiles.Extract(goodZip,Path.Combine(dir,"payload"),"0.4.0",CancellationToken.None),"Release and manifest version must match");}
   {string dir=Fresh("size");var manifest=Manifest(payload);manifest.files[0].size=UpdateFiles.MaxFile+1;string zip=Archive(dir,payload,null,manifest);Reject(()=>UpdateFiles.Extract(zip,Path.Combine(dir,"payload"),"0.3.0",CancellationToken.None),"Manifest per-file expansion limit enforced before hashing");}
   {string dir=Fresh("bomb");var bomb=Payload();bomb["runtime/companion/oversize.cjs"]=new byte[4*1024*1024];string zip=Archive(dir,bomb);Reject(()=>UpdateFiles.Extract(zip,Path.Combine(dir,"payload"),"0.3.0",CancellationToken.None),"Excessive compression ratio rejected before expansion");}
   {string root=Fresh("install");Initial(root);int writes=0;UpdateInstaller.Apply(root,goodOut,good,Path.Combine(root,"data","backup"),n=>{writes++;Check(AppUpdateConfig.Read(root).Version=="0.2.0","Version marker remains old before every replacement, and is committed last");});Check(writes==5&&AppUpdateConfig.Read(root).Version=="0.3.0","Transactional manifest installation finishes with new version");foreach(var file in good.files)Check(UpdateFiles.Hash(UpdateFiles.Under(root,file.path))==file.sha256,"Installed bytes equal manifest");LocalPreserved(root);}
   {string root=Fresh("rollback"),dir=Fresh("rollback-payload");Initial(root);string zip=Archive(dir,payload);var manifest=UpdateFiles.Extract(zip,Path.Combine(dir,"payload"),"0.3.0",CancellationToken.None);Reject(()=>UpdateInstaller.Apply(root,Path.Combine(dir,"payload"),manifest,Path.Combine(root,"data","backup"),n=>{if(n==5)throw new IOException("Synthetic write fault");}),"Injected late write failure rolls back");Check(File.ReadAllText(Path.Combine(root,"bin","WallpaperShell.exe"))=="SYNTHETIC OLD APP; NOT EXECUTABLE"&&AppUpdateConfig.Read(root).Version=="0.2.0","Rollback restores existing app and version");Check(!File.Exists(Path.Combine(root,"runtime","companion","fixture.cjs")),"Rollback removes only its newly installed file");LocalPreserved(root);}
   {string root=Fresh("locked"),dir=Fresh("locked-payload");Initial(root);string zip=Archive(dir,payload);var manifest=UpdateFiles.Extract(zip,Path.Combine(dir,"payload"),"0.3.0",CancellationToken.None);using(var locked=new FileStream(Path.Combine(root,"bin","node.exe"),FileMode.Open,FileAccess.Read,FileShare.None)){Reject(()=>UpdateInstaller.Apply(root,Path.Combine(dir,"payload"),manifest,Path.Combine(root,"data","backup"),null),"Locked target triggers rollback without killing any process");}Check(AppUpdateConfig.Read(root).Version=="0.2.0"&&File.ReadAllText(Path.Combine(root,"bin","WallpaperShell.exe"))=="SYNTHETIC OLD APP; NOT EXECUTABLE","Earlier replacements are restored on lock failure");LocalPreserved(root);}
   {string root=Fresh("plan");Initial(root);string stage=Path.Combine(root,"data","updates",Guid.NewGuid().ToString("N"));Directory.CreateDirectory(stage);
    var plan=new UpdateInstallPlan{schemaVersion=1,root=root,stage=stage,fromVersion="0.2.0",version="0.3.0",repository="Kodzimba/WallpaperShell",processId=System.Diagnostics.Process.GetCurrentProcess().Id,startedTicks=System.Diagnostics.Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks,exeSha256=new string('a',64),archiveSha256=new string('b',64),nonce=Guid.NewGuid().ToString("N"),mode="desktop"};
    string path=Path.Combine(stage,"install-plan.json");UpdateFiles.WriteJson(path,plan);Check(UpdateInstaller.ReadPlan(path).root==root,"Plan binds stage and current release to exactly its own root");Reject(()=>UpdateInstaller.Owner(plan),"Helper cannot use its own PID or an arbitrary executable as the App owner");
    new AppUpdates(root).CancelInstaller(new AppUpdateStage{Root=root,Directory=stage});Check(UpdateFiles.Text(UpdateFiles.Object(File.ReadAllText(Path.Combine(stage,"cancel.json"))),"nonce")==plan.nonce,"Cancellation after a ready handshake uses the exact plan nonce");
    plan.version="0.1.0";File.WriteAllText(path,UpdateFiles.Json().Serialize(plan));Reject(()=>UpdateInstaller.ReadPlan(path),"Installer independently rejects downgrades");plan.version="0.3.0";plan.stage=Path.GetDirectoryName(stage);File.WriteAllText(path,UpdateFiles.Json().Serialize(plan));Reject(()=>UpdateInstaller.ReadPlan(path),"Installer independently rejects a stage outside its GUID directory");
   }
   {string root=Fresh("unconfigured");File.WriteAllText(Path.Combine(root,"app-release.json"),Config("0.2.0",null));Reject(()=>new AppUpdates(root).CheckAsync(CancellationToken.None).GetAwaiter().GetResult(),"Unconfigured update check fails locally without network access");}
   {string stage=Fresh("synchronous-cancel"),nonce=Guid.NewGuid().ToString("N");using(var cancel=new CancellationTokenSource())using(AppUpdates.ArmInstallerCancellation(stage,nonce,cancel.Token)){cancel.Cancel();Check(File.Exists(Path.Combine(stage,"cancel.json"))&&UpdateFiles.Text(UpdateFiles.Object(File.ReadAllText(Path.Combine(stage,"cancel.json"))),"nonce")==nonce,"Installer cancellation is persisted synchronously without an async UI continuation");}}
   {string stage=Fresh("ready-cancel");using(var cancel=new CancellationTokenSource()){using(AppUpdates.ArmInstallerCancellation(stage,Guid.NewGuid().ToString("N"),cancel.Token)){}cancel.Cancel();Check(!File.Exists(Path.Combine(stage,"cancel.json")),"After ready returns, an authorized App Quit no longer cancels installation");}}
   {string root=Fresh("mutex");using(var ready=new ManualResetEvent(false))using(var done=new ManualResetEvent(false)){
    var thread=new Thread(()=>{using(var mutex=new Mutex(false,UpdateFiles.MutexName(root))){mutex.WaitOne();ready.Set();done.WaitOne();mutex.ReleaseMutex();}});thread.Start();if(!ready.WaitOne(5000))throw new Exception("Mutex test timed out");try{Check(AppUpdates.InstallationActive(root),"A separate installer mutex blocks manual relaunch during replacement");}finally{done.Set();thread.Join();}Check(!AppUpdates.InstallationActive(root),"Finished transaction no longer blocks own App startup");
   }}
   Console.WriteLine("Updater pure/temporary-file tests: "+count+" checks passed; no network, helper execution, installed-app writes, restart or downloaded code execution.");
  }finally{string prefix=Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;if(!home.StartsWith(prefix,StringComparison.OrdinalIgnoreCase))throw new Exception("Unsafe fixture cleanup");if(Directory.Exists(home))Directory.Delete(home,true);}
 }
}
