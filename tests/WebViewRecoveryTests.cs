using System;
using PaperGreen;
class WebViewRecoveryTests {
 static int checks;
 static void Require(bool value,string name){checks++;if(!value)throw new Exception(name);}
 static void Main(){
  var policy=new WebViewRecovery();long first,next,unused;var now=new DateTime(2026,10,21,20,0,0,DateTimeKind.Utc);
  Require(policy.BeginInitial(out first)&&policy.Current(first),"Initial creation receives a current generation");
  Require(!policy.BeginInitial(out unused),"Shown cannot create another initial view");
  Require(policy.Request(first,now)==WebViewRecoveryDecision.Ignored,"Failure during initialization cannot create a parallel view");
  Require(policy.Complete(first),"Current initialization completes");
  for(int i=0;i<3;i++){
   Require(policy.Request(first,now.AddSeconds(i))==WebViewRecoveryDecision.Queued,"One recovery is reserved within the budget");
   for(int duplicate=0;duplicate<20;duplicate++)Require(policy.Request(first,now)==WebViewRecoveryDecision.Ignored,"Repeated notifications coalesce before the queued callback runs");
   Require(policy.BeginQueued(first,out next)&&next!=first,"Queued recovery creates one new generation");
   Require(!policy.Current(first)&&!policy.Complete(first),"Old async continuation cannot complete or modify the replacement");
   Require(!policy.BeginQueued(first,out unused),"Stale queued callback cannot start a replacement");
   Require(policy.Request(next,now)==WebViewRecoveryDecision.Ignored,"Failure cannot start parallel initialization");
   Require(policy.Complete(next),"Replacement initialization completes");first=next;
  }
  Require(policy.Request(first,now.AddSeconds(10))==WebViewRecoveryDecision.Exhausted,"Fourth recovery reports the budget once");
  for(int duplicate=0;duplicate<20;duplicate++)Require(policy.Request(first,now.AddSeconds(11))==WebViewRecoveryDecision.Ignored,"Exhausted failures cannot repeat the dialog");
  Require(policy.Request(first,now.AddMinutes(1))==WebViewRecoveryDecision.Queued,"A later minute replenishes the recovery budget");
  policy.CancelQueued(first);Require(!policy.BeginQueued(first,out unused),"Cancelled callback cannot create a view");
  policy.Close();Require(!policy.Current(first)&&!policy.Complete(first)&&!policy.BeginQueued(first,out unused),"Disposal invalidates continuations and queued callbacks");
  Require(policy.Request(first,now.AddMinutes(2))==WebViewRecoveryDecision.Ignored,"Disposed views cannot recover or show dialogs");
  Console.WriteLine("WebView recovery policy: "+checks+" checks passed; no WebView, native UI or processes created.");
 }
}
