using System;

namespace PaperGreen {
 internal enum WebViewRecoveryDecision { Ignored, Queued, Exhausted }
 // UI-thread state only. A failure reserves one recovery before BeginInvoke,
 // so repeated notifications cannot queue parallel EnsureCoreWebView2Async calls.
 internal sealed class WebViewRecovery {
  long generation;bool creating,queued,closed,notice;int recoveries;DateTime window=DateTime.MinValue;
  internal bool Current(long token){return !closed&&token==generation;}
  internal bool BeginInitial(out long token){token=0;if(closed||generation!=0)return false;creating=true;token=++generation;return true;}
  internal WebViewRecoveryDecision Request(long token,DateTime now){
   if(!Current(token)||creating||queued)return WebViewRecoveryDecision.Ignored;
   if(window==DateTime.MinValue||now-window>=TimeSpan.FromMinutes(1)){window=now;recoveries=0;notice=false;}
   if(recoveries>=3){if(notice)return WebViewRecoveryDecision.Ignored;notice=true;return WebViewRecoveryDecision.Exhausted;}
   recoveries++;queued=true;return WebViewRecoveryDecision.Queued;
  }
  internal bool BeginQueued(long expected,out long token){token=0;if(!Current(expected)||!queued||creating)return false;queued=false;creating=true;token=++generation;return true;}
  internal void CancelQueued(long token){if(Current(token))queued=false;}
  internal bool Complete(long token){if(!Current(token))return false;creating=false;return true;}
  internal void Close(){closed=true;generation++;creating=false;queued=false;}
 }
}
