using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

namespace PaperGreen {
 // The WebView also receives private desktop content. A frontend regression
 // must never turn that content into persisted diagnostics. Unknown fields and
 // free-form strings are discarded at this last native persistence boundary.
 internal static class NativeDiagnostics {
  sealed class Projection {
   readonly Dictionary<string,object> source;
   internal readonly Dictionary<string,object> Value=new Dictionary<string,object>();
   internal Projection(object input){source=input as Dictionary<string,object>??new Dictionary<string,object>();}
   internal void Numbers(string names,double maximum=1000000000000){foreach(string name in names.Split(' ')){object raw;if(!source.TryGetValue(name,out raw))continue;if(raw==null){Value[name]=null;continue;}if(!(raw is int||raw is long||raw is double||raw is decimal||raw is float||raw is short||raw is byte))continue;double number=Convert.ToDouble(raw);if(!Double.IsNaN(number)&&!Double.IsInfinity(number)&&number>=0&&number<=maximum)Value[name]=number;}}
   internal void Bools(string names){foreach(string name in names.Split(' ')){object raw;if(source.TryGetValue(name,out raw)&&raw is bool)Value[name]=raw;}}
   internal void Enum(string name,string allowed){object raw;if(!source.TryGetValue(name,out raw))return;if(raw==null){Value[name]=null;return;}var text=raw as string;if(text!=null&&allowed.Split(' ').Contains(text,StringComparer.Ordinal))Value[name]=text;}
   internal void Child(string name,Func<object,Dictionary<string,object>> project){object input;if(!source.TryGetValue(name,out input))return;if(input==null){Value[name]=null;return;}var value=project(input);if(value!=null&&value.Count>0)Value[name]=value;}
   internal void Pair(string name){object raw;if(!source.TryGetValue(name,out raw))return;var pair=raw as IList;if(pair==null||pair.Count!=2)return;var values=new double[2];for(int i=0;i<2;i++){if(!(pair[i] is int||pair[i] is long||pair[i] is double||pair[i] is decimal))return;values[i]=Convert.ToDouble(pair[i]);if(Double.IsNaN(values[i])||Double.IsInfinity(values[i])||values[i]<0||values[i]>32768)return;}Value[name]=values;}
  }
  const string States="unknown unavailable loading starting saved saving local memory conflict error ok stale ready disabled enabled denied not-supported identity-required not-requested checking allowed";
  internal static Dictionary<string,object> Project(object input){
   if(!(input is Dictionary<string,object>))return null;
   var p=new Projection(input);p.Enum("profile","auto display-1 display-2");p.Enum("scene","luna-water polymer still unavailable off paused reduced fallback running starting");p.Enum("moonMaterial","brightness-only");
   p.Numbers("frames frameAge glErrorProbeAge waterDraws spectrumDraws audioFrames audioAge");p.Numbers("glError",65535);p.Numbers("waterFps renderFps",240);p.Numbers("audioEnergy audioPeak",1);p.Numbers("barHeight",10000);p.Bools("contextLost renderSleeping waterSleeping settingsOpen launcherPresent");p.Pair("viewport");
   p.Child("sceneGeometry",value=>{var s=new Projection(value);s.Numbers("aspect",100);s.Numbers("cssWidth cssHeight bufferWidth bufferHeight",32768);return s.Value;});
   p.Child("windowPolicy",value=>{var s=new Projection(value);s.Bools("mounted pending blocked owned active suspended");s.Enum("activePanel","settings themes launcher");s.Enum("pendingPanel","settings themes launcher");s.Enum("modal","import export power shell notifications update");return s.Value;});
   p.Child("sources",value=>{var s=new Projection(value);foreach(string name in new[]{"system","network","mouse","weather","ecoflow","pet","media","speedtest","desktop","events"})s.Enum(name,States);return s.Value;});
   p.Child("layout",Layout);return p.Value.Count>0?p.Value:null;
  }
  static Dictionary<string,object> Layout(object value){
   var p=new Projection(value);p.Enum("theme","paper-green classic luna-blue");p.Enum("profile","display-1 display-2");p.Enum("status",States);p.Numbers("revision",2147483647);p.Numbers("widgetCount renderedPanels matchedPanels",1024);p.Bools("settingsMounted editorEntryMounted editorToolbarMounted editorOverlayMounted fileBridgeReady");
   p.Child("maintenance",v=>{var s=new Projection(v);s.Bools("mounted updateMounted reportMounted");s.Enum("phase","idle acquiring checking available latest downloading verifying installing canceled error reported");return s.Value;});
   p.Child("editor",v=>{var s=new Projection(v);s.Bools("editing snapping dragging toolbarMounted");s.Numbers("guides boxes targets commits",1000000);s.Enum("selected","clock calendar weather system network mouse media openwindows notifications launcher scene ecoflow screens audio pet");s.Child("history",h=>{var t=new Projection(h);t.Bools("canUndo canRedo");t.Numbers("undoCount redoCount",100000);return t.Value;});return s.Value;});
   p.Child("devices",v=>{var s=new Projection(v);s.Bools("mounted network gpu");s.Enum("mouse",States);return s.Value;});
   p.Child("builder",v=>{var s=new Projection(v);s.Bools("mounted aiAvailable");s.Numbers("customWidgets",100);s.Enum("status",States);return s.Value;});
   p.Child("transfer",v=>{var s=new Projection(v);s.Bools("mounted busy open");s.Numbers("buttons",100);return s.Value;});
   p.Child("desktopHub",v=>{var s=new Projection(v);s.Bools("mounted startMenuMounted appearanceShortcut windowCloseMounted scrolling notificationActivationMounted notificationDismissalMounted");s.Enum("windowStatus",States);s.Enum("notificationStatus",States);s.Numbers("windowCount windowRendered windowColumns windowRows notificationCount notificationRendered actionableNotifications notificationTickers activeNotificationTickers",10000);return s.Value;});
   p.Child("pixelEqualizer",v=>{var s=new Projection(v);s.Bools("mounted");s.Numbers("bars",256);s.Enum("signal","unknown paused silent reactive quiet reacting");return s.Value;});
   p.Child("settings",v=>{var s=new Projection(v);s.Bools("unified legacyThemePanel");s.Numbers("sections paletteEditors",100);return s.Value;});
   p.Child("launcher",v=>{var s=new Projection(v);s.Bools("mounted categoryDragAvailable desktop overlayHost nativeOverlayAvailable remotePending remoteShown");return s.Value;});return p.Value;
  }
 }
 internal sealed class NativeDiagnosticsGate {
  readonly Dictionary<string,long> previous=new Dictionary<string,long>(StringComparer.Ordinal);readonly long interval;
  internal NativeDiagnosticsGate(long frequency){if(frequency<1)throw new ArgumentOutOfRangeException("frequency");interval=frequency;}
  internal bool Allow(string profile,long now){
   if(profile!="display-1"&&profile!="display-2"||now<0)return false;
   long last;if(previous.TryGetValue(profile,out last)&&now-last<interval)return false;previous[profile]=now;return true;
  }
 }
 internal static class NativeWebMessages {
  internal const int MaxJsonCharacters=131072;
  internal static bool Bounded(string json){return json!=null&&json.Length<=MaxJsonCharacters;}
  internal static bool WeatherLink(string value){return String.Equals(value,"https://open-meteo.com/",StringComparison.Ordinal);}
 }
}
