'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{createInterface}=require('node:readline');
const C=require('../wallpaper/custom-widget-model.js');
function findCli(){
 const parent=path.join(process.env.LOCALAPPDATA||'','OpenAI/Codex/bin');
 try{for(const entry of fs.readdirSync(parent,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^[a-f0-9]{8,64}$/i.test(e.name)).sort((a,b)=>fs.statSync(path.join(parent,b.name)).mtimeMs-fs.statSync(path.join(parent,a.name)).mtimeMs)){const file=path.join(parent,entry.name,'codex.exe');if(fs.existsSync(file))return file;}}catch{}
 for(const dir of (process.env.PATH||'').split(path.delimiter)){const file=path.join(dir,'codex.exe');if(fs.existsSync(file))return file;}return null;
}
function responseSchema(){return {type:'object',additionalProperties:false,properties:{answer:{type:'string'},widget:{anyOf:[C.schema,{type:'null'}]}},required:['answer','widget']};}
const instructions=`Ты — встроенный помощник конструктора обоев WallpaperShell. Общайся по-русски. Создавай и изменяй полезные виджеты, отвечай на уточнения. Возвращай JSON по заданной схеме. Никаких инструментов, команд, чтения файлов, подключения аккаунтов, обращения к сети или изменения приложения. Если готов вариант, заполни widget; иначе widget:null и задай вопрос в answer. Пользователь сам добавит результат на экран. Поддерживаются note (текст), metric (метрика), progress (шкала), countdown (дата ISO8601), clock (часы), checklist (список). Доступные binding: none, ramUsed (GiB), ramPercent (%), vramUsed (GiB), vramPercent (%), mouseBattery (%), ping (ms), download/upload (Mbps последнего теста), temperature (температура настроенного пользователем города). Не придумывай новые источники данных. Если запрос требует другого источника/действия, честно объясни это и предложи доступный вариант. art: none/moon/sun/water/orbit/leaf — встроенные иллюстрации. width160..960,height100..700,accent #RRGGBB. Все поля обязательны; неиспользуемые текстовые поля пустые, items пустой массив, binding none. Текст, изображения и метрики масштабируются вместе с блоком. Не помещай HTML/JS, команды, адреса, пути и секреты в результат. В качестве цвета по умолчанию используй #b6d8f8.`;
function createCodex({root,spawnProcess=spawn,cli=findCli()}={}){
 const work=path.join(root,'data/builder-agent'),schemaFile=path.join(work,'response.schema.json');let busy=null,connected=null;
 function status(){return {available:!!cli,provider:'Codex',connected,busy:!!busy};}
 function chat(messages,current,onProgress=()=>{}){
  if(!cli)throw Error('Codex не найден. Установи Codex и войди в свой аккаунт.');if(busy)throw Error('Помощник уже отвечает. Дождись ответа или останови его.');
  if(!Array.isArray(messages)||messages.length<1||messages.length>24||messages.some(m=>!m||Object.keys(m).sort().join(',')!=='role,text'||!['user','assistant'].includes(m.role)||typeof m.text!=='string'||m.text.length>8000)||messages.at(-1).role!=='user')throw Error('Неверный запрос чата.');
  const selected=current?C.spec(current):null;fs.mkdirSync(work,{recursive:true});fs.writeFileSync(schemaFile,JSON.stringify(responseSchema()));
  const args=['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--disable','shell_tool','--disable','apps','--disable','plugins','--disable','multi_agent','--disable','code_mode','--disable','code_mode_host','-c','agents.enabled=false','-c','web_search="disabled"','-c','project_doc_max_bytes=0','-c','approval_policy="never"','--output-schema',schemaFile,'--json','--color','never','-'];
  const child=spawnProcess(cli,args,{cwd:work,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});let output='',bytes=0,done=false,timer;
  const promise=new Promise((resolve,reject)=>{
   const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);busy=null;lines.close();if(error)try{child.kill();}catch{}if(error){connected=false;reject(error);}else{connected=true;resolve(value);}};
   // Bound the stream before readline buffers an arbitrarily long unterminated line.
   child.stdout.on('data',part=>{if(done)return;bytes+=Buffer.byteLength(part);if(bytes>1024*1024)finish(Error('Ответ помощника слишком большой.'));});
   const lines=createInterface({input:child.stdout});lines.on('line',line=>{if(done)return;try{const event=JSON.parse(line);if(event.type==='item.completed'&&event.item?.type==='agent_message')output=event.item.text||'';if(event.type==='turn.started')onProgress('Помощник готовит виджет…');if(event.type==='error')finish(Error('Codex не смог ответить. Проверь вход и доступные лимиты в Codex.'));}catch{}});
   child.stderr.on('data',()=>{});child.on('error',()=>finish(Error('Не удалось запустить Codex. Проверь установку.')));child.on('close',code=>{if(done)return;if(code!==0){finish(Error('Codex не смог ответить. Открой Codex и проверь вход или доступные лимиты.'));return;}try{const raw=JSON.parse(output);if(!raw||Object.keys(raw).sort().join(',')!=='answer,widget'||typeof raw.answer!=='string'||raw.answer.length>12000)throw Error();finish(null,{answer:raw.answer,widget:raw.widget===null?null:C.spec(raw.widget)});}catch{finish(Error('Помощник вернул неподдерживаемый виджет. Попробуй уточнить запрос.'));}});
   timer=setTimeout(()=>{child.kill();finish(Error('Помощник не успел ответить. Попробуй ещё раз.'));},180000);timer.unref();
  });
  busy={child,cancel:()=>child.kill()};child.stdin.on('error',()=>{});child.stdin.end(instructions+'\nТекущий вариант: '+JSON.stringify(selected)+'\nДиалог:\n'+messages.map(m=>(m.role==='user'?'Пользователь':'Помощник')+': '+m.text).join('\n\n'));return promise;
 }
 return {status,chat,stop(){busy?.cancel();}};
}
module.exports={findCli,createCodex,responseSchema,instructions};

