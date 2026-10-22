using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Runtime.InteropServices.ComTypes;
using IDataObject = System.Runtime.InteropServices.ComTypes.IDataObject;

// The actual Shell menu for catalog items. Paths arrive only over the parent's
// private pipe after ID/identity checks, never from WebView messages or HTTP.
public sealed class VGLauncherContext : IDisposable {
 [ComImport,Guid("000214E6-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IShellFolder {
  [PreserveSig]int ParseDisplayName(IntPtr hwnd,IntPtr context,[MarshalAs(UnmanagedType.LPWStr)]string name,ref uint eaten,out IntPtr pidl,ref uint attributes);
  [PreserveSig]int EnumObjects(IntPtr hwnd,uint flags,out IntPtr result);
  [PreserveSig]int BindToObject(IntPtr pidl,IntPtr context,ref Guid iid,out IntPtr result);
  [PreserveSig]int BindToStorage(IntPtr pidl,IntPtr context,ref Guid iid,out IntPtr result);
  [PreserveSig]int CompareIDs(IntPtr parameter,IntPtr first,IntPtr second);
  [PreserveSig]int CreateViewObject(IntPtr owner,ref Guid iid,out IntPtr result);
  [PreserveSig]int GetAttributesOf(uint count,[In,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=0)]IntPtr[] children,ref uint attributes);
  [PreserveSig]int GetUIObjectOf(IntPtr owner,uint count,[In,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=1)]IntPtr[] children,ref Guid iid,IntPtr reserved,out IntPtr result);
  [PreserveSig]int GetDisplayNameOf(IntPtr pidl,uint flags,IntPtr result);
  [PreserveSig]int SetNameOf(IntPtr owner,IntPtr pidl,[MarshalAs(UnmanagedType.LPWStr)]string name,uint flags,out IntPtr renamed);
 }
 [ComImport,Guid("000214E4-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IContextMenu {
  [PreserveSig]int QueryContextMenu(IntPtr menu,uint index,uint first,uint last,uint flags);
  [PreserveSig]int InvokeCommand(ref InvokeInfo info);
  [PreserveSig]int GetCommandString(UIntPtr command,uint flags,IntPtr reserved,IntPtr name,uint length);
 }
 [ComImport,Guid("000214F4-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IContextMenu2 {
  [PreserveSig]int QueryContextMenu(IntPtr menu,uint index,uint first,uint last,uint flags);
  [PreserveSig]int InvokeCommand(ref InvokeInfo info);
  [PreserveSig]int GetCommandString(UIntPtr command,uint flags,IntPtr reserved,IntPtr name,uint length);
  [PreserveSig]int HandleMenuMsg(uint message,IntPtr wParam,IntPtr lParam);
 }
 [ComImport,Guid("BCFCE0A0-EC17-11D0-8D10-00A0C90F2719"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IContextMenu3 {
  [PreserveSig]int QueryContextMenu(IntPtr menu,uint index,uint first,uint last,uint flags);
  [PreserveSig]int InvokeCommand(ref InvokeInfo info);
  [PreserveSig]int GetCommandString(UIntPtr command,uint flags,IntPtr reserved,IntPtr name,uint length);
  [PreserveSig]int HandleMenuMsg(uint message,IntPtr wParam,IntPtr lParam);
  [PreserveSig]int HandleMenuMsg2(uint message,IntPtr wParam,IntPtr lParam,out IntPtr result);
 }
 [StructLayout(LayoutKind.Sequential)] struct InvokeInfo {
  public uint size,mask;public IntPtr owner,verb,parameters,directory;public int show;public uint hotKey;public IntPtr icon,title,verbW,parametersW,directoryW,titleW;public Point point;
 }
 [ComImport,Guid("00000122-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDropTarget {
  [PreserveSig]int DragEnter([MarshalAs(UnmanagedType.Interface)]IDataObject data,uint keys,Point point,ref uint effect);
  [PreserveSig]int DragOver(uint keys,Point point,ref uint effect);
  [PreserveSig]int DragLeave();
  [PreserveSig]int Drop([MarshalAs(UnmanagedType.Interface)]IDataObject data,uint keys,Point point,ref uint effect);
 }
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern IntPtr ILCreateFromPath(string path);
 [DllImport("shell32.dll")] static extern IntPtr ILFindLastID(IntPtr pidl);
 [DllImport("shell32.dll")] static extern int SHBindToParent(IntPtr pidl,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out IShellFolder parent,out IntPtr child);
 [DllImport("shell32.dll")] static extern int SHGetDesktopFolder([MarshalAs(UnmanagedType.Interface)]out IShellFolder folder);
 [DllImport("user32.dll")] static extern IntPtr CreatePopupMenu();
 [DllImport("user32.dll")] static extern bool DestroyMenu(IntPtr menu);
 [DllImport("user32.dll")] static extern uint TrackPopupMenuEx(IntPtr menu,uint flags,int x,int y,IntPtr owner,IntPtr parameter);
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr owner);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] static extern bool AttachThreadInput(uint first,uint second,bool attach);
 [DllImport("user32.dll")] static extern IntPtr SetActiveWindow(IntPtr window);
 [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr window);
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr owner,uint message,IntPtr wParam,IntPtr lParam);
 [DllImport("user32.dll")] static extern bool EndMenu();
 [DllImport("user32.dll")] static extern short GetKeyState(int key);
 [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
 [DllImport("user32.dll")] static extern uint GetMenuItemID(IntPtr menu,int position);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool InsertMenu(IntPtr menu,uint position,uint flags,UIntPtr id,string text);
 [DllImport("ole32.dll")] static extern int OleGetClipboard([MarshalAs(UnmanagedType.Interface)]out IDataObject data);
 [DllImport("ole32.dll")] static extern void ReleaseStgMedium(ref STGMEDIUM medium);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
 [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr memory);
 [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr memory);
 IContextMenu menu;IContextMenu2 menu2;IContextMenu3 menu3;IShellFolder folder,desktop;
 readonly List<IntPtr> pidls=new List<IntPtr>();IntPtr popup;bool tracking;
 IShellFolder dropFolder;IDropTarget dropTarget;bool customPaste;
 static void Check(int result){if(result<0)Marshal.ThrowExceptionForHR(result);}
 public static void Validate(string[] paths,string directory,bool background){
  var roots=new HashSet<string>(StringComparer.OrdinalIgnoreCase);foreach(var value in new[]{Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory)})if(!String.IsNullOrEmpty(value))roots.Add(Path.GetFullPath(value));
  directory=Path.GetFullPath(directory);if(!roots.Contains(directory)||!Directory.Exists(directory)||(File.GetAttributes(directory)&FileAttributes.ReparsePoint)!=0)throw new IOException("Invalid desktop folder");
  if(paths==null||background&&paths.Length!=0||!background&&(paths.Length<1||paths.Length>100))throw new IOException("Invalid selection");
  var unique=new HashSet<string>(StringComparer.OrdinalIgnoreCase);foreach(var value in paths){var path=Path.GetFullPath(value);if(!unique.Add(path)||!String.Equals(Path.GetDirectoryName(path),directory,StringComparison.OrdinalIgnoreCase)||(File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)throw new IOException("Item changed");}
 }
 IntPtr Pidl(string path){var p=ILCreateFromPath(path);if(p==IntPtr.Zero)throw new IOException("Shell item unavailable");pidls.Add(p);return p;}
 void Build(IntPtr owner,string[] paths,string directory,bool background){
  Validate(paths,directory,background);var contextId=typeof(IContextMenu).GUID;IntPtr pointer;
  if(background){
   Check(SHGetDesktopFolder(out desktop));var folderId=typeof(IShellFolder).GUID;IntPtr bound;Check(desktop.BindToObject(Pidl(directory),IntPtr.Zero,ref folderId,out bound));
   try{folder=(IShellFolder)Marshal.GetObjectForIUnknown(bound);}finally{Marshal.Release(bound);}Check(folder.CreateViewObject(owner,ref contextId,out pointer));
  }else{
   IntPtr child;var folderId=typeof(IShellFolder).GUID;Check(SHBindToParent(Pidl(paths[0]),ref folderId,out folder,out child));var children=new IntPtr[paths.Length];children[0]=child;for(int i=1;i<paths.Length;i++)children[i]=ILFindLastID(Pidl(paths[i]));
   Check(folder.GetUIObjectOf(owner,(uint)children.Length,children,ref contextId,IntPtr.Zero,out pointer));
  }
  try{menu=(IContextMenu)Marshal.GetObjectForIUnknown(pointer);}finally{Marshal.Release(pointer);}menu2=menu as IContextMenu2;menu3=menu as IContextMenu3;
  popup=CreatePopupMenu();if(popup==IntPtr.Zero)throw new IOException("Menu unavailable");
  uint flags=background?0u:paths.Length==1?0x10u:0u;if((GetKeyState(0x10)&0x8000)!=0)flags|=0x100;
  Check(menu.QueryContextMenu(popup,0,1,0x7fff,flags));
  var destination=background?directory:paths.Length==1&&Directory.Exists(paths[0])?paths[0]:null;
  if(destination!=null){
   // Clipboard commands are normally contributed by Explorer's view. Our
   // native host delegates them to the destination's real Shell drop target.
   bool hasPaste=false;for(int i=0;i<GetMenuItemCount(popup);i++){uint command=GetMenuItemID(popup,i);if(command>=1&&command<=0x7fff&&String.Equals(Verb(command-1),"paste",StringComparison.OrdinalIgnoreCase))hasPaste=true;}
   if(!hasPaste){
    if(desktop==null)Check(SHGetDesktopFolder(out desktop));var folderId=typeof(IShellFolder).GUID;IntPtr bound;Check(desktop.BindToObject(Pidl(destination),IntPtr.Zero,ref folderId,out bound));try{dropFolder=(IShellFolder)Marshal.GetObjectForIUnknown(bound);}finally{Marshal.Release(bound);}
    var dropId=typeof(IDropTarget).GUID;IntPtr target;Check(dropFolder.CreateViewObject(owner,ref dropId,out target));try{dropTarget=(IDropTarget)Marshal.GetObjectForIUnknown(target);}finally{Marshal.Release(target);}
    customPaste=true;InsertMenu(popup,0,0x400|(ClipboardEffect(false)==0?1u:0u),new UIntPtr(0x8000),"Вставить");InsertMenu(popup,1,0x400|(ClipboardEffect(true)==0?1u:0u),new UIntPtr(0x8001),"Вставить ярлык");InsertMenu(popup,2,0x400|0x800,UIntPtr.Zero,null);
   }
  }
 }
 static uint PreferredEffect(IDataObject data){
  var format=new FORMATETC{cfFormat=unchecked((short)RegisterClipboardFormat("Preferred DropEffect")),dwAspect=DVASPECT.DVASPECT_CONTENT,lindex=-1,tymed=TYMED.TYMED_HGLOBAL};STGMEDIUM medium;
  try{data.GetData(ref format,out medium);}catch{return 1;}
  try{var value=GlobalLock(medium.unionmember);try{return value!=IntPtr.Zero&&(Marshal.ReadInt32(value)&2)!=0?2u:1u;}finally{if(value!=IntPtr.Zero)GlobalUnlock(medium.unionmember);}}finally{ReleaseStgMedium(ref medium);}
 }
 uint ClipboardEffect(bool link){
  IDataObject data=null;try{if(OleGetClipboard(out data)<0||data==null)return 0;uint effect=link?4u:PreferredEffect(data);Check(dropTarget.DragEnter(data,link?12u:effect==2?4u:8u,Cursor.Position,ref effect));try{return effect;}finally{dropTarget.DragLeave();}}catch{return 0;}finally{if(data!=null&&Marshal.IsComObject(data))Marshal.ReleaseComObject(data);}
 }
 void Paste(bool link){
  IDataObject data=null;try{Check(OleGetClipboard(out data));uint effect=link?4u:PreferredEffect(data),keys=link?12u:effect==2?4u:8u;Check(dropTarget.DragEnter(data,keys,Cursor.Position,ref effect));bool dropped=false;try{if(effect==0)throw new InvalidOperationException("Clipboard cannot be pasted");Check(dropTarget.Drop(data,keys,Cursor.Position,ref effect));dropped=true;}finally{if(!dropped)dropTarget.DragLeave();}}finally{if(data!=null&&Marshal.IsComObject(data))Marshal.ReleaseComObject(data);}
 }
 string Verb(uint command){var text=Marshal.AllocHGlobal(1024);try{for(int i=0;i<1024;i++)Marshal.WriteByte(text,i,0);return menu.GetCommandString(new UIntPtr(command),4,IntPtr.Zero,text,512)>=0?Marshal.PtrToStringUni(text):null;}finally{Marshal.FreeHGlobal(text);}}
 // Read-only integration probe: build real Shell commands without displaying
 // the menu or invoking anything. Not exposed through the local HTTP API.
 public static string[] Inspect(string[] paths,string directory,bool background){using(var shell=new VGLauncherContext()){shell.Build(IntPtr.Zero,paths,directory,background);var verbs=new List<string>();for(int i=0;i<GetMenuItemCount(shell.popup);i++){uint command=GetMenuItemID(shell.popup,i);if(command==0x8000||command==0x8001){verbs.Add(command==0x8000?"paste":"pastelink");continue;}if(command>=1&&command<=0x7fff){var verb=shell.Verb(command-1);if(!String.IsNullOrEmpty(verb))verbs.Add(verb);}}return verbs.ToArray();}}
 public bool Show(Form owner,string[] paths,string directory,bool background,Action<int> shown,Action invoking=null,IWin32Window invocationOwner=null,string menuMode="dark"){
  LauncherMenuTheme.Apply(owner.Handle,menuMode);Build(owner.Handle,paths,directory,background);var point=Cursor.Position;
  // The fallback can be invoked from Engine's process. Briefly join its input
  // queue only to activate our menu owner; no hook or input event collection.
  uint pid,current=GetCurrentThreadId(),foreground=GetWindowThreadProcessId(GetForegroundWindow(),out pid);bool attached=foreground!=0&&foreground!=current&&AttachThreadInput(current,foreground,true);
  try{SetForegroundWindow(owner.Handle);SetActiveWindow(owner.Handle);SetFocus(owner.Handle);}finally{if(attached)AttachThreadInput(current,foreground,false);}
  if(GetForegroundWindow()!=owner.Handle)throw new InvalidOperationException("Context owner could not activate");tracking=true;uint command;
  try{shown(GetMenuItemCount(popup));command=TrackPopupMenuEx(popup,0x100|0x2,point.X,point.Y,owner.Handle,IntPtr.Zero);}finally{tracking=false;PostMessage(owner.Handle,0,IntPtr.Zero,IntPtr.Zero);}
  if(command==0)return false;
  // Long-lived Shell dialogs must inherit an ordinary, demoted owner.
  if(invoking!=null)invoking();
  var normalOwner=invocationOwner??owner;
  Validate(paths,directory,background);if(customPaste&&(command==0x8000||command==0x8001)){Paste(command==0x8001);return true;}
  if(!background&&paths.Length==1&&String.Equals(Verb(command-1),"rename",StringComparison.OrdinalIgnoreCase)){Rename(normalOwner,paths[0]);return true;}
  var info=new InvokeInfo{size=(uint)Marshal.SizeOf(typeof(InvokeInfo)),mask=0x4000|0x20000000,owner=normalOwner.Handle,verb=new IntPtr(command-1),verbW=new IntPtr(command-1),show=1,point=point};
  if((GetKeyState(0x10)&0x8000)!=0)info.mask|=0x10000000;if((GetKeyState(0x11)&0x8000)!=0)info.mask|=0x40000000;
  Check(menu.InvokeCommand(ref info));return true;
 }
 public bool Handle(ref Message message){
  if(!tracking||message.Msg!=0x117&&message.Msg!=0x2b&&message.Msg!=0x2c&&message.Msg!=0x120)return false;
  IntPtr result;if(menu3!=null&&menu3.HandleMenuMsg2((uint)message.Msg,message.WParam,message.LParam,out result)==0){message.Result=result;return true;}
  if(menu2!=null&&message.Msg!=0x120&&menu2.HandleMenuMsg((uint)message.Msg,message.WParam,message.LParam)==0){message.Result=message.Msg==0x117?IntPtr.Zero:new IntPtr(1);return true;}return false;
 }
 public void Cancel(){if(tracking)EndMenu();}
 static void Rename(IWin32Window owner,string path){
  using(var dialog=new Form{Text="Переименование",FormBorderStyle=FormBorderStyle.FixedDialog,StartPosition=FormStartPosition.CenterParent,MinimizeBox=false,MaximizeBox=false,ShowInTaskbar=false,ClientSize=new Size(450,128),AutoScaleMode=AutoScaleMode.Dpi}){
   var field=new TextBox{Text=Path.GetFileName(path),Left=16,Top=19,Width=418};var ok=new Button{Text="Сохранить",Left=228,Top=78,Width=100,DialogResult=DialogResult.None};var cancel=new Button{Text="Отмена",Left=336,Top=78,Width=98,DialogResult=DialogResult.Cancel};
   dialog.Controls.AddRange(new Control[]{field,ok,cancel});dialog.AcceptButton=ok;dialog.CancelButton=cancel;dialog.Shown+=(s,e)=>{field.Focus();field.Select(0,Directory.Exists(path)?field.Text.Length:Path.GetFileNameWithoutExtension(path).Length);};
   ok.Click+=(s,e)=>{try{VGLauncherFiles.Rename(path,field.Text,owner.Handle);dialog.DialogResult=DialogResult.OK;dialog.Close();}catch{MessageBox.Show(dialog,"Не удалось переименовать. Проверь имя и отсутствие другого элемента с таким именем.","Переименование",MessageBoxButtons.OK,MessageBoxIcon.Warning);}};
   dialog.ShowDialog(owner);
  }
 }
 public void Dispose(){if(popup!=IntPtr.Zero){DestroyMenu(popup);popup=IntPtr.Zero;}menu2=null;menu3=null;if(menu!=null){Marshal.ReleaseComObject(menu);menu=null;}if(dropTarget!=null){Marshal.ReleaseComObject(dropTarget);dropTarget=null;}if(dropFolder!=null){Marshal.ReleaseComObject(dropFolder);dropFolder=null;}if(folder!=null){Marshal.ReleaseComObject(folder);folder=null;}if(desktop!=null){Marshal.ReleaseComObject(desktop);desktop=null;}foreach(var p in pidls)Marshal.FreeCoTaskMem(p);pidls.Clear();}
}
