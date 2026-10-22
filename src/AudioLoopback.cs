using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace PaperGreen {
 // WASAPI render-loopback only. Samples live in RAM, are reduced to FFT bins,
 // and are neither recorded nor sent to the backend. Never opens eCapture.
 internal sealed class AudioLoopback : IDisposable {
  [ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class Enumerator {}
  [ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevices {
   [PreserveSig]int EnumAudioEndpoints(int flow,uint state,out IntPtr devices);
   [PreserveSig]int GetDefaultAudioEndpoint(int flow,int role,out IDevice device);
   [PreserveSig]int GetDevice([MarshalAs(UnmanagedType.LPWStr)]string id,out IDevice device);
   [PreserveSig]int RegisterEndpointNotificationCallback(IntPtr callback);
   [PreserveSig]int UnregisterEndpointNotificationCallback(IntPtr callback);
  }
  [ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevice {
   [PreserveSig]int Activate(ref Guid iid,uint context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)]out object result);
   [PreserveSig]int OpenPropertyStore(uint access,out IntPtr store);
   [PreserveSig]int GetId([MarshalAs(UnmanagedType.LPWStr)]out string id);
   [PreserveSig]int GetState(out uint state);
  }
  [ComImport,Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IClient {
   [PreserveSig]int Initialize(int share,uint flags,long duration,long period,IntPtr format,IntPtr session);
   [PreserveSig]int GetBufferSize(out uint frames);[PreserveSig]int GetStreamLatency(out long value);[PreserveSig]int GetCurrentPadding(out uint value);
   [PreserveSig]int IsFormatSupported(int share,IntPtr format,out IntPtr closest);[PreserveSig]int GetMixFormat(out IntPtr format);
   [PreserveSig]int GetDevicePeriod(out long normal,out long minimum);[PreserveSig]int Start();[PreserveSig]int Stop();[PreserveSig]int Reset();
   [PreserveSig]int SetEventHandle(IntPtr handle);[PreserveSig]int GetService(ref Guid iid,[MarshalAs(UnmanagedType.IUnknown)]out object result);
  }
  [ComImport,Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ICapture {
   [PreserveSig]int GetBuffer(out IntPtr data,out uint frames,out uint flags,out ulong devicePosition,out ulong clockPosition);
   [PreserveSig]int ReleaseBuffer(uint frames);[PreserveSig]int GetNextPacketSize(out uint frames);
  }
  const int N=2048;readonly object gate=new object();readonly AutoResetEvent wake=new AutoResetEvent(false);readonly Thread thread;
  [StructLayout(LayoutKind.Explicit)]struct FloatBits{[FieldOffset(0)]public int Raw;[FieldOffset(0)]public float Value;}
  [StructLayout(LayoutKind.Explicit)]struct DoubleBits{[FieldOffset(0)]public long Raw;[FieldOffset(0)]public double Value;}
  static readonly double[] Hann=Window(N),ZeroSpectrum=new double[128];
  static double[] Window(int n){var w=new double[n];for(int i=0;i<n;i++)w[i]=.5-.5*Math.Cos(2*Math.PI*i/(n-1));return w;}
  volatile bool stopping,enabled=true;double[] latest=new double[128];string status="starting";long frames;DateTime received=DateTime.MinValue;
  public AudioLoopback(){thread=new Thread(Run);thread.Name="WallpaperShell output spectrum";thread.IsBackground=true;thread.SetApartmentState(ApartmentState.MTA);thread.Start();}
  public void SetEnabled(bool value){if(enabled==value)return;enabled=value;wake.Set();}
  public double[] Read(out string state,out long count,out double age){lock(gate){state=status;count=frames;age=received==DateTime.MinValue?1e12:Math.Max(0,(DateTime.UtcNow-received).TotalMilliseconds);return (double[])latest.Clone();}}
  void Publish(double[] values,string state){lock(gate){latest=values;status=state;frames++;received=DateTime.UtcNow;}}
  static void Check(int hr){if(hr<0)Marshal.ThrowExceptionForHR(hr);}
  static void Release(object value){if(value!=null&&Marshal.IsComObject(value))Marshal.ReleaseComObject(value);}
  static float Sample(IntPtr p,int bits,bool floating){
   if(floating&&bits==32)return new FloatBits{Raw=Marshal.ReadInt32(p)}.Value;
   if(floating&&bits==64)return (float)new DoubleBits{Raw=Marshal.ReadInt64(p)}.Value;
   if(bits==16)return Marshal.ReadInt16(p)/32768f;
   if(bits==24){int v=Marshal.ReadByte(p)|(Marshal.ReadByte(p,1)<<8)|(Marshal.ReadByte(p,2)<<16);return (v<<8)/2147483648f;}
   if(bits==32)return Marshal.ReadInt32(p)/2147483648f;throw new NotSupportedException("Unsupported output format");
  }
  void Run(){
   while(!stopping){
    if(!enabled){Publish(ZeroSpectrum,"paused");wake.WaitOne();continue;}
    IDevices devices=null;IDevice device=null;IClient client=null;ICapture capture=null;IntPtr format=IntPtr.Zero;
    try{
     devices=(IDevices)new Enumerator();Check(devices.GetDefaultAudioEndpoint(0,1,out device));string initial;Check(device.GetId(out initial));
     var id=typeof(IClient).GUID;object obj;Check(device.Activate(ref id,23,IntPtr.Zero,out obj));client=(IClient)obj;Check(client.GetMixFormat(out format));
     int tag=(ushort)Marshal.ReadInt16(format),channels=Marshal.ReadInt16(format,2),rate=Marshal.ReadInt32(format,4),stride=Marshal.ReadInt16(format,12),bits=Marshal.ReadInt16(format,14);
     bool floating=tag==3||tag==65534&&Marshal.ReadInt32(format,24)==3;
     if(channels<1||channels>32||rate<8000||rate>384000||!(bits==16||bits==24||bits==32||floating&&bits==64)||stride<channels*(bits/8))throw new NotSupportedException();
     Check(client.Initialize(0,0x20000,1000000,0,format,IntPtr.Zero));id=typeof(ICapture).GUID;Check(client.GetService(ref id,out obj));capture=(ICapture)obj;Check(client.Start());
     double[] left=new double[N],right=new double[N];var fft=new SpectrumWorkspace(N,rate);int cursor=0,total=0;var timer=Stopwatch.StartNew();long lastFft=0,lastCheck=0,lastData=0;
     while(!stopping&&enabled){
      if(timer.ElapsedMilliseconds-lastCheck>=2000){lastCheck=timer.ElapsedMilliseconds;IDevice current=null;try{Check(devices.GetDefaultAudioEndpoint(0,1,out current));string currentId;Check(current.GetId(out currentId));if(currentId!=initial)break;}finally{Release(current);}}
      uint packet;Check(capture.GetNextPacketSize(out packet));
      while(packet>0){
       IntPtr bytes;uint count,flags;ulong a,b;Check(capture.GetBuffer(out bytes,out count,out flags,out a,out b));
       try{for(int f=0;f<count;f++){
        bool silent=(flags&2)!=0||bytes==IntPtr.Zero;float l=silent?0:Sample(IntPtr.Add(bytes,f*stride),bits,floating),r=silent?0:channels>1?Sample(IntPtr.Add(bytes,f*stride+bits/8),bits,floating):l;
        left[cursor]=float.IsNaN(l)||float.IsInfinity(l)?0:l;right[cursor]=float.IsNaN(r)||float.IsInfinity(r)?0:r;cursor=(cursor+1)%N;total=Math.Min(N,total+1);
       }}finally{Check(capture.ReleaseBuffer(count));}lastData=timer.ElapsedMilliseconds;Check(capture.GetNextPacketSize(out packet));
      }
      if(timer.ElapsedMilliseconds-lastFft>=40){lastFft=timer.ElapsedMilliseconds;var spectrum=new double[128];if(total==N&&timer.ElapsedMilliseconds-lastData<200){fft.Compute(left,cursor,spectrum,0);fft.Compute(right,cursor,spectrum,64);}Publish(spectrum,"ready");}
      wake.WaitOne(12);
     }
    }catch{Publish(ZeroSpectrum,"unavailable");wake.WaitOne(1500);}
    finally{if(client!=null)try{client.Stop();}catch{}Release(capture);Release(client);Release(device);Release(devices);if(format!=IntPtr.Zero)Marshal.FreeCoTaskMem(format);}
   }
  }
  // Public within the assembly for deterministic sine/silence tests; no device or microphone needed.
  internal static double[] Spectrum(double[] ring,int cursor,int rate){
   var result=new double[64];new SpectrumWorkspace(ring.Length,rate).Compute(ring,cursor,result,0);return result;
  }
  // One workspace belongs to the capture thread and serves the two channels in
  // sequence. Published bins remain separate immutable snapshots for UI readers.
  internal sealed class SpectrumWorkspace {
   readonly int n;readonly double[] re,im,window;readonly int[] lower=new int[64],upper=new int[64];
   internal SpectrumWorkspace(int size,int rate){
    if(size<2||(size&(size-1))!=0||rate<=0)throw new ArgumentOutOfRangeException();
    n=size;re=new double[n];im=new double[n];window=n==N?Hann:Window(n);double top=Math.Min(18000,rate/2.0);
    for(int i=0;i<64;i++){lower[i]=Math.Max(1,(int)Math.Floor(30*Math.Pow(top/30,i/64.0)*n/rate));upper[i]=Math.Max(lower[i],Math.Min(n/2,(int)Math.Ceiling(30*Math.Pow(top/30,(i+1)/64.0)*n/rate)));}
   }
   internal void Compute(double[] ring,int cursor,double[] result,int offset){
    if(ring==null||ring.Length!=n||cursor<0||cursor>=n||result==null||offset<0||offset>result.Length-64)throw new ArgumentException("Invalid spectrum buffer");
    bool audible=false;for(int i=0;i<n;i++){re[i]=ring[(i+cursor)%n]*window[i];if(re[i]!=0)audible=true;}
    // A silent WASAPI packet is still a valid packet. Preserve exact zero
    // rather than running both FFTs continuously while the output is silent.
    if(!audible){Array.Clear(result,offset,64);return;}
    Array.Clear(im,0,n);
   for(int i=1,j=0;i<n;i++){int bit=n>>1;for(; (j&bit)!=0;bit>>=1)j^=bit;j^=bit;if(i<j){double x=re[i];re[i]=re[j];re[j]=x;}}
   for(int len=2;len<=n;len<<=1){double angle=-2*Math.PI/len,sr=Math.Cos(angle),si=Math.Sin(angle);for(int i=0;i<n;i+=len){double wr=1,wi=0;for(int j=0;j<len/2;j++){int a=i+j,b=a+len/2;double r=re[b]*wr-im[b]*wi,q=re[b]*wi+im[b]*wr;re[b]=re[a]-r;im[b]=im[a]-q;re[a]+=r;im[a]+=q;double next=wr*sr-wi*si;wi=wr*si+wi*sr;wr=next;}}}
    for(int i=0;i<64;i++){double peak=0;for(int b=lower[i];b<=upper[i]&&b<n/2;b++)peak=Math.Max(peak,Math.Sqrt(re[b]*re[b]+im[b]*im[b])*4/n);result[offset+i]=Math.Min(1,peak);}
   }
  }
  public void Dispose(){stopping=true;wake.Set();if(thread.Join(2500))wake.Dispose();}
 }
}
