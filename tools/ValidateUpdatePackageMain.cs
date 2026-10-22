using System;
using System.IO;
using System.Linq;
using System.Threading;
namespace PaperGreen {
 internal static class ValidateUpdatePackageMain {
  static int Main(string[] args){
   string stage=null;
   try{
    if(args.Length!=4||UpdateFiles.Version(args[1])==null)throw new AppUpdateException("invalid-validator-arguments");
    string archive=Path.GetFullPath(args[0]),version=args[1],repository=args[2],expected=args[3];UpdateFiles.NoReparse(archive);
    var info=new FileInfo(archive);if(!info.Exists||info.Length<1||info.Length>UpdateFiles.MaxArchive)throw new AppUpdateException("invalid-archive");
    string digest=UpdateFiles.Hash(archive);if(expected!="-"&&(!UpdateFiles.Digest(expected)||digest!=expected))throw new AppUpdateException("digest-mismatch");
    stage=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"package-validation-"+Guid.NewGuid().ToString("N"));
    var manifest=UpdateFiles.Extract(archive,stage,version,CancellationToken.None);var config=AppUpdateConfig.Read(stage);
    if(config.Version!=version||config.Repository!=repository||config.AssetName!="WallpaperShell-win-x64.zip")throw new AppUpdateException("package-config-mismatch");
    Console.WriteLine(UpdateFiles.Json().Serialize(new{status="pass",version=version,platform="win-x64",files=manifest.files.Length,archiveBytes=info.Length,expandedBytes=manifest.files.Sum(file=>file.size),sha256=digest,downloadedCodeExecuted=false}));return 0;
   }catch(Exception error){Console.Error.WriteLine(error is AppUpdateException?((AppUpdateException)error).Code:"package-validation-failed");return 1;}
   finally{
    if(stage!=null){string expected=Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
     if(Path.GetFullPath(stage).StartsWith(expected,StringComparison.OrdinalIgnoreCase)&&Path.GetFileName(stage).StartsWith("package-validation-",StringComparison.Ordinal)&&Directory.Exists(stage)){UpdateFiles.NoReparse(stage);Directory.Delete(stage,true);}
    }
   }
  }
 }
}
