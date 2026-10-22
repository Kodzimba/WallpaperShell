using System;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
class PrivateBootstrapTests {
 static int checks;
 static void Check(bool ok,string name){checks++;if(!ok)throw new Exception(name);}
 static void Reject(Action action,string name){bool rejected=false;try{action();}catch{rejected=true;}Check(rejected,name);}
 static void Main(){
  var root=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"private-fixture-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
  try{
   var everyone=new SecurityIdentifier(WellKnownSidType.WorldSid,null);var acl=Directory.GetAccessControl(root);acl.AddAccessRule(new FileSystemAccessRule(everyone,FileSystemRights.ReadAndExecute,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));Directory.SetAccessControl(root,acl);
   var before=Directory.GetAccessControl(root).GetSecurityDescriptorSddlForm(AccessControlSections.Access);var data=Path.Combine(root,"data");Directory.CreateDirectory(data);var legacy=Path.Combine(data,"existing-settings.json");File.WriteAllText(legacy,"synthetic");var legacyAcl=File.GetAccessControl(legacy).GetSecurityDescriptorSddlForm(AccessControlSections.Access);
   var path=PrivateBootstrap.EnsurePrivate(root);Check(path==Path.Combine(data,"private"),"Private path scoped under own data");Check(Directory.GetAccessControl(path).AreAccessRulesProtected,"Private directory breaks inherited broad permissions");
   foreach(FileSystemAccessRule rule in Directory.GetAccessControl(path).GetAccessRules(true,true,typeof(SecurityIdentifier)))Check(!rule.IdentityReference.Equals(everyone),"Everyone absent from private directory");
   Check(Directory.GetAccessControl(root).GetSecurityDescriptorSddlForm(AccessControlSections.Access)==before,"Portable root ACL untouched");Check(File.GetAccessControl(legacy).GetSecurityDescriptorSddlForm(AccessControlSections.Access)==legacyAcl,"Existing userdata ACL untouched");
   var key=new string('a',64);var file=Path.Combine(path,"control.key");File.WriteAllText(file+".tmp",key,Encoding.ASCII);File.Move(file+".tmp",file);Check(PrivateBootstrap.Read(root)==key,"Created token inherits private DACL through temp rename");Check(PrivateBootstrap.EnsurePrivate(root)==path&&PrivateBootstrap.Read(root)==key,"Repeated initialization preserves own token");
   string main="http://127.0.0.1:8767/luna-blue/index.html";Check(PrivateBootstrap.AllowedPage(root,main),"Exact native wallpaper page accepted");
   foreach(var rejected in new[]{"http://localhost:8767/index.html","https://127.0.0.1:8767/index.html","http://127.0.0.1:8768/index.html","http://127.0.0.1:8767/other.html","http://127.0.0.1:8767/index.html?next=remote","http://127.0.0.1:8767/index.html#remote","http://user@127.0.0.1:8767/index.html","https://example.invalid/index.html",new Uri(Path.Combine(root,"runtime","other","launcher-overlay.html")).AbsoluteUri}){Check(!PrivateBootstrap.AllowedPage(root,rejected),"Untrusted page rejected");Reject(()=>PrivateBootstrap.InjectionScript(root,rejected),"Untrusted page cannot obtain native secret script");}
   string popup=new Uri(Path.Combine(root,"runtime","themes","luna-blue","launcher-overlay.html")).AbsoluteUri;Check(PrivateBootstrap.AllowedPage(root,popup),"Exact own native popup accepted");
   string script=PrivateBootstrap.InjectionScript(root,main);Check(script.Contains("window.top!==window")&&script.Contains("location.origin==='http://127.0.0.1:8767'")&&script.Contains("location.pathname===\"/luna-blue/index.html\""),"Main script verifies top-level origin and exact path");
   File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"main-script.js"),script,Encoding.UTF8);File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"popup-script.js"),PrivateBootstrap.InjectionScript(root,popup),Encoding.UTF8);File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"popup-uri.txt"),popup,Encoding.UTF8);
   File.WriteAllText(file,new string('a',63)+"\n",Encoding.ASCII);Reject(()=>PrivateBootstrap.Read(root),"Token trailing newline rejected");File.WriteAllText(file,new string('A',64),Encoding.ASCII);Reject(()=>PrivateBootstrap.Read(root),"Noncanonical token rejected");File.WriteAllText(file,key,Encoding.ASCII);
   var unsafeAcl=File.GetAccessControl(file);unsafeAcl.AddAccessRule(new FileSystemAccessRule(everyone,FileSystemRights.Read,AccessControlType.Allow));File.SetAccessControl(file,unsafeAcl);Reject(()=>PrivateBootstrap.Read(root),"Broad explicit token file permission fails closed");
   Console.WriteLine("Private bootstrap: "+checks+" synthetic ACL/policy checks passed; existing application data untouched.");
  }finally{if(!root.StartsWith(AppDomain.CurrentDomain.BaseDirectory,StringComparison.OrdinalIgnoreCase))throw new Exception("Fixture cleanup scope rejected");Directory.Delete(root,true);}
 }
}
