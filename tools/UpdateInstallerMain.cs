using System;
namespace PaperGreen {
 internal static class UpdateInstallerMain {
  [STAThread]static int Main(string[] args){if(args.Length!=2||args[0]!="--plan")return 2;return UpdateInstaller.Run(args[1]);}
 }
}
