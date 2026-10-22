using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Only the launcher-host process opts into native menu theming. This does not
// alter Windows personalization, Explorer, or the Shell extension renderers.
public static class LauncherMenuTheme {
 [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate int PreferredMode(int mode);
 [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate void FlushThemes();
 [UnmanagedFunctionPointer(CallingConvention.Winapi)] [return:MarshalAs(UnmanagedType.U1)] delegate bool AllowWindow(IntPtr owner,[MarshalAs(UnmanagedType.U1)]bool allow);
 [DllImport("ntdll.dll")] static extern void RtlGetNtVersionNumbers(out uint major,out uint minor,out uint build);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryEx(string file,IntPtr reserved,uint flags);
 [DllImport("kernel32.dll",ExactSpelling=true)] static extern IntPtr GetProcAddress(IntPtr module,IntPtr ordinal);
 static readonly IntPtr module;
 static readonly PreferredMode preferred;
 static readonly FlushThemes flush;
 static readonly AllowWindow allow;
 public static bool Supported { get { return preferred!=null&&flush!=null&&allow!=null; } }
 // Ordinal135 changed its signature in1903. Never call that ABI on1809 or
 // older. Resolve optional exports from System32 and retain the module for the
 // process lifetime, so delegates cannot point into an unloaded DLL.
 public static bool SupportedVersion(uint major,uint minor,uint build){return major==10&&minor==0&&(build&0x0fffffff)>=18362;}
 static T Export<T>(int ordinal) where T:class {var address=GetProcAddress(module,new IntPtr(ordinal));return address==IntPtr.Zero?null:Marshal.GetDelegateForFunctionPointer(address,typeof(T)) as T;}
 static LauncherMenuTheme(){
  try{uint major,minor,build;RtlGetNtVersionNumbers(out major,out minor,out build);if(!SupportedVersion(major,minor,build))return;module=LoadLibraryEx("uxtheme.dll",IntPtr.Zero,0x800);if(module==IntPtr.Zero)return;preferred=Export<PreferredMode>(135);flush=Export<FlushThemes>(136);allow=Export<AllowWindow>(133);}catch{preferred=null;flush=null;allow=null;}
 }
 public static int Mode(string mode,bool highContrast){if(mode!="dark"&&mode!="light")throw new ArgumentException("Invalid menu mode");return highContrast?0:mode=="dark"?2:3;}
 public static bool Apply(IntPtr owner,string mode){
  int value=Mode(mode,SystemInformation.HighContrast);if(!Supported)return false;
  try{preferred(value);allow(owner,value==2);flush();return true;}catch{return false;}
 }
}
