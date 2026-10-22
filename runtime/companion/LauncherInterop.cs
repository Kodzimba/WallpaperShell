using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;

// Shell icon extraction and Explorer's existing Show desktop icons command.
// No item moves, registry layout edits, deletion, or Explorer restart.
public static class VGLauncherShell {
 public sealed class ShellImage { public string png; public int width,height; public string kind; }
 [StructLayout(LayoutKind.Sequential)] struct SIZE {public int cx,cy;public SIZE(int x,int y){cx=x;cy=y;}}
 [ComImport,Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IImageFactory {
  [PreserveSig]int GetImage(SIZE size,uint flags,out IntPtr bitmap);
 }
 [DllImport("shell32.dll",CharSet=CharSet.Unicode,PreserveSig=true)] static extern int SHCreateItemFromParsingName(string path,IntPtr context,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out IImageFactory factory);
 [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int type,width,height,widthBytes;public ushort planes,bitsPixel;public IntPtr bits; }
 [StructLayout(LayoutKind.Sequential)] struct BITMAPINFO { public uint size;public int width,height;public ushort planes,bitCount;public uint compression,sizeImage;public int xPels,yPels;public uint used,important,color; }
 [DllImport("gdi32.dll")] static extern int GetObject(IntPtr bitmap,int size,out BITMAP result);
 [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
 [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
 [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr bitmap);
 [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr dc,IntPtr bitmap,uint start,uint lines,[Out]byte[] bits,ref BITMAPINFO info,uint usage);
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SHFILEINFO {
  public IntPtr hIcon; public int iIcon; public uint attributes;
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string displayName;
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=80)] public string typeName;
 }
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SHGetFileInfo(string path,uint attrs,ref SHFILEINFO info,uint size,uint flags);
 [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern uint ExtractIconEx(string path,int index,[Out]IntPtr[] large,[Out]IntPtr[] small,uint count);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string name,string caption);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string name,string caption);
 delegate bool EnumProc(IntPtr hwnd,IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr data);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint msg,UIntPtr wParam,IntPtr lParam,uint flags,uint timeout,out UIntPtr result);
 static IntPtr View() {
  IntPtr view=FindWindowEx(FindWindow("Progman",null),IntPtr.Zero,"SHELLDLL_DefView",null);
  if(view!=IntPtr.Zero)return view;
  EnumWindows(delegate(IntPtr window,IntPtr ignored) {
   IntPtr child=FindWindowEx(window,IntPtr.Zero,"SHELLDLL_DefView",null);
   if(child==IntPtr.Zero)return true;view=child;return false;
  },IntPtr.Zero);
  if(view==IntPtr.Zero)throw new InvalidOperationException("Desktop shell view unavailable");
  return view;
 }
 public static bool IconsVisible() {
  IntPtr list=FindWindowEx(View(),IntPtr.Zero,"SysListView32",null);
  if(list==IntPtr.Zero)throw new InvalidOperationException("Desktop icon view unavailable");
  return IsWindowVisible(list);
 }
 public static void SetIconsVisible(bool visible) {
  if(IconsVisible()==visible)return;
  UIntPtr result;
  if(SendMessageTimeout(View(),0x111,new UIntPtr(0x7402),IntPtr.Zero,2,2000,out result)==IntPtr.Zero)
   throw new InvalidOperationException("Explorer did not accept icon visibility command");
  for(int i=0;i<15;i++){if(IconsVisible()==visible)return;System.Threading.Thread.Sleep(100);}
  throw new InvalidOperationException("Desktop icon visibility not confirmed");
 }
 static ShellImage Encode(Bitmap bitmap,string kind) {
  if(kind=="icon"&&(bitmap.Width<96||bitmap.Height<96)){bool visible=false;for(int y=0;y<bitmap.Height&&!visible;y++)for(int x=0;x<bitmap.Width;x++)if(bitmap.GetPixel(x,y).A>16){visible=true;break;}if(!visible)return null;}
  if(kind=="icon"&&bitmap.Width>=96&&bitmap.Height>=96){
   int edge=Math.Max(2,Math.Min(bitmap.Width,bitmap.Height)/50),left=bitmap.Width,top=bitmap.Height,right=-1,bottom=-1;
   for(int y=edge;y<bitmap.Height-edge;y++)for(int x=edge;x<bitmap.Width-edge;x++)if(bitmap.GetPixel(x,y).A>16){left=Math.Min(left,x);top=Math.Min(top,y);right=Math.Max(right,x);bottom=Math.Max(bottom,y);}
   if(right<left||bottom<top)return null;
   // Shell sometimes centers a small legacy icon inside a 256px border. Keep
   // its real pixels, remove only the empty surrounding canvas and that border.
   if(right-left+1<bitmap.Width/2&&bottom-top+1<bitmap.Height/2){
    left=Math.Max(0,left-2);top=Math.Max(0,top-2);right=Math.Min(bitmap.Width-1,right+2);bottom=Math.Min(bitmap.Height-1,bottom+2);
    using(var cropped=bitmap.Clone(new Rectangle(left,top,right-left+1,bottom-top+1),PixelFormat.Format32bppPArgb))return Encode(cropped,kind);
   }
  }
  if(kind=="thumbnail"&&Math.Max(bitmap.Width,bitmap.Height)>384) {
   double scale=384.0/Math.Max(bitmap.Width,bitmap.Height);int w=Math.Max(1,(int)Math.Round(bitmap.Width*scale)),h=Math.Max(1,(int)Math.Round(bitmap.Height*scale));
   using(Bitmap resized=new Bitmap(w,h,PixelFormat.Format32bppPArgb)) {
    using(Graphics draw=Graphics.FromImage(resized)) {draw.CompositingMode=CompositingMode.SourceCopy;draw.InterpolationMode=InterpolationMode.HighQualityBicubic;draw.PixelOffsetMode=PixelOffsetMode.HighQuality;draw.DrawImage(bitmap,new Rectangle(0,0,w,h),0,0,bitmap.Width,bitmap.Height,GraphicsUnit.Pixel);}
    return Encode(resized,kind);
   }
  }
  using(MemoryStream buffer=new MemoryStream()){bitmap.Save(buffer,ImageFormat.Png);return new ShellImage{png=Convert.ToBase64String(buffer.ToArray()),width=bitmap.Width,height=bitmap.Height,kind=kind};}
 }
 static ShellImage FromShellBitmap(IntPtr handle,string kind) {
  BITMAP source;if(GetObject(handle,Marshal.SizeOf(typeof(BITMAP)),out source)==0||source.width<1||source.height<1||source.width>2048||source.height>2048)return null;
  int stride=source.width*4;byte[] pixels=new byte[stride*source.height];
  BITMAPINFO info=new BITMAPINFO{size=40,width=source.width,height=-source.height,planes=1,bitCount=32};IntPtr dc=CreateCompatibleDC(IntPtr.Zero);
  try{if(GetDIBits(dc,handle,0,(uint)source.height,pixels,ref info,0)==0)return null;}finally{DeleteDC(dc);}
  bool alpha=false;for(int i=3;i<pixels.Length;i+=4)if(pixels[i]!=0){alpha=true;break;}
  if(!alpha&&kind=="icon")return null;
  if(!alpha)for(int i=3;i<pixels.Length;i+=4)pixels[i]=255;
  using(Bitmap bitmap=new Bitmap(source.width,source.height,PixelFormat.Format32bppPArgb)) {
   BitmapData locked=bitmap.LockBits(new Rectangle(0,0,source.width,source.height),ImageLockMode.WriteOnly,PixelFormat.Format32bppPArgb);
   try{for(int y=0;y<source.height;y++)Marshal.Copy(pixels,y*stride,IntPtr.Add(locked.Scan0,y*locked.Stride),stride);}finally{bitmap.UnlockBits(locked);}
   return Encode(bitmap,kind);
  }
 }
 public static ShellImage ImageFor(string path,bool thumbnail) {
  if(!thumbnail&&String.Equals(Path.GetExtension(path),".ico",StringComparison.OrdinalIgnoreCase)){
   try{return IcoImage(path);}catch{}
  }
  IImageFactory factory=null;IntPtr handle=IntPtr.Zero;
  try {
   Guid iid=typeof(IImageFactory).GUID;
   if(SHCreateItemFromParsingName(path,IntPtr.Zero,ref iid,out factory)>=0) {
    int size=thumbnail?384:256;
    // BIGGERSIZEOK permits native larger images; deliberately never SCALEUP.
    if(factory.GetImage(new SIZE(size,size),1u|(thumbnail?8u:4u),out handle)>=0&&handle!=IntPtr.Zero){var result=FromShellBitmap(handle,thumbnail?"thumbnail":"icon");if(result!=null)return result;}
   }
  }catch{}finally{if(handle!=IntPtr.Zero)DeleteObject(handle);if(factory!=null)Marshal.ReleaseComObject(factory);}
  return thumbnail?null:IconFallback(path);
 }
 public static ShellImage ResourceImage(string path,int index){
  IntPtr[] large=new IntPtr[1],small=new IntPtr[1];
  try{if(ExtractIconEx(path,index,large,small,1)==0||large[0]==IntPtr.Zero)return null;using(var icon=Icon.FromHandle(large[0]))using(var bitmap=icon.ToBitmap())return Encode(bitmap,"icon");}
  finally{if(large[0]!=IntPtr.Zero)DestroyIcon(large[0]);if(small[0]!=IntPtr.Zero)DestroyIcon(small[0]);}
 }
 static ShellImage IcoImage(string path) {
  byte[] source=File.ReadAllBytes(path);if(source.Length<22||BitConverter.ToUInt16(source,2)!=1)throw new InvalidDataException();
  int count=BitConverter.ToUInt16(source,4),best=-1,bestPixels=0;
  if(count<1||count>256||source.Length<6+16*count)throw new InvalidDataException();
  for(int i=0;i<count;i++){int p=6+i*16,w=source[p]==0?256:source[p],h=source[p+1]==0?256:source[p+1];if(w*h>bestPixels){best=i;bestPixels=w*h;}}
  int entry=6+best*16,length=BitConverter.ToInt32(source,entry+8),offset=BitConverter.ToInt32(source,entry+12);
  if(length<1||length>4*1024*1024||offset<0||offset>source.Length-length)throw new InvalidDataException();
  // Decode one original ICO frame, never a 32px icon centered on a 256px Shell canvas.
  byte[] single=new byte[22+length];Array.Copy(source,0,single,0,6);single[4]=1;single[5]=0;Array.Copy(source,entry,single,6,16);Array.Copy(BitConverter.GetBytes(22),0,single,18,4);Array.Copy(source,offset,single,22,length);
  using(var stream=new MemoryStream(single))using(var icon=new Icon(stream))using(var bitmap=icon.ToBitmap())return Encode(bitmap,"icon");
 }
 static ShellImage IconFallback(string path) {
  SHFILEINFO info=new SHFILEINFO();
  if(SHGetFileInfo(path,0,ref info,(uint)Marshal.SizeOf(info),0x100)==IntPtr.Zero||info.hIcon==IntPtr.Zero)return null;
  try {
   using(Icon icon=Icon.FromHandle(info.hIcon))
   using(Bitmap bitmap=icon.ToBitmap())
   {return Encode(bitmap,"icon");}
  } finally {DestroyIcon(info.hIcon);}
 }
}
