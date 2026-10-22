using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace PaperGreen {
 internal static class DesktopHost {
  delegate bool EnumProc(IntPtr hwnd,IntPtr state);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern IntPtr FindWindow(string name,string title);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string name,string title);
  [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc callback,IntPtr state);
  [DllImport("user32.dll",SetLastError=true)]static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint message,UIntPtr wp,IntPtr lp,uint flags,uint timeout,out UIntPtr result);
  [DllImport("user32.dll",SetLastError=true)]static extern IntPtr SetParent(IntPtr hwnd,IntPtr parent);
  [DllImport("user32.dll",SetLastError=true)]static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")]static extern int GetWindowLong(IntPtr hwnd,int index);
  [DllImport("user32.dll")]static extern int SetWindowLong(IntPtr hwnd,int index,int value);
  [DllImport("user32.dll")]static extern int MapWindowPoints(IntPtr from,IntPtr to,ref Point point,uint count);
  [DllImport("user32.dll")]internal static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr hwnd,StringBuilder text,int size);
  [StructLayout(LayoutKind.Sequential)]struct Rect{public int Left,Top,Right,Bottom;}
  internal static IntPtr Attach(Form form,Screen screen){
   IntPtr progman=FindWindow("Progman",null);if(progman==IntPtr.Zero)throw new InvalidOperationException("Windows desktop is unavailable.");
   UIntPtr ignored;SendMessageTimeout(progman,0x052c,UIntPtr.Zero,IntPtr.Zero,2,1000,out ignored);IntPtr worker=IntPtr.Zero;
   EnumWindows(delegate(IntPtr hwnd,IntPtr state){if(FindWindowEx(hwnd,IntPtr.Zero,"SHELLDLL_DefView",null)!=IntPtr.Zero){worker=FindWindowEx(IntPtr.Zero,hwnd,"WorkerW",null);if(worker!=IntPtr.Zero)return false;}return true;},IntPtr.Zero);
   if(worker==IntPtr.Zero)worker=progman;
   form.FormBorderStyle=FormBorderStyle.None;form.ShowInTaskbar=false;
   SetWindowLong(form.Handle,-16,(GetWindowLong(form.Handle,-16)|0x40000000)&~unchecked((int)0x80000000));
   SetParent(form.Handle,worker);var point=screen.Bounds.Location;MapWindowPoints(IntPtr.Zero,worker,ref point,1);
   if(!SetWindowPos(form.Handle,IntPtr.Zero,point.X,point.Y,screen.Bounds.Width,screen.Bounds.Height,0x10|0x40))throw new InvalidOperationException("Could not attach app to desktop.");
   return worker;
  }
  internal static bool Covered(Rectangle bounds){
   IntPtr hwnd=GetForegroundWindow();uint pid;GetWindowThreadProcessId(hwnd,out pid);if(pid==(uint)System.Diagnostics.Process.GetCurrentProcess().Id)return false;
   var name=new StringBuilder(128);GetClassName(hwnd,name,name.Capacity);if(name.ToString()=="Progman"||name.ToString()=="WorkerW"||name.ToString()=="SHELLDLL_DefView"||name.ToString()=="SysListView32")return false;
   Rect r;if(!GetWindowRect(hwnd,out r))return false;return r.Left<=bounds.Left&&r.Top<=bounds.Top&&r.Right>=bounds.Right&&r.Bottom>=bounds.Bottom;
  }
 }
 internal sealed class ChildJob : IDisposable {
  [StructLayout(LayoutKind.Sequential)]struct Basic{public long ProcessTime,JobTime;public uint Flags;public UIntPtr Min,Max;public uint Processes;public UIntPtr Affinity;public uint Priority,Scheduling;}
  [StructLayout(LayoutKind.Sequential)]struct Counters{public ulong ReadOperations,WriteOperations,OtherOperations,ReadBytes,WriteBytes,OtherBytes;}
  [StructLayout(LayoutKind.Sequential)]struct Extended{public Basic Basic;public Counters IO;public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob;}
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll")]static extern bool SetInformationJobObject(IntPtr job,int kind,IntPtr data,uint size);
  [DllImport("kernel32.dll")]static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
  IntPtr handle;
  public ChildJob(){handle=CreateJobObject(IntPtr.Zero,null);var data=new Extended();data.Basic.Flags=0x2000;IntPtr p=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Extended)));try{Marshal.StructureToPtr(data,p,false);if(handle==IntPtr.Zero||!SetInformationJobObject(handle,9,p,(uint)Marshal.SizeOf(typeof(Extended))))throw new InvalidOperationException("Could not isolate app processes.");}finally{Marshal.FreeHGlobal(p);}}
  public void Add(System.Diagnostics.Process process){if(!AssignProcessToJobObject(handle,process.Handle))throw new InvalidOperationException("Could not own app backend.");}
  public void Dispose(){if(handle!=IntPtr.Zero){CloseHandle(handle);handle=IntPtr.Zero;}}
 }
}
