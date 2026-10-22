using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace PaperGreen {
 // Paths come exclusively from a native chooser. No request field can name a file.
 internal sealed class LayoutFileChoice {
  internal readonly string Path;internal readonly bool OverwriteAllowed;
  internal LayoutFileChoice(string path,bool overwriteAllowed){Path=path;OverwriteAllowed=overwriteAllowed;}
 }
 internal sealed class LayoutFiles {
  internal const int MaxBytes=32768;
  static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
  readonly Form owner;readonly bool desktop;readonly Action<object> send;readonly Func<IWin32Window,string,LayoutFileChoice> chooser;readonly Func<string,IDisposable> nativeScope;
  bool busy;int generation;IntPtr activeChooserOwner;
  internal LayoutFiles(Form owner,bool desktop,Action<object> send):this(owner,desktop,send,null){}
  internal LayoutFiles(Form owner,bool desktop,Action<object> send,Func<IWin32Window,string,LayoutFileChoice> chooser):this(owner,desktop,send,chooser,null){}
  internal LayoutFiles(Form owner,bool desktop,Action<object> send,Func<IWin32Window,string,LayoutFileChoice> chooser,Func<string,IDisposable> nativeScope){
   if(send==null)throw new ArgumentNullException("send");this.owner=owner;this.desktop=desktop;this.send=send;this.chooser=chooser??ChooseFile;this.nativeScope=nativeScope;
  }
  // Call on navigation, WebView replacement and disposal. A modal chooser can run a
  // nested message loop; invalidating its generation prevents a late file write.
  internal void CancelPending(){generation++;if(activeChooserOwner!=IntPtr.Zero)CloseOwnedDialogs(activeChooserOwner);}
  internal static bool IsTrustedPage(string source){
   Uri uri;return Uri.TryCreate(source,UriKind.Absolute,out uri)&&uri.Scheme=="http"&&uri.Host=="127.0.0.1"&&uri.Port==8767&&String.IsNullOrEmpty(uri.UserInfo)&&(uri.AbsolutePath=="/index.html"||uri.AbsolutePath=="/classic/index.html"||uri.AbsolutePath=="/luna-blue/index.html");
  }
  internal bool Handle(Dictionary<string,object> request){
   object raw; if(request==null||!request.TryGetValue("type",out raw)||!(raw is string)||(string)raw!="layout-file-request")return false;
   string id=StringField(request,"requestId"),action=StringField(request,"action");Guid parsed;
   if(id==null||!Guid.TryParseExact(id,"D",out parsed)||(action!="open"&&action!="save"))return true;
   string content=StringField(request,"content");
   if(!Fields(request,action=="save"?new[]{"type","requestId","action","content"}:new[]{"type","requestId","action"})||action=="save"&&!ValidExport(content)){
    Result(id,action,"error",null,null,"Некорректный файл раскладки.");return true;
   }
   if(busy){Result(id,action,"error",null,null,"Сначала закройте открытый диалог выбора файла.");return true;}
   int current=generation;busy=true;IDisposable scope=null;
   try{
    if(nativeScope!=null){scope=nativeScope(action);if(scope==null){Result(id,action,"error",null,null,"Сначала завершите открытый диалог в WallpaperShell.");return true;}}
    var choice=chooser(owner,action);
    if(current!=generation)return true;
    if(choice==null){Result(id,action,"cancelled",null,null,null);return true;}
    string path=ValidatePath(choice.Path);
    if(action=="open"){
     string text=ReadFile(path);if(current==generation)Result(id,action,"ok",text,System.IO.Path.GetFileName(path),null);
    }else{
     WriteFile(path,content,choice.OverwriteAllowed);if(current==generation)Result(id,action,"ok",null,System.IO.Path.GetFileName(path),null);
    }
   }catch(Exception){if(current==generation)Result(id,action,"error",null,null,"Не удалось открыть или сохранить файл раскладки. Проверьте файл и права доступа.");}
   finally{busy=false;if(scope!=null)scope.Dispose();}
   return true;
  }
  void Result(string id,string action,string status,string content,string filename,string message){
   var response=new Dictionary<string,object>{{"type","layout-file-result"},{"requestId",id},{"action",action},{"status",status}};
   if(content!=null)response["content"]=content;if(filename!=null)response["filename"]=filename;if(message!=null)response["message"]=message;
   try{send(response);}catch{/* A navigation can dispose the receiving WebView. */}
  }
  LayoutFileChoice ChooseFile(IWin32Window originalOwner,string action){
   // WorkerW children are not suitable owners for Windows file dialogs. A temporary
   // top-level owner appears only for this explicit user action, on the same monitor.
   Form proxy=null;IWin32Window dialogOwner=originalOwner;
   try{
    if(desktop){
     Rectangle area=owner==null?Screen.PrimaryScreen.WorkingArea:Screen.FromControl(owner).WorkingArea;
     proxy=new DialogOwnerForm{ShowInTaskbar=false,FormBorderStyle=FormBorderStyle.None,StartPosition=FormStartPosition.Manual,Opacity=0,Size=new Size(1,1),Location=new Point(area.Left+area.Width/2,area.Top+area.Height/2)};
     proxy.Show();dialogOwner=proxy;
    }
    activeChooserOwner=dialogOwner==null?IntPtr.Zero:dialogOwner.Handle;
    using(FileDialog dialog=action=="save"?(FileDialog)new SaveFileDialog{OverwritePrompt=false,CreatePrompt=false}:new OpenFileDialog{Multiselect=false,CheckFileExists=true}){
     dialog.Title=action=="save"?"Сохранить раскладку WallpaperShell":"Открыть раскладку WallpaperShell";
     dialog.Filter="Раскладка WallpaperShell (*.json)|*.json";dialog.DefaultExt="json";dialog.AddExtension=true;dialog.CheckPathExists=true;dialog.ValidateNames=true;dialog.DereferenceLinks=false;dialog.RestoreDirectory=true;
     if(action=="save")dialog.FileName="WallpaperShell-layout.json";
     if(dialog.ShowDialog(dialogOwner)!=DialogResult.OK)return null;
     string path=ValidatePath(dialog.FileName);
     if(action=="save")return ApproveSaveChoice(path,()=>MessageBox.Show(dialogOwner,"Файл с таким именем уже существует. Заменить его?","Сохранить раскладку WallpaperShell",MessageBoxButtons.YesNo,MessageBoxIcon.Question,MessageBoxDefaultButton.Button2)==DialogResult.Yes);
     return new LayoutFileChoice(path,false);
    }
   }finally{activeChooserOwner=IntPtr.Zero;if(proxy!=null){proxy.Close();proxy.Dispose();}}
  }
  sealed class DialogOwnerForm:Form{protected override bool ShowWithoutActivation{get{return true;}}}
  delegate bool EnumThreadWindow(IntPtr hwnd,IntPtr state);
  [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]static extern bool EnumThreadWindows(uint threadId,EnumThreadWindow callback,IntPtr state);
  [DllImport("user32.dll")]static extern IntPtr GetWindow(IntPtr hwnd,uint command);
  [DllImport("user32.dll")]static extern bool PostMessage(IntPtr hwnd,uint message,IntPtr wp,IntPtr lp);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr hwnd,StringBuilder text,int size);
  static void CloseOwnedDialogs(IntPtr ownerHandle){
   // Only this UI thread's native dialog chain is closed. Never enumerate or close
   // unrelated applications, or activate a proxy during recovery/display changes.
   EnumThreadWindows(GetCurrentThreadId(),delegate(IntPtr hwnd,IntPtr state){
    var name=new StringBuilder(64);GetClassName(hwnd,name,name.Capacity);if(name.ToString()!="#32770")return true;
    IntPtr parent=GetWindow(hwnd,4);for(int depth=0;parent!=IntPtr.Zero&&depth<16;depth++){
     if(parent==ownerHandle){PostMessage(hwnd,0x0010,IntPtr.Zero,IntPtr.Zero);break;}parent=GetWindow(parent,4);
    }return true;
   },IntPtr.Zero);
  }
  internal static LayoutFileChoice ApproveSaveChoice(string path,Func<bool> confirmOverwrite){
   path=ValidatePath(path);
   // Native SaveFileDialog cannot tell us whether its own overwrite prompt was
   // shown. Confirm explicitly after selection instead of inferring approval
   // from a later File.Exists call. A file appearing after this check is protected
   // by the creation-only atomic move in WriteFile.
   if(!File.Exists(path))return new LayoutFileChoice(path,false);
   if(confirmOverwrite==null||!confirmOverwrite())return null;
   return new LayoutFileChoice(path,true);
  }
  static string StringField(Dictionary<string,object> source,string key){object value;return source.TryGetValue(key,out value)?value as string:null;}
  static bool Fields(Dictionary<string,object> value,string[] names){if(value.Count!=names.Length)return false;foreach(string name in names)if(!value.ContainsKey(name))return false;return true;}
  static bool Number(object value){return value is byte||value is short||value is int||value is long||value is decimal||value is float||value is double;}
  static bool Finite(object value){return Number(value)&&!Double.IsNaN(Convert.ToDouble(value))&&!Double.IsInfinity(Convert.ToDouble(value));}
  internal static bool ValidExport(string text){
   try{
    if(text==null||text.Length>MaxBytes||Utf8.GetByteCount(text)>MaxBytes)return false;
    var json=new JavaScriptSerializer{MaxJsonLength=MaxBytes,RecursionLimit=16};
    var root=json.DeserializeObject(text) as Dictionary<string,object>;
    if(root==null||!Fields(root,new[]{"format","version","theme","canvas","widgets"})||StringField(root,"format")!="paper-green-layout"||!Number(root["version"])||(Convert.ToDouble(root["version"])!=1&&Convert.ToDouble(root["version"])!=2&&Convert.ToDouble(root["version"])!=3))return false;
    string theme=StringField(root,"theme");if(theme!="paper-green"&&theme!="classic"&&theme!="luna-blue")return false;
    var canvas=root["canvas"] as Dictionary<string,object>;
    if(canvas==null||!Fields(canvas,new[]{"width","height"})||!Number(canvas["width"])||!Number(canvas["height"])||Convert.ToDouble(canvas["width"])!=1920||Convert.ToDouble(canvas["height"])!=1080)return false;
    var widgets=root["widgets"] as Dictionary<string,object>;if(widgets==null||widgets.Count==0||widgets.Count>32)return false;
    foreach(var item in widgets){
     var fields=item.Value as Dictionary<string,object>;
     if(!Regex.IsMatch(item.Key,"^[a-z][a-z0-9-]{0,39}$")||fields==null||!Fields(fields,new[]{"x","y","scale","visible"})||!Finite(fields["x"])||!Finite(fields["y"])||!Finite(fields["scale"])||Convert.ToDouble(fields["scale"])<=0||!(fields["visible"] is bool))return false;
    }
    return true;
   }catch{return false;}
  }
  internal static string ValidatePath(string path){
   if(String.IsNullOrWhiteSpace(path)||path.IndexOf('\0')>=0||path.StartsWith(@"\\?\",StringComparison.Ordinal)||path.StartsWith(@"\\.\",StringComparison.Ordinal)||path.StartsWith(@"\??\",StringComparison.Ordinal))throw new IOException("Invalid layout path");
   bool drive=Regex.IsMatch(path,@"^[a-zA-Z]:[\\/]");bool unc=path.StartsWith(@"\\",StringComparison.Ordinal);
   if(!drive&&!unc)throw new IOException("Absolute path required");
   if(path.IndexOf(':',drive?2:0)>=0)throw new IOException("Alternate streams are not layout files");
   foreach(string rawPart in path.Substring(drive?3:2).Split(new[]{'\\','/'},StringSplitOptions.RemoveEmptyEntries))if(rawPart.EndsWith(" ",StringComparison.Ordinal)||rawPart!="."&&rawPart!=".."&&rawPart.EndsWith(".",StringComparison.Ordinal))throw new IOException("Ambiguous file component");
   string full=System.IO.Path.GetFullPath(path);
   if(!String.Equals(System.IO.Path.GetExtension(full),".json",StringComparison.OrdinalIgnoreCase))throw new IOException("JSON file required");
   string[] parts=full.Substring(drive?3:2).Split(new[]{'\\','/'},StringSplitOptions.RemoveEmptyEntries);
   foreach(string part in parts){if(part.EndsWith(".",StringComparison.Ordinal)||part.EndsWith(" ",StringComparison.Ordinal)||Regex.IsMatch(part,@"^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)",RegexOptions.IgnoreCase))throw new IOException("Invalid file component");}
   if(Directory.Exists(full))throw new IOException("Layout is a directory");
   if(File.Exists(full)&&(File.GetAttributes(full)&(FileAttributes.Directory|FileAttributes.ReparsePoint|FileAttributes.Device))!=0)throw new IOException("Not a regular layout file");
   return full;
  }
  internal static string ReadFile(string path){
   path=ValidatePath(path);byte[] bytes;
   using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read)){
    if(stream.Length>MaxBytes+3)throw new IOException("Layout exceeds size limit");
    bytes=new byte[(int)stream.Length];int offset=0;
    while(offset<bytes.Length){int count=stream.Read(bytes,offset,bytes.Length-offset);if(count==0)throw new IOException("Incomplete layout file");offset+=count;}
    if(stream.ReadByte()!=-1||stream.Length>MaxBytes+3)throw new IOException("Layout changed while reading");
   }
   int start=bytes.Length>=3&&bytes[0]==239&&bytes[1]==187&&bytes[2]==191?3:0;
   if(bytes.Length-start>MaxBytes)throw new IOException("Layout exceeds size limit");
   string text=Utf8.GetString(bytes,start,bytes.Length-start);
   if(text.IndexOf('\0')>=0)throw new IOException("Invalid text encoding");return text;
  }
  internal static void WriteFile(string path,string content,bool overwriteAllowed){
   if(!ValidExport(content))throw new IOException("Invalid layout export");
   path=ValidatePath(path);string temporary=System.IO.Path.Combine(System.IO.Path.GetDirectoryName(path),".PaperGreen-layout-"+Guid.NewGuid().ToString("N")+".tmp");
   try{
    byte[] bytes=Utf8.GetBytes(content);
    using(var stream=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None,4096,FileOptions.WriteThrough)){stream.Write(bytes,0,bytes.Length);stream.Flush(true);}
    // Never fall back to deleting the destination. A newly appeared file must not
    // be replaced when the chooser approved creation of a new file.
    if(overwriteAllowed)File.Replace(temporary,path,null);else File.Move(temporary,path);
   }finally{try{if(File.Exists(temporary))File.Delete(temporary);}catch{}}
  }
 }
}
