namespace PaperGreen {
 internal static class ThemeSupport {
  internal static bool Known(string theme){return theme=="paper-green"||theme=="classic"||theme=="luna-blue";}
  internal static bool DesktopHub(string theme){return theme=="paper-green"||theme=="luna-blue";}
  internal static string PagePrefix(string theme){return theme=="classic"?"classic/":theme=="luna-blue"?"luna-blue/":"";}
 }
}
