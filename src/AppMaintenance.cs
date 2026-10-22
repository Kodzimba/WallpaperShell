using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;

namespace PaperGreen {
 internal static class AppMaintenanceRules {
  internal static bool Action(string value){return value=="info"||value=="report"||value=="check"||value=="install"||value=="cancel";}
  internal static string ReportUrl(string repository,string version){
   if(String.IsNullOrEmpty(repository)||!Regex.IsMatch(repository,@"\A[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\z")||repository.Contains(".."))return null;
   return "https://github.com/"+repository+"/issues/new?template=bug_report.yml&title="+Uri.EscapeDataString("[Bug] ")+"&version="+Uri.EscapeDataString(version??"");
  }
  internal static string Error(string code){
   switch(code){
    case "not-configured":case "repository-unconfigured":return "Репозиторий обновлений ещё не настроен.";
    case "release-not-found":case "not-found":return "Стабильный релиз ещё не опубликован. Попробуй позже.";
    case "checksum":case "digest":case "hash":case "digest-mismatch":case "invalid-digest":case "missing-digest":case "payload-mismatch":return "Проверка загрузки не пройдена. Обновление не установлено.";
    case "github-rate-limit":return "GitHub временно ограничил проверки. Попробуй позже.";
    case "installation-rolled-back":return "Установка не завершилась. Прежняя версия восстановлена.";
    case "rollback-incomplete":return "Не удалось полностью восстановить версию. Сохрани папку приложения и повтори установку из релиза.";
    case "permission":case "access":return "Нет доступа для обновления этой папки. Перенеси приложение в доступную для записи папку.";
    default:return "Обновление не выполнено. Проверь подключение и повтори попытку.";
   }
  }
 }
 internal sealed partial class AppContext {
  AppUpdates updates;
  AppUpdateRelease updateRelease;
  DateTime updateCheckedAt;
  CancellationTokenSource updateCancellation;
  string updateOwner,updateRequest,updateCheckedOwner;
  AppUpdates Updates {get{if(updates==null)updates=new AppUpdates(Root);return updates;}}
  internal void MaintenanceInfo(Surface source){
   try{var config=Updates.Configuration;source.SendPolicy(new{type="app-maintenance-info",version=config.Version,repository=config.Repository,enabled=config.Enabled,reportAvailable=AppMaintenanceRules.ReportUrl(config.Repository,config.Version)!=null});}
   catch{source.SendPolicy(new{type="app-maintenance-info",version="0.2.1",enabled=false,reportAvailable=false});}
  }
  internal bool MaintenanceRequest(Surface source,Dictionary<string,object> message){
   object type,rawAction,rawId;
   if(!message.TryGetValue("type",out type)||Convert.ToString(type)!="app-maintenance")return false;
   string action=message.TryGetValue("action",out rawAction)?Convert.ToString(rawAction):null;
   string request=message.TryGetValue("requestId",out rawId)?Convert.ToString(rawId):null;Guid parsed;
   if(!AppMaintenanceRules.Action(action)||!Guid.TryParse(request,out parsed))return true;
   if(action=="info"){MaintenanceInfo(source);return true;}
   if(action=="cancel"){if(updateOwner==source.SurfaceId&&updateRequest==request&&updateCancellation!=null)updateCancellation.Cancel();return true;}
   bool installing=action=="install";
   if(Exiting||sessionSuspended||nativeFiles>0||!source.CanInteract||(!installing&&policy.Blocked)||(installing&&!policy.Owns(source.SurfaceId,"update"))){MaintenanceStatus(source,request,"error","Сначала заверши открытое окно приложения.",null,0);return true;}
   MaintenanceAction(source,request,action);return true;
  }
  void MaintenanceStatus(Surface source,string request,string state,string text,string version,long size){source.SendPolicy(new{type="app-maintenance-status",requestId=request,state=state,message=text,version=version,size=size});}
  async void MaintenanceAction(Surface source,string request,string action){
   if(action=="report"){
    try{string url=AppMaintenanceRules.ReportUrl(Updates.Configuration.Repository,Updates.Configuration.Version);if(url==null)throw new InvalidOperationException();Process.Start(new ProcessStartInfo(url){UseShellExecute=true});MaintenanceStatus(source,request,"reported","Форма GitHub открыта в браузере.",null,0);}
    catch{MaintenanceStatus(source,request,"error","Не удалось открыть GitHub. Репозиторий: Kodzimba/WallpaperShell.",null,0);}return;
   }
   if(updateCancellation!=null){MaintenanceStatus(source,request,"error","Проверка или загрузка уже выполняется.",null,0);return;}
   var cancellation=new CancellationTokenSource();updateCancellation=cancellation;updateOwner=source.SurfaceId;updateRequest=request;
   AppUpdateStage staged=null;
   try{
    if(action=="check"){
     updateRelease=null;updateCheckedOwner=null;
     MaintenanceStatus(source,request,"checking","Проверяем стабильный релиз…",null,0);
     updateRelease=await Updates.CheckAsync(cancellation.Token);cancellation.Token.ThrowIfCancellationRequested();updateCheckedAt=DateTime.UtcNow;updateCheckedOwner=source.SurfaceId;
     if(updateRelease==null)MaintenanceStatus(source,request,"latest","Установлена актуальная версия.",null,0);
     else MaintenanceStatus(source,request,"available","Доступна новая версия.",updateRelease.Version,updateRelease.Size);
    }else if(action=="install"){
     var release=updateRelease;if(release==null||updateCheckedOwner!=source.SurfaceId||(DateTime.UtcNow-updateCheckedAt).TotalMinutes>30)throw new InvalidOperationException();
     MaintenanceStatus(source,request,"downloading","Скачиваем обновление…",release.Version,release.Size);
     var progress=new Progress<AppUpdateProgress>(value=>{if(updateCancellation!=cancellation||cancellation.IsCancellationRequested)return;source.SendPolicy(new{type="app-maintenance-progress",requestId=request,phase=value.Phase,bytes=value.Bytes,total=value.TotalBytes});});
     staged=await Updates.StageAsync(release,progress,cancellation.Token);cancellation.Token.ThrowIfCancellationRequested();
     if(Exiting||sessionSuspended||!source.CanInteract||!policy.Owns(source.SurfaceId,"update"))throw new OperationCanceledException();
     MaintenanceStatus(source,request,"installing","Загрузка проверена. Перезапускаем WallpaperShell…",release.Version,release.Size);
     bool launched=await Updates.LaunchInstallerAsync(staged,Mode,cancellation.Token);cancellation.Token.ThrowIfCancellationRequested();
     if(!launched||!policy.Owns(source.SurfaceId,"update"))throw new InvalidOperationException();
     Quit();
    }
   }catch(OperationCanceledException){MaintenanceStatus(source,request,"canceled","Обновление отменено.",null,0);}
   catch(AppUpdateException error){MaintenanceStatus(source,request,"error",AppMaintenanceRules.Error(error.Code),null,0);}
   catch{MaintenanceStatus(source,request,"error",AppMaintenanceRules.Error(null),null,0);}
   finally{if(staged!=null&&!Exiting)Updates.CancelInstaller(staged);if(updateCancellation==cancellation){updateCancellation=null;updateOwner=updateRequest=null;}cancellation.Dispose();}
  }
  void CancelUpdate(){if(updateCancellation!=null)updateCancellation.Cancel();}
 }
}
