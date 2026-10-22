using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Runs inside the existing sensors worker. It observes wheel only, never consumes
// Windows input, and queues nothing outside a leased menu rectangle on the desktop.
public static class VGLauncherWheel {
 public sealed class Wheel {public string id;public int delta;}
 sealed class Region {public string id;public int width,height;public double left,top,right,bottom;public long expires;}
 [StructLayout(LayoutKind.Sequential)] struct Point {public int x,y;}
 [StructLayout(LayoutKind.Sequential)] struct Rect {public int left,top,right,bottom;}
 [StructLayout(LayoutKind.Sequential)] struct MonitorInfo {public int size;public Rect monitor,work;public uint flags;}
 [StructLayout(LayoutKind.Sequential)] struct Mouse {public Point point;public uint data,flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] struct Message {public IntPtr hwnd;public uint message;public UIntPtr wParam;public IntPtr lParam;public uint time;public Point point;public uint reserved;}
 delegate IntPtr Hook(int code,IntPtr message,IntPtr data);
 [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int type,Hook callback,IntPtr module,uint thread);
 [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
 [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
 [DllImport("user32.dll")] static extern int GetMessage(out Message message,IntPtr hwnd,uint min,uint max);
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder name,int size);
 [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Point point,uint flags);
 [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
 static volatile Region[] regions=new Region[0];
 static readonly ConcurrentQueue<Wheel> queue=new ConcurrentQueue<Wheel>();
 static readonly AutoResetEvent wheelReady=new AutoResetEvent(false);
 static readonly ManualResetEvent initialized=new ManualResetEvent(false);
 static readonly Hook callback=OnMouse;
 static IntPtr hook=IntPtr.Zero;static bool started;
 static long Now(){return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();}
 static bool DesktopAt(Point point){
  IntPtr hwnd=WindowFromPoint(point);
  for(int i=0;i<16&&hwnd!=IntPtr.Zero;i++,hwnd=GetAncestor(hwnd,1)){
   var name=new StringBuilder(96);GetClassName(hwnd,name,name.Capacity);
   if(name.ToString()=="WorkerW"||name.ToString()=="Progman")return true;
  }return false;
 }
 static IntPtr OnMouse(int code,IntPtr message,IntPtr data){
  // Keep the hook short: no files, network, console writes, or work for mouse moves/clicks.
  if(code>=0&&message.ToInt64()==0x20A&&regions.Length>0){
   // Windows enters a hook callback in its own DPI context. Set it here as well
   // as on the pump thread; otherwise the 200% screen becomes 1920x1080.
   IntPtr previousDpi=SetThreadDpiAwarenessContext(new IntPtr(-4));
   try{
    var mouse=(Mouse)Marshal.PtrToStructure(data,typeof(Mouse));
    if((mouse.flags&1)==0&&(GetAsyncKeyState(0x11)&0x8000)==0&&(GetAsyncKeyState(0x12)&0x8000)==0&&(GetAsyncKeyState(0x5B)&0x8000)==0&&(GetAsyncKeyState(0x5C)&0x8000)==0){
     var info=new MonitorInfo();info.size=Marshal.SizeOf(info);
     if(GetMonitorInfo(MonitorFromPoint(mouse.point,0),ref info)){
      int width=info.monitor.right-info.monitor.left,height=info.monitor.bottom-info.monitor.top;
      double x=(mouse.point.x-info.monitor.left)/(double)width,y=(mouse.point.y-info.monitor.top)/(double)height;
      foreach(var r in regions)if(r.expires>Now()&&r.width==width&&r.height==height&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom&&DesktopAt(mouse.point)){
       int delta=-(short)(mouse.data>>16);if(delta!=0&&queue.Count<32){queue.Enqueue(new Wheel{id=r.id,delta=delta});wheelReady.Set();}break;
      }
     }
    }
   }catch{/* Fail closed and leave the system input untouched. */}
   finally{if(previousDpi!=IntPtr.Zero)SetThreadDpiAwarenessContext(previousDpi);}
  }
  return CallNextHookEx(hook,code,message,data);
 }
 static void ReadRegions(){
  try{string line;while((line=Console.ReadLine())!=null){
   if(!line.StartsWith("L|",StringComparison.Ordinal)||line.Length>4096)continue;
   var next=new List<Region>();
   foreach(string part in line.Substring(2).Split(';')){
    string[] p=part.Split(',');if(p.Length!=9||p[0].Length!=32)continue;
    bool validId=true;foreach(char c in p[0])if(!(c>='a'&&c<='f'||c>='0'&&c<='9'))validId=false;if(!validId)continue;
    var r=new Region{id=p[0],width=int.Parse(p[1],CultureInfo.InvariantCulture),height=int.Parse(p[2],CultureInfo.InvariantCulture),left=double.Parse(p[3],CultureInfo.InvariantCulture),top=double.Parse(p[4],CultureInfo.InvariantCulture),right=double.Parse(p[5],CultureInfo.InvariantCulture),bottom=double.Parse(p[6],CultureInfo.InvariantCulture),expires=long.Parse(p[7],CultureInfo.InvariantCulture)};
    if(p[8]!="1"||r.width<320||r.height<240||r.left<0||r.top<0||r.right>1||r.bottom>1||r.left>=r.right||r.top>=r.bottom||r.expires<=Now()||r.expires>Now()+5000)continue;
    if(next.Count<4)next.Add(r);
   }regions=next.ToArray();
  }}catch{}finally{regions=new Region[0];}
 }
 public static bool Start(){
  if(started)return hook!=IntPtr.Zero;started=true;
  var input=new Thread(ReadRegions);input.IsBackground=true;input.Start();
  var output=new Thread(delegate(){while(true){wheelReady.WaitOne();foreach(var item in Drain())Console.WriteLine("{\"launcherWheel\":{\"id\":\""+item.id+"\",\"delta\":"+item.delta.ToString(CultureInfo.InvariantCulture)+"}}");}});output.IsBackground=true;output.Start();
  var pump=new Thread(delegate(){
   try{SetThreadDpiAwarenessContext(new IntPtr(-4));hook=SetWindowsHookEx(14,callback,GetModuleHandle(null),0);initialized.Set();if(hook!=IntPtr.Zero){Message msg;while(GetMessage(out msg,IntPtr.Zero,0,0)>0){}}}
   finally{initialized.Set();if(hook!=IntPtr.Zero)UnhookWindowsHookEx(hook);hook=IntPtr.Zero;}
  });pump.IsBackground=true;pump.Start();initialized.WaitOne(3000);return hook!=IntPtr.Zero;
 }
 static Wheel[] Drain(){var result=new List<Wheel>();Wheel item;while(queue.TryDequeue(out item))result.Add(item);return result.ToArray();}
}
