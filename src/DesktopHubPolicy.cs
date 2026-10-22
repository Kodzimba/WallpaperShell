using System;
using System.Collections.Generic;

namespace PaperGreen {
 internal static class DesktopHubPolicy {
  internal static string Text(Dictionary<string,object> value,string key){object raw;return value!=null&&value.TryGetValue(key,out raw)?raw as string:null;}
  internal static bool Request(Dictionary<string,object> value){
   Guid id;if(value==null||Text(value,"type")!="desktop-hub-request"||!Guid.TryParseExact(Text(value,"requestId"),"D",out id))return false;
   string action=Text(value,"action");string[] required,optional=new string[0];
   if(action=="window-preview"){required=new[]{"id","rect"};optional=new[]{"appearance"};}
   else if(action=="window-activate"||action=="window-close"||action=="notification-activate"||action=="notification-dismiss")required=new[]{"id"};
   else if(action=="window-preview-close"){required=new string[0];optional=new[]{"id"};}
   else if(action=="notifications-access"||action=="notifications-settings"||action=="start-menu")required=new string[0];else return false;
   foreach(string key in required)if(!value.ContainsKey(key))return false;
   foreach(string key in value.Keys){if(key=="type"||key=="requestId"||key=="action")continue;if(Array.IndexOf(required,key)<0&&Array.IndexOf(optional,key)<0)return false;}
   return true;
  }
  internal static bool Allowed(string action,bool paper,bool ready,bool suspended,bool modal,bool panel){
   if(action=="window-preview-close")return true;
   return paper&&ready&&!suspended&&!modal&&!panel;
  }
 }
}
