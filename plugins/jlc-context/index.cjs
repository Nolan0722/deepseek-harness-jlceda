'use strict';
const net=require('node:net');
const crypto=require('node:crypto');
const {RULES,contextText}=require('./prompt.cjs');
exports.name='jlc-eda-context';
exports.inject=['tools','workingDirectory','systemPrompt'];
function request(pipe,value,signal){return new Promise((resolve,reject)=>{
  const socket=net.connect(pipe);socket.setEncoding('utf8');let buffer='';
  const timer=setTimeout(()=>socket.destroy(Error('EDA context request timed out')),70000);
  const cancel=()=>socket.destroy(Error('EDA call cancelled'));
  if(signal?.aborted){clearTimeout(timer);socket.destroy();reject(Error('EDA call cancelled'));return;}
  signal?.addEventListener('abort',cancel,{once:true});
  socket.on('connect',()=>socket.write(JSON.stringify(value)+'\n'));
  socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>4e6){socket.destroy(Error('EDA response too large'));return}if(buffer.includes('\n')){try{const response=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));response.ok?resolve(response.value):reject(Error(`${response.error.code}: ${response.error.message}`));}catch(error){reject(error)}socket.end();}});
  socket.on('error',reject);socket.on('close',()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(Error('EDA context connection closed'));});
});}
exports.apply=async function(ctx,config){
  const facts=new Map();
  const agentOf=context=>context.agent||(context.scope?.session?context.scope:null);
  const workspaceOf=agent=>({root:agent.session.header.cwd||null,cwd:ctx.workingDirectory.get(agent.session)});
  const liveText=context=>contextText(facts.get(agentOf(context)?.session?.id)||{state:'unavailable',reason:'CONTEXT_NOT_REFRESHED'});
  ctx.systemPrompt.section({name:'jlceda:rules',order:50,interpolate:false,text:RULES});
  ctx.systemPrompt.context({name:'jlceda:live',order:50,required:true,interpolate:false,text:liveText});
  ctx.on('system-prompt/assemble',async(_assembly,context,next)=>{
    const agent=agentOf(context);
    if(agent?.session){
      const signal=context.signal?AbortSignal.any([context.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);
      let value;
      try{value=await request(config.pipe,{action:'prompt-context',conversationId:agent.session.id,workspace:workspaceOf(agent)},signal);}
      catch(error){value={state:'unavailable',reason:'CONTEXT_REFRESH_FAILED',message:error.message,observedAt:new Date().toISOString()};}
      facts.set(agent.session.id,value);
    }
    const assembly=await next();
    return {...assembly,contexts:assembly.contexts.map(row=>row.name==='jlceda:live'?{...row,text:liveText(context)}:row)};
  });
  ctx.on('agent/disposed',({agent})=>facts.delete(agent.session.id));
  const definitions=[
    ['context',{},'Read the live active document of THIS conversation\'s bound EDA project. Documents follow the active tab within that project; other projects/windows are refused. Copy target.documentTabId into every invoke call\'s documentTabId so a later tab switch cannot redirect that operation.'],
    ['help',{path:{type:'string'}},'Discover the EDA CLI capabilities. Execution remains limited to this conversation\'s bound EDA session.'],
    ['discover',{query:{type:'string'},limit:{type:'number'}},'Search native EDA command documentation for this bound conversation.'],
    ['call',{path:{type:'string'},input:{type:'object',additionalProperties:true},documentTabId:{type:'string',description:'Required for invoke: exact target.documentTabId from jlceda_context, retained through read/modify/verify. A changed tab is rejected, never silently retargeted.'},purpose:{type:'string',enum:['query','modify','verify','save']},verifyOf:{type:'string'}},'Proxy native lceda-pro.call on this conversation\'s bound EDA project. For invoke, pass documentTabId from the observed context. Use existing help/doc.api and invoke, not a separate domain API. Optional purpose is an intent label, not a permission sandbox. After modifying, independently read back with purpose verify and optionally verifyOf the returned jlcCall.id. Never repeat a timed-out modification before reading back.'],
  ];
  for(const [tool,properties,description] of definitions)ctx.tools.register({
    name:`jlceda_${tool}`,description,
    parameters:{type:'object',properties,additionalProperties:false,required:tool==='call'?['path']:tool==='discover'?['query']:[]},
    output:{schema:{},render:(_args,value)=>value.content?[...value.content,...(value.jlcCall?[{type:'text',text:JSON.stringify({jlcCall:value.jlcCall})}]:[])]:[{type:'text',text:JSON.stringify(value)}]},
    execute:async(args,execution)=>{
      const conversationId=execution.agent?.session?.id;
      if(!conversationId)throw Error('CONVERSATION_UNBOUND: EDA tools require an actual DSH agent session.');
      const workspace=workspaceOf(execution.agent);
      const result=await request(config.pipe,{action:'tool',conversationId,tool,args,workspace},execution.signal);
      if(result.isError)throw Error(result.content?.find(x=>x.type==='text')?.text||'EDA invocation failed');
      return result;
    },
  });
  // Model-free integration probe, available only in explicitly debug launches.
  if(config.debug){
    const sockets=new Set();
    const scheduleFixtures=new Map();
    const server=net.createServer(socket=>{
      socket.setEncoding('utf8');sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});let buffer='';
      socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>1e6)return socket.destroy();if(!buffer.includes('\n'))return;
        const run=async()=>{
          const query=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));
          const agent=ctx.get('agents')?.get(query.conversationId);
          if(!agent)throw Error('No live DSH agent for this conversation');
          if(query.action==='topbar-transcript-fixture'){
            const path=require('node:path'),{pathToFileURL}=require('node:url');
            const root=path.resolve(__dirname,'../..'),fixtureRoot=path.join(root,'lab/topbar-fixture');
            const relative=path.relative(fixtureRoot,path.resolve(agent.session.header.cwd));
            if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Transcript fixtures require a disposable topbar workspace');
            if(agent.session.log.some(event=>['user/message','assistant/message','turn/start'].includes(event.type)))throw Error('Transcript fixtures require a fresh conversation');
            const {createUserMessage,createAssistantMessage}=await import(pathToFileURL(path.join(root,'runtime/node_modules/@deepseek-ai/dsh-llm/lib/index.js')).href);
            agent.session.append('turn/start',{turn:1});agent.session.append('step/start',{turn:1,step:1});
            agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'自动化布局验证：检查已完成会话的顶部工具栏。'}],source:{kind:'ui-regression-fixture'}}),{surfaceOp:'append'});
            const text='## 自动化布局验证\n\n这是本地构造的已完成会话，用于验证宽屏顶部栏、设置和关联状态菜单。未请求模型，也未执行工程修改。'+(query.long===true?'\n\n输入框回归：读取真实工程状态，执行后回读验证。这段本地测试记录用于覆盖长会话滚动布局。'.repeat(80):'');
            agent.session.append('assistant/message',{turn:1,step:1,message:createAssistantMessage({content:[{type:'text',text}],source:{provider:'ui-regression-fixture',model:'fixture'}}),stream:[]},{surfaceOp:'append'});
            agent.session.append('step/end',{turn:1,step:1});agent.session.append('turn/end',{turn:1,reason:{kind:'completed'}});
            await ctx.get('sessions').flush(agent.session);return {fixture:true,modelRequests:0};
          }
          if(query.action==='list')return ctx.tools.schemas(agent).map(t=>t.name);
          if(query.action==='workspace')return {root:agent.session.header.cwd,cwd:ctx.workingDirectory.get(agent.session)};
          if(query.action==='ptc-regression'){
            if(!ctx.tools.schemas(agent).some(t=>t.name==='run_code'))throw Error('Select the native PTC preset before probing');
            if(typeof query.code!=='string')throw Error('PTC regression code is required');
            return ctx.tools.execute({callId:crypto.randomUUID(),name:'run_code',arguments:{code:query.code,description:'自动化验证 PTC 原生沙箱与嘉立创 MCP'},agent,signal:AbortSignal.timeout(60000)});
          }
          if(query.action==='context-via-presented-tools'){
            const ptc=ctx.tools.schemas(agent).some(t=>t.name==='run_code');
            // Exercise the actual preset presentation, including PTC's nested dispatch.
            return ctx.tools.execute({callId:crypto.randomUUID(),name:ptc?'run_code':'jlceda_context',
              arguments:ptc?{code:'return await tools.jlceda_context({})',description:'读取当前绑定的嘉立创工程状态'}:{},agent,signal:AbortSignal.timeout(60000)});
          }
          if(query.action==='schedule-fixture-create'){
            const record=await ctx.get('schedule').create(agent.session.id,{title:'DSH 自动化设置回归',prompt:'仅用于自动化回归；测试完成即删除。',at:new Date(Date.now()+14*86400000).toISOString()});
            scheduleFixtures.set(record.id,agent.session.id);return record;
          }
          if(query.action==='schedule-fixture-list')return ctx.get('schedule').list({sessionId:agent.session.id});
          if(query.action==='schedule-fixture-delete'){
            if(scheduleFixtures.get(query.id)!==agent.session.id)throw Error('Not a task created by this debug fixture');
            const result=await ctx.get('schedule').delete({sessionId:agent.session.id,id:query.id});scheduleFixtures.delete(query.id);return result;
          }
          if(query.action==='prompt'){
            const assembly=await ctx.systemPrompt.assemble({scope:agent,agent,signal:AbortSignal.timeout(20000)});
            const {renderPrompt}=require(config.systemPromptModule);
            return {prompt:renderPrompt(assembly),contexts:assembly.contexts.filter(x=>x.name==='jlceda:live'),tools:assembly.tools.filter(x=>x.name.startsWith('jlceda_'))};
          }
          if(!/^jlceda_(context|help|discover|call)$/.test(query.name))throw Error('Only bound EDA tools may be probed');
          return ctx.tools.execute({callId:crypto.randomUUID(),name:query.name,arguments:query.args||{},agent,signal:AbortSignal.timeout(60000)});
        };
        run().then(value=>socket.end(JSON.stringify({ok:true,value})+'\n'),error=>socket.end(JSON.stringify({ok:false,error:{message:error.message}})+'\n'));
      });
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.pipe+'-dsh-test',resolve)});
    ctx.effect(()=>()=>{for(const s of sockets)s.destroy();server.close();},'jlc-context debug probe');
  }
};
exports.request=request;
