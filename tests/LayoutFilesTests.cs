using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
using PaperGreen;

class LayoutFilesTests {
 sealed class TestScope:IDisposable{Action close;internal TestScope(Action close){this.close=close;}public void Dispose(){var callback=close;close=null;if(callback!=null)callback();}}
 static int checks;
 static readonly string Export="{\"format\":\"paper-green-layout\",\"version\":1,\"theme\":\"paper-green\",\"canvas\":{\"width\":1920,\"height\":1080},\"widgets\":{\"clock\":{\"x\":12,\"y\":30,\"scale\":1,\"visible\":true}}}";
 static void Require(bool ok,string message){checks++;if(!ok)throw new Exception(message);}
 static void Reject(Action operation,string message){bool failed=false;try{operation();}catch{failed=true;}Require(failed,message);}
 static Dictionary<string,object> Request(string action){var result=new Dictionary<string,object>{{"type","layout-file-request"},{"requestId",Guid.NewGuid().ToString("D")},{"action",action}};if(action=="save")result["content"]=Export;return result;}
 static Dictionary<string,object> Response(object response){return (Dictionary<string,object>)response;}
 static string Status(object response){return (string)Response(response)["status"];}
 [STAThread]static int Main(){
  string root=Path.Combine(Path.GetTempPath(),"PaperGreen-LayoutFilesTests-"+Guid.NewGuid().ToString("N"));
  Directory.CreateDirectory(root);
  try{
   string target=Path.Combine(root,"layout.json");
   Require(LayoutFiles.IsTrustedPage("http://127.0.0.1:8767/index.html?profile=display-1"),"Own Paper Green page trusted");
   Require(LayoutFiles.IsTrustedPage("http://127.0.0.1:8767/classic/index.html"),"Own Classic page trusted");
   Require(LayoutFiles.IsTrustedPage("http://127.0.0.1:8767/luna-blue/index.html"),"Own Luna Blue page trusted");
   Require(!LayoutFiles.IsTrustedPage("http://127.0.0.1:8767/luna-blue/launcher-overlay.html"),"Luna popup cannot use main Surface commands");
   foreach(string source in new[]{"https://127.0.0.1:8767/index.html","http://localhost:8767/index.html","http://127.0.0.1:8765/index.html","http://127.0.0.1:8767/launcher-overlay.html","http://127.0.0.1:8767/classic/other.html","http://name:pass@127.0.0.1:8767/index.html","file:///index.html","not-a-url"})Require(!LayoutFiles.IsTrustedPage(source),"Foreign or popup page not trusted");
   Require(LayoutFiles.ValidExport(Export),"Portable header and bounded widget shapes accepted");
   Require(LayoutFiles.ValidExport(Export.Replace("paper-green\"","luna-blue\"")),"Luna portable header accepted");
   Require(!LayoutFiles.ValidExport("hello"),"Arbitrary text rejected");
   Require(LayoutFiles.ValidExport(Export.Replace("\"version\":1","\"version\":2")),"Current v2 portable header accepted");
   Require(LayoutFiles.ValidExport(Export.Replace("\"version\":1","\"version\":3")),"Current v3 portable header accepted");
   Require(!LayoutFiles.ValidExport(Export.Replace("\"version\":1","\"version\":4")),"Unknown version rejected");
   Require(!LayoutFiles.ValidExport(Export.Replace("\"theme\":\"paper-green\"","\"theme\":\"evil\"")),"Unknown theme rejected");
   Require(!LayoutFiles.ValidExport(Export.Replace("\"x\":12","\"x\":\"12\"")),"Numeric strings rejected");
   Require(!LayoutFiles.ValidExport(Export.Replace("\"visible\":true","\"visible\":1")),"Nonboolean visibility rejected");
   Require(!LayoutFiles.ValidExport(Export.Replace("\"scale\":1","\"scale\":0")),"Zero scale rejected");
   Require(!LayoutFiles.ValidExport(Export.Replace("\"x\":12","\"x\":12,\"script\":\"run\"")),"Unexpected widget fields rejected");
   Require(!LayoutFiles.ValidExport(Export.Replace("\"widgets\":", "\"path\":\"secret\",\"widgets\":")),"Unexpected export fields rejected");
   string exact=Export+new string(' ',LayoutFiles.MaxBytes-Encoding.UTF8.GetByteCount(Export));
   Require(LayoutFiles.ValidExport(exact),"Exactly 32 KiB UTF8 export accepted");
   Require(!LayoutFiles.ValidExport(exact+" "),"Export beyond byte limit rejected");
   Require(!LayoutFiles.ValidExport(Export+new string('\u0416',17000)),"UTF8 byte limit enforced rather than character count");
   Require(!LayoutFiles.ValidExport(Export+"\ud800"),"Invalid surrogate rejected before encoding");

   LayoutFiles.WriteFile(target,Export,false);
   Require(File.ReadAllText(target)==Export,"New selected file saved");
   Require(!File.ReadAllBytes(target).Take(3).SequenceEqual(new byte[]{239,187,191}),"Export is UTF8 without BOM");
   string replacement=Export.Replace("\"x\":12","\"x\":88");
   int confirmations=0;
   var declined=LayoutFiles.ApproveSaveChoice(target,()=>{confirmations++;return false;});
   Require(declined==null&&confirmations==1&&File.ReadAllText(target)==Export,"Existing file requires explicit approval and No does not write");
   var approved=LayoutFiles.ApproveSaveChoice(target,()=>{confirmations++;return true;});
   Require(approved!=null&&approved.OverwriteAllowed&&confirmations==2,"Only explicit Yes grants overwrite permission");
   string raced=Path.Combine(root,"appeared-after-selection.json");
   var creation=LayoutFiles.ApproveSaveChoice(raced,()=>{confirmations++;return true;});
   Require(!creation.OverwriteAllowed&&confirmations==2,"Choosing an absent file grants creation only and shows no overwrite prompt");
   File.WriteAllText(raced,Export);
   Reject(()=>LayoutFiles.WriteFile(creation.Path,replacement,creation.OverwriteAllowed),"File appearing after selection cannot be overwritten without explicit approval");
   Require(File.ReadAllText(raced)==Export,"Selection-time creation race preserves newly appeared file");
   File.Delete(raced);
   Reject(()=>LayoutFiles.WriteFile(target,replacement,false),"Existing destination is not overwritten without chooser approval");
   Require(File.ReadAllText(target)==Export,"Refused overwrite leaves destination intact");
   Require(Directory.GetFiles(root).Length==1,"Failed save cleans its sibling temporary file");
   LayoutFiles.WriteFile(target,replacement,true);
   Require(File.ReadAllText(target)==replacement,"Approved existing file atomically replaced");
   string absent=Path.Combine(root,"missing.json");
   Reject(()=>LayoutFiles.WriteFile(absent,Export,true),"Disappeared approved destination is not silently recreated");
   Require(!File.Exists(absent),"Failed atomic replacement creates no destination");
   using(var held=new FileStream(target,FileMode.Open,FileAccess.Read,FileShare.Read)){
    Reject(()=>LayoutFiles.WriteFile(target,Export,true),"Locked destination rejects replacement");
   }
   Require(File.ReadAllText(target)==replacement&&Directory.GetFiles(root).Length==1,"Failed atomic replacement preserves original and cleans temporary file");

   File.WriteAllBytes(target,Encoding.UTF8.GetBytes("{\"title\":\"\u043c\u043e\u0439 \u044d\u043a\u0440\u0430\u043d\"}"));
   Require(LayoutFiles.ReadFile(target)=="{\"title\":\"\u043c\u043e\u0439 \u044d\u043a\u0440\u0430\u043d\"}","UTF8 characters decoded exactly");
   byte[] bom=new byte[]{239,187,191};
   File.WriteAllBytes(target,bom.Concat(Encoding.UTF8.GetBytes(exact)).ToArray());
   Require(LayoutFiles.ReadFile(target)==exact,"Optional UTF8 BOM excluded from content byte limit");
   File.WriteAllBytes(target,new byte[LayoutFiles.MaxBytes+4]);
   Reject(()=>LayoutFiles.ReadFile(target),"Oversized file rejected before allocation");
   File.WriteAllBytes(target,Encoding.UTF8.GetBytes(exact+" "));
   Reject(()=>LayoutFiles.ReadFile(target),"Oversized content rejected when no BOM");
   File.WriteAllBytes(target,new byte[]{123,34,192,175,34,125});
   Reject(()=>LayoutFiles.ReadFile(target),"Malformed UTF8 rejected rather than repaired");
   File.WriteAllBytes(target,new byte[]{255,254,123,0,125,0});
   Reject(()=>LayoutFiles.ReadFile(target),"UTF16 rejected");
   File.WriteAllBytes(target,new byte[]{123,0,125});
   Reject(()=>LayoutFiles.ReadFile(target),"Embedded NUL rejected");
   foreach(string path in new[]{"relative.json",@"\\?\C:\layout.json",@"\\.\C:\layout.json",@"\??\C:\layout.json",Path.Combine(root,"layout.json:stream.json"),Path.Combine(root,"NUL.json"),Path.Combine(root,"file.txt"),Path.Combine(root,"file.json ")})Reject(()=>LayoutFiles.ValidatePath(path),"Unsafe or non-JSON path rejected");
   string directory=Path.Combine(root,"directory.json");Directory.CreateDirectory(directory);
   Reject(()=>LayoutFiles.ReadFile(directory),"Directories rejected");
   File.WriteAllText(target,Export,new UTF8Encoding(false));

   var responses=new List<object>();int picks=0;
   var bridge=new LayoutFiles(null,false,responses.Add,(owner,action)=>{picks++;return new LayoutFileChoice(target,true);});
   Require(!bridge.Handle(new Dictionary<string,object>{{"type","other"}}),"Other bridge messages left for their handler");
   var bad=Request("open");bad["path"]=target;bridge.Handle(bad);
   Require(picks==0&&Status(responses.Last())=="error","JS-supplied path rejected without chooser");
   bad=Request("open");bad["content"]="unexpected";bridge.Handle(bad);
   Require(picks==0&&Status(responses.Last())=="error","Open request cannot inject content");
   bad=Request("save");bad["content"]=new string('x',LayoutFiles.MaxBytes+1);bridge.Handle(bad);
   Require(picks==0&&Status(responses.Last())=="error","Oversized save rejected before opening dialog");
   bad=Request("open");bad["requestId"]="not-uuid";int sent=responses.Count;bridge.Handle(bad);
   Require(picks==0&&responses.Count==sent,"Invalid correlation ID rejected silently");
   bad=Request("open");bad["action"]="delete";bridge.Handle(bad);
   Require(picks==0&&responses.Count==sent,"Unknown action rejected without filesystem access");
   bridge.Handle(Request("open"));var result=Response(responses.Last());
   Require(picks==1&&(string)result["status"]=="ok"&&(string)result["content"]==Export&&(string)result["filename"]=="layout.json","Open result contains only selected text and basename");
   Require(!new JavaScriptSerializer().Serialize(result).Contains(root.Replace("\\","\\\\")),"Open result never leaks absolute path");
   bridge.Handle(Request("save"));result=Response(responses.Last());
   Require(picks==2&&(string)result["status"]=="ok"&&!result.ContainsKey("content")&&!result.ContainsKey("path"),"Save result omits content and path");
   var cancelled=new LayoutFiles(null,false,responses.Add,(owner,action)=>null);cancelled.Handle(Request("save"));
   Require(Status(responses.Last())=="cancelled"&&File.ReadAllText(target)==Export,"Cancelling chooser never writes");
   var failing=new LayoutFiles(null,false,responses.Add,(owner,action)=>{throw new IOException(target);});failing.Handle(Request("open"));
   result=Response(responses.Last());
   Require((string)result["status"]=="error"&&!((string)result["message"]).Contains(target),"Errors expose no exception paths");

   LayoutFiles stale=null;stale=new LayoutFiles(null,false,responses.Add,(owner,action)=>{stale.CancelPending();return new LayoutFileChoice(target,true);});
   sent=responses.Count;var staleSave=Request("save");staleSave["content"]=replacement;stale.Handle(staleSave);
   Require(responses.Count==sent&&File.ReadAllText(target)==Export,"Navigation invalidates late save result and prevents file write");
   LayoutFiles reentrant=null;int reentrantPicks=0;
   reentrant=new LayoutFiles(null,false,responses.Add,(owner,action)=>{reentrantPicks++;reentrant.Handle(Request("open"));return null;});
   sent=responses.Count;reentrant.Handle(Request("open"));
   Require(reentrantPicks==1&&responses.Count==sent+2&&Status(responses[sent])=="error"&&Status(responses[sent+1])=="cancelled","Nested requests cannot create a second native chooser");
   Require(File.ReadAllText(target)==Export,"No rejected operation changed the selected file");
   int leases=0,returns=0;var guarded=new LayoutFiles(null,false,responses.Add,(owner,action)=>{leases++;return null;},action=>null);
   guarded.Handle(Request("open"));Require(leases==0&&Status(responses.Last())=="error","Global modal reservation rejects chooser before any native/file work");
   var released=new LayoutFiles(null,false,responses.Add,(owner,action)=>null,action=>new TestScope(()=>returns++));released.Handle(Request("open"));
   Require(returns==1&&Status(responses.Last())=="cancelled","Chooser cancellation releases its global scope");
   var faultScope=new LayoutFiles(null,false,responses.Add,(owner,action)=>{throw new IOException();},action=>new TestScope(()=>returns++));faultScope.Handle(Request("save"));
   Require(returns==2&&Status(responses.Last())=="error","Chooser exception releases its global scope");
   Console.WriteLine("Layout file tests passed: "+checks+" assertions; no native dialogs opened.");return 0;
  }catch(Exception e){Console.Error.WriteLine("Layout file test failed: "+e.GetType().Name+": "+e.Message);return 1;}
  finally{try{string full=Path.GetFullPath(root);if(full.StartsWith(Path.Combine(Path.GetTempPath(),"PaperGreen-LayoutFilesTests-"),StringComparison.OrdinalIgnoreCase))Directory.Delete(full,true);}catch{}}
 }
}
