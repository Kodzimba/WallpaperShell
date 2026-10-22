using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

// Windows Core Audio COM declarations. No microphone capture or volume changes.
public static class VGDesktop {
 public sealed class AudioOutput { public string id,name; public uint state; public bool selected,console,communications; }
 [StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid format; public uint id; public PropertyKey(string f,uint p){format=new Guid(f);id=p;} }
 [StructLayout(LayoutKind.Explicit,Size=24)] struct Variant { [FieldOffset(0)]public ushort type; [FieldOffset(8)]public IntPtr pointer; }
 [DllImport("ole32.dll")] static extern int PropVariantClear(ref Variant value);
 [ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IProperties {
  [PreserveSig]int GetCount(out uint count);[PreserveSig]int GetAt(uint index,out PropertyKey key);[PreserveSig]int GetValue(ref PropertyKey key,out Variant value);[PreserveSig]int SetValue(ref PropertyKey key,ref Variant value);[PreserveSig]int Commit();
 }
 [ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevice {
  [PreserveSig]int Activate(ref Guid iid,uint context,IntPtr activation,out IntPtr result);[PreserveSig]int OpenPropertyStore(uint access,out IProperties properties);[PreserveSig]int GetId([MarshalAs(UnmanagedType.LPWStr)]out string id);[PreserveSig]int GetState(out uint state);
 }
 [ComImport,Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ICollection {
  [PreserveSig]int GetCount(out uint count);[PreserveSig]int Item(uint index,out IDevice device);
 }
 [ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevices {
  [PreserveSig]int EnumAudioEndpoints(int flow,uint states,out ICollection devices);[PreserveSig]int GetDefaultAudioEndpoint(int flow,int role,out IDevice device);[PreserveSig]int GetDevice([MarshalAs(UnmanagedType.LPWStr)]string id,out IDevice device);[PreserveSig]int RegisterNotification(IntPtr callback);[PreserveSig]int UnregisterNotification(IntPtr callback);
 }
 [ComImport,Guid("F8679F50-850A-41CF-9C72-430F290290C8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IPolicy {
  [PreserveSig]int GetMixFormat(string id,IntPtr format);[PreserveSig]int GetDeviceFormat(string id,int defaults,IntPtr format);[PreserveSig]int ResetDeviceFormat(string id);[PreserveSig]int SetDeviceFormat(string id,IntPtr endpoint,IntPtr mix);[PreserveSig]int GetProcessingPeriod(string id,int defaults,IntPtr period,IntPtr minimum);[PreserveSig]int SetProcessingPeriod(string id,IntPtr period);[PreserveSig]int GetShareMode(string id,IntPtr mode);[PreserveSig]int SetShareMode(string id,IntPtr mode);[PreserveSig]int GetPropertyValue(string id,bool effects,ref PropertyKey key,out Variant value);[PreserveSig]int SetPropertyValue(string id,bool effects,ref PropertyKey key,ref Variant value);
  [PreserveSig]int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)]string id,int role);[PreserveSig]int SetEndpointVisibility(string id,int visible);
 }
 static IDevices Devices(){return (IDevices)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));}
 static void Check(int hr){Marshal.ThrowExceptionForHR(hr);}
 static string DefaultId(IDevices devices,int role){IDevice device=null;try{if(devices.GetDefaultAudioEndpoint(0,role,out device)!=0)return null;string id;Check(device.GetId(out id));return id;}finally{if(device!=null)Marshal.ReleaseComObject(device);}}
 public static AudioOutput[] Outputs(){
  IDevices devices=Devices();ICollection list=null;var output=new List<AudioOutput>();
  try{
   string selected=DefaultId(devices,1),console=DefaultId(devices,0),communications=DefaultId(devices,2);
   Check(devices.EnumAudioEndpoints(0,1,out list));uint count;Check(list.GetCount(out count));
   for(uint i=0;i<count;i++){
    IDevice device=null;IProperties store=null;
    try{
     Check(list.Item(i,out device));string id;uint state;Check(device.GetId(out id));Check(device.GetState(out state));Check(device.OpenPropertyStore(0,out store));
     var key=new PropertyKey("a45c254e-df1c-4efd-8020-67d146a850e0",14);Variant value;Check(store.GetValue(ref key,out value));string name;
     try{name=value.type==31?Marshal.PtrToStringUni(value.pointer):"Audio output";}finally{PropVariantClear(ref value);}
     output.Add(new AudioOutput{id=id,name=name,state=state,selected=id==selected,console=id==console,communications=id==communications});
    }catch(COMException){/* A stale/disconnected endpoint may no longer have a property store. */}
    finally{if(store!=null)Marshal.ReleaseComObject(store);if(device!=null)Marshal.ReleaseComObject(device);}
   }return output.ToArray();
  }finally{if(list!=null)Marshal.ReleaseComObject(list);Marshal.ReleaseComObject(devices);}
 }
 public static void SetOutput(string id){
  // PolicyConfig is an internal Windows interface; only known active render IDs.
  bool active=false;foreach(var device in Outputs())if(device.id==id&&device.state==1)active=true;
  if(!active)throw new InvalidOperationException("Audio output unavailable");
  var policy=(IPolicy)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")));
  try{Check(policy.SetDefaultEndpoint(id,0));Check(policy.SetDefaultEndpoint(id,1));}finally{Marshal.ReleaseComObject(policy);}
 }
 public static void RestoreOutputs(string console,string media){var policy=(IPolicy)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")));try{if(console!=null)Check(policy.SetDefaultEndpoint(console,0));if(media!=null)Check(policy.SetDefaultEndpoint(media,1));}finally{Marshal.ReleaseComObject(policy);}}
 public sealed class AudioChoice {public string key,name;public bool available,selected;}
 public static AudioChoice[] AudioChoices(){
  var outputs=Outputs();var choices=new List<AudioChoice>();
  foreach(string key in new string[]{"headphones","speakers","tv"}){var found=new List<AudioOutput>();foreach(var o in outputs){if(key=="headphones"&&o.name.Contains("Razer Kraken Kitty Edition")||key=="speakers"&&o.name.Contains("Realtek(R) Audio")&&(o.name.StartsWith("Динамики")||o.name.StartsWith("Speakers"))||key=="tv"&&o.name=="SAMSUNG (NVIDIA High Definition Audio)")found.Add(o);}choices.Add(new AudioChoice{key=key,name=found.Count==1?found[0].name:null,available=found.Count==1,selected=found.Count==1&&found[0].selected&&found[0].console});}return choices.ToArray();
 }
 public static void SelectAudio(string key){
  string name=null;foreach(var choice in AudioChoices())if(choice.key==key&&choice.available)name=choice.name;
  if(name==null)throw new InvalidOperationException("Audio output unavailable or ambiguous");
  foreach(var output in Outputs())if(output.name==name){SetOutput(output.id);return;}throw new InvalidOperationException("Audio output disconnected");
 }

 [ComImport,Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IVolume {
  [PreserveSig]int RegisterControlChangeNotify(IntPtr callback);[PreserveSig]int UnregisterControlChangeNotify(IntPtr callback);[PreserveSig]int GetChannelCount(out uint channels);
  [PreserveSig]int SetMasterVolumeLevel(float level,IntPtr context);[PreserveSig]int SetMasterVolumeLevelScalar(float level,IntPtr context);[PreserveSig]int GetMasterVolumeLevel(out float level);[PreserveSig]int GetMasterVolumeLevelScalar(out float level);
  [PreserveSig]int SetChannelVolumeLevel(uint channel,float level,IntPtr context);[PreserveSig]int SetChannelVolumeLevelScalar(uint channel,float level,IntPtr context);[PreserveSig]int GetChannelVolumeLevel(uint channel,out float level);[PreserveSig]int GetChannelVolumeLevelScalar(uint channel,out float level);
  [PreserveSig]int SetMute([MarshalAs(UnmanagedType.Bool)]bool mute,IntPtr context);[PreserveSig]int GetMute([MarshalAs(UnmanagedType.Bool)]out bool mute);
 }
 public sealed class VolumeState {public string target;public double percent;public bool muted;}
 static string VolumeKey(string id){using(var hash=System.Security.Cryptography.SHA256.Create()){return BitConverter.ToString(hash.ComputeHash(System.Text.Encoding.UTF8.GetBytes(id))).Replace("-","").ToLowerInvariant();}}
 static IVolume VolumeEndpoint(out string id){
  IDevices devices=Devices();IDevice device=null;IntPtr pointer=IntPtr.Zero;
  try{id=DefaultId(devices,1);if(id==null)throw new InvalidOperationException("No output");Check(devices.GetDevice(id,out device));Guid iid=new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");Check(device.Activate(ref iid,23,IntPtr.Zero,out pointer));return (IVolume)Marshal.GetObjectForIUnknown(pointer);}
  finally{if(pointer!=IntPtr.Zero)Marshal.Release(pointer);if(device!=null)Marshal.ReleaseComObject(device);Marshal.ReleaseComObject(devices);}
 }
 public static VolumeState Volume(){string id;var volume=VolumeEndpoint(out id);try{float level;bool muted;Check(volume.GetMasterVolumeLevelScalar(out level));Check(volume.GetMute(out muted));return new VolumeState{target=VolumeKey(id),percent=level*100.0,muted=muted};}finally{Marshal.ReleaseComObject(volume);}}
 public static void SetVolume(string target,int percent){
  if(percent<0||percent>100)throw new ArgumentOutOfRangeException("percent");
  string id;var volume=VolumeEndpoint(out id);try{if(VolumeKey(id)!=target)throw new InvalidOperationException("Audio output changed");Check(volume.SetMasterVolumeLevelScalar(percent/100f,IntPtr.Zero));if(percent>0)Check(volume.SetMute(false,IntPtr.Zero));}finally{Marshal.ReleaseComObject(volume);}
 }

 [StructLayout(LayoutKind.Sequential)] public struct Luid { public uint low; public int high; }
 [StructLayout(LayoutKind.Sequential)] public struct Rational { public uint numerator,denominator; }
 [StructLayout(LayoutKind.Sequential)] public struct Source { public Luid adapter; public uint id,mode,status; }
 [StructLayout(LayoutKind.Sequential)] public struct Target { public Luid adapter; public uint id,mode,technology,rotation,scaling; public Rational refresh; public uint scan; public int available; public uint status; }
 [StructLayout(LayoutKind.Sequential)] public struct DisplayPath { public Source source; public Target target; public uint flags; }
 [StructLayout(LayoutKind.Sequential)] public struct SourceMode { public uint width,height,format; public int x,y; }
 [StructLayout(LayoutKind.Explicit,Size=64)] public struct DisplayMode { [FieldOffset(0)] public uint type; [FieldOffset(4)] public uint id; [FieldOffset(8)] public Luid adapter; [FieldOffset(16)] public SourceMode source; }
 [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags,out uint paths,out uint modes);
 [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags,ref uint paths,[Out] DisplayPath[] path,ref uint modes,[Out] DisplayMode[] mode,IntPtr topology);
 [DllImport("user32.dll")] static extern int SetDisplayConfig(uint paths,DisplayPath[] path,uint modes,DisplayMode[] mode,uint flags);
 public sealed class DisplayState { public int count; public bool primary2k; public string mode; }
 public sealed class DisplaySnapshot { public string paths,modes; public uint pathCount,modeCount; }
 static void WinCheck(int result){if(result!=0)throw new System.ComponentModel.Win32Exception(result);}
 static void Query(out DisplayPath[] paths,out DisplayMode[] modes){
  for(int attempt=0;attempt<4;attempt++){
   uint p,m;WinCheck(GetDisplayConfigBufferSizes(2,out p,out m));paths=new DisplayPath[p];modes=new DisplayMode[m];
   int result=QueryDisplayConfig(2,ref p,paths,ref m,modes,IntPtr.Zero);if(result==122)continue;WinCheck(result);
   Array.Resize(ref paths,(int)p);Array.Resize(ref modes,(int)m);return;
  }throw new InvalidOperationException("Display configuration changed during query");
 }
 static bool Primary(DisplayPath p,DisplayMode[] modes){return p.source.mode<modes.Length&&modes[p.source.mode].type==1&&modes[p.source.mode].source.x==0&&modes[p.source.mode].source.y==0&&modes[p.source.mode].source.width==2560&&modes[p.source.mode].source.height==1440;}
 public static DisplayState Displays(){
  DisplayPath[] paths;DisplayMode[] modes;Query(out paths,out modes);bool primary=false;foreach(var p in paths)if(Primary(p,modes))primary=true;
  return new DisplayState{count=paths.Length,primary2k=primary,mode=primary&&paths.Length==1?"single":primary&&paths.Length==2?"dual":"other"};
 }
 static string Pack<T>(T[] values){int size=Marshal.SizeOf(typeof(T));byte[] data=new byte[size*values.Length];IntPtr buffer=Marshal.AllocHGlobal(size);try{for(int i=0;i<values.Length;i++){Marshal.StructureToPtr(values[i],buffer,false);Marshal.Copy(buffer,data,i*size,size);}}finally{Marshal.FreeHGlobal(buffer);}return Convert.ToBase64String(data);}
 static T[] Unpack<T>(string encoded,uint count){int size=Marshal.SizeOf(typeof(T));byte[] data=Convert.FromBase64String(encoded);if(count>128||data.Length!=size*count)throw new InvalidOperationException("Invalid local display snapshot");T[] result=new T[count];IntPtr buffer=Marshal.AllocHGlobal(size);try{for(int i=0;i<count;i++){Marshal.Copy(data,i*size,buffer,size);result[i]=(T)Marshal.PtrToStructure(buffer,typeof(T));}}finally{Marshal.FreeHGlobal(buffer);}return result;}
 public static DisplaySnapshot CaptureDisplays(){DisplayPath[] paths;DisplayMode[] modes;Query(out paths,out modes);return new DisplaySnapshot{paths=Pack(paths),modes=Pack(modes),pathCount=(uint)paths.Length,modeCount=(uint)modes.Length};}
 public static void ApplyDisplays(DisplaySnapshot snapshot,bool single){
  DisplayPath[] paths=Unpack<DisplayPath>(snapshot.paths,snapshot.pathCount);DisplayMode[] modes=Unpack<DisplayMode>(snapshot.modes,snapshot.modeCount);
  if(single){var primary=new List<DisplayPath>();foreach(var p in paths)if(Primary(p,modes))primary.Add(p);if(primary.Count!=1)throw new InvalidOperationException("Primary 2560x1440 display is ambiguous");paths=primary.ToArray();}
  // Validate the exact primary path and existing timings before applying anything.
  WinCheck(SetDisplayConfig((uint)paths.Length,paths,(uint)modes.Length,modes,0x60));
  WinCheck(SetDisplayConfig((uint)paths.Length,paths,(uint)modes.Length,modes,0x2A0));
 }
 public static void Extend(){WinCheck(SetDisplayConfig(0,null,0,null,0x44));WinCheck(SetDisplayConfig(0,null,0,null,0x84));}
}
