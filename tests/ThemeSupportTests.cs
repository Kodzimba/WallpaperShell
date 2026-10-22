using System;
using PaperGreen;
class ThemeSupportTests {
 static int Main(){int checks=0;foreach(string theme in new[]{"paper-green","classic","luna-blue"}){if(!ThemeSupport.Known(theme))throw new Exception("Missing known theme");checks++;}
 foreach(string theme in new[]{"paper-green","luna-blue"}){if(!ThemeSupport.DesktopHub(theme))throw new Exception("Desktop Hub must use the existing policy");checks++;}
 if(ThemeSupport.DesktopHub("classic")||ThemeSupport.Known("../../evil")||ThemeSupport.Known(null))throw new Exception("Unknown or Classic capability widened");checks+=3;
 if(ThemeSupport.PagePrefix("luna-blue")!="luna-blue/"||ThemeSupport.PagePrefix("classic")!="classic/"||ThemeSupport.PagePrefix("paper-green")!="")throw new Exception("Wrong fixed navigation");checks+=3;Console.WriteLine(checks+" native theme checks passed.");return 0;}
}
