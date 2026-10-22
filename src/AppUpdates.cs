using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace PaperGreen {
 internal sealed class AppUpdateException:Exception {
  internal string Code {get;private set;}
  internal AppUpdateException(string code):base(code){Code=code;}
 }
 internal sealed class AppUpdateConfig {
  internal string Version {get;private set;}
  internal string Repository {get;private set;}
  internal string AssetName {get;private set;}
  internal bool Enabled {get{return Repository!=null;}}
  internal static AppUpdateConfig Read(string root){return Parse(UpdateFiles.ReadText(UpdateFiles.Under(root,"app-release.json"),16384));}
  internal static AppUpdateConfig Parse(string text){
   var value=UpdateFiles.Object(text);object schema,repository;
   if(!value.TryGetValue("schemaVersion",out schema)||Convert.ToString(schema)!="1")throw new AppUpdateException("invalid-config");
   string version=UpdateFiles.Text(value,"version"),asset=UpdateFiles.Text(value,"assetName");
   if(UpdateFiles.Version(version)==null||asset!="WallpaperShell-win-x64.zip"||!value.TryGetValue("repository",out repository))throw new AppUpdateException("invalid-config");
   string repo=repository as string;if(repository!=null&&(repo==null||!Regex.IsMatch(repo,@"\A[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\z")||repo.EndsWith(".")||repo.Contains("..")))throw new AppUpdateException("invalid-repository");
   return new AppUpdateConfig{Version=version,Repository=repo,AssetName=asset};
  }
 }
 internal sealed class AppUpdateRelease {
  internal string Version {get;set;}internal string AssetName {get;set;}internal long Size {get;set;}internal string Sha256 {get;set;}
  internal string Repository,Tag;internal Uri Download;
 }
 internal sealed class AppUpdateProgress {
  internal string Phase {get;set;}internal long Bytes {get;set;}internal long TotalBytes {get;set;}
 }
 internal sealed class AppUpdateStage {
  internal string Directory,Root,ArchiveSha256,Version,Repository;internal UpdateManifest Manifest;
 }
 internal sealed class UpdateManifestFile {public string path {get;set;}public long size {get;set;}public string sha256 {get;set;}}
 internal sealed class UpdateManifest {public int schemaVersion {get;set;}public string version {get;set;}public string platform {get;set;}public UpdateManifestFile[] files {get;set;}}
 internal sealed class UpdateInstallPlan {
  public int schemaVersion,processId;public long startedTicks;public string root,stage,fromVersion,version,repository,archiveSha256,exeSha256,nonce,mode;
 }
 internal static class UpdateFiles {
  internal const long MaxArchive=536870912,MaxExpanded=1073741824,MaxFile=268435456;
  internal const int MaxFiles=10000;
  internal static JavaScriptSerializer Json(){return new JavaScriptSerializer{MaxJsonLength=2097152,RecursionLimit=24};}
  internal static Dictionary<string,object> Object(string text){try{var obj=Json().DeserializeObject(text) as Dictionary<string,object>;if(obj==null)throw new Exception();return obj;}catch{throw new AppUpdateException("invalid-json");}}
  internal static string Text(Dictionary<string,object> obj,string key){object value;return obj.TryGetValue(key,out value)?value as string:null;}
  internal static Version Version(string value){if(value==null||!Regex.IsMatch(value,@"\A(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\z"))return null;Version v;return System.Version.TryParse(value,out v)?v:null;}
  internal static bool Digest(string value){return value!=null&&Regex.IsMatch(value,@"\A[a-f0-9]{64}\z");}
  internal static bool Token(string value){return value!=null&&Regex.IsMatch(value,@"\A[a-f0-9]{32}\z");}
  internal static string Hash(string path){using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read))using(var sha=SHA256.Create())return Hex(sha.ComputeHash(stream));}
  internal static string Hex(byte[] bytes){return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();}
  internal static string Root(string root){string full=Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);if(full.Length<4||!Directory.Exists(full))throw new AppUpdateException("invalid-root");NoReparse(full);return full;}
  internal static void NoReparse(string path){
   for(string at=Path.GetFullPath(path);!String.IsNullOrEmpty(at);at=Path.GetDirectoryName(at)){
    // Exists follows links and returns false for dangling links or access errors.
    // Probe the entry itself and treat only genuine missing paths as absent.
    try{if((File.GetAttributes(at)&FileAttributes.ReparsePoint)!=0)throw new AppUpdateException("reparse-path");}
    catch(FileNotFoundException){}catch(DirectoryNotFoundException){}
    if(at==Path.GetPathRoot(at))break;
   }
  }
  internal static string Under(string root,string relative){
   if(String.IsNullOrEmpty(relative)||relative.Contains("\\")||relative.StartsWith("/")||relative.Contains(":"))throw new AppUpdateException("unsafe-path");
   var parts=relative.Split('/');if(parts.Length>32)throw new AppUpdateException("unsafe-path");
   foreach(string part in parts){
    if(part.Length==0||part=="."||part==".."||part.EndsWith(".")||part.EndsWith(" ")||part.Any(c=>c<32||"<>\"|?*".IndexOf(c)>=0)||Regex.IsMatch(part,@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)",RegexOptions.IgnoreCase))throw new AppUpdateException("unsafe-path");
   }
   string full=Path.GetFullPath(Path.Combine(root,relative.Replace('/',Path.DirectorySeparatorChar))),prefix=Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
   if(!full.StartsWith(prefix,StringComparison.OrdinalIgnoreCase)||full.Length>=240)throw new AppUpdateException("unsafe-path");NoReparse(full);return full;
  }
  internal static bool PayloadPath(string path){
   try{Under(Path.GetTempPath(),path);}catch{return false;}
   if(path.Split('/').Any(p=>p.StartsWith(".")||new[]{"data","verification","profiles","snapshots"}.Contains(p,StringComparer.OrdinalIgnoreCase)))return false;
   if(path=="app-release.json"||path=="README.md"||path=="NOTICE.md"||path=="SECURITY.md"||path=="licenses/assets-provenance.json"||Regex.IsMatch(path,@"^RUN(?:_[A-Z0-9_]+)?\.cmd$"))return true;
   string extension=Path.GetExtension(path).ToLowerInvariant();
   if(path=="tools/launch-luna.ps1"||path=="tools/setup-notifications.ps1")return true;
   if(path=="identity/notifications/AppxManifest.xml"||path=="identity/notifications/app.manifest.fragment.xml"||path=="identity/notifications/README.md")return true;
   if(path.StartsWith("identity/notifications/Assets/",StringComparison.Ordinal))return extension==".png"&&path.Split('/').Length==4;
   if(path.StartsWith("bin/",StringComparison.Ordinal))return new[]{".exe",".dll",".config",".txt"}.Contains(extension);
   if(path.StartsWith("licenses/",StringComparison.Ordinal))return extension==".txt"||extension==".md"||Path.GetFileName(path)=="LICENSE";
   if(path.StartsWith("docs/",StringComparison.Ordinal))return new[]{".txt",".md",".png",".svg"}.Contains(extension);
   if(path.StartsWith("runtime/wallpaper/",StringComparison.Ordinal)||path.StartsWith("runtime/themes/",StringComparison.Ordinal))return new[]{".js",".css",".html",".ttf",".otf",".woff",".woff2",".webp",".png",".svg",".jpg",".jpeg",".ico",".gif",".txt",".glsl",".vert",".frag"}.Contains(extension);
   if(path.StartsWith("runtime/companion/",StringComparison.Ordinal))return new[]{".cs",".cjs",".ps1",".dll",".txt"}.Contains(extension)||path=="runtime/companion/vendor/webview2/package.json";
   return false;
  }
  internal static string ReadText(string path,int limit){NoReparse(path);var info=new FileInfo(path);if(!info.Exists||info.Length>limit)throw new AppUpdateException("invalid-file");return File.ReadAllText(path,Encoding.UTF8);}
  internal static void WriteJson(string path,object value){NoReparse(path);using(var file=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None))using(var writer=new StreamWriter(file,new UTF8Encoding(false))){writer.Write(Json().Serialize(value));writer.Flush();file.Flush(true);}}
  internal static UpdateManifest ReadManifest(string path){
   UpdateManifest manifest;try{manifest=Json().Deserialize<UpdateManifest>(ReadText(path,2097152));}catch(AppUpdateException){throw;}catch{throw new AppUpdateException("invalid-manifest");}
   if(manifest==null||manifest.schemaVersion!=1||manifest.platform!="win-x64"||Version(manifest.version)==null||manifest.files==null||manifest.files.Length<3||manifest.files.Length>MaxFiles)throw new AppUpdateException("invalid-manifest");
   long total=0;var paths=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
   foreach(var file in manifest.files){if(file==null||!PayloadPath(file.path)||!paths.Add(file.path)||file.size<0||file.size>MaxFile||!Digest(file.sha256))throw new AppUpdateException("invalid-manifest-file");total=checked(total+file.size);if(total>MaxExpanded)throw new AppUpdateException("package-too-large");}
   foreach(string required in new[]{"bin/WallpaperShell.exe","bin/WallpaperShell.Updater.exe","bin/node.exe","app-release.json"})if(!paths.Contains(required))throw new AppUpdateException("missing-package-file");
   return manifest;
  }
  internal static void VerifyPayload(string directory,UpdateManifest manifest){foreach(var file in manifest.files){string path=Under(directory,file.path);var info=new FileInfo(path);if(!info.Exists||info.Length!=file.size||Hash(path)!=file.sha256)throw new AppUpdateException("payload-mismatch");}}
  internal static UpdateManifest Extract(string zipPath,string destination,string version,CancellationToken token){
   NoReparse(zipPath);NoReparse(destination);Directory.CreateDirectory(destination);NoReparse(destination);
   using(var input=new FileStream(zipPath,FileMode.Open,FileAccess.Read,FileShare.Read))using(var zip=new ZipArchive(input,ZipArchiveMode.Read)){
    if(zip.Entries.Count<1||zip.Entries.Count>MaxFiles*2)throw new AppUpdateException("invalid-archive");
    var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);long total=0;int files=0;
    foreach(var entry in zip.Entries){
     token.ThrowIfCancellationRequested();bool directory=entry.FullName.EndsWith("/",StringComparison.Ordinal);string name=directory?entry.FullName.TrimEnd('/'):entry.FullName;
     string target=Under(destination,name);if(!seen.Add(name))throw new AppUpdateException("duplicate-archive-path");
     int unix=(entry.ExternalAttributes>>16)&0xf000;if((entry.ExternalAttributes&0x400)!=0||unix!=0&&unix!=0x8000&&unix!=0x4000||directory&&unix==0x8000||!directory&&unix==0x4000)throw new AppUpdateException("archive-link");
     if(directory){if(entry.Length!=0)throw new AppUpdateException("invalid-directory");Directory.CreateDirectory(target);continue;}
     if(name!="package-manifest.json"&&!PayloadPath(name))throw new AppUpdateException("forbidden-package-path");
     if(++files>MaxFiles+1||entry.Length<0||entry.Length>MaxFile||name=="package-manifest.json"&&entry.Length>2097152||entry.CompressedLength<0||entry.CompressedLength>MaxArchive||entry.Length>entry.CompressedLength*500+1048576||(total=checked(total+entry.Length))>MaxExpanded)throw new AppUpdateException("package-too-large");
     Directory.CreateDirectory(Path.GetDirectoryName(target));NoReparse(target);
     using(var source=entry.Open())using(var output=new FileStream(target,FileMode.CreateNew,FileAccess.Write,FileShare.None)){
      var buffer=new byte[65536];long written=0;int read;while((read=source.Read(buffer,0,buffer.Length))>0){token.ThrowIfCancellationRequested();written+=read;if(written>entry.Length)throw new AppUpdateException("archive-size-mismatch");output.Write(buffer,0,read);}if(written!=entry.Length)throw new AppUpdateException("archive-size-mismatch");output.Flush(true);
     }
    }
    var manifest=ReadManifest(Under(destination,"package-manifest.json"));if(manifest.version!=version||files!=manifest.files.Length+1)throw new AppUpdateException("manifest-mismatch");
    var declared=new HashSet<string>(manifest.files.Select(f=>f.path),StringComparer.Ordinal);foreach(var entry in zip.Entries.Where(e=>!e.FullName.EndsWith("/")))if(entry.FullName!="package-manifest.json"&&!declared.Contains(entry.FullName))throw new AppUpdateException("undeclared-file");
    VerifyPayload(destination,manifest);return manifest;
   }
  }
  internal static string MutexName(string root){using(var sha=SHA256.Create())return "Local\\WallpaperShell.Update."+Hex(sha.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(root).TrimEnd('\\').ToUpperInvariant()))).Substring(0,32);}
 }
 internal sealed class AppUpdates {
  readonly string root;internal AppUpdateConfig Configuration {get;private set;}
  internal AppUpdates(string directory){root=UpdateFiles.Root(directory);Configuration=AppUpdateConfig.Read(root);}
  internal static bool InstallationActive(string root){using(var mutex=new Mutex(false,UpdateFiles.MutexName(root))){bool entered=false;try{try{entered=mutex.WaitOne(0);}catch(AbandonedMutexException){entered=true;}return !entered;}finally{if(entered)mutex.ReleaseMutex();}}}
  internal static bool AllowedUri(Uri uri,bool api){return uri!=null&&uri.Scheme=="https"&&uri.Port==443&&String.IsNullOrEmpty(uri.UserInfo)&&String.IsNullOrEmpty(uri.Fragment)&&(api?uri.Host=="api.github.com":new[]{"github.com","release-assets.githubusercontent.com","objects.githubusercontent.com"}.Contains(uri.Host,StringComparer.Ordinal));}
  internal static AppUpdateRelease ParseRelease(string json,AppUpdateConfig config){
   var obj=UpdateFiles.Object(json);object draft,pre,assets;
   if(!obj.TryGetValue("draft",out draft)||!(draft is bool)||((bool)draft)||!obj.TryGetValue("prerelease",out pre)||!(pre is bool)||((bool)pre))throw new AppUpdateException("unstable-release");
   string tag=UpdateFiles.Text(obj,"tag_name"),version=tag!=null&&tag.StartsWith("v",StringComparison.Ordinal)?tag.Substring(1):tag;
   var v=UpdateFiles.Version(version);if(v==null)throw new AppUpdateException("invalid-release-version");if(v<=UpdateFiles.Version(config.Version))return null;
   if(!obj.TryGetValue("assets",out assets)||!(assets is IList))throw new AppUpdateException("missing-asset");
   var matches=((IList)assets).Cast<object>().OfType<Dictionary<string,object>>().Where(a=>UpdateFiles.Text(a,"name")==config.AssetName).ToArray();if(matches.Length!=1)throw new AppUpdateException("missing-asset");
   var asset=matches[0];object size;long bytes;string download=UpdateFiles.Text(asset,"browser_download_url"),expected="https://github.com/"+config.Repository+"/releases/download/"+Uri.EscapeDataString(tag)+"/"+config.AssetName;
   if(UpdateFiles.Text(asset,"state")!="uploaded"||!asset.TryGetValue("size",out size)||!Int64.TryParse(Convert.ToString(size),out bytes)||bytes<1||bytes>UpdateFiles.MaxArchive||download!=expected)throw new AppUpdateException("invalid-asset");
   string digest=UpdateFiles.Text(asset,"digest");if(digest!=null){if(!digest.StartsWith("sha256:",StringComparison.Ordinal)||!UpdateFiles.Digest(digest.Substring(7)))throw new AppUpdateException("invalid-digest");digest=digest.Substring(7);}
   return new AppUpdateRelease{Version=version,AssetName=config.AssetName,Size=bytes,Sha256=digest,Repository=config.Repository,Tag=tag,Download=new Uri(expected)};
  }
  internal async Task<AppUpdateRelease> CheckAsync(CancellationToken token){
   if(!Configuration.Enabled)throw new AppUpdateException("repository-unconfigured");
   byte[] bytes=await DownloadBytes(new Uri("https://api.github.com/repos/"+Configuration.Repository+"/releases/latest"),true,2097152,token).ConfigureAwait(false);
   var release=ParseRelease(Encoding.UTF8.GetString(bytes),Configuration);if(release==null)return null;
   if(release.Sha256==null){
    var obj=UpdateFiles.Object(Encoding.UTF8.GetString(bytes));var assets=((IList)obj["assets"]).Cast<object>().OfType<Dictionary<string,object>>().Where(a=>UpdateFiles.Text(a,"name")==Configuration.AssetName+".sha256").ToArray();
    string expected=release.Download.AbsoluteUri+".sha256";if(assets.Length!=1||UpdateFiles.Text(assets[0],"browser_download_url")!=expected)throw new AppUpdateException("missing-digest");
    string checksum=Encoding.ASCII.GetString(await DownloadBytes(new Uri(expected),false,1024,token).ConfigureAwait(false));var match=Regex.Match(checksum,"^([a-f0-9]{64})  "+Regex.Escape(release.AssetName)+"\\r?\\n?$");if(!match.Success)throw new AppUpdateException("invalid-digest");release.Sha256=match.Groups[1].Value;
   }
   return release;
  }
  static async Task<byte[]> DownloadBytes(Uri uri,bool api,int maximum,CancellationToken token){using(var memory=new MemoryStream()){try{await Download(uri,api,memory,maximum,null,token).ConfigureAwait(false);return memory.ToArray();}catch{token.ThrowIfCancellationRequested();throw;}}}
  static async Task Download(Uri uri,bool api,Stream output,long maximum,IProgress<AppUpdateProgress> progress,CancellationToken token){
   using(var timeout=CancellationTokenSource.CreateLinkedTokenSource(token)){
    timeout.CancelAfter(TimeSpan.FromMinutes(10));token=timeout.Token;
    for(int redirect=0;redirect<=5;redirect++){
     token.ThrowIfCancellationRequested();if(!AllowedUri(uri,api))throw new AppUpdateException("untrusted-download-host");
     var request=(HttpWebRequest)WebRequest.Create(uri);request.AllowAutoRedirect=false;request.Timeout=15000;request.ReadWriteTimeout=15000;request.UserAgent="WallpaperShell-Updater";request.Accept=api?"application/vnd.github+json":"application/octet-stream";request.Headers["X-GitHub-Api-Version"]="2022-11-28";ServicePointManager.CheckCertificateRevocationList=true;request.ProtocolVersion=HttpVersion.Version11;
     ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
     using(token.Register(request.Abort)){
      HttpWebResponse response;try{response=(HttpWebResponse)await request.GetResponseAsync().ConfigureAwait(false);}catch(WebException e){if(token.IsCancellationRequested)throw new OperationCanceledException(token);var error=e.Response as HttpWebResponse;if(error!=null){int status=(int)error.StatusCode;error.Dispose();throw new AppUpdateException(status==404?"release-not-found":status==403?"github-rate-limit":"download-unavailable");}throw new AppUpdateException("network-unavailable");}
      using(response){int code=(int)response.StatusCode;if(code>=300&&code<400){string next=response.Headers["Location"];Uri target;if(redirect==5||!Uri.TryCreate(uri,next,out target))throw new AppUpdateException("invalid-redirect");uri=target;continue;}
       if(code!=200||response.ContentLength>maximum)throw new AppUpdateException("download-too-large");
       using(var stream=response.GetResponseStream()){var buffer=new byte[65536];long total=0,lastProgress=-100;var clock=Stopwatch.StartNew();int count;while((count=await stream.ReadAsync(buffer,0,buffer.Length,token).ConfigureAwait(false))>0){total+=count;if(total>maximum)throw new AppUpdateException("download-too-large");await output.WriteAsync(buffer,0,count,token).ConfigureAwait(false);if(progress!=null&&(clock.ElapsedMilliseconds-lastProgress>=100||total==maximum)){lastProgress=clock.ElapsedMilliseconds;progress.Report(new AppUpdateProgress{Phase="downloading",Bytes=total,TotalBytes=maximum});}}if(response.ContentLength>=0&&total!=response.ContentLength)throw new AppUpdateException("incomplete-download");}return;
      }
     }
    }
   }
   throw new AppUpdateException("invalid-redirect");
  }
  internal async Task<AppUpdateStage> StageAsync(AppUpdateRelease release,IProgress<AppUpdateProgress> progress,CancellationToken token){
   if(release==null||release.Repository!=Configuration.Repository||release.AssetName!=Configuration.AssetName||UpdateFiles.Version(release.Version)==null||UpdateFiles.Version(release.Version)<=UpdateFiles.Version(Configuration.Version)||!UpdateFiles.Digest(release.Sha256)||!AllowedUri(release.Download,false))throw new AppUpdateException("invalid-release");
   if(release.Tag!=release.Version&&release.Tag!="v"+release.Version||release.Download.AbsoluteUri!="https://github.com/"+Configuration.Repository+"/releases/download/"+Uri.EscapeDataString(release.Tag)+"/"+Configuration.AssetName)throw new AppUpdateException("invalid-release");
   string relative="data/updates/"+Guid.NewGuid().ToString("N"),stage=UpdateFiles.Under(root,relative);Directory.CreateDirectory(stage);UpdateFiles.NoReparse(stage);
   string archive=UpdateFiles.Under(stage,"package.zip");
   try{
    using(var output=new FileStream(archive,FileMode.CreateNew,FileAccess.Write,FileShare.None)){await Download(release.Download,false,output,release.Size,progress,token).ConfigureAwait(false);output.Flush(true);}
    if(new FileInfo(archive).Length!=release.Size||UpdateFiles.Hash(archive)!=release.Sha256)throw new AppUpdateException("digest-mismatch");
    if(progress!=null)progress.Report(new AppUpdateProgress{Phase="verifying",Bytes=release.Size,TotalBytes=release.Size});
    var manifest=await Task.Run(()=>UpdateFiles.Extract(archive,UpdateFiles.Under(stage,"payload"),release.Version,token),token).ConfigureAwait(false);
    var config=AppUpdateConfig.Read(UpdateFiles.Under(stage,"payload"));if(config.Version!=release.Version||config.Repository!=Configuration.Repository||config.AssetName!=Configuration.AssetName)throw new AppUpdateException("package-config-mismatch");
    return new AppUpdateStage{Root=root,Directory=stage,Manifest=manifest,ArchiveSha256=release.Sha256,Version=release.Version,Repository=release.Repository};
   }catch{try{UpdateFiles.WriteJson(UpdateFiles.Under(stage,"failed.json"),new{status=token.IsCancellationRequested?"cancelled":"verification-failed"});}catch{}token.ThrowIfCancellationRequested();throw;}
  }
  internal async Task<bool> LaunchInstallerAsync(AppUpdateStage stage,string mode,CancellationToken token){
   if(stage==null||stage.Root!=root||stage.Repository!=Configuration.Repository||!new[]{"window","desktop","all"}.Contains(mode)||InstallationActive(root))throw new AppUpdateException("invalid-installation");
   string expectedStage=UpdateFiles.Under(root,"data/updates/"+Path.GetFileName(stage.Directory));if(expectedStage!=stage.Directory||!UpdateFiles.Token(Path.GetFileName(stage.Directory)))throw new AppUpdateException("invalid-stage");
   var current=Process.GetCurrentProcess();string exe=UpdateFiles.Under(root,"bin/WallpaperShell.exe");if(!String.Equals(Path.GetFullPath(current.MainModule.FileName),exe,StringComparison.OrdinalIgnoreCase))throw new AppUpdateException("wrong-owner");
   var plan=new UpdateInstallPlan{schemaVersion=1,processId=current.Id,startedTicks=current.StartTime.ToUniversalTime().Ticks,root=root,stage=stage.Directory,fromVersion=Configuration.Version,version=stage.Version,repository=stage.Repository,archiveSha256=stage.ArchiveSha256,exeSha256=UpdateFiles.Hash(exe),nonce=Guid.NewGuid().ToString("N"),mode=mode};
   string planPath=UpdateFiles.Under(stage.Directory,"install-plan.json");UpdateFiles.WriteJson(planPath,plan);
   string helper=UpdateFiles.Under(root,"bin/WallpaperShell.Updater.exe"),temp=Path.Combine(Path.GetTempPath(),"WallpaperShellUpdater-"+Guid.NewGuid().ToString("N"));UpdateFiles.NoReparse(temp);Directory.CreateDirectory(temp);UpdateFiles.NoReparse(temp);
   string runner=Path.Combine(temp,"WallpaperShell.Updater.exe");File.Copy(helper,runner);if(UpdateFiles.Hash(helper)!=UpdateFiles.Hash(runner))throw new AppUpdateException("helper-copy-mismatch");
   // Cancellation must persist synchronously even if ExitThread stops the UI
   // synchronization context before an awaited Task.Delay can run its catch.
   using(ArmInstallerCancellation(stage.Directory,plan.nonce,token)){
    token.ThrowIfCancellationRequested();
    var process=Process.Start(new ProcessStartInfo(runner,"--plan \""+planPath+"\""){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=temp});
    try{
    for(int attempt=0;attempt<600;attempt++){
     token.ThrowIfCancellationRequested();if(process.HasExited)throw new AppUpdateException("installer-unavailable");string ready=UpdateFiles.Under(stage.Directory,"installer-ready.json");
     if(File.Exists(ready)){var value=UpdateFiles.Object(UpdateFiles.ReadText(ready,4096));object id;if(UpdateFiles.Text(value,"nonce")==plan.nonce&&value.TryGetValue("pid",out id)&&Convert.ToString(id)==process.Id.ToString())return true;throw new AppUpdateException("invalid-installer-handshake");}
     await Task.Delay(100,token).ConfigureAwait(false);
    }
    throw new AppUpdateException("installer-timeout");
    }catch{try{UpdateFiles.WriteJson(UpdateFiles.Under(stage.Directory,"cancel.json"),new{nonce=plan.nonce});}catch{}throw;}
    finally{process.Dispose();current.Dispose();}
   }
  }
  internal static IDisposable ArmInstallerCancellation(string stage,string nonce,CancellationToken token){
   if(!UpdateFiles.Token(nonce))throw new AppUpdateException("invalid-installer-handshake");
   string marker=UpdateFiles.Under(stage,"cancel.json");
   return token.Register(()=>{try{UpdateFiles.WriteJson(marker,new{nonce=nonce});}catch{}});
  }
  internal void CancelInstaller(AppUpdateStage stage){
   if(stage==null||stage.Root!=root)return;
   try{
    string name=Path.GetFileName(stage.Directory);if(!UpdateFiles.Token(name)||stage.Directory!=UpdateFiles.Under(root,"data/updates/"+name))return;
    string planPath=UpdateFiles.Under(stage.Directory,"install-plan.json");if(!File.Exists(planPath))return;
    var plan=UpdateFiles.Json().Deserialize<UpdateInstallPlan>(UpdateFiles.ReadText(planPath,16384));
    if(plan!=null&&plan.root==root&&plan.stage==stage.Directory&&UpdateFiles.Token(plan.nonce))UpdateFiles.WriteJson(UpdateFiles.Under(stage.Directory,"cancel.json"),new{nonce=plan.nonce});
   }catch{}
  }
 }
 internal sealed class UpdateTransactionRecord {internal string Path,OldHash,NewHash;internal bool HadOriginal;}
 internal static class UpdateInstaller {
  internal static UpdateInstallPlan ReadPlan(string planPath){
   UpdateInstallPlan plan;try{plan=UpdateFiles.Json().Deserialize<UpdateInstallPlan>(UpdateFiles.ReadText(planPath,16384));}catch{throw new AppUpdateException("invalid-plan");}
   if(plan==null||plan.schemaVersion!=1||plan.processId<=0||plan.startedTicks<=0||!UpdateFiles.Token(plan.nonce)||!UpdateFiles.Digest(plan.archiveSha256)||!UpdateFiles.Digest(plan.exeSha256)||UpdateFiles.Version(plan.fromVersion)==null||UpdateFiles.Version(plan.version)==null||UpdateFiles.Version(plan.version)<=UpdateFiles.Version(plan.fromVersion)||!new[]{"window","desktop","all"}.Contains(plan.mode))throw new AppUpdateException("invalid-plan");
   plan.root=UpdateFiles.Root(plan.root);string id=Path.GetFileName(plan.stage);if(!UpdateFiles.Token(id)||plan.stage!=UpdateFiles.Under(plan.root,"data/updates/"+id)||Path.GetFullPath(planPath)!=UpdateFiles.Under(plan.stage,"install-plan.json"))throw new AppUpdateException("invalid-plan-root");
   var config=AppUpdateConfig.Read(plan.root);if(config.Version!=plan.fromVersion||config.Repository!=plan.repository||!config.Enabled)throw new AppUpdateException("installation-changed");
   return plan;
  }
  internal static Process Owner(UpdateInstallPlan plan){
   try{
    var owner=Process.GetProcessById(plan.processId);
    if(owner.HasExited||owner.Id==Process.GetCurrentProcess().Id||owner.StartTime.ToUniversalTime().Ticks!=plan.startedTicks||!String.Equals(Path.GetFullPath(owner.MainModule.FileName),UpdateFiles.Under(plan.root,"bin/WallpaperShell.exe"),StringComparison.OrdinalIgnoreCase)||UpdateFiles.Hash(owner.MainModule.FileName)!=plan.exeSha256){owner.Dispose();throw new Exception();}
    return owner;
   }catch{throw new AppUpdateException("owner-identity-mismatch");}
  }
  static bool Cancelled(UpdateInstallPlan plan){string file=UpdateFiles.Under(plan.stage,"cancel.json");return File.Exists(file)&&UpdateFiles.Text(UpdateFiles.Object(UpdateFiles.ReadText(file,4096)),"nonce")==plan.nonce;}
  internal static void Apply(string root,string payload,UpdateManifest manifest,string backup,Action<int> beforeReplace){
   root=UpdateFiles.Root(root);UpdateFiles.NoReparse(payload);UpdateFiles.VerifyPayload(payload,manifest);UpdateFiles.NoReparse(backup);
   if(Directory.Exists(backup))throw new AppUpdateException("backup-already-exists");Directory.CreateDirectory(backup);var records=new List<UpdateTransactionRecord>();
   try{
    using(var journal=new FileStream(UpdateFiles.Under(backup,"transaction.jsonl"),FileMode.CreateNew,FileAccess.Write,FileShare.Read))using(var writer=new StreamWriter(journal,new UTF8Encoding(false))){
     // The version marker is committed last. No recursive root copy or deletion
     // takes place: the manifest names every replaceable code file explicitly.
     foreach(var file in manifest.files.OrderBy(f=>f.path=="app-release.json"?1:0).ThenBy(f=>f.path,StringComparer.Ordinal)){
      string target=UpdateFiles.Under(root,file.path),source=UpdateFiles.Under(payload,file.path),old=UpdateFiles.Under(backup,file.path);
      if(Directory.Exists(target))throw new AppUpdateException("target-is-directory");Directory.CreateDirectory(Path.GetDirectoryName(target));Directory.CreateDirectory(Path.GetDirectoryName(old));UpdateFiles.NoReparse(target);UpdateFiles.NoReparse(old);
      var record=new UpdateTransactionRecord{Path=file.path,HadOriginal=File.Exists(target),OldHash=File.Exists(target)?UpdateFiles.Hash(target):null,NewHash=file.sha256};records.Add(record);
      writer.WriteLine(UpdateFiles.Json().Serialize(new{path=record.Path,hadOriginal=record.HadOriginal,oldHash=record.OldHash,newHash=record.NewHash}));writer.Flush();journal.Flush(true);
      if(beforeReplace!=null)beforeReplace(records.Count);
      if(record.HadOriginal)File.Replace(source,target,old,true);else File.Move(source,target);
     }
    }
   }catch{
    bool complete=true;
    foreach(var record in records.AsEnumerable().Reverse()){
     try{
      string target=UpdateFiles.Under(root,record.Path),old=UpdateFiles.Under(backup,record.Path);
      if(record.HadOriginal){if(File.Exists(old)){if(UpdateFiles.Hash(old)!=record.OldHash)throw new Exception();if(File.Exists(target))File.Replace(old,target,null,true);else File.Move(old,target);}}
      else if(File.Exists(target)){if(UpdateFiles.Hash(target)!=record.NewHash)throw new Exception();File.Delete(target);}
     }catch{complete=false;}
    }
    throw new AppUpdateException(complete?"installation-rolled-back":"rollback-incomplete");
   }
  }
  static void Result(UpdateInstallPlan plan,string status){
   try{UpdateFiles.WriteJson(UpdateFiles.Under(plan.stage,"installer-result.json"),new{status=status,version=plan.version,at=DateTime.UtcNow.ToString("o")});}catch{}
  }
  internal static int Run(string planPath){
   UpdateInstallPlan plan=null;bool changed=false;Mutex mutex=null;bool entered=false;
   try{
    plan=ReadPlan(planPath);mutex=new Mutex(false,UpdateFiles.MutexName(plan.root));try{entered=mutex.WaitOne(0);}catch(AbandonedMutexException){entered=true;}if(!entered)throw new AppUpdateException("installer-already-running");
    using(var owner=Owner(plan)){
     string archive=UpdateFiles.Under(plan.stage,"package.zip");if(UpdateFiles.Hash(archive)!=plan.archiveSha256)throw new AppUpdateException("digest-mismatch");
     string payload=UpdateFiles.Under(plan.stage,"installer-payload");var manifest=UpdateFiles.Extract(archive,payload,plan.version,CancellationToken.None);
     var config=AppUpdateConfig.Read(payload);if(config.Version!=plan.version||config.Repository!=plan.repository)throw new AppUpdateException("package-config-mismatch");
     if(Cancelled(plan))throw new AppUpdateException("cancelled");
     UpdateFiles.WriteJson(UpdateFiles.Under(plan.stage,"installer-ready.json"),new{nonce=plan.nonce,pid=Process.GetCurrentProcess().Id});
     var deadline=Stopwatch.StartNew();while(!owner.WaitForExit(100)){if(Cancelled(plan))throw new AppUpdateException("cancelled");if(deadline.ElapsedMilliseconds>120000)throw new AppUpdateException("owner-did-not-exit");}
     if(Cancelled(plan))throw new AppUpdateException("cancelled");var current=AppUpdateConfig.Read(plan.root);if(current.Version!=plan.fromVersion||current.Repository!=plan.repository||UpdateFiles.Hash(UpdateFiles.Under(plan.root,"bin/WallpaperShell.exe"))!=plan.exeSha256)throw new AppUpdateException("installation-changed");
     if(Cancelled(plan))throw new AppUpdateException("cancelled");
     changed=true;Apply(plan.root,payload,manifest,UpdateFiles.Under(plan.stage,"backup"),n=>{if(Cancelled(plan))throw new AppUpdateException("cancelled");});Result(plan,"installed");
    }
    // Release the installation mutex before launching the fixed own executable;
    // Program.Main refuses startup while this mutex is held.
    mutex.ReleaseMutex();entered=false;Restart(plan);return 0;
   }catch(Exception error){
    string code=error is AppUpdateException?((AppUpdateException)error).Code:"installer-failed";
    if(plan!=null)Result(plan,code);
    if(plan!=null&&changed&&code=="installation-rolled-back"){
     try{if(UpdateFiles.Hash(UpdateFiles.Under(plan.root,"bin/WallpaperShell.exe"))==plan.exeSha256){if(entered){mutex.ReleaseMutex();entered=false;}Restart(plan);}}catch{}
    }
    return 1;
   }finally{if(mutex!=null){if(entered)mutex.ReleaseMutex();mutex.Dispose();}}
  }
  static void Restart(UpdateInstallPlan plan){string args=plan.mode=="desktop"?"--desktop":plan.mode=="all"?"--all-monitors":"";Process.Start(new ProcessStartInfo(UpdateFiles.Under(plan.root,"bin/WallpaperShell.exe"),args){UseShellExecute=false,WorkingDirectory=plan.root});}
 }
}
