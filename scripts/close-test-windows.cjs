const {targets,connect}=require('./cdp.cjs');
(async()=>{
  const list=(await targets()).filter(t=>t.type==='page'&&t.url.startsWith('https://client/editor'));
  if(!list.length)throw Error('No isolated editor pages');
  for(const target of list){
    const client=await connect(target);
    try{await client.call('Page.close');}finally{client.close();}
  }
  console.log(JSON.stringify({closedEditorWindows:list.length}));
})().catch(error=>{console.error(error);process.exitCode=1});
