using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;

// Up to 100 regular files, explicit user drop. No folder deletion or permanent-delete path.
public static class VGLauncherFiles {
 [ComImport,Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface IShellItem {
  void BindToHandler(IntPtr context,ref Guid handler,ref Guid iid,out IntPtr result);
  void GetParent(out IShellItem parent);void GetDisplayName(uint kind,out IntPtr name);void GetAttributes(uint mask,out uint attributes);void Compare(IShellItem other,uint hint,out int order);
 }
 [ComImport,Guid("947aab5f-0a5c-4c13-b4d6-4bf7836fc9f8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IFileOperation {
  void Advise(ISink sink,out uint cookie);void Unadvise(uint cookie);void SetOperationFlags(uint flags);void SetProgressMessage([MarshalAs(UnmanagedType.LPWStr)]string message);void SetProgressDialog(IntPtr dialog);void SetProperties(IntPtr properties);void SetOwnerWindow(IntPtr window);
  void ApplyPropertiesToItem(IShellItem item);void ApplyPropertiesToItems(IntPtr items);
  void RenameItem(IShellItem item,[MarshalAs(UnmanagedType.LPWStr)]string name,ISink sink);void RenameItems(IntPtr items,[MarshalAs(UnmanagedType.LPWStr)]string name);
  void MoveItem(IShellItem item,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name,ISink sink);void MoveItems(IntPtr items,IShellItem folder);
  void CopyItem(IShellItem item,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name,ISink sink);void CopyItems(IntPtr items,IShellItem folder);
  void DeleteItem(IShellItem item,ISink sink);void DeleteItems(IntPtr items);void NewItem(IShellItem folder,uint attributes,[MarshalAs(UnmanagedType.LPWStr)]string name,[MarshalAs(UnmanagedType.LPWStr)]string template,ISink sink);
  [PreserveSig]int PerformOperations();void GetAnyOperationsAborted([MarshalAs(UnmanagedType.Bool)]out bool aborted);
 }
 [ComVisible(true),Guid("04b0f1a7-9490-44bc-96e1-4296a31252e2"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface ISink {
  [PreserveSig]int StartOperations();[PreserveSig]int FinishOperations(int result);
  [PreserveSig]int PreRenameItem(uint flags,IShellItem item,[MarshalAs(UnmanagedType.LPWStr)]string name);[PreserveSig]int PostRenameItem(uint flags,IShellItem item,[MarshalAs(UnmanagedType.LPWStr)]string name,int result,IShellItem created);
  [PreserveSig]int PreMoveItem(uint flags,IShellItem item,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name);[PreserveSig]int PostMoveItem(uint flags,IShellItem item,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name,int result,IShellItem created);
  [PreserveSig]int PreCopyItem(uint flags,IShellItem item,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name);[PreserveSig]int PostCopyItem(uint flags,IShellItem item,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name,int result,IShellItem created);
  [PreserveSig]int PreDeleteItem(uint flags,IShellItem item);[PreserveSig]int PostDeleteItem(uint flags,IShellItem item,int result,IShellItem created);
  [PreserveSig]int PreNewItem(uint flags,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name);[PreserveSig]int PostNewItem(uint flags,IShellItem folder,[MarshalAs(UnmanagedType.LPWStr)]string name,[MarshalAs(UnmanagedType.LPWStr)]string template,uint attributes,int result,IShellItem created);
  [PreserveSig]int UpdateProgress(uint total,uint done);[PreserveSig]int ResetTimer();[PreserveSig]int PauseTimer();[PreserveSig]int ResumeTimer();
 }
 [ComVisible(true),ClassInterface(ClassInterfaceType.None)] public sealed class RecycleSink:ISink {
  public bool recycled;
  public static bool Allows(uint flags){return (flags&0x80)!=0;}
  public int StartOperations(){return 0;}public int FinishOperations(int result){return 0;}
  public int PreDeleteItem(uint flags,IShellItem item){return Allows(flags)?0:unchecked((int)0x80004004);}
  public int PostDeleteItem(uint flags,IShellItem item,int result,IShellItem created){recycled=Allows(flags)&&result>=0&&created!=null;return 0;}
  public int PreRenameItem(uint f,IShellItem i,string n){return unchecked((int)0x80004004);}public int PostRenameItem(uint f,IShellItem i,string n,int r,IShellItem c){return 0;}
  public int PreMoveItem(uint f,IShellItem i,IShellItem d,string n){return unchecked((int)0x80004004);}public int PostMoveItem(uint f,IShellItem i,IShellItem d,string n,int r,IShellItem c){return 0;}
  public int PreCopyItem(uint f,IShellItem i,IShellItem d,string n){return unchecked((int)0x80004004);}public int PostCopyItem(uint f,IShellItem i,IShellItem d,string n,int r,IShellItem c){return 0;}
  public int PreNewItem(uint f,IShellItem d,string n){return unchecked((int)0x80004004);}public int PostNewItem(uint f,IShellItem d,string n,string t,uint a,int r,IShellItem c){return 0;}
  public int UpdateProgress(uint t,uint d){return 0;}public int ResetTimer(){return 0;}public int PauseTimer(){return 0;}public int ResumeTimer(){return 0;}
 }
 [DllImport("shell32.dll",CharSet=CharSet.Unicode,PreserveSig=false)] static extern void SHCreateItemFromParsingName(string path,IntPtr context,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out IShellItem item);
 static void RegularFile(string path){var attributes=File.GetAttributes(path);if((attributes&(FileAttributes.Directory|FileAttributes.ReparsePoint))!=0)throw new IOException("Not a regular file");}
 static void Sources(string[] sources){if(sources==null||sources.Length<1||sources.Length>100)throw new IOException("Invalid file count");var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);foreach(var source in sources){if(!seen.Add(Path.GetFullPath(source)))throw new IOException("Duplicate file");RegularFile(source);}}
 public static bool[] MoveMany(string[] sources,string folder){
  Sources(sources);var attributes=File.GetAttributes(folder);if((attributes&FileAttributes.Directory)==0||(attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("Not a regular directory");
  var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
  foreach(var source in sources){string name=Path.GetFileName(source),target=Path.Combine(folder,name);if(!names.Add(name)||File.Exists(target)||Directory.Exists(target))throw new IOException("Destination exists");}
  var completed=new bool[sources.Length];
  for(int i=0;i<sources.Length;i++){try{File.Move(sources[i],Path.Combine(folder,Path.GetFileName(sources[i])));completed[i]=true;}catch{break;}}
  return completed;
 }
 public static void Move(string source,string folder){
  RegularFile(source);var attributes=File.GetAttributes(folder);if((attributes&FileAttributes.Directory)==0||(attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("Not a regular directory");
  // File.Move refuses an existing destination atomically; never replace or auto-rename.
  File.Move(source,Path.Combine(folder,Path.GetFileName(source)));
 }
 public static void Recycle(string source){
  if(!RecycleMany(new string[]{source})[0])throw new IOException("Recycling was not confirmed");
 }
 public static void Rename(string source,string name,IntPtr owner){
  if(String.IsNullOrWhiteSpace(name)||name=="."||name==".."||name.Length>255||name.IndexOfAny(Path.GetInvalidFileNameChars())>=0||name.EndsWith(".")||name.EndsWith(" "))throw new IOException("Invalid name");
  if((File.GetAttributes(source)&FileAttributes.ReparsePoint)!=0)throw new IOException("Item changed");
  var target=Path.Combine(Path.GetDirectoryName(source),name);if(String.Equals(source,target,StringComparison.Ordinal))return;
  if(!String.Equals(source,target,StringComparison.OrdinalIgnoreCase)&&(File.Exists(target)||Directory.Exists(target)))throw new IOException("Destination exists");
  IShellItem item=null;IFileOperation operation=null;try{
   var iid=typeof(IShellItem).GUID;SHCreateItemFromParsingName(source,IntPtr.Zero,ref iid,out item);operation=(IFileOperation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("3ad05575-8857-4850-9277-11b85bdb8e09")));
   operation.SetOwnerWindow(owner);operation.SetOperationFlags(0x40u|0x20000000u);operation.RenameItem(item,name,null);int result=operation.PerformOperations();if(result<0)Marshal.ThrowExceptionForHR(result);bool aborted;operation.GetAnyOperationsAborted(out aborted);if(aborted)throw new IOException("Rename cancelled");
  }finally{if(operation!=null)Marshal.ReleaseComObject(operation);if(item!=null)Marshal.ReleaseComObject(item);}
 }
 public static bool[] RecycleMany(string[] sources){
  Sources(sources);foreach(var source in sources){var drive=new DriveInfo(Path.GetPathRoot(source));if(drive.DriveType!=DriveType.Fixed)throw new IOException("Recycle requires a local fixed volume");}
  var items=new List<IShellItem>();var sinks=new List<RecycleSink>();IFileOperation operation=null;
  try{
   var iid=typeof(IShellItem).GUID;
   operation=(IFileOperation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("3ad05575-8857-4850-9277-11b85bdb8e09")));
   // RECYCLEONDELETE + ADDUNDORECORD; refuse permanent-delete callbacks in the sink.
   // WANTNUKEWARNING overrides automatic confirmation if Shell proposes a
   // permanent-delete fallback; never silently accept such a fallback.
   operation.SetOperationFlags(0x00080000u|0x20000000u|0x00100000u|0x0400u|0x0004u|0x0010u|0x2000u|0x4000u);
   foreach(var source in sources){IShellItem item;SHCreateItemFromParsingName(source,IntPtr.Zero,ref iid,out item);items.Add(item);var sink=new RecycleSink();sinks.Add(sink);operation.DeleteItem(item,sink);}
   operation.PerformOperations();var completed=new bool[sources.Length];for(int i=0;i<sources.Length;i++)completed[i]=sinks[i].recycled&&!File.Exists(sources[i]);return completed;
  }finally{if(operation!=null)Marshal.ReleaseComObject(operation);foreach(var item in items)Marshal.ReleaseComObject(item);}
 }
}
