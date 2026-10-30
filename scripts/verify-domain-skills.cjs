'use strict';
// Model-free integration with the locked DSH services and an actual npm-packed
// copy of our plugin. No EDA client is launched and no project is modified.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const runtimeRequire=createRequire(path.join(root,'runtime/package.json'));
const native=name=>import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/'+name)).href);
const names=['jlceda-pcb','jlceda-schematic'];
const contentText=messages=>messages.flatMap(m=>m.content).filter(c=>c.type==='text').map(c=>c.text).join('\n');

test('packaged domain skills use native discovery, invocation and lifecycle',async t=>{
  const cache=path.join(root,'.cache');fs.mkdirSync(cache,{recursive:true});
  const fixture=fs.mkdtempSync(path.join(cache,'domain-skills-'));
  let ctx;
  try{
    const npm=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
    // The bundled Node has no npm; setup requires npm on PATH.
    const npmCli=fs.existsSync(npm)?npm:spawnSync('where.exe',['npm'],{encoding:'utf8',windowsHide:true}).stdout.trim().split(/\r?\n/).map(p=>path.join(path.dirname(p),'node_modules/npm/bin/npm-cli.js')).find(p=>fs.existsSync(p));
    assert.ok(npmCli,'npm is required for the package regression');
    const packed=spawnSync(process.execPath,[npmCli,'pack','--json','--ignore-scripts','--pack-destination',fixture],{cwd:path.join(root,'plugins/jlc-context'),encoding:'utf8',windowsHide:true});
    assert.equal(packed.status,0,packed.stderr);
    const manifest=JSON.parse(packed.stdout)[0];
    const files=manifest.files.map(f=>f.path);
    for(const name of names)for(const suffix of ['SKILL.md','references/design.md','references/verification.md'])assert.ok(files.includes(`skills/${name}/${suffix}`));
    assert.ok(files.every(f=>/^(?:index\.cjs|client\.js|prompt\.cjs|cordis\.patch\.yml|package\.json|README\.md|locale\/[^/]+\.json|skills\/[^/]+\/(?:SKILL\.md|references\/[^/]+\.md))$/.test(f)),files.join('\n'));
    const installed=path.join(fixture,'node_modules/@jlc-agent/dsh-context');fs.mkdirSync(installed,{recursive:true});
    const unpack=spawnSync('tar.exe',['-xf',path.join(fixture,manifest.filename),'-C',installed,'--strip-components','1'],{encoding:'utf8',windowsHide:true});
    assert.equal(unpack.status,0,unpack.stderr);
    fs.symlinkSync(path.join(root,'runtime/node_modules/@deepseek-ai'),path.join(fixture,'node_modules/@deepseek-ai'),'junction');
    const plugin=require(installed);
    const [{Context,Service},{default:SystemPrompt},{default:ToolRuntime},{default:AgentRegistry,agentEvents},{default:SkillRegistry},toolSkill,{Session,SESSION_FORMAT_VERSION},{createUserMessage},{createScope},{PtcRuntime},presentation]=await Promise.all([
      native('cordis'),native('dsh-system-prompt'),native('dsh-tools'),native('dsh-agent'),native('dsh-skill'),native('dsh-tool-skill'),native('dsh-session'),native('dsh-llm'),native('dsh-scope'),native('dsh-ptc-runtime'),native('dsh-agent-tool-presentation'),
    ]);
    ctx=new Context();
    // Only the cwd owner is a fixture. Skill parsing, registry, dispatch,
    // session events, scoped presentation and plugin teardown are upstream DSH.
    class WorkingDirectoryFixture extends Service{
      constructor(c){super(c,'workingDirectory');}
      get(session){return session.header.cwd;}
      async ensure(agent){return agent.session.header.cwd;}
    }
    await ctx.plugin(WorkingDirectoryFixture);
    await ctx.plugin(SystemPrompt,{});await ctx.plugin(ToolRuntime,{});
    await ctx.plugin(AgentRegistry);await ctx.plugin(SkillRegistry);
    const pipe='\\\\.\\pipe\\jlc-dsh-context-unused-domain-skills';
    let mount=ctx.plugin(plugin,{pipe});await mount;
    await ctx.plugin(toolSkill,{});
    const workspace=path.join(fixture,'中文工程 带空格');fs.mkdirSync(workspace);
    const agent={id:'domain-skills-standard',options:{},status:'idle'};
    agent.session=Session.create(agent.id,[],{version:SESSION_FORMAT_VERSION,id:agent.id,createdAt:0,cwd:workspace,isSeeded:false});
    agent.ctx=createScope(ctx,agent).ctx;
    const lookup={cwd:workspace,scope:agent};
    const fire=messages=>agentEvents(ctx,agent).waterfall('agent/pre-step',{messages,turn:1,step:1,signal:AbortSignal.timeout(10000)},async()=>({kind:'enter',messages}));

    await t.test('packed resources resolve from the relocated package and catalogs stay concise',async()=>{
      const entries=await ctx.skills.list(lookup);assert.deepEqual(entries.map(s=>s.name),names);
      for(const entry of entries){
        assert.equal(entry.provider,'jlc-agent');assert.equal(entry.source,'bundled');
        assert.deepEqual(entry.invocation,{modelInvocable:true,userInvocable:true});
        assert.equal(entry.resourceBase.path,path.join(installed,'skills',entry.name));
        const skill=await ctx.skills.get(entry.name,lookup);
        assert.ok(skill.content.includes('documentTabId'));assert.ok(!skill.content.startsWith('---'));
        const links=[...skill.content.matchAll(/\]\((references\/[^)]+)\)/g)].map(m=>m[1]);
        assert.deepEqual(links.sort(),['references/design.md','references/verification.md']);
        for(const link of links)assert.ok(fs.readFileSync(path.join(skill.resourceBase.path,link),'utf8').length>100);
      }
      const decision=await fire([]);assert.equal(decision.kind,'enter');
      const catalog=decision.messages.find(m=>m.source.kind==='skill-catalog');
      assert.deepEqual(catalog.source.entries.map(s=>s.name),names);
      assert.ok(!contentText([catalog]).includes('## 1. 读取真实状态'));
      assert.deepEqual(ctx.tools.schemas(agent).map(s=>s.name).sort(),['jlceda_call','jlceda_context','jlceda_discover','jlceda_help','skill']);
    });

    await t.test('native skill tool and slash invocation load both workflows without EDA calls',async()=>{
      for(const name of names){
        const result=await ctx.tools.execute({callId:'load-'+name,name:'skill',arguments:{name},agent,signal:AbortSignal.timeout(10000)});
        assert.equal(result.isError,false,JSON.stringify(result));assert.equal(result.value.name,name);
        assert.ok(contentText([{content:result.content}]).includes(`<skill_content name="${name}">`));
        assert.ok(result.value.content.includes('jlceda_call'));
        const message=createUserMessage({content:[{type:'text',text:`/${name} 检查当前设计`}],source:{kind:'user'}});
        const decision=await fire([message]);
        const injected=decision.messages.filter(m=>m.source.kind==='skill-invocation');
        assert.equal(injected.length,1);assert.equal(injected[0].source.name,name);
        assert.ok(contentText(injected).includes(result.value.content));
      }
    });

    await t.test('PTC presentation retains the native skill catalog and loader in its SDK',async()=>{
      // Presentation-only sentinel; this test never executes run_code or
      // changes sandbox policy. Windows sandbox execution has its own regression.
      class PresentationRuntime extends PtcRuntime{
        language='typescript';isolation='test-no-execution';
        resolve(){throw Error('This regression must not execute PTC');}
        run(){throw Error('This regression must not execute PTC');}
      }
      await ctx.plugin(PresentationRuntime);
      const row=agent.ctx.plugin(presentation,{mode:'ptc'});await row;
      try{
      assert.equal(ctx.tools.modeFor(agent),'ptc');
      const decision=await fire([]);
      assert.deepEqual(decision.messages.find(m=>m.source.kind==='skill-catalog').source.entries.map(s=>s.name),names);
      // The deliberately nonexistent host pipe reports unavailable; no EDA runs.
      const assembled=await ctx.systemPrompt.assemble({scope:agent});
      assert.deepEqual(assembled.tools.map(s=>s.name),['run_code']);
      assert.ok(assembled.sections.some(s=>s.name==='tools:sdk'&&s.text.includes('skill')));
      }finally{await row.dispose();}
      assert.ok(ctx.tools.schemas(agent).some(s=>s.name==='skill'));
    });

    await t.test('unload and reload remove and restore native skills without duplicates',async()=>{
      await mount.dispose();assert.deepEqual(await ctx.skills.list(lookup),[]);
      assert.deepEqual(ctx.tools.schemas(agent).map(s=>s.name),['skill']);
      const unavailable=await ctx.tools.execute({callId:'unloaded',name:'skill',arguments:{name:names[0]},agent,signal:AbortSignal.timeout(10000)});
      assert.equal(unavailable.isError,true);
      mount=ctx.plugin(plugin,{pipe});await mount;
      assert.deepEqual((await ctx.skills.list(lookup)).map(s=>s.name),names);
    });
  }finally{
    await ctx?.fiber.dispose();
    // Only remove this test's generated directory, never a computed external path.
    assert.equal(path.dirname(path.resolve(fixture)),cache);
    assert.ok(path.basename(fixture).startsWith('domain-skills-'));
    fs.rmSync(fixture,{recursive:true,force:true});
  }
});
