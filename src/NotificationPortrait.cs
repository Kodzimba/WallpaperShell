using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace PaperGreen {
 // Only the exact appLogoOverride from an unambiguous, OS-owned Telegram toast.
 // Paths/pixels stay private to the native feed; no network, scan or disk cache.
 internal static class NotificationPortrait {
  const int MaximumBytes=131072;
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern uint GetFinalPathNameByHandle(SafeFileHandle file,StringBuilder path,uint length,uint flags);
  internal static string[] TelegramTempRoots() {
   var roots=new List<string>{Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"Telegram Desktop","tdata","temp")};
   // Portable Telegram keeps the same generated userpic directory by its exe.
   try {foreach(var process in Process.GetProcessesByName("Telegram"))using(process){try{roots.Add(Path.Combine(Path.GetDirectoryName(process.MainModule.FileName),"tdata","temp"));}catch{}}}catch{}
   return roots.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
  }
  internal static bool TryPath(string source,IEnumerable<string> roots,out string path) {
   path=null;
   try {
    Uri uri;if(String.IsNullOrWhiteSpace(source)||source.Length>4096||source.Any(Char.IsControl)||!Uri.TryCreate(source,UriKind.Absolute,out uri)||!uri.IsFile||uri.IsUnc||!String.IsNullOrEmpty(uri.Host)||!String.IsNullOrEmpty(uri.Query)||!String.IsNullOrEmpty(uri.Fragment)||!String.IsNullOrEmpty(uri.UserInfo))return false;
    var local=uri.LocalPath.Replace('/','\\');
    if(local.Length<4||!Char.IsLetter(local[0])||local[1]!=':'||local[2]!='\\'||local.Substring(2).Contains(':'))return false;
    local=Path.GetFullPath(local);
    string name=Path.GetFileName(local),stem=Path.GetFileNameWithoutExtension(name);
    if(!name.EndsWith(".png",StringComparison.OrdinalIgnoreCase)||stem.Length<1||stem.Length>16||stem.Any(c=>!Uri.IsHexDigit(c)))return false;
    string directory=Path.GetDirectoryName(local);
    if(roots==null||!roots.Any(root=>!String.IsNullOrWhiteSpace(root)&&String.Equals(Path.GetFullPath(root).TrimEnd('\\','/'),directory,StringComparison.OrdinalIgnoreCase)))return false;
    if(new DriveInfo(Path.GetPathRoot(local)).DriveType!=DriveType.Fixed)return false;
    path=local;return true;
   }catch{return false;}
  }
  internal static string Load(string source,IEnumerable<string> roots) {
   string path;if(!TryPath(source,roots,out path))return "";
   try {
    // Never follow junctions/symlinks out of Telegram's generated temp folder.
    for(string part=path;!String.IsNullOrEmpty(part);part=Path.GetDirectoryName(part))if((File.GetAttributes(part)&FileAttributes.ReparsePoint)!=0)return "";
    using(var file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)) {
     var final=new StringBuilder(4096);uint length=GetFinalPathNameByHandle(file.SafeFileHandle,final,(uint)final.Capacity,0);
     if(length==0||length>=final.Capacity||!String.Equals(final.ToString(),"\\\\?\\"+path,StringComparison.OrdinalIgnoreCase)||file.Length<24||file.Length>MaximumBytes)return "";
     var bytes=new byte[(int)file.Length];int offset=0;
     while(offset<bytes.Length){int count=file.Read(bytes,offset,bytes.Length-offset);if(count<=0)return "";offset+=count;}
     return Normalize(bytes);
    }
   }catch{return "";}
  }
  internal static string Normalize(byte[] bytes) {
   if(bytes==null||bytes.Length<24||bytes.Length>MaximumBytes)return "";
   byte[] signature={137,80,78,71,13,10,26,10};
   if(!signature.SequenceEqual(bytes.Take(8))||bytes[12]!=73||bytes[13]!=72||bytes[14]!=68||bytes[15]!=82)return "";
   uint width=Dimension(bytes,16),height=Dimension(bytes,20);
   if(width==0||height==0||width>512||height>512)return "";
   try {using(var input=new MemoryStream(bytes))using(var source=Image.FromStream(input,false,true)) {
    if(source.Width!=(int)width||source.Height!=(int)height)return "";
    foreach(int size in new[]{64,32})using(var bitmap=new Bitmap(size,size))using(var graphics=Graphics.FromImage(bitmap))using(var output=new MemoryStream()) {
     float side=Math.Min(source.Width,source.Height);
     graphics.InterpolationMode=InterpolationMode.HighQualityBicubic;graphics.PixelOffsetMode=PixelOffsetMode.HighQuality;
     graphics.DrawImage(source,new RectangleF(0,0,size,size),new RectangleF((source.Width-side)/2,(source.Height-side)/2,side,side),GraphicsUnit.Pixel);
     bitmap.Save(output,ImageFormat.Png);if(output.Length<=16384)return "data:image/png;base64,"+Convert.ToBase64String(output.ToArray());
    }
   }}catch{}
   return "";
  }
  static uint Dimension(byte[] bytes,int at){return ((uint)bytes[at]<<24)|((uint)bytes[at+1]<<16)|((uint)bytes[at+2]<<8)|bytes[at+3];}
 }
}
