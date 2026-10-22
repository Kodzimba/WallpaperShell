using System;
using System.Reflection;
using System.Runtime.InteropServices;
using PaperGreen;
class AudioTests {
 static void Require(bool ok,string message){if(!ok)throw new Exception(message);}
 static int Main(){try{
  const int n=2048;var silence=AudioLoopback.Spectrum(new double[n],0,48000);foreach(var value in silence)Require(value==0,"Silence must stay zero");
  var signal=new double[n];for(int i=0;i<n;i++)signal[i]=.25*Math.Sin(2*Math.PI*1000*i/48000);
  var fft=AudioLoopback.Spectrum(signal,0,48000);int max=0;for(int i=0;i<fft.Length;i++){Require(!Double.IsNaN(fft[i])&&fft[i]>=0&&fft[i]<=1,"Finite bounded spectrum");if(fft[i]>fft[max])max=i;}
  double low=30*Math.Pow(18000.0/30,max/64.0),high=30*Math.Pow(18000.0/30,(max+1)/64.0);Require(low<1100&&high>900&&fft[max]>.1,"A real 1kHz tone must reach its frequency band");
  for(int i=0;i<n;i++)signal[i]*=.25;var quiet=AudioLoopback.Spectrum(signal,0,48000);Require(Math.Abs(quiet[max]/fft[max]-.25)<.001,"FFT amplitude must follow the input");
  var random=new Random(42);for(int i=0;i<n;i++)signal[i]=random.NextDouble()-.5;
  foreach(int rate in new[]{44100,48000,96000}){
   var workspace=new AudioLoopback.SpectrumWorkspace(n,rate);var stereo=new double[128];
   foreach(int cursor in new[]{0,1,1023,2047}){
    var expected=Reference(signal,cursor,rate);workspace.Compute(signal,cursor,stereo,0);
    for(int i=0;i<64;i++)Require(Math.Abs(expected[i]-stereo[i])<1e-12,"Reusable FFT preserves every rotated noise band");
    workspace.Compute(new double[n],cursor,stereo,64);
    for(int i=0;i<64;i++)Require(stereo[64+i]==0&&Math.Abs(expected[i]-stereo[i])<1e-12,"No stale imaginary values or stereo cross-contamination");
   }
  }
  AppDomain.MonitoringIsEnabled=true;var reused=new AudioLoopback.SpectrumWorkspace(n,48000);var output=new double[128];reused.Compute(signal,0,output,0);GC.Collect();long before=AppDomain.CurrentDomain.MonitoringTotalAllocatedMemorySize;
  for(int i=0;i<400;i++)reused.Compute(signal,i%n,output,i%2*64);
  GC.Collect();long allocated=AppDomain.CurrentDomain.MonitoringTotalAllocatedMemorySize-before;Require(allocated<32768,"Streaming FFT must reuse buffers instead of allocating per frame");
  var sample=typeof(AudioLoopback).GetMethod("Sample",BindingFlags.Static|BindingFlags.NonPublic);IntPtr bytes=Marshal.AllocHGlobal(8);try{
   Marshal.Copy(BitConverter.GetBytes(.5f),0,bytes,4);Require(Math.Abs((float)sample.Invoke(null,new object[]{bytes,32,true})-.5f)<.00001,"Float mix decoding");
   Marshal.WriteInt16(bytes,-16384);Require(Math.Abs((float)sample.Invoke(null,new object[]{bytes,16,false})+.5f)<.00001,"Signed PCM decoding");
   Marshal.WriteByte(bytes,0,0);Marshal.WriteByte(bytes,1,0);Marshal.WriteByte(bytes,2,0xc0);Require(Math.Abs((float)sample.Invoke(null,new object[]{bytes,24,false})+.5f)<.00001,"Signed 24-bit PCM decoding");
  }finally{Marshal.FreeHGlobal(bytes);}
  Console.WriteLine("Audio tests passed: silence, frequency, amplitude, float/PCM16/PCM24, exact reusable stereo FFT at 3 sample rates; 400 computations allocated "+allocated+" bytes.");return 0;
 }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}}
 static double[] Reference(double[] ring,int cursor,int rate){
  int n=ring.Length;var re=new double[n];var im=new double[n];for(int i=0;i<n;i++)re[i]=ring[(i+cursor)%n]*(.5-.5*Math.Cos(2*Math.PI*i/(n-1)));
  for(int i=1,j=0;i<n;i++){int bit=n>>1;for(;(j&bit)!=0;bit>>=1)j^=bit;j^=bit;if(i<j){double x=re[i];re[i]=re[j];re[j]=x;}}
  for(int len=2;len<=n;len<<=1){double angle=-2*Math.PI/len,sr=Math.Cos(angle),si=Math.Sin(angle);for(int i=0;i<n;i+=len){double wr=1,wi=0;for(int j=0;j<len/2;j++){int a=i+j,b=a+len/2;double r=re[b]*wr-im[b]*wi,q=re[b]*wi+im[b]*wr;re[b]=re[a]-r;im[b]=im[a]-q;re[a]+=r;im[a]+=q;double next=wr*sr-wi*si;wi=wr*si+wi*sr;wr=next;}}}
  var result=new double[64];double top=Math.Min(18000,rate/2.0);for(int i=0;i<64;i++){int lo=Math.Max(1,(int)Math.Floor(30*Math.Pow(top/30,i/64.0)*n/rate)),hi=Math.Min(n/2,(int)Math.Ceiling(30*Math.Pow(top/30,(i+1)/64.0)*n/rate));double peak=0;for(int b=lo;b<=Math.Max(lo,hi)&&b<n/2;b++)peak=Math.Max(peak,Math.Sqrt(re[b]*re[b]+im[b]*im[b])*4/n);result[i]=Math.Min(1,peak);}return result;
 }
}
