using System;
using System.IO;
using System.Security;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

// Shared by the wallpaper host and the separate launcher WebView host.
internal static class PrivateBootstrap {
 static readonly SecurityIdentifier SystemSid=new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null);
 static SecurityIdentifier User {get{using(var identity=WindowsIdentity.GetCurrent()){if(identity.User==null)throw new SecurityException("Private storage identity unavailable.");return identity.User;}}}
 static string Root(string root){var value=Path.GetFullPath(root);if(value.StartsWith("\\\\",StringComparison.Ordinal)||Path.GetPathRoot(value).Length!=3)throw new SecurityException("Private storage requires a local drive.");NoReparse(value);return value;}
 static void NoReparse(string path){for(string current=Path.GetFullPath(path);!String.IsNullOrEmpty(current);current=Path.GetDirectoryName(current)){try{if((File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new SecurityException("Private storage reparse point rejected.");}catch(FileNotFoundException){}catch(DirectoryNotFoundException){}}}
 static DirectorySecurity Descriptor(SecurityIdentifier user){var acl=new DirectorySecurity();acl.SetAccessRuleProtection(true,false);acl.SetOwner(user);var inherit=InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit;acl.AddAccessRule(new FileSystemAccessRule(user,FileSystemRights.FullControl,inherit,PropagationFlags.None,AccessControlType.Allow));acl.AddAccessRule(new FileSystemAccessRule(SystemSid,FileSystemRights.FullControl,inherit,PropagationFlags.None,AccessControlType.Allow));return acl;}
 static void CreateKey(string directory,SecurityIdentifier user){
  var file=Path.Combine(directory,"control.key");NoReparse(file);try{File.GetAttributes(file);return;}catch(FileNotFoundException){}
  var acl=new FileSecurity();acl.SetAccessRuleProtection(true,false);acl.SetOwner(user);acl.AddAccessRule(new FileSystemAccessRule(user,FileSystemRights.FullControl,AccessControlType.Allow));acl.AddAccessRule(new FileSystemAccessRule(SystemSid,FileSystemRights.FullControl,AccessControlType.Allow));
  // An elevated token's default owner can be Administrators. Set the SID and
  // private DACL atomically at creation, before the backend reads the token.
  var random=new byte[32];byte[] bytes=null;try{using(var rng=RandomNumberGenerator.Create())rng.GetBytes(random);bytes=System.Text.Encoding.ASCII.GetBytes(BitConverter.ToString(random).Replace("-","").ToLowerInvariant());using(var stream=new FileStream(file,FileMode.CreateNew,FileSystemRights.Write,FileShare.None,4096,FileOptions.None,acl))stream.Write(bytes,0,bytes.Length);}finally{Array.Clear(random,0,random.Length);if(bytes!=null)Array.Clear(bytes,0,bytes.Length);}
 }
 static void Verify(FileSystemSecurity acl,SecurityIdentifier user,bool protectedRequired){
  if(protectedRequired&&!acl.AreAccessRulesProtected)throw new SecurityException("Private directory inheritance is not protected.");
  if(!user.Equals(acl.GetOwner(typeof(SecurityIdentifier))))throw new SecurityException("Private storage owner rejected.");
  bool owns=false;foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier))){var sid=(SecurityIdentifier)rule.IdentityReference;if(rule.AccessControlType!=AccessControlType.Allow||(!sid.Equals(user)&&!sid.Equals(SystemSid)))throw new SecurityException("Private storage access rejected.");if(sid.Equals(user)&&(rule.FileSystemRights&FileSystemRights.FullControl)==FileSystemRights.FullControl)owns=true;}
  if(!owns)throw new SecurityException("Private storage access unavailable.");
 }
 internal static string EnsurePrivate(string appRoot){
  var root=Root(appRoot);var data=Path.Combine(root,"data");NoReparse(data);Directory.CreateDirectory(data);NoReparse(data);
  var path=Path.Combine(data,"private");NoReparse(path);var user=User;var acl=Descriptor(user);
  if(Directory.Exists(path)){var current=Directory.GetAccessControl(path,AccessControlSections.Owner);if(!user.Equals(current.GetOwner(typeof(SecurityIdentifier))))throw new SecurityException("Private directory owner rejected.");Directory.SetAccessControl(path,acl);}else Directory.CreateDirectory(path,acl);
  NoReparse(path);Verify(Directory.GetAccessControl(path),user,true);CreateKey(path,user);Read(root);return path;
 }
 internal static string Read(string appRoot){
  var path=Path.Combine(Root(appRoot),"data","private");NoReparse(path);var user=User;Verify(Directory.GetAccessControl(path),user,true);
  var file=Path.Combine(path,"control.key");NoReparse(file);Verify(File.GetAccessControl(file),user,false);
  string key;using(var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read)){if(stream.Length!=64)throw new SecurityException("Private capability format rejected.");using(var reader=new StreamReader(stream,System.Text.Encoding.ASCII,false))key=reader.ReadToEnd();}
  if(!Regex.IsMatch(key,"\\A[a-f0-9]{64}\\z"))throw new SecurityException("Private capability format rejected.");return key;
 }
 internal static bool AllowedPage(string appRoot,string page){
  Uri uri;if(!Uri.TryCreate(page,UriKind.Absolute,out uri)||uri.UserInfo!=""||uri.Fragment!="")return false;
  if(uri.Scheme=="http"&&uri.Host=="127.0.0.1"&&uri.Port==8767&&uri.Query=="")return uri.AbsolutePath=="/index.html"||uri.AbsolutePath=="/classic/index.html"||uri.AbsolutePath=="/luna-blue/index.html";
  if(!uri.IsFile||uri.Query!=""||uri.IsUnc)return false;
  var runtime=Path.Combine(Path.GetFullPath(appRoot),"runtime");foreach(var folder in new[]{"wallpaper",Path.Combine("themes","classic"),Path.Combine("themes","luna-blue")})if(page.Equals(new Uri(Path.Combine(runtime,folder,"launcher-overlay.html")).AbsoluteUri,StringComparison.Ordinal))return true;return false;
 }
 internal static string InjectionScript(string appRoot,string exactAllowedPage){
  if(!AllowedPage(appRoot,exactAllowedPage))throw new SecurityException("Private bootstrap page rejected.");
  var uri=new Uri(exactAllowedPage);string match=uri.IsFile?"location.href==="+Quote(exactAllowedPage):"location.origin==='http://127.0.0.1:8767'&&location.pathname==="+Quote(uri.AbsolutePath);
  return "(()=>{if(window.top!==window||!("+match+"))return;Object.defineProperty(window,'VG_LOCAL_CONTROL_KEY',{value:"+Quote(Read(appRoot))+",writable:false,configurable:false});})();";
 }
 static string Quote(string value){return "\""+value.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\r","\\r").Replace("\n","\\n").Replace("\u2028","\\u2028").Replace("\u2029","\\u2029")+"\"";}
}
